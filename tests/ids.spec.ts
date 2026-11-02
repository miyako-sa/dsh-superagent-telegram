/**
 * A Trigger id must stay equal across restarts and installations, so these pin the exact values `dsh-superagent` produces
 * for the same inputs. If one of these changes, every Thread binding already stored by a host starts pointing at a new id.
 */
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { key, threadKey } from '../src/ids.ts'
import { telegramTriggerId } from '../src/telegram-trigger.ts'

describe('content-derived ids', () => {
  it('matches the host key(): sha256 of the JSON array, first 32 hex characters', () => {
    expect(key('telegram', '5912468469:42')).toBe(createHash('sha256')
      .update(JSON.stringify(['telegram', '5912468469:42'])).digest('hex').slice(0, 32))
  })
  it('derives a Telegram Trigger id from chat and message', () => {
    expect(telegramTriggerId(123, 456)).toBe(key('telegram', '123:456'))
    expect(telegramTriggerId('123', '456')).toBe(telegramTriggerId(123, 456))
  })
  it('derives a Thread key as source:id', () => {
    expect(threadKey({ source: 'telegram', id: '123:123' })).toBe('telegram:123:123')
  })
})
