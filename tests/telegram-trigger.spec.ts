import { describe, expect, it } from 'vitest'
import {
  mentionBot, messageText, placeholderFor, telegramTrigger, telegramTriggerId, type TelegramMessage, type TelegramUser,
} from '../src/telegram-trigger.ts'

const me: TelegramUser = { id: 1, is_bot: true, first_name: 'Bot', username: 'test_bot' }
type Message = TelegramMessage & { chat: { id: number; type: 'private' | 'group' | 'supergroup' | 'channel'; title?: string } }

const privateMessage = (overrides: Partial<Message> = {}): Message => ({
  message_id: 10, date: 1700000000, text: 'hi', chat: { id: 555, type: 'private' },
  from: { id: 7, is_bot: false, first_name: 'Yabo' }, ...overrides,
})

describe('mentionBot', () => {
  it('detects an @ mention of the bot username, case-insensitively', () => {
    const message = privateMessage({ text: 'hey @Test_Bot', entities: [{ type: 'mention', offset: 4, length: 9 }] })
    expect(mentionBot(message as TelegramMessage, me)).toBe(true)
  })
  it('ignores an @ mention of another bot', () => {
    const message = privateMessage({ text: 'hey @other', entities: [{ type: 'mention', offset: 4, length: 6 }] })
    expect(mentionBot(message as TelegramMessage, me)).toBe(false)
  })
  it('treats a reply to one of the bot messages as addressing it', () => {
    const message = privateMessage({ reply_to_message: { message_id: 9, date: 1, chat: { id: 555, type: 'private' }, from: me } as never })
    expect(mentionBot(message as TelegramMessage, me)).toBe(true)
  })
  it('accepts a command at a anyone, and also /command@name that names this bot', () => {
    // The Source only listens in chats it was told to, and Policy decides who may originate work, so a command is
    // always addressed to the bot; what changes is which command entities name it.
    const bare = privateMessage({ text: '/status', entities: [{ type: 'bot_command', offset: 0, length: 7 }] })
    expect(mentionBot(bare as TelegramMessage, me)).toBe(true)
    const named = privateMessage({ text: '/status@test_bot', entities: [{ type: 'bot_command', offset: 0, length: 16 }] })
    expect(mentionBot(named as TelegramMessage, me)).toBe(true)
  })
})

describe('message text', () => {
  it('falls back to a placeholder for media that carries no text', () => {
    expect(placeholderFor({ message_id: 1, date: 1, chat: privateMessage().chat as never, document: { file_name: 'a.zip' } } as TelegramMessage))
      .toBe('[document: a.zip]')
    expect(messageText({ message_id: 1, date: 1, chat: privateMessage().chat as never, photo: [{}, {}] } as TelegramMessage)).toBe('[photo]')
  })
  it('prefers text, then caption', () => {
    expect(messageText(privateMessage({ text: 'x', caption: 'y' }) as TelegramMessage)).toBe('x')
    expect(messageText(privateMessage({ text: undefined, caption: 'y' }) as TelegramMessage)).toBe('y')
  })
})

describe('telegramTrigger', () => {
  it('returns nothing for the bot own messages', () => {
    expect(telegramTrigger(privateMessage({ from: me }) as TelegramMessage, me, { editsAsNewEvents: false })).toBeUndefined()
  })
  it('gives a private chat one stable thread across messages', () => {
    const first = telegramTrigger(privateMessage() as TelegramMessage, me, { editsAsNewEvents: false })!
    const second = telegramTrigger(privateMessage({ message_id: 11 }) as TelegramMessage, me, { editsAsNewEvents: false })!
    expect(first.threads[0]!.id).toBe('555:555')
    expect(second.threads[0]!.id).toBe('555:555')
    expect(first.addressed).toBe('direct')
    expect(first.id).toBe(telegramTriggerId(555, 10))
  })
  it('keeps a forum topic as its own thread and records the topic for replies', () => {
    const message = privateMessage({ chat: { id: -100, type: 'supergroup', title: 'G' }, message_thread_id: 77, text: 'ping' })
    const trigger = telegramTrigger(message as TelegramMessage, me, { editsAsNewEvents: false })!
    expect(trigger.threads[0]!.id).toBe('-100:t77')
    expect(trigger.meta.messageThreadId).toBe('77')
    expect(trigger.addressed).toBeUndefined()
    expect(trigger.channel.address).toMatchObject({ chatId: '-100', messageId: '10', direct: 'false', messageThreadId: '77' })
  })
  it('inherits the parent thread when replying in a group', () => {
    const parent = { source: 'telegram', id: telegramTriggerId(-100, 5) }
    const message = privateMessage({ chat: { id: -100, type: 'supergroup' }, reply_to_message: { message_id: 5, date: 1, chat: { id: -100, type: 'supergroup' } } as never })
    const trigger = telegramTrigger(message as TelegramMessage, me, { editsAsNewEvents: false }, id => id === parent.id ? '-100:t3' : undefined)!
    expect(trigger.threads[0]!.id).toBe('-100:t3')
    expect(trigger.meta.replyToId).toBe('5')
  })
  it('marks a bot sender as not human', () => {
    const message = privateMessage({ from: { id: 9, is_bot: true, first_name: 'Other' } })
    expect(telegramTrigger(message as TelegramMessage, me, { editsAsNewEvents: false })!.human).toBe(false)
  })
  it('gives an edit its own id only when edits count as new events', () => {
    const message = privateMessage({ edit_date: 1700000100 })
    const off = telegramTrigger(message as TelegramMessage, me, { editsAsNewEvents: false })!
    const on = telegramTrigger(message as TelegramMessage, me, { editsAsNewEvents: true })!
    expect(off.id).toBe(telegramTriggerId(555, 10))
    expect(on.id).not.toBe(off.id)
    expect(on.meta.editedAt).toBe(new Date(1700000100 * 1000).toISOString())
  })
})
