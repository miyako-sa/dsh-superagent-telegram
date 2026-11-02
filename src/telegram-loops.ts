/** Telegram long-poll loop: tokens, webhook conflicts, offsets, chat metadata, Trigger intake, and health. */
import { setTimeout as delay } from 'node:timers/promises'
import type { SourceContext, Trigger } from './contract.ts'
import { threadKey } from './ids.ts'
import { KV } from './kv.ts'
import { TelegramApi, TelegramError, retryableTelegram, telegramToken } from './telegram-api.ts'
import { rememberTokenEnv, telegramLink } from './telegram-channel.ts'
import { SOURCE, telegramTrigger, UpdateSchema, type TelegramChat, type TelegramMessage, type TelegramUpdate, type TelegramUser }
  from './telegram-trigger.ts'
import type { TelegramConfig } from './telegram.ts'

const wait = (ms: number, signal: AbortSignal): Promise<void> => delay(ms, undefined, { signal }).catch(() => {})
const messageOf = (update: TelegramUpdate, config: TelegramConfig): TelegramMessage | undefined => {
  if (update.message) return update.message
  if (config.channelPosts && update.channel_post) return update.channel_post
  if (!config.editsAsNewEvents) return undefined
  return update.edited_message ?? (config.channelPosts ? update.edited_channel_post : undefined)
}
/** The update types to ask for; channel posts and edits are requested only when their settings allow them. */
export function allowedUpdates(config: Pick<TelegramConfig, 'channelPosts' | 'editsAsNewEvents'>): string[] {
  return ['message', ...(config.channelPosts ? ['channel_post'] : []), 'my_chat_member',
    ...(config.editsAsNewEvents ? ['edited_message'] : []),
    ...(config.channelPosts && config.editsAsNewEvents ? ['edited_channel_post'] : [])]
}
/** Records a chat's type and display name, and its name for the settings form's chat picker. */
function recordChat(ctx: SourceContext, chat: TelegramChat): void {
  const name = chat.title || [chat.first_name, chat.last_name].filter((part): part is string => !!part).join(' ') || chat.username
  const chats = { ...ctx.state.get(KV.telegram.chats) }
  chats[String(chat.id)] = { type: chat.type, ...(chat.title ? { title: chat.title } : {}),
    ...(chat.username ? { username: chat.username } : {}), ...(name ? { name } : {}) }
  ctx.state.set(KV.telegram.chats, chats)
  if (!name) return
  const labels = { ...ctx.state.get(KV.sources.labels(SOURCE)) }
  labels[String(chat.id)] = name
  ctx.state.set(KV.sources.labels(SOURCE), labels)
}
/** Describes the Trigger's Threads so the panel shows the chat and, when available, a `t.me` link. */
function describe(ctx: SourceContext, trigger: Trigger): void {
  const chatId = String(trigger.meta.chatId ?? '')
  if (!chatId) return
  const info = ctx.state.get(KV.telegram.chats)?.[chatId]
  const name = info?.name ?? info?.title ?? info?.username ?? chatId
  const chat = trigger.meta.direct === true ? { value: { zh: '私聊', en: 'Direct message' } } : { value: name }
  const url = telegramLink(chatId, String(trigger.meta.messageId ?? ''))
  for (const ref of trigger.threads) ctx.threads.describe(threadKey(ref), { ...(url ? { url } : {}), facts: { chat } })
}
/** Resolves the bot's own account once per token environment, so its messages can be skipped. */
async function bot(ctx: SourceContext, api: TelegramApi, config: TelegramConfig, signal: AbortSignal): Promise<TelegramUser> {
  const stored = ctx.state.get(KV.telegram.me)
  if (stored?.tokenEnv === config.tokenEnv) return stored.user
  const user = await api.getMe(signal)
  ctx.state.set(KV.telegram.me, { tokenEnv: config.tokenEnv, user })
  return user
}
/**
 * Reads the updates after the stored offset, takes each message in, and advances the offset only after the whole batch
 * has been handled. A failed or aborted batch keeps the offset so stable Trigger IDs deduplicate the replay.
 * @returns how many updates the batch held.
 */
