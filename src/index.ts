/**
 * Telegram Source plugin entry for `dsh-superagent`.
 *
 * Registers the `telegram` Source kind on the host's `orchestrator` service and runs its long-poll loop. Everything the
 * plugin needs from the host goes through that one service, so nothing here imports `dsh-superagent` internals.
 */
import type { Context } from '@deepseek-ai/cordis'
import { telegramKind } from './telegram.ts'
import { runTelegram } from './telegram-loops.ts'
import { sourceContext } from './host.ts'
import type { SourceHost } from './contract.ts'

export const name = 'dsh-superagent-telegram'
/** The host service the plugin attaches to; without it the plugin stays inert instead of failing the host. */
export const inject = ['orchestrator']

/**
 * The `orchestrator` service lives on the Cordis context as an ambient declaration made by `dsh-superagent`; this plugin
 * declares the same shape so it can be compiled and loaded without that declaration.
 */
type OrchestratorContext = Context & { readonly orchestrator: SourceHost }

export function apply(ctx: Context): void {
  const orchestrator = (ctx as OrchestratorContext).orchestrator
  ctx.effect(() => orchestrator.sources.register(telegramKind as never), 'telegram: source kind')
  ctx.effect(() => {
    const source = sourceContext(orchestrator, telegramKind)
    const controller = new AbortController()
    // DSH ends its process on an unhandled rejection, so a failure that escapes the loop becomes the Source's health.
    const running = runTelegram(source, controller.signal)
      .catch((error: unknown) => { source.report('telegram', { state: 'error', detail: String(error) }) })
    return async () => { controller.abort(); await running }
  }, 'telegram: poll loop')
}

export { telegramKind, TelegramConfigSchema } from './telegram.ts'
export { runTelegram, pollTelegram, allowedUpdates } from './telegram-loops.ts'
export { telegramTrigger, telegramTriggerId, telegramEditTriggerId, mentionBot, messageText, placeholderFor, SOURCE } from './telegram-trigger.ts'
export { TelegramApi, TelegramError, retryableTelegram, permanentTelegram } from './telegram-api.ts'
export { split4096, telegramHtml, telegramLink, sendTelegram } from './telegram-channel.ts'
export type { TelegramConfig } from './telegram.ts'
export type { TelegramChat, TelegramChatInfo, TelegramMessage, TelegramUpdate, TelegramUser } from './telegram-trigger.ts'
