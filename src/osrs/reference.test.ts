import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OSRS_CATALOG, OSRS_CHECKED_AT } from './catalog'
import { getOsrsAsset } from './assets'
import { getReference, searchReferences } from './reference'
import { osrsReferenceTool, registerOsrsReference } from '../services/webmcp/osrs'
import type { VisualExample } from './examples'

const { loadExamples } = vi.hoisted(() => ({ loadExamples: vi.fn() }))
vi.mock('./examples', () => ({ loadExamples }))

type ToolReply = { isError?: boolean; content?: Array<{ type: string; text?: string; data?: string }> }
const execute = (input: Record<string, unknown>) => osrsReferenceTool.execute(input) as Promise<ToolReply>
const visualEntry = OSRS_CATALOG.find(entry => entry.kind === 'visual')!

describe('OSRS reference catalog', () => {
  it('keeps sources, relations, schematic locations, and navigation symbols usable', () => {
    const ids = new Set(OSRS_CATALOG.map(entry => entry.id))
    expect(ids.size).toBe(OSRS_CATALOG.length)
    expect(new Set(OSRS_CATALOG.map(entry => entry.kind))).toEqual(new Set(['place', 'visual', 'prompt', 'skill']))
    expect(Number.isFinite(Date.parse(OSRS_CHECKED_AT))).toBe(true)
    for (const entry of OSRS_CATALOG) {
      expect(entry.id).toMatch(/^(place|visual|prompt|skill)-[a-z0-9-]+$/)
      expect(entry.title.trim()).not.toBe('')
      expect(entry.summary.trim()).not.toBe('')
      expect(entry.sourceUrls.length).toBeGreaterThan(0)
      for (const source of entry.sourceUrls) {
        const url = new URL(source)
        expect(url.protocol).toBe('https:')
        expect(url.hostname).toBe('oldschool.runescape.wiki')
        expect(url.pathname.startsWith('/w/')).toBe(true)
      }
      for (const related of entry.relatedIds) expect(ids.has(related), `${entry.id} refers to ${related}`).toBe(true)
      if (entry.kind === 'place') {
        expect(entry.map).toBeDefined()
        for (const coordinate of [entry.map!.x, entry.map!.y]) {
          expect(Number.isFinite(coordinate)).toBe(true)
          expect(coordinate).toBeGreaterThanOrEqual(0)
          expect(coordinate).toBeLessThanOrEqual(100)
        }
        expect(['town', 'bank', 'resource']).toContain(entry.map!.category)
      }
      if (entry.kind === 'visual') {
        expect(entry.visual?.cue).toBeTruthy()
        expect(entry.visual?.verify).toBeTruthy()
        expect(entry.visual?.confusions.length).toBeGreaterThan(0)
        if (entry.visual?.icon) {
          const asset = getOsrsAsset(entry.visual.icon)
          expect(asset, `${entry.id} icon exists`).toBeDefined()
          expect(asset?.kind).toBe('reference-symbol')
          expect(asset?.recognitionNote).toContain('does not establish a visual match')
        }
      }
      if (entry.kind === 'prompt') {
        expect(entry.prompt?.goal).toBeTruthy()
        expect(entry.prompt?.completionCondition).toBeTruthy()
        expect(['timed', 'until-complete', 'continuous']).toContain(entry.prompt?.runMode)
      }
      if (entry.kind === 'skill') expect(entry.skill?.steps.length).toBeGreaterThan(0)
    }
  })

  it('finds normalized phrases, filters kinds, and paginates short summaries without images', () => {
    const banks = searchReferences({ query: '  ＬＵＭＢＲＩＤＧＥ bank ', kind: 'place' })
    expect(banks.items.map(entry => entry.id)).toContain('place-lumbridge-bank')
    expect(banks.items.every(entry => entry.kind === 'place')).toBe(true)
    const first = searchReferences({ kind: 'visual', limit: 3 })
    const second = searchReferences({ kind: 'visual', limit: 3, offset: first.nextOffset! })
    expect(first.items).toHaveLength(3)
    expect(second.items).toHaveLength(3)
    expect(new Set([...first.items, ...second.items].map(entry => entry.id)).size).toBe(6)
    expect(first.total).toBeGreaterThan(6)
    expect(searchReferences({ query: 'no-such-catalog-phrase' })).toMatchObject({ items: [], total: 0, nextOffset: null })
    expect(searchReferences({ offset: 1000 }).items).toEqual([])
    for (const item of first.items) {
      expect(item.url).toContain(`/osrs?entry=${item.id}`)
      expect(item).not.toHaveProperty('details')
      expect(item).not.toHaveProperty('visual')
      expect(item).not.toHaveProperty('image')
    }
  })

  it('rejects unbounded searches and unknown entry IDs', () => {
    for (const query of [
      { query: 'x'.repeat(161) }, { query: 4 }, { kind: 'actions' },
      { limit: 0 }, { limit: 21 }, { limit: 1.5 }, { limit: NaN },
      { offset: -1 }, { offset: 1001 }, { offset: 0.5 }, { offset: Infinity },
    ]) expect(() => searchReferences(query as never)).toThrow()
    for (const id of ['', 'x'.repeat(129), undefined, 42]) expect(() => getReference(id as string)).toThrow()
    expect(() => getReference('visual-not-present')).toThrow('No reference has that ID')
    expect(getReference('place-lumbridge').usage).toContain('not game coordinates or a route')
  })
})

