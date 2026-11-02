import { describe, expect, it, vi } from 'vitest'
import { contextMessageOf, mediaTypeOf, telegramThreadContext } from '../src/telegram-context.ts'
import type { Trigger } from '../src/contract.ts'
import type { TelegramMessage } from '../src/telegram-trigger.ts'

const trigger = (overrides: Record<string, unknown> = {}): Trigger => ({ id: 'x', source: 'telegram', at: '', threads: [],
  text: '', channel: { source: 'telegram', thread: 'telegram:5', address: {} }, meta: { chatId: '5', messageId: '10', updateId: 9, ...overrides } })

const message = (id: number, chatId = 5, extra: Record<string, unknown> = {}): TelegramMessage => ({
  message_id: id, date: 1700000000 + id, chat: { id: chatId, type: 'private' }, from: { id: 7, is_bot: false, first_name: 'Y', username: 'y' },
  text: `m${id}`, ...extra,
} as unknown as TelegramMessage)

describe('contextMessageOf', () => {
  it('names the sender by username and marks bots and replies', () => {
    expect(contextMessageOf(message(3, 5, { reply_to_message: message(2) }))).toEqual({
      id: '3', from: '@y', at: new Date((1700000003) * 1000).toISOString(), text: 'm3', reply_to: '2' })
    expect(contextMessageOf(message(4, 5, { from: { id: 9, is_bot: true, first_name: 'B' } }))).toMatchObject({ from: 'B', bot: true })
  })
})

describe('telegramThreadContext', () => {
  const config = { tokenEnv: 'TG_TEST_TOKEN', maxDownloadBytes: 1024 }
  const setToken = () => { process.env.TG_TEST_TOKEN = '123:abc' }

  it('reads the messages after the Trigger for a thread, ignoring other chats', async () => {
    setToken()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true, result: [
      { update_id: 9, message: message(9, 5) }, { update_id: 10, message: message(10, 5) },
      { update_id: 11, message: message(11, 5) }, { update_id: 12, message: message(12, 99) },
    ] }), { status: 200 }))
    try {
      const part = await telegramThreadContext.read(undefined, trigger(), 'thread', undefined, config)
      expect(part.messages.map(item => item.id)).toEqual(['11'])
      expect(part.status).toBe('available')
      const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))
      expect(body).toMatchObject({ offset: 9, timeout: 0, limit: 100 })
    } finally { fetchMock.mockRestore() }
  })

  it('reads the earlier messages for a root, oldest first', async () => {
    setToken()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true, result: [
      { update_id: 7, message: message(8, 5) }, { update_id: 8, message: message(7, 5) }, { update_id: 9, message: message(10, 5) },
    ] }), { status: 200 }))
    try {
      const part = await telegramThreadContext.read(undefined, trigger(), 'root', undefined, config)
      expect(part.messages.map(item => item.id)).toEqual(['7', '8'])
    } finally { fetchMock.mockRestore() }
  })

  it('returns nothing for a parent when the Trigger is not a reply', async () => {
    const part = await telegramThreadContext.read(undefined, trigger(), 'parent', undefined, config)
    expect(part).toEqual({ messages: [], body: { status: 'no_parent' }, status: 'no_parent' })
  })

  it('exposes only the file ids its own text names', () => {
    expect(telegramThreadContext.images!('see [photo P1] and [document: a.zip D1]')).toEqual(['P1', 'D1'])
  })

  it('refuses an image key the message text does not name', async () => {
    setToken()
    await expect(telegramThreadContext.image!({ ctx: { get: () => undefined } } as never, undefined, trigger(),
      { id: '10', text: 'no media' }, 'P1', '/tmp', new AbortController().signal)).rejects.toThrow(/Choose an image key/)
  })

  it('refuses to read an image without an attachment service', async () => {
    setToken()
    await expect(telegramThreadContext.image!({ ctx: { get: () => undefined } } as never, undefined, trigger(),
      { id: '10', text: '[photo P1]' }, 'P1', '/tmp', new AbortController().signal)).rejects.toThrow(/no attachment service is mounted/)
  })
})

describe('mediaTypeOf', () => {
  it('maps the four image extensions', () => {
    expect(mediaTypeOf('/a/b.jpg')).toBe('image/jpeg')
    expect(mediaTypeOf('/a/b.PNG')).toBe('image/png')
    expect(mediaTypeOf('/a/b.txt')).toBeUndefined()
  })
})
