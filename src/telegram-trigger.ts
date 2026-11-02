/** Telegram Bot API payloads: permissive schemas, Trigger translation, mention detection, and text placeholders. */
import { z } from 'zod'
import type { Trigger } from './contract.ts'
import { key } from './ids.ts'

export const SOURCE = 'telegram'

/** A Telegram account as the Bot API reports it. */
export interface TelegramUser {
  id: number
  is_bot: boolean
  first_name: string
  last_name?: string
  username?: string
}
/** A private chat, group, supergroup, or channel. */
export interface TelegramChat {
  id: number
  type: 'private' | 'group' | 'supergroup' | 'channel'
  title?: string
  username?: string
  is_forum?: boolean
  first_name?: string
  last_name?: string
}
/** One entity (a mention, a command, a link, and so on) inside a message's text or caption. */
export interface TelegramMessageEntity {
  type: string
  offset: number
  length: number
  url?: string
  user?: TelegramUser
  language?: string
  custom_emoji_id?: string
}
/** A message as the Bot API reports it; media fields are kept opaque because the Source is text-only. */
export interface TelegramMessage {
  message_id: number
  message_thread_id?: number
  from?: TelegramUser
  sender_chat?: TelegramChat
  chat: TelegramChat
  date: number
  edit_date?: number
  text?: string
  caption?: string
  entities?: TelegramMessageEntity[]
  caption_entities?: TelegramMessageEntity[]
  reply_to_message?: TelegramMessage
  is_topic_message?: boolean
  is_automatic_forward?: boolean
  photo?: unknown[]
  document?: { file_name?: string; mime_type?: string }
  voice?: unknown
  sticker?: unknown
  video?: unknown
  audio?: unknown
  animation?: unknown
  video_note?: unknown
  location?: unknown
  contact?: unknown
  poll?: unknown
  dice?: unknown
  venue?: unknown
  story?: unknown
}
/** A chat membership change, which the poll loop records but never turns into a Trigger. */
export interface TelegramChatMemberUpdated {
  chat: TelegramChat
  from: TelegramUser
  date: number
  old_chat_member?: unknown
  new_chat_member?: unknown
}
/** One `getUpdates` item; fields this Source does not use stay unknown. */
export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
  edited_message?: TelegramMessage
  channel_post?: TelegramMessage
  edited_channel_post?: TelegramMessage
  my_chat_member?: TelegramChatMemberUpdated
}
/** The stored metadata of one known chat. */
export interface TelegramChatInfo { type: TelegramChat['type']; title?: string; username?: string; name?: string }
/** The part of the configuration Trigger translation reads. */
export interface TelegramTriggerConfig { editsAsNewEvents: boolean }
/** Resolves the Thread a stored Trigger belongs to, used to inherit a replied-to message's Thread. */
export type TelegramParentThread = (triggerId: string) => string | undefined

const UserSchema: z.ZodType<TelegramUser> = z.object({
  id: z.number().int(), is_bot: z.boolean(), first_name: z.string().default(''),
  last_name: z.string().optional(), username: z.string().optional(),
}).passthrough()
const ChatSchema: z.ZodType<TelegramChat> = z.object({
  id: z.number().int(), type: z.enum(['private', 'group', 'supergroup', 'channel']),
  title: z.string().optional(), username: z.string().optional(), is_forum: z.boolean().optional(),
  first_name: z.string().optional(), last_name: z.string().optional(),
}).passthrough()
const MessageEntitySchema: z.ZodType<TelegramMessageEntity> = z.object({
  type: z.string(), offset: z.number().int().nonnegative(), length: z.number().int().nonnegative(),
  url: z.string().optional(), user: z.lazy(() => UserSchema).optional(), language: z.string().optional(),
  custom_emoji_id: z.string().optional(),
}).passthrough()
/** A message; `reply_to_message` is recursive, so the object is built lazily. */
export const MessageSchema: z.ZodType<TelegramMessage> = z.lazy(() => z.object({
  message_id: z.number().int(), message_thread_id: z.number().int().optional(),
  from: UserSchema.optional(), sender_chat: ChatSchema.optional(), chat: ChatSchema, date: z.number().int(), edit_date: z.number().int().optional(),
  text: z.string().optional(), caption: z.string().optional(),
  entities: z.array(MessageEntitySchema).optional(), caption_entities: z.array(MessageEntitySchema).optional(),
  reply_to_message: MessageSchema.optional(), is_topic_message: z.boolean().optional(), is_automatic_forward: z.boolean().optional(),
  photo: z.array(z.unknown()).optional(), document: z.looseObject({ file_name: z.string().optional(), mime_type: z.string().optional() }).optional(),
  voice: z.unknown().optional(), sticker: z.unknown().optional(), video: z.unknown().optional(), audio: z.unknown().optional(),
  animation: z.unknown().optional(), video_note: z.unknown().optional(), location: z.unknown().optional(), contact: z.unknown().optional(),
  poll: z.unknown().optional(), dice: z.unknown().optional(), venue: z.unknown().optional(), story: z.unknown().optional(),
}).passthrough())
const ChatMemberUpdatedSchema: z.ZodType<TelegramChatMemberUpdated> = z.object({
  chat: ChatSchema, from: UserSchema, date: z.number().int(),
  old_chat_member: z.unknown().optional(), new_chat_member: z.unknown().optional(),
}).passthrough()
/** One Bot API update, permissive about fields this Source ignores. */
export const UpdateSchema: z.ZodType<TelegramUpdate> = z.object({
  update_id: z.number().int(),
  message: MessageSchema.optional(), edited_message: MessageSchema.optional(),
  channel_post: MessageSchema.optional(), edited_channel_post: MessageSchema.optional(),
  my_chat_member: ChatMemberUpdatedSchema.optional(),
}).passthrough()

