import { describe, expect, it } from 'vitest'
import { split4096, telegramHtml, telegramLink } from '../src/telegram-channel.ts'

describe('split4096', () => {
  it('leaves a short message whole', () => {
    expect(split4096('hello')).toEqual(['hello'])
  })
  it('splits long text under the limit, preferring a newline', () => {
    const text = `${'a'.repeat(3000)}\n${'b'.repeat(3000)}`
    const chunks = split4096(text)
    expect(chunks.length).toBe(2)
    expect(chunks.every(chunk => chunk.length <= 4096)).toBe(true)
    expect(chunks[0]).toBe('a'.repeat(3000))
  })
  it('never splits a surrogate pair', () => {
    const chunks = split4096('😀'.repeat(3000), 4095)
    expect(chunks.join('')).toBe('😀'.repeat(3000))
    expect(chunks.every(chunk => !chunk.startsWith('\uDE00'))).toBe(true)
  })
})

describe('telegramHtml', () => {
  it('escapes HTML and renders the Markdown subset', () => {
    expect(telegramHtml('<b>&</b>')).toBe('&lt;b&gt;&amp;&lt;/b&gt;')
    expect(telegramHtml('**bold** and `code`')).toBe('<b>bold</b> and <code>code</code>')
    expect(telegramHtml('[PR #1](https://example.com/1)')).toBe('<a href="https://example.com/1">PR #1</a>')
    expect(telegramHtml('`<x>`')).toBe('<code>&lt;x&gt;</code>')
  })
})

describe('telegramLink', () => {
  it('links supergroup messages and leaves private chats unlinked', () => {
    expect(telegramLink('-1001234567890', '42')).toBe('https://t.me/c/1234567890/42')
    expect(telegramLink('555', '42')).toBe('')
  })
})
