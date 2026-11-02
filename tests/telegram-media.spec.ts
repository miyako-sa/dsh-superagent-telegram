import { describe, expect, it } from 'vitest'
import { extensionOf, imageKeys, mediaOf, placeholderOf, servicePlaceholder, textOfMessage } from '../src/telegram-media.ts'
import type { TelegramMessage } from '../src/telegram-trigger.ts'

const message = (fields: Record<string, unknown>): TelegramMessage => ({
  message_id: 1, date: 1, chat: { id: 5, type: 'private' }, ...fields,
} as unknown as TelegramMessage)

describe('mediaOf', () => {
  it('picks the largest photo size', () => {
    const media = mediaOf(message({ photo: [{ file_id: 'small', width: 90, height: 60 }, { file_id: 'big', width: 1280, height: 720 }] }))
    expect(media).toEqual([{ kind: 'photo', fileId: 'big', width: 1280, height: 720 }])
  })
  it('reads a document, a voice note and a sticker in a stable order', () => {
    const media = mediaOf(message({
      document: { file_id: 'doc1', file_name: 'report.pdf', mime_type: 'application/pdf', file_size: 2048 },
      voice: { file_id: 'voice1', duration: 4 }, sticker: { file_id: 'st1' },
    }))
    expect(media.map(item => item.kind)).toEqual(['document', 'voice', 'sticker'])
    expect(media[0]).toMatchObject({ fileId: 'doc1', name: 'report.pdf', mimeType: 'application/pdf', size: 2048 })
  })
  it('is empty for a text-only message', () => {
    expect(mediaOf(message({ text: 'hi' }))).toEqual([])
  })
})

describe('placeholders', () => {
  it('names the file id in every media placeholder', () => {
    expect(placeholderOf({ kind: 'photo', fileId: 'P' })).toBe('[photo P]')
    expect(placeholderOf({ kind: 'document', fileId: 'D', name: 'a.zip' })).toBe('[document: a.zip D]')
    expect(placeholderOf({ kind: 'voice', fileId: 'V' })).toBe('[voice V]')
    expect(placeholderOf({ kind: 'video_note', fileId: 'N' })).toBe('[video note N]')
  })
  it('keeps a caption and appends the media placeholders', () => {
    expect(textOfMessage(message({ caption: 'look', photo: [{ file_id: 'P', width: 1, height: 1 }] }))).toBe('look\n[photo P]')
  })
  it('falls back to a service placeholder', () => {
    expect(servicePlaceholder(message({ location: { latitude: 1, longitude: 2 } }))).toBe('[location]')
    expect(textOfMessage(message({}))).toBe('[message]')
  })
  it('round-trips file ids through imageKeys', () => {
    const text = textOfMessage(message({ text: 'see', photo: [{ file_id: 'P1', width: 2, height: 2 }],
      document: { file_id: 'D1', file_name: 'a.zip' } }))
    expect(imageKeys(text)).toEqual(['P1', 'D1'])
    expect(imageKeys('no media here')).toEqual([])
  })
})

describe('extensionOf', () => {
  it('uses the document name, then the media type, then the kind', () => {
    expect(extensionOf({ kind: 'document', fileId: 'x', name: 'notes.txt' })).toBe('.txt')
    expect(extensionOf({ kind: 'document', fileId: 'x', mimeType: 'image/png' })).toBe('.png')
    expect(extensionOf({ kind: 'photo', fileId: 'x' })).toBe('.jpg')
    expect(extensionOf({ kind: 'voice', fileId: 'x' })).toBe('.ogg')
    expect(extensionOf({ kind: 'document', fileId: 'x' })).toBe('.bin')
  })
})
