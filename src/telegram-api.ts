/** Minimal Telegram Bot API client over global `fetch`, with token resolution and retry classification. */
import type { TelegramMessage, TelegramUpdate, TelegramUser } from './telegram-trigger.ts'

/** The environment variable the Telegram bot token is read from unless configuration names another. */
export const DEFAULT_TOKEN_ENV = 'DSH_SUPERAGENT_TELEGRAM_TOKEN'
/** A Bot API failure: `code` is the API/HTTP code (0 for a network failure), and `retryAfter` is 429's wait in seconds. */
export class TelegramError extends Error {
  constructor(readonly code: number, readonly description: string, readonly retryAfter?: number, options?: ErrorOptions) {
    super(description, options)
    this.name = 'TelegramError'
  }
}
/** Resolves the bot token from the process environment; the token is never stored, logged, or put in an error. */
export function telegramToken(tokenEnv: string = DEFAULT_TOKEN_ENV): string {
  const name = tokenEnv.trim() || DEFAULT_TOKEN_ENV
  const token = process.env[name]?.trim()
  if (!token) throw new Error(`The Telegram token environment variable ${name} is not set`)
  return token
}
/** True for failures a later poll can succeed after: rate limits, server errors, and network errors. */
export const retryableTelegram = (error: unknown): boolean => error instanceof TelegramError
  ? error.code === 0 || error.code === 429 || error.code >= 500
  : error instanceof TypeError
/** True for failures retrying cannot fix, such as a rejected token or an unknown chat. */
export const permanentTelegram = (error: unknown): boolean => !retryableTelegram(error)

