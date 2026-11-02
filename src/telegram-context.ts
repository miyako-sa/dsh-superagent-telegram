/**
 * The Telegram Source's thread context: what an assessment can read around a Trigger, and how one image of it becomes a
 * model-visible attachment.
 *
 * Messages are read back from the Bot API with `getUpdates` rather than from stored history: the Source already long-polls
 * every update, so a bounded read costs one extra call. Only message ids in the Trigger's own chat are accepted, and an
 * image key must appear in the message text it was cited from, so a model cannot point the reader at arbitrary files.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { TelegramApi, telegramToken } from './telegram-api.ts'
import { downloadMedia, mediaDirectory, readMediaBytes, TELEGRAM_GET_FILE_LIMIT } from './telegram-download.ts'
import { imageKeys, mediaOf, textOfMessage, type TelegramMedia } from './telegram-media.ts'
import type { TelegramMessage } from './telegram-trigger.ts'
import type { ContextMessage, ContextPart, ContextPartName, ImageReadingAgent, ThreadContext, Trigger } from './contract.ts'

/** How many earlier updates one context read asks for; the Bot API returns a whole batch, and only this chat is kept. */
const HISTORY_LIMIT = 100
/** The media kinds that can become an image attachment. */
const IMAGE_KINDS = new Set<TelegramMedia['kind']>(['photo', 'sticker', 'document'])

/** Token and read settings a context read needs; `readPageSize` is ignored (Telegram pages by `message_id`). */
export interface TelegramContextConfig { tokenEnv: string; maxDownloadBytes: number; readPageSize?: number }

const chatOf = (trigger: Trigger): string => String(trigger.meta.chatId ?? '')
const apiFor = (config: TelegramContextConfig): TelegramApi => new TelegramApi(telegramToken(config.tokenEnv))

/** The Telegram message id a Trigger is named after. */
const messageIdOf = (trigger: Trigger): string => String(trigger.meta.messageId ?? '')

/** One update's message as a context message; replies and topic messages keep their place. */
export function contextMessageOf(message: TelegramMessage): ContextMessage {
  const from = message.from
  const at = new Date(message.date * 1000).toISOString()
  const text = textOfMessage(message)
  return { id: String(message.message_id), from: from ? (from.username ? `@${from.username}` : from.first_name) : String(message.sender_chat?.id ?? message.chat.id),
    at, text, ...(from?.is_bot ? { bot: true as const } : {}),
    ...(message.reply_to_message ? { reply_to: String(message.reply_to_message.message_id) } : {}) }
}

/**
 * Reads the messages of one chat around the Trigger: newer messages after it for `thread`, earlier ones for `root`, and the
 * replied-to message alone for `parent`. `getUpdates` pages by update id, not by message id, so the caller hands in the
 * updated-recorded floor it knows (`meta.updateId`); a read never asks below it, so a live poll's cursor is never undone.
 */
async function readChat(api: TelegramApi, trigger: Trigger, part: ContextPartName, cursor: string | undefined,
  signal?: AbortSignal): Promise<ContextPart> {
  const chatId = chatOf(trigger)
  const own = Number(messageIdOf(trigger))
  const floor = Number(trigger.meta.updateId)
  if (part === 'parent') {
    const replyToId = Number(trigger.meta.replyToId)
    if (!Number.isFinite(replyToId) || !Number.isFinite(floor)) return { messages: [], body: { status: 'no_parent' }, status: 'no_parent' }
    const message = await findMessage(api, chatId, replyToId, floor, signal)
    return message ? { messages: [contextMessageOf(message)], body: { status: 'available' } }
      : { messages: [], body: { status: 'unavailable' }, status: 'unavailable' }
  }
  const start = part === 'thread' ? (Number.isFinite(floor) ? floor : 1) : Math.max(1, (Number(cursor ?? floor) || 1) - HISTORY_LIMIT)
  const collected: TelegramMessage[] = []
  let offset = start
  for (let page = 0; page < 3; page += 1) {
    const updates = await api.getUpdates({ offset, timeout: 0, limit: HISTORY_LIMIT, allowed_updates: ['message', 'channel_post'] }, signal)
    if (!updates.length) break
    for (const update of updates) {
      const message = update.message ?? update.channel_post
      if (!message || String(message.chat.id) !== chatId) continue
      if (part === 'thread' ? message.message_id <= own : message.message_id >= own) continue
      collected.push(message)
    }
    offset = updates[updates.length - 1]!.update_id + 1
    if (updates.length < HISTORY_LIMIT) break
  }
  const messages = collected.sort((a, b) => a.message_id - b.message_id).map(contextMessageOf)
  return { messages, body: { status: 'available', chat_id: chatId }, status: 'available',
    ...collected.length ? { next: String(Number(messages[0]!.id)) } : {} }
}

