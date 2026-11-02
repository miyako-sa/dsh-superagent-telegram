/** Telegram outbound channel: HTML-safe replies, 4096-character splitting, and chat deep links. */
import type { ChannelLink, OutboundMessage, SourceContext } from './contract.ts'
import { DEFAULT_TOKEN_ENV, TelegramApi, TelegramError, telegramToken } from './telegram-api.ts'
import { telegramTriggerId } from './telegram-trigger.ts'

/** The token environment name of the most recent resolution; `SourceChannel.send` receives no configuration, so
 * `allowed()` records the current one immediately before each delivery. */
let tokenEnv = DEFAULT_TOKEN_ENV
/** Remembers the configured token environment name for the next send. */
export function rememberTokenEnv(name: string): void { tokenEnv = name.trim() || DEFAULT_TOKEN_ENV }

/** The Telegram message limit, in the UTF-16 units JavaScript counts. */
const LIMIT = 4096
/** Splits text into Telegram-sized chunks, preferring a newline and never splitting a surrogate pair. */
export function split4096(text: string, limit = LIMIT): string[] {
  const chunks: string[] = []
  let rest = text
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit)
    if (cut < limit / 2) cut = rest.lastIndexOf(' ', limit)
    if (cut < limit / 2) cut = limit
    if (cut > 0 && /[\uD800-\uDBFF]/.test(rest[cut - 1] ?? '')) cut -= 1
    const chunk = rest.slice(0, cut).trimEnd()
    if (chunk) chunks.push(chunk)
    rest = rest.slice(cut).trimStart()
  }
  if (rest || !chunks.length) chunks.push(rest)
  return chunks
}
/**
 * Escapes HTML and then applies the tiny Markdown subset Telegram replies use: fenced blocks, inline code, bold, and links.
 * Code is stashed before the other rules so its contents stay literal.
 */
export function telegramHtml(text: string): string {
  const escaped = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  const blocks: string[] = []
  const stash = (html: string): string => `\u0000${blocks.push(html) - 1}\u0000`
  let html = escaped.replace(/```([\s\S]*?)```/g, (_, code: string) => stash(`<pre>${code}</pre>`))
  html = html.replace(/`([^`\n]+)`/g, (_, code: string) => stash(`<code>${code}</code>`))
  html = html.replace(/\*\*([^*\n]+?)\*\*/g, (_, bold: string) => `<b>${bold}</b>`)
  html = html.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_, label: string, url: string) => `<a href="${url.replaceAll('"', '&quot;')}">${label}</a>`)
  return html.replace(/\u0000(\d+)\u0000/g, (_, index: string) => blocks[Number(index)] ?? '')
}
const GONE = ['chat not found', 'bot was kicked', 'bot is blocked', 'user is deactivated', 'message thread not found', 'topic_closed', 'chat_write_forbidden']
/** True when Telegram permanently refuses delivery to this conversation or topic. */
export function goneTelegram(error: unknown): boolean {
  return error instanceof TelegramError && error.code === 403
    && GONE.some(description => error.description.toLowerCase().includes(description))
}
/** The `t.me` link of a supergroup message, or an empty string for a private chat or a basic group. */
export function telegramLink(chatId: string, messageId: string): string {
  return chatId.startsWith('-100') ? `https://t.me/c/${chatId.slice(4)}/${messageId}` : ''
}
/** The Channel's display link for an address. */
export const telegramChannelLink = (address: Record<string, string>, _links: Record<string, unknown>): ChannelLink => ({
  url: telegramLink(address.chatId ?? '', address.messageId ?? ''),
  label: { zh: 'Telegram 消息', en: 'Telegram message' },
  ...address.messageId ? { triggerId: telegramTriggerId(address.chatId ?? '', address.messageId) } : {},
})
/**
 * Sends one reply as HTML, disabling link previews and threading it under `messageId` when the address has one.
 * Long text is split into several messages; a permanent refusal is reported as `gone`.
 */
export async function sendTelegram(_host: Pick<SourceContext, 'commands'>, message: OutboundMessage): Promise<'sent' | 'gone'> {
  const { chatId, messageId, messageThreadId } = message.channel.address
  if (!chatId) throw new Error('Missing Telegram reply target')
  const text = message.text.trim()
  if (!text) throw new Error('Missing Telegram reply text')
  const api = new TelegramApi(telegramToken(tokenEnv))
  const thread = messageThreadId ? Number(messageThreadId) : undefined
  const reply = messageId ? { message_id: Number(messageId), allow_sending_without_reply: true } : undefined
  try {
    for (const chunk of split4096(text)) {
      await api.sendMessage({
        chat_id: chatId,
        text: telegramHtml(chunk),
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...(thread !== undefined && Number.isFinite(thread) ? { message_thread_id: thread } : {}),
        ...(reply ? { reply_parameters: reply } : {}),
      })
    }
  } catch (error) {
    if (goneTelegram(error)) return 'gone'
    throw error
  }
  return 'sent'
}
