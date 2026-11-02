/**
 * Bounded, verified downloads of the media a message carries.
 *
 * The Telegram Bot API refuses files above 20 MB to a bot, so `limit` is what the deployment allows: the configured
 * `maxDownloadBytes`, never more than the API's own bound. Downloads land in a per-Telegram-token directory so two bots on
 * one host cannot overwrite each other, and each file is written under a sanitized name inside that directory only.
 */
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { TelegramApi, TelegramError } from './telegram-api.ts'
import { extensionOf, type TelegramMedia } from './telegram-media.ts'

/** The Bot API's own ceiling for `getFile`; larger files cannot be downloaded by any bot. */
export const TELEGRAM_GET_FILE_LIMIT = 20 * 1024 * 1024

/** What became of one download. */
export interface MediaDownload {
  media: TelegramMedia
  /** Absolute path inside the destination directory; the file stays there for the worker to open. */
  path: string
  bytes: number
  /** The Telegram `file_path` the bytes came from. */
  filePath?: string
  /** True when an identical file was already on disk (same id and size) and was not downloaded again. */
  cached: boolean
}

const safeName = (name: string): string => {
  const cleaned = name.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_').replace(/^\.+/, '').trim()
  return cleaned.slice(0, 120) || 'file'
}

/** True for a `file_unique_id` that stays the same across bots, so it can name a cached copy. */
const uniqueOf = (media: TelegramMedia & { fileUniqueId?: string }): string | undefined => media.fileUniqueId

/** The directory one token's downloads go to. */
export const mediaDirectory = (stateDir: string, token: string): string =>
  join(stateDir, 'telegram-media', createHash('sha256').update(token).digest('hex').slice(0, 12))

/**
 * Downloads one media file: asks the Bot API for its path, streams it to a temporary file, checks it against the size
 * limit, then renames it into place. A size claim above `limit` is refused before any bytes move.
 * @throws TelegramError for API or HTTP failures, and a plain Error for a file that is too large or empty.
 */
export async function downloadMedia(api: TelegramApi, media: TelegramMedia, directory: string,
  limit = TELEGRAM_GET_FILE_LIMIT, signal?: AbortSignal): Promise<MediaDownload> {
  const capped = Math.min(limit, TELEGRAM_GET_FILE_LIMIT)
  if (media.size !== undefined && media.size > capped) {
    throw new Error(`The ${media.kind} is ${media.size} bytes, above the ${capped}-byte download limit`)
  }
  const file = await api.getFile(media.fileId, signal)
  const size = file.file_size ?? media.size
  if (size !== undefined && size > capped) throw new Error(`The ${media.kind} is ${size} bytes, above the ${capped}-byte download limit`)
  await mkdir(directory, { recursive: true })
  const stem = `tg-${safeName(uniqueOf(media) ?? media.fileId)}${extensionOf(media)}`
  const path = join(directory, stem)
  const existing = await stat(path).catch(() => undefined)
  if (existing?.isFile() && existing.size === size) return { media, path, bytes: existing.size, cached: true,
    ...file.file_path ? { filePath: file.file_path } : {} }
  if (!file.file_path) throw new Error('The Bot API returned no file path for this media')
  signal?.throwIfAborted()
  const response = await api.download(file.file_path, signal)
  const temporary = `${path}.part`
  try {
    const length = Number(response.headers.get('content-length') ?? '0')
    if (length && length > capped) throw new Error(`The ${media.kind} is ${length} bytes, above the ${capped}-byte download limit`)
    const data = new Uint8Array(await response.arrayBuffer())
    if (!data.byteLength) throw new Error('The downloaded media was empty')
    if (data.byteLength > capped) throw new Error(`The ${media.kind} is ${data.byteLength} bytes, above the ${capped}-byte download limit`)
    await writeFile(temporary, data)
    await rename(temporary, path)
    return { media, path, bytes: data.byteLength, cached: false, ...file.file_path ? { filePath: file.file_path } : {} }
  } finally {
    await rm(temporary, { force: true })
  }
}

/** Reads a downloaded media file back, refusing anything above `limit`. */
export async function readMediaBytes(path: string, limit: number): Promise<Uint8Array> {
  const file = await stat(path)
  if (!file.isFile()) throw new Error('The media download is not a regular file')
  if (file.size > limit) throw new Error(`The media is ${file.size} bytes, above the ${limit}-byte limit`)
  return readFile(path)
}

export { TelegramError }
