/**
 * Telegram media: what a message carries besides text, the placeholders a Trigger shows for it, and the image keys an
 * assessment can read back.
 *
 * A Trigger stays text-only so its id and text compare the way the host expects, but every media message now names its
 * Telegram `file_id`, so `threadContext.images` and the media downloader can fetch the bytes later through `getFile`.
 */
import type { TelegramMessage } from './telegram-trigger.ts'

/** A Bot API `PhotoSize`, the largest being the one worth downloading. */
export interface TelegramPhotoSize { file_id: string; file_unique_id?: string; width: number; height: number; file_size?: number }
/** A Bot API `Video`, `Audio`, `Voice`, `Animation`, `VideoNote` or `Sticker`; only the fields the Source reads. */
export interface TelegramMediaFile {
  file_id: string; file_unique_id?: string; file_size?: number
  file_name?: string; mime_type?: string; duration?: number; width?: number; height?: number; emoji?: string; is_animated?: boolean
}
/** One piece of media on a message, normalized for placeholders and downloads. */
export interface TelegramMedia {
  /** `photo` keeps its `photo` spelling; the rest keep their Bot API field name. */
  kind: 'photo' | 'document' | 'video' | 'audio' | 'voice' | 'animation' | 'video_note' | 'sticker'
  fileId: string
  /** The largest photo size, or the media file itself. */
  size?: number
  width?: number
  height?: number
  duration?: number
  /** A document's or audio's file name when Telegram reports one. */
  name?: string
  mimeType?: string
}

/** Media-bearing fields of a message, in the order a reader should prefer them. */
const MEDIA_FIELDS = ['photo', 'document', 'video', 'audio', 'voice', 'animation', 'video_note', 'sticker'] as const

const largest = (sizes: TelegramPhotoSize[]): TelegramPhotoSize | undefined =>
  sizes.filter(size => typeof size?.file_id === 'string').sort((a, b) => (b.width * b.height) - (a.width * a.height))[0]

/** The media one message carries, most significant first; empty for a text-only message. */
export function mediaOf(message: TelegramMessage): TelegramMedia[] {
  const media: TelegramMedia[] = []
  for (const field of MEDIA_FIELDS) {
    const value = (message as unknown as Record<string, unknown>)[field]
    if (field === 'photo') {
      const photo = Array.isArray(value) ? largest(value as TelegramPhotoSize[]) : undefined
      if (photo) media.push({ kind: 'photo', fileId: photo.file_id, width: photo.width, height: photo.height,
        ...photo.file_size !== undefined ? { size: photo.file_size } : {} })
      continue
    }
    if (!value || typeof value !== 'object') continue
    const file = value as TelegramMediaFile
    if (typeof file.file_id !== 'string') continue
    media.push({ kind: field, fileId: file.file_id,
      ...file.file_size !== undefined ? { size: file.file_size } : {},
      ...file.width !== undefined ? { width: file.width } : {},
      ...file.height !== undefined ? { height: file.height } : {},
      ...file.duration !== undefined ? { duration: file.duration } : {},
      ...file.file_name ? { name: file.file_name } : {},
      ...file.mime_type ? { mimeType: file.mime_type } : {} })
  }
  return media
}

/** A short stand-in for one piece of media, so an assessment can see what a message carried. */
export function placeholderOf(media: TelegramMedia): string {
  switch (media.kind) {
    case 'photo': return `[photo ${media.fileId}]`
    case 'document': return `[document${media.name ? `: ${media.name}` : ''} ${media.fileId}]`
    case 'video': return `[video ${media.fileId}]`
    case 'video_note': return `[video note ${media.fileId}]`
    case 'audio': return `[audio${media.name ? `: ${media.name}` : ''} ${media.fileId}]`
    case 'voice': return `[voice ${media.fileId}]`
    case 'animation': return `[animation ${media.fileId}]`
    case 'sticker': return `[sticker ${media.fileId}]`
  }
}

/** A text stand-in for a message that carries a service payload rather than text or media. */
export function servicePlaceholder(message: TelegramMessage): string | undefined {
  const record = message as unknown as Record<string, unknown>
  const names: Record<string, string> = { location: 'location', contact: 'contact', poll: 'poll', dice: 'dice', venue: 'venue',
    story: 'story' }
  for (const [field, label] of Object.entries(names)) if (record[field]) return `[${label}]`
  return undefined
}

/** The message's own text, or placeholders for everything it carried instead. */
export function textOfMessage(message: TelegramMessage): string {
  const text = message.text ?? message.caption ?? ''
  const media = mediaOf(message)
  if (!text) return media.length ? media.map(placeholderOf).join(' ') : servicePlaceholder(message) ?? '[message]'
  return media.length ? `${text}\n${media.map(placeholderOf).join(' ')}` : text
}

const KEY = /\[(?:photo|video|video note|audio|voice|animation|sticker|document(?:: [^\]]*)?) ([A-Za-z0-9_-]+)\]/g

/** The media file ids named in a message's text, so `threadContext.image` can only read what that message showed. */
export function imageKeys(text: string): string[] {
  return [...new Set([...text.matchAll(KEY)].map(match => match[1]!))]
}

/** Localized file extension for one media, used to name a downloaded copy. */
export function extensionOf(media: TelegramMedia): string {
  if (media.kind === 'photo') return '.jpg'
  const fromMime: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
    'video/mp4': '.mp4', 'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'application/pdf': '.pdf', 'application/zip': '.zip',
    'text/plain': '.txt', 'application/json': '.json' }
  if (media.mimeType && fromMime[media.mimeType]) return fromMime[media.mimeType]!
  if (media.kind === 'voice') return '.ogg'
  if (media.kind === 'video' || media.kind === 'video_note' || media.kind === 'animation') return '.mp4'
  if (media.kind === 'audio') return '.mp3'
  if (media.kind === 'sticker') return '.webp'
  const name = media.name ?? ''
  const dot = name.lastIndexOf('.')
  if (dot > 0 && /^\.[A-Za-z0-9]{1,8}$/.test(name.slice(dot))) return name.slice(dot).toLowerCase()
  return '.bin'
}