export interface TelegramUpdatesInput { offset?: number; timeout?: number; limit?: number; allowed_updates?: string[] }
export interface SendMessageInput {
  chat_id: string | number
  text: string
  parse_mode?: 'HTML'
  link_preview_options?: { is_disabled?: boolean }
  reply_parameters?: { message_id: number; allow_sending_without_reply?: boolean }
  message_thread_id?: number
  disable_notification?: boolean
}
export interface SendDocumentInput {
  chat_id: string | number
  data: Uint8Array
  filename: string
  mediaType?: string
  caption?: string
  parse_mode?: 'HTML'
  reply_parameters?: { message_id: number; allow_sending_without_reply?: boolean }
  message_thread_id?: number
}
export interface TelegramChatMember { status: string; user: TelegramUser; is_anonymous?: boolean }
/** A Bot API `File`: `file_path` is relative to `https://api.telegram.org/file/bot<token>/` and valid for about an hour. */
export interface TelegramFile { file_id: string; file_unique_id?: string; file_size?: number; file_path?: string }
export interface TelegramWebhookInfo {
  url: string
  has_custom_certificate?: boolean
  pending_update_count?: number
  last_error_date?: number
  last_error_message?: string
  max_connections?: number
  allowed_updates?: string[]
}
interface ApiResponse<T> {
  ok: boolean
  result?: T
  error_code?: number
  description?: string
  parameters?: { retry_after?: number; migrate_to_chat_id?: number }
}
/** A Bot API client bound to one token; every request is a POST to `https://api.telegram.org/bot<token>/<method>`. */
export class TelegramApi {
  constructor(private readonly token: string) {}
  private url(method: string): string { return `https://api.telegram.org/bot${this.token}/${method}` }
  private async call<T>(method: string, payload: object, signal?: AbortSignal): Promise<T> {
    let response: Response
    try {
      response = await fetch(this.url(method), { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload), ...(signal ? { signal } : {}) })
    } catch (error) {
      if (signal?.aborted) throw error
      throw new TelegramError(0, `Telegram ${method} network error: ${error instanceof Error ? error.message : String(error)}`,
        undefined, { cause: error })
    }
    let body: ApiResponse<T>
    try { body = await response.json() as ApiResponse<T> }
    catch { throw new TelegramError(response.status, `Telegram ${method} returned HTTP ${response.status} without JSON`) }
    if (!body.ok) {
      const parameters = body.parameters
      throw new TelegramError(body.error_code ?? response.status,
        body.description ?? `Telegram ${method} failed with HTTP ${response.status}`, parameters?.retry_after)
    }
    return body.result as T
  }
  /** Sends one file from `file` as a document with `caption`; the field name is `document`. */
  async sendDocument(input: SendDocumentInput, signal?: AbortSignal): Promise<unknown> {
    const form = new FormData()
    form.append('chat_id', String(input.chat_id))
    if (input.caption) form.append('caption', input.caption)
    if (input.parse_mode) form.append('parse_mode', input.parse_mode)
    if (input.message_thread_id !== undefined && Number.isFinite(input.message_thread_id)) form.append('message_thread_id', String(input.message_thread_id))
    if (input.reply_parameters) form.append('reply_parameters', JSON.stringify(input.reply_parameters))
    form.append('document', new Blob([input.data], { type: input.mediaType ?? 'application/octet-stream' }), input.filename)
    let response: Response
    try {
      response = await fetch(this.url('sendDocument'), { method: 'POST', body: form, ...(signal ? { signal } : {}) })
    } catch (error) {
      if (signal?.aborted) throw error
      throw new TelegramError(0, `Telegram sendDocument network error: ${error instanceof Error ? error.message : String(error)}`,
        undefined, { cause: error })
    }
    let body: ApiResponse<unknown>
    try { body = await response.json() as ApiResponse<unknown> }
    catch { throw new TelegramError(response.status, `Telegram sendDocument returned HTTP ${response.status} without JSON`) }
    if (!body.ok) throw new TelegramError(body.error_code ?? response.status,
      body.description ?? `Telegram sendDocument failed with HTTP ${response.status}`, body.parameters?.retry_after)
    return body.result
  }
  getFile(fileId: string, signal?: AbortSignal): Promise<TelegramFile> {
    return this.call<TelegramFile>('getFile', { file_id: fileId }, signal)
  }
  /** Streams a file the Bot API hosts; the bytes go through the same token and are never logged. */
  async download(filePath: string, signal?: AbortSignal): Promise<Response> {
    let response: Response
    try {
      response = await fetch(`https://api.telegram.org/file/bot${this.token}/${filePath}`, { ...(signal ? { signal } : {}) })
    } catch (error) {
      if (signal?.aborted) throw error
      throw new TelegramError(0, `Telegram file download network error: ${error instanceof Error ? error.message : String(error)}`,
        undefined, { cause: error })
    }
    if (!response.ok) throw new TelegramError(response.status, `Telegram file download failed with HTTP ${response.status}`)
    return response
  }
  getMe(signal?: AbortSignal): Promise<TelegramUser> {
    return this.call<TelegramUser>('getMe', {}, signal)
  }
  getUpdates(input: TelegramUpdatesInput, signal?: AbortSignal): Promise<TelegramUpdate[]> {
    return this.call<TelegramUpdate[]>('getUpdates', {
      ...(input.offset !== undefined ? { offset: input.offset } : {}),
      ...(input.timeout !== undefined ? { timeout: input.timeout } : {}),
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
      ...(input.allowed_updates ? { allowed_updates: input.allowed_updates } : {}),
    }, signal)
  }
  sendMessage(input: SendMessageInput, signal?: AbortSignal): Promise<TelegramMessage> {
    return this.call<TelegramMessage>('sendMessage', input, signal)
  }
  getChatAdministrators(chatId: string | number, signal?: AbortSignal): Promise<TelegramChatMember[]> {
    return this.call<TelegramChatMember[]>('getChatAdministrators', { chat_id: chatId }, signal)
  }
  getWebhookInfo(signal?: AbortSignal): Promise<TelegramWebhookInfo> {
    return this.call<TelegramWebhookInfo>('getWebhookInfo', {}, signal)
  }
}
