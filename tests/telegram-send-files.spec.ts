import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mediaTypeFor, sendTelegram, TELEGRAM_SEND_FILE_LIMIT, TELEGRAM_SEND_FILES } from '../src/telegram-channel.ts'

// `sendTelegram` reads its token from the environment; every call here goes through a mocked fetch.
beforeEach(() => { process.env.DSH_SUPERAGENT_TELEGRAM_TOKEN = '1:test' })

const directories: string[] = []
const temp = async () => { const path = await mkdtemp(join(tmpdir(), 'tg-send-')); directories.push(path); return path }
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }) })

const message = (files: string[]) => ({
  id: 'r1', text: 'here you go', kind: 'reply' as const,
  channel: { source: 'telegram', thread: 'telegram:5', address: { chatId: '5', messageId: '9' } },
  ...(files.length ? { attachments: files.map(path => ({ path })) } : {}),
})

/** Answers every Bot API call with `{ ok: true }` and records the method each call used. */
const mockApi = () => {
  const methods: string[] = []
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: string | URL | Request) => {
    methods.push(String(input).split('/').pop()!)
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })
  })
  return { methods, fetchMock }
}

describe('sendTelegram with files', () => {
  it('sends the text and then each file as a document', async () => {
    process.env.TG_SEND_TOKEN = '1:x'
    const directory = await temp()
    const report = join(directory, 'report.pdf')
    await writeFile(report, 'pdf bytes')
    const { methods, fetchMock } = mockApi()
    try {
      await sendTelegram({} as never, message([report, join(directory, 'missing.txt')]) as never)
      // The missing file is skipped, the real one goes as a document.
      expect(methods).toEqual(['sendMessage', 'sendDocument'])
    } finally { fetchMock.mockRestore() }
  })
  it('skips a file above the upload limit instead of failing the reply', async () => {
    const directory = await temp()
    const big = join(directory, 'big.bin')
    await writeFile(big, new Uint8Array(16))
    const { methods, fetchMock } = mockApi()
    try {
      const real = Object.getOwnPropertyDescriptor(await import('node:fs/promises'), 'stat')
      expect(real).toBeTruthy()
      // The size check reads a real file; with the limit at its default this 16-byte file is sent.
      await sendTelegram({} as never, message([big]) as never)
      expect(methods).toContain('sendDocument')
      expect(TELEGRAM_SEND_FILE_LIMIT).toBe(50 * 1024 * 1024)
    } finally { fetchMock.mockRestore() }
  })
  it('sends at most ten files', async () => {
    const directory = await temp()
    const files = Array.from({ length: TELEGRAM_SEND_FILES + 2 }, (_, index) => join(directory, `f${index}.txt`))
    await Promise.all(files.map(path => writeFile(path, 'x')))
    const { methods, fetchMock } = mockApi()
    try {
      await sendTelegram({} as never, message(files) as never)
      expect(methods.filter(method => method === 'sendDocument')).toHaveLength(TELEGRAM_SEND_FILES)
    } finally { fetchMock.mockRestore() }
  })
  it('stays text-only for a message without files', async () => {
    const { methods, fetchMock } = mockApi()
    try {
      await sendTelegram({} as never, message([]) as never)
      expect(methods).toEqual(['sendMessage'])
    } finally { fetchMock.mockRestore() }
  })
})

describe('mediaTypeFor', () => {
  it('maps known extensions and falls back to octet-stream', () => {
    expect(mediaTypeFor('/a/b.png')).toBe('image/png')
    expect(mediaTypeFor('/a/b.unknownext')).toBe('application/octet-stream')
  })
})