export async function pollTelegram(ctx: SourceContext, api: TelegramApi, config: TelegramConfig, signal: AbortSignal): Promise<number> {
  const me = await bot(ctx, api, config, signal)
  const offset = ctx.state.get(KV.telegram.offset) ?? 0
  const updates = await api.getUpdates({ offset, timeout: config.pollTimeoutSeconds, allowed_updates: allowedUpdates(config) }, signal)
  let next = offset
  for (const raw of updates) {
    if (signal.aborted) throw new Error('The Telegram Source stopped during the poll')
    const rawId = typeof raw === 'object' && raw !== null && typeof (raw as { update_id?: unknown }).update_id === 'number'
      ? (raw as { update_id: number }).update_id : undefined
    const parsed = UpdateSchema.safeParse(raw)
    if (!parsed.success) {
      if (rawId !== undefined) next = Math.max(next, rawId + 1)
      continue
    }
    const update = parsed.data
    next = Math.max(next, update.update_id + 1)
    const message = messageOf(update, config)
    if (message) {
      recordChat(ctx, message.chat)
      const trigger = telegramTrigger(message, me, config, id => ctx.triggers.get(id)?.threads[0]?.id)
      if (!trigger) continue
      await ctx.receive(trigger)
      describe(ctx, trigger)
      continue
    }
    if (update.my_chat_member) recordChat(ctx, update.my_chat_member.chat)
  }
  ctx.state.set(KV.telegram.offset, next)
  return updates.length
}
/** A health detail for a failed poll that does not echo the token. */
function failure(error: unknown): string {
  if (error instanceof TelegramError) {
    if (error.code === 401) return 'Telegram rejected the bot token (401)'
    if (error.code === 409 && /webhook/i.test(error.description)) {
      return 'Telegram reports a webhook conflict (409); remove the webhook so getUpdates can run'
    }
    return error.code ? `Telegram API error ${error.code}: ${error.description}` : `Telegram network error: ${error.description}`
  }
  return String(error)
}
/**
 * Runs the Telegram Source while it is on: waits for setup, resolves the token, refuses to poll while a webhook is set,
 * long-polls, reports health, and retries after one second (or 429's `retry_after`).
 */
export async function runTelegram(ctx: SourceContext, signal: AbortSignal): Promise<void> {
  await ctx.ready
  let failures = 0
  let webhook = false
  while (!signal.aborted) {
    const config = ctx.config<TelegramConfig>(SOURCE)
    if (!config) {
      ctx.report('telegram', { state: 'paused', detail: 'Off' })
      await wait(5000, signal)
      continue
    }
    if (!ctx.configured()) {
      ctx.report('telegram', { state: 'paused', detail: 'Waiting for the deployment check' })
      await wait(5000, signal)
      continue
    }
    rememberTokenEnv(config.tokenEnv)
    let api: TelegramApi
    try { api = new TelegramApi(telegramToken(config.tokenEnv)) }
    catch (error) {
      ctx.report('telegram', { state: 'error', detail: String(error) })
      await wait(5000, signal)
      continue
    }
    if (!webhook) {
      try {
        if ((await api.getWebhookInfo(signal)).url) {
          ctx.report('telegram', { state: 'error',
            detail: 'A Telegram webhook is set, so getUpdates cannot run; remove the webhook (deleteWebhook) and restart' })
          await wait(60_000, signal)
          continue
        }
        webhook = true
        failures = 0
      } catch (error) {
        if (signal.aborted) break
        failures += 1
        if (failures >= config.failuresBeforeError) ctx.report('telegram', { state: 'error', detail: failure(error) })
        await wait(1000, signal)
        continue
      }
    }
    let pause = 1000
    try {
      const updates = await pollTelegram(ctx, api, config, signal)
      failures = 0
      ctx.report('telegram', { state: 'ready', detail: `${updates} updates`, at: new Date().toISOString() })
    } catch (error) {
      if (signal.aborted) break
      failures += 1
      if (failures >= config.failuresBeforeError) ctx.report('telegram', { state: 'error', detail: failure(error) })
      pause = retryableTelegram(error) ? 1000 : 5000
      if (error instanceof TelegramError && error.code === 429 && error.retryAfter) pause = Math.max(pause, error.retryAfter * 1000)
      if (error instanceof TelegramError && error.code === 409 && /webhook/i.test(error.description)) webhook = false
    }
    await wait(pause, signal)
  }
}