/** Finds one message of `chatId` at or after the recorded update floor. */
async function findMessage(api: TelegramApi, chatId: string, messageId: number, floor: number, signal?: AbortSignal): Promise<TelegramMessage | undefined> {
  let offset = Math.max(1, floor)
  for (let page = 0; page < 3; page += 1) {
    const updates = await api.getUpdates({ offset, timeout: 0, limit: HISTORY_LIMIT, allowed_updates: ['message', 'channel_post'] }, signal)
    if (!updates.length) return undefined
    for (const update of updates) {
      const message = update.message ?? update.channel_post
      if (message && String(message.chat.id) === chatId && message.message_id === messageId) return message
    }
    offset = updates[updates.length - 1]!.update_id + 1
    if (updates.length < HISTORY_LIMIT) return undefined
  }
  return undefined
}

/** Downloads one image of a message and commits it as an attachment for the assessing agent. */
async function readImage(agent: ImageReadingAgent, trigger: Trigger, message: { id: string; text: string }, key: string,
  stateDir: string, config: TelegramContextConfig, signal: AbortSignal): Promise<unknown> {
  if (!imageKeys(message.text).includes(key)) throw new Error('Choose an image key from this message; only its own media can be read')
  const chatId = chatOf(trigger)
  const messageId = Number(message.id)
  if (!Number.isFinite(messageId)) throw new Error('The message id is not a Telegram message id')
  const attachments = agent.ctx.get('attachments')
  if (!attachments) throw new Error('Image reading is unavailable: no attachment service is mounted')
  const api = apiFor(config)
  const floor = Number(trigger.meta.updateId)
  if (!Number.isFinite(floor)) throw new Error('This message has no recorded Telegram update id to read back')
  const found = await findMessage(api, chatId, messageId, floor, signal)
  if (!found) throw new Error('The Telegram message is no longer available for reading')
  const media = mediaOf(found).find(item => item.fileId === key)
  if (!media || !IMAGE_KINDS.has(media.kind)) throw new Error('That file id is not an image of this message')
  const directory = await mkdtemp(join(mediaDirectory(stateDir, telegramToken(config.tokenEnv)), 'image-'))
  try {
    const limit = Math.min(config.maxDownloadBytes, attachments.imageLimits.maxImageBytes, attachments.imageLimits.maxMessageImageBytes, TELEGRAM_GET_FILE_LIMIT)
    const download = await downloadMedia(api, media, directory, limit, signal)
    const mediaType = mediaTypeOf(download.path)
    if (!mediaType) throw new Error('The downloaded file is not a PNG/JPEG/WebP/GIF image')
    const data = await readMediaBytes(download.path, limit)
    signal.throwIfAborted()
    return await attachments.saveImage({ data, mediaType, name: `${basename(download.path, extname(download.path))}${extname(download.path)}` })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/** The media type of a downloaded image from its extension. */
export function mediaTypeOf(path: string): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | undefined {
  const types: Record<string, 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }
  return types[extname(path).toLowerCase()]
}

export const telegramThreadContext: ThreadContext<TelegramContextConfig> = {
  messageId: trigger => messageIdOf(trigger),
  read: async (_commands, trigger, part, cursor, config) => readChat(apiFor(config), trigger, part, cursor),
  images: imageKeys,
  image: (agent, _commands, trigger, message, key, stateDir, signal) =>
    readImage(agent, trigger, message, key, stateDir, configOf(), signal),
}

/**
 * `threadContext.image` receives no configuration, so the installed instance's settings are recorded when the kind's
 * settings are read (`telegramSettings` calls `rememberContextConfig`), the same way `allowed()` records the token env.
 */
let currentConfig: TelegramContextConfig = { tokenEnv: 'DSH_SUPERAGENT_TELEGRAM_TOKEN', maxDownloadBytes: TELEGRAM_GET_FILE_LIMIT }
export function rememberContextConfig(config: TelegramContextConfig): void {
  currentConfig = { tokenEnv: config.tokenEnv, maxDownloadBytes: config.maxDownloadBytes }
}
const configOf = (): TelegramContextConfig => currentConfig