/** Deterministic Trigger ID of one Telegram message. */
export const telegramTriggerId = (chatId: string | number, messageId: string | number): string => key('telegram', `${chatId}:${messageId}`)
/** Deterministic Trigger ID of one edit when edits are received as new events. */
export const telegramEditTriggerId = (chatId: string | number, messageId: string | number, editDate: number): string =>
  key('telegram', `${chatId}:${messageId}:${editDate}`)

const textOf = (message: TelegramMessage): string => message.text ?? message.caption ?? ''
const entitiesOf = (message: TelegramMessage): TelegramMessageEntity[] =>
  [...message.entities ?? [], ...message.caption_entities ?? []]
/**
 * Whether the message addresses the bot: a `mention` of its username, a `text_mention` of its account, a `bot_command`
 * aimed at it, or a reply to one of its messages.
 */
export function mentionBot(message: TelegramMessage, me: TelegramUser): boolean {
  if (message.reply_to_message?.from?.id === me.id) return true
  const text = textOf(message)
  const username = me.username?.toLowerCase()
  return entitiesOf(message).some(entity => {
    if (entity.type === 'text_mention') return entity.user?.id === me.id
    if (entity.type !== 'mention' && entity.type !== 'bot_command') return false
    const value = text.slice(entity.offset, entity.offset + entity.length)
    if (entity.type === 'mention') return !!username && value.toLowerCase() === `@${username}`
    // `/command` in a private chat is for this bot; in a group, `/command@name` must name it.
    const at = value.indexOf('@')
    return at < 0 || (!!username && value.slice(at + 1).toLowerCase() === username)
  })
}

/** A short stand-in for a non-text message, so its Trigger still carries something an assessment can read. */
export function placeholderFor(message: TelegramMessage): string {
  if (message.photo?.length) return '[photo]'
  if (message.document) return `[document${message.document.file_name ? `: ${message.document.file_name}` : ''}]`
  if (message.voice) return '[voice]'
  if (message.sticker) return '[sticker]'
  if (message.video) return '[video]'
  if (message.audio) return '[audio]'
  if (message.animation) return '[animation]'
  if (message.video_note) return '[video note]'
  if (message.location) return '[location]'
  if (message.contact) return '[contact]'
  if (message.poll) return '[poll]'
  if (message.dice) return '[dice]'
  if (message.venue) return '[venue]'
  if (message.story) return '[story]'
  return '[message]'
}
/** The message text, caption, or a placeholder for a message that carries neither. */
export const messageText = (message: TelegramMessage): string => message.text || message.caption || placeholderFor(message)
/**
 * Converts one Bot API message into a Trigger, returning undefined for the bot's own messages.
 * A reply inherits its parent's Thread through `parentThread`; a forum topic and a direct chat have Thread IDs of their own.
 */
export function telegramTrigger(message: TelegramMessage, me: TelegramUser, config: TelegramTriggerConfig,
  parentThread?: TelegramParentThread): Trigger | undefined {
  const from = message.from
  if (from?.id === me.id) return undefined
  const chatId = String(message.chat.id)
  const messageId = String(message.message_id)
  const direct = message.chat.type === 'private'
  const mentioned = mentionBot(message, me)
  const reply = message.reply_to_message
  const inherited = reply ? parentThread?.(telegramTriggerId(chatId, reply.message_id)) : undefined
  // A private chat has one stable Thread; a group's forum topic keeps its own, and a reply inherits its parent's.
  const topic = !direct && message.message_thread_id !== undefined ? `${chatId}:t${message.message_thread_id}` : undefined
  const thread = direct ? `${chatId}:${chatId}` : topic ?? inherited ?? `${chatId}:${messageId}`
  const editDate = config.editsAsNewEvents ? message.edit_date : undefined
  const edited = editDate !== undefined
  const id = editDate !== undefined ? telegramEditTriggerId(chatId, messageId, editDate) : telegramTriggerId(chatId, messageId)
  const at = new Date((editDate ?? message.date) * 1000).toISOString()
  const address = { chatId, messageId, direct: String(direct),
    ...(message.message_thread_id !== undefined ? { messageThreadId: String(message.message_thread_id) } : {}) }
  return {
    id, source: SOURCE, threads: [{ source: SOURCE, id: thread }],
    actor: { source: SOURCE, id: from ? String(from.id) : String(message.sender_chat?.id ?? message.chat.id) },
    human: !!from && !from.is_bot,
    ...(direct ? { addressed: 'direct' as const } : mentioned ? { addressed: 'mention' as const } : {}),
    at, text: messageText(message),
    channel: { source: SOURCE, thread: `telegram:${chatId}`, address },
    meta: { chatId, chatType: message.chat.type, messageId, direct, mentioned, threadId: thread,
      ...(message.message_thread_id !== undefined ? { messageThreadId: String(message.message_thread_id) } : {}),
      ...(reply ? { replyToId: String(reply.message_id) } : {}),
      ...(edited ? { editedAt: at } : {}),
      ...(message.chat.title ? { chatTitle: message.chat.title } : {}),
      ...(from?.username ? { username: from.username } : {}) },
  }
}
