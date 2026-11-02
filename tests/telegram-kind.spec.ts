import { describe, expect, it } from 'vitest'
import { TelegramConfigSchema, telegramKind, telegramSettings } from '../src/telegram.ts'

const config = (overrides: Record<string, unknown> = {}) => TelegramConfigSchema.parse(overrides)

describe('Telegram kind', () => {
  it('declares the source kind and its health entry', () => {
    expect(telegramKind.kind).toBe('telegram')
    expect(telegramKind.health).toEqual(['telegram'])
  })
  it('receives a direct message only while direct messages are on', () => {
    expect(telegramKind.scope!({ meta: { direct: true } }, config())).toEqual({ listened: true, observed: false, row: 'direct' })
    expect(telegramKind.scope!({ meta: { direct: true } }, config({ directMessages: false })))
      .toEqual({ listened: false, reason: 'direct_messages_not_allowed' })
  })
  it('uses each listed chat listening mode and falls back to the other-chats setting', () => {
    const listed = config({ chats: [{ chatId: '-1001', name: 'G', listen: 'all' }] })
    expect(telegramKind.scope!({ meta: { chatId: '-1001' } }, listed)).toEqual({ listened: true, observed: true, row: '-1001' })
    expect(telegramKind.scope!({ meta: { chatId: '-2002' } }, listed)).toEqual({ listened: false, reason: 'chat_not_listened' })
    expect(telegramKind.scope!({ meta: { chatId: '-2002' } }, config({ otherChats: 'mentions' })))
      .toEqual({ listened: true, observed: false, row: 'other' })
  })
  it('names the answered message as the parent Trigger', () => {
    expect(telegramKind.repliesTo!({ id: 'x', source: 'telegram', at: '', threads: [], meta: { chatId: '5', replyToId: '9' } } as never))
      .toMatch(/^[0-9a-f]{32}$/)
    expect(telegramKind.repliesTo!({ id: 'x', source: 'telegram', at: '', threads: [], meta: { chatId: '5' } } as never)).toBeUndefined()
  })
  it('reads the configured instance and falls back to defaults', () => {
    const host = { sources: { instance: () => undefined, register: () => () => {} } } as never
    expect(telegramSettings(host)).toEqual(TelegramConfigSchema.parse({}))
  })
  it('exports the ticket chat and topic as environment values', () => {
    const values = telegramKind.environment!.values({ trigger: { id: 'x', source: 'telegram', at: '', threads: [], meta: { chatId: '5', messageThreadId: '7' } } as never })
    expect(values).toEqual({ DSH_SUPERAGENT_TELEGRAM_CHAT: '5', DSH_SUPERAGENT_TELEGRAM_THREAD: '7' })
    expect(telegramKind.environment!.values({})).toEqual({ DSH_SUPERAGENT_TELEGRAM_CHAT: '', DSH_SUPERAGENT_TELEGRAM_THREAD: '' })
  })
})
