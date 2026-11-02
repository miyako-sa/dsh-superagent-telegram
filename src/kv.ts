/**
 * KV keys owned by this Source plugin.
 *
 * `dsh-superagent` exports the `Key`, `record` and `family` helpers for exactly this purpose ("external Source plugins use
 * `record` and `family` to type their own keys"), so the plugin declares the same key names the bundled Telegram Source
 * used; an instance upgraded in place keeps its read offset, chat labels and bot identity.
 */
import type { TelegramChatInfo, TelegramUser } from './telegram-trigger.ts'

type Key<V> = string & { readonly __value?: V }
type Family<V, A extends unknown[]> = ((...name: A) => Key<V>) & { readonly prefix: string }
const record = <V>(key: string) => key as Key<V>
const family = <V, A extends unknown[] = [string]>(prefix: string): Family<V, A> =>
  Object.assign((...name: A) => `${prefix}${name.join(':')}` as Key<V>, { prefix })

export const KV = {
  /** Per-Source resolved display names, mapping a chat ID to the name the panel shows (`dsh-superagent` key family). */
  sources: { labels: family<Record<string, string>, [source: string]>('source-labels:') },
  telegram: {
    offset: record<number>('telegram-offset'),
    chats: record<Record<string, TelegramChatInfo>>('telegram-chats'),
    me: record<{ tokenEnv: string; user: TelegramUser }>('telegram-me'),
  },
}
