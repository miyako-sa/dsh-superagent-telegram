import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadMedia, mediaDirectory, readMediaBytes, TELEGRAM_GET_FILE_LIMIT } from '../src/telegram-download.ts'
import type { TelegramApi } from '../src/telegram-api.ts'
import type { TelegramMedia } from '../src/telegram-media.ts'

const directories: string[] = []
const temp = async () => { const path = await mkdtemp(join(tmpdir(), 'tg-media-')); directories.push(path); return path }
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }) })

/** A Bot API double: `getFile` answers with a path and the download answers with bytes. */
const api = (bytes: Uint8Array | number, overrides: { file_size?: number; file_path?: string } = {}) => ({
  getFile: vi.fn(async () => ({ file_id: 'f', file_size: overrides.file_size ?? (typeof bytes === 'number' ? bytes : bytes.byteLength),
    file_path: overrides.file_path ?? 'documents/file_1.bin' })),
  download: vi.fn(async () => new Response(typeof bytes === 'number' ? new Uint8Array(bytes) : bytes)),
}) as unknown as TelegramApi & { getFile: ReturnType<typeof vi.fn>; download: ReturnType<typeof vi.fn> }

const document: TelegramMedia = { kind: 'document', fileId: 'f', name: 'report.pdf', mimeType: 'application/pdf' }

describe('downloadMedia', () => {
  it('streams a file into the media directory under a safe name', async () => {
    const directory = await temp()
    const call = api(new Uint8Array([1, 2, 3]))
    const saved = await downloadMedia(call, document, directory)
    expect(saved.bytes).toBe(3)
    expect(saved.cached).toBe(false)
    expect(saved.path.startsWith(directory)).toBe(true)
    expect(saved.path.endsWith('.pdf')).toBe(true)
    expect(Array.from(await readMediaBytes(saved.path, 10))).toEqual([1, 2, 3])
  })
  it('refuses a file its own size claim puts above the limit, before any request for bytes', async () => {
    const call = api(new Uint8Array(0), { file_size: 21 * 1024 * 1024 })
    await expect(downloadMedia(call, document, await temp(), 1024)).rejects.toThrow(/above the 1024-byte download limit/)
    expect(call.download).not.toHaveBeenCalled()
  })
  it('refuses the bytes once fetched when they exceed the limit', async () => {
    const call = api(new Uint8Array(4096), { file_size: 10 })
    await expect(downloadMedia(call, document, await temp(), 1024)).rejects.toThrow(/above the 1024-byte download limit/)
  })
  it('never lets the limit rise above the Bot API ceiling', async () => {
    const call = api(new Uint8Array(0), { file_size: TELEGRAM_GET_FILE_LIMIT + 1 })
    await expect(downloadMedia(call, document, await temp(), Number.MAX_SAFE_INTEGER)).rejects.toThrow(/download limit/)
  })
  it('reuses an identical earlier download instead of fetching it again', async () => {
    const directory = await temp()
    const first = api(new Uint8Array([9, 9]))
    await downloadMedia(first, document, directory)
    const second = api(new Uint8Array([9, 9]))
    const saved = await downloadMedia(second, document, directory)
    expect(saved.cached).toBe(true)
    expect(second.download).not.toHaveBeenCalled()
  })
  it('rejects an empty download and leaves no file behind', async () => {
    const directory = await temp()
    await expect(downloadMedia(api(new Uint8Array(0), { file_size: 0 }), document, directory)).rejects.toThrow(/empty/)
  })
  it('refuses a path with no file name, and strips a name that could escape the directory', async () => {
    const directory = await temp()
    await expect(downloadMedia(api(new Uint8Array([1]), { file_path: '' }), document, directory)).rejects.toThrow(/no file path/)
    const saved = await downloadMedia(api(new Uint8Array([1])), { ...document, name: '../../etc/passwd' }, directory)
    expect(saved.path.startsWith(directory)).toBe(true)
    expect(saved.path.includes('..')).toBe(false)
  })
})

describe('mediaDirectory', () => {
  it('separates two bot tokens', async () => {
    const stateDir = await temp()
    expect(mediaDirectory(stateDir, 'a')).not.toBe(mediaDirectory(stateDir, 'b'))
    await writeFile(join(stateDir, 'marker'), 'x')
    expect(mediaDirectory(stateDir, 'a').startsWith(stateDir)).toBe(true)
  })
})