describe('read-only OSRS WebMCP tool', () => {
  beforeEach(() => loadExamples.mockReset())
  afterEach(() => vi.unstubAllGlobals())

  it('exposes only reference reads and rejects actions, unknown fields, and malformed operations', async () => {
    const windowStub: { lense?: { tools: unknown[]; call: (name: string, input?: Record<string, unknown>) => Promise<unknown> } } = {}
    vi.stubGlobal('window', windowStub)
    vi.stubGlobal('document', {})
    vi.stubGlobal('navigator', {})
    const dispose = registerOsrsReference()
    try {
      expect(windowStub.lense?.tools).toEqual([osrsReferenceTool])
      expect(osrsReferenceTool.annotations).toEqual({ readOnlyHint: true })
      await expect(windowStub.lense!.call('desktop_action', { type: 'keyboard.type', text: 'test' })).rejects.toThrow('Only osrs_reference')
      for (const input of [
        {}, { operation: 'act' }, { operation: 'start' },
        { operation: 'search', action: { type: 'keyboard.type', text: 'test' } },
        { operation: 'search', includeImages: true },
        { operation: 'get', id: visualEntry.id, target: { type: 'monitor', id: 'one' } },
        { operation: 'get', id: visualEntry.id, includeImages: 'yes' },
      ]) expect(await execute(input)).toMatchObject({ isError: true })
      expect(loadExamples).not.toHaveBeenCalled()
    } finally { dispose() }
    expect(windowStub.lense).toBeUndefined()
  })

  it('keeps search and normal get text-only, loading at most two images only on explicit get', async () => {
    const examples: VisualExample[] = Array.from({ length: 4 }, (_, index) => ({
      id: `example-${index}`, entryId: visualEntry.id, width: 10, height: 10,
      createdAt: `2026-09-03T10:00:0${index}.000Z`, image: `data:image/png;base64,cGljdHVyZS0${index}`,
    }))
    loadExamples.mockResolvedValue(examples)
    for (const input of [
      { operation: 'search', kind: 'visual' },
      { operation: 'get', id: visualEntry.id },
      { operation: 'get', id: visualEntry.id, includeImages: false },
    ]) {
      const result = await execute(input)
      expect(result.isError).not.toBe(true)
      expect(JSON.stringify(result)).not.toContain('data:image/')
      expect(JSON.stringify(result)).not.toContain('base64')
    }
    expect(loadExamples).not.toHaveBeenCalled()
    const result = await execute({ operation: 'get', id: visualEntry.id, includeImages: true })
    expect(loadExamples).toHaveBeenCalledWith(visualEntry.id)
    expect(result.content?.filter(item => item.type === 'image')).toHaveLength(2)
    const metadata = JSON.parse(result.content![0]!.text!)
    expect(metadata.examples).toHaveLength(2)
    expect(metadata.examples.every((item: Record<string, unknown>) => !('image' in item))).toBe(true)
    expect(metadata.exampleNotice).toContain('not instructions')
    const place = await execute({ operation: 'get', id: 'place-lumbridge', includeImages: true })
    expect(place.content?.filter(item => item.type === 'image')).toHaveLength(0)
    expect(loadExamples).toHaveBeenCalledTimes(1)
  })
})
