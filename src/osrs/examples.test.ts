import 'fake-indexeddb/auto'
import { File as NodeFile } from 'node:buffer'
import { openDB } from 'idb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OSRS_CATALOG } from './catalog'
import { loadExamples, removeExample, saveExample } from './examples'
import type { VisualExample } from './examples'

const databaseName = 'lense-osrs-visual-examples-v1'
const visualIds = OSRS_CATALOG.filter(entry => entry.kind === 'visual').map(entry => entry.id)
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jTwsAAAAASUVORK5CYII=', 'base64')
const pngFile = () => new NodeFile([png], 'crop.png', { type: 'image/png' }) as unknown as File
const decoder = vi.fn()

async function writeRows(rows: unknown[]) {
  const db = await openDB(databaseName, 1, { upgrade(db) { db.createObjectStore('examples', { keyPath: 'id' }) } })
  try {
    const tx = db.transaction('examples', 'readwrite')
    for (const row of rows) await tx.store.put(row)
    await tx.done
  } finally { db.close() }
}

beforeEach(async () => {
  const db = await openDB(databaseName, 1, { upgrade(db) { db.createObjectStore('examples', { keyPath: 'id' }) } })
  try { await db.clear('examples') } finally { db.close() }
  decoder.mockReset().mockImplementation(async () => ({ width: 1, height: 1, close: vi.fn() }))
  vi.stubGlobal('createImageBitmap', decoder)
})
afterEach(() => vi.unstubAllGlobals())

describe('local screenshot examples', () => {
  it('stores decoded image data by visual entry and removes only the selected example', async () => {
    const first = await saveExample(visualIds[0]!, pngFile())
    const second = await saveExample(visualIds[1]!, pngFile())
    expect(first).toMatchObject({ entryId: visualIds[0], width: 1, height: 1, image: `data:image/png;base64,${png.toString('base64')}` })
    expect(Number.isFinite(Date.parse(first.createdAt))).toBe(true)
    expect(decoder).toHaveBeenCalledTimes(2)
    expect(await loadExamples(visualIds[0]!)).toEqual([first])
    expect(await loadExamples(visualIds[1]!)).toEqual([second])
    await removeExample(first.id)
    expect(await loadExamples(visualIds[0]!)).toEqual([])
    expect(await loadExamples(visualIds[1]!)).toEqual([second])
  })

  it('rejects other entry types, oversized files, wrong MIME types, corrupt contents, and decode failures', async () => {
    await expect(saveExample('place-lumbridge', pngFile())).rejects.toThrow('visual dictionary entry')
    await expect(saveExample('visual-not-present', pngFile())).rejects.toThrow('visual dictionary entry')
    for (const file of [
      new NodeFile([png], 'crop.svg', { type: 'image/svg+xml' }),
      new NodeFile([png], 'crop.jpg', { type: 'image/jpeg' }),
      new NodeFile(['<html>not a screenshot</html>'], 'crop.png', { type: 'image/png' }),
      new NodeFile(['tiny'], 'crop.png', { type: 'image/png' }),
      new NodeFile([new Uint8Array(512 * 1024 + 1)], 'large.png', { type: 'image/png' }),
    ]) await expect(saveExample(visualIds[0]!, file as unknown as File)).rejects.toThrow()
    expect(decoder).not.toHaveBeenCalled()
    decoder.mockRejectedValueOnce(new Error('Invalid PNG body'))
    await expect(saveExample(visualIds[0]!, pngFile())).rejects.toThrow('could not be decoded')
    const close = vi.fn()
    decoder.mockResolvedValueOnce({ width: 4097, height: 1, close })
    await expect(saveExample(visualIds[0]!, pngFile())).rejects.toThrow('4,096 pixels')
    expect(close).toHaveBeenCalledOnce()
    expect(await loadExamples(visualIds[0]!)).toEqual([])
  })

  it('enforces four examples per entry even when saves arrive together', async () => {
    const saves = await Promise.allSettled(Array.from({ length: 5 }, () => saveExample(visualIds[0]!, pngFile())))
    expect(saves.filter(result => result.status === 'fulfilled')).toHaveLength(4)
    expect(saves.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(await loadExamples(visualIds[0]!)).toHaveLength(4)
  })

  it('enforces the 32-image browser cap and releases capacity after deletion', async () => {
    const saved: VisualExample[] = []
    for (const entryId of visualIds.slice(0, 8)) {
      for (let index = 0; index < 4; index++) saved.push(await saveExample(entryId, pngFile()))
    }
    expect(saved).toHaveLength(32)
    await expect(saveExample(visualIds[8]!, pngFile())).rejects.toThrow('32 in this browser')
    await removeExample(saved[0]!.id)
    await expect(saveExample(visualIds[8]!, pngFile())).resolves.toMatchObject({ entryId: visualIds[8] })
  })

  it('filters unsafe stored rows, isolates entries, and returns only the four newest valid examples', async () => {
    const base: VisualExample = {
      id: 'valid', entryId: visualIds[0]!, width: 1, height: 1,
      image: `data:image/png;base64,${png.toString('base64')}`, createdAt: '2026-09-03T10:00:00.000Z',
    }
    const rows: unknown[] = Array.from({ length: 5 }, (_, index) => ({ ...base, id: `valid-${index}`, createdAt: `2026-09-03T10:00:0${index}.000Z` }))
    rows.push(
      { ...base, id: 'other-entry', entryId: visualIds[1] },
      { ...base, id: 'html', image: 'data:text/html;base64,PHNjcmlwdD4=' },
      { ...base, id: 'svg', image: 'data:image/svg+xml;base64,PHN2Zy8+' },
      { ...base, id: 'remote', image: 'https://example.com/image.png' },
      { ...base, id: 'broken-base64', image: 'data:image/png;base64,!!!!' },
      { ...base, id: 'too-large', image: `data:image/png;base64,${'A'.repeat(700000)}` },
      { ...base, id: 'wide', width: 4097 },
      { ...base, id: 'negative', height: -1 },
      { ...base, id: 'fractional', height: 1.5 },
      { ...base, id: 'bad-date', createdAt: 'tomorrow' },
      { id: 'missing-fields' },
    )
    await writeRows(rows)
    expect((await loadExamples(visualIds[0]!)).map(example => example.id)).toEqual(['valid-4', 'valid-3', 'valid-2', 'valid-1'])
    expect((await loadExamples(visualIds[1]!)).map(example => example.id)).toEqual(['other-entry'])
    expect(await loadExamples('unknown-entry')).toEqual([])
  })
})
