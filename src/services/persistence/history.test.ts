import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import type { LenseEvent } from '../../types/protocol'
import { boundHistory, HistoryRepository, MAX_EVENTS, MAX_SCREENSHOTS } from './history'

function event(index: number): LenseEvent {
  return { id: `event-${index}`, timestamp: String(index), type: 'observation.captured', data: { index }, observation: { id: `frame-${index}`, timestamp: String(index), target: { type: 'monitor', id: 'lab' }, width: 10, height: 10, nativeWidth: 10, nativeHeight: 10, mimeType: 'image/png', image: 'data:image/png;base64,fixture' } }
}

describe('bounded IndexedDB history', () => {
  it('keeps the latest events and bounds replay images separately', () => {
    const events = boundHistory(Array.from({ length: MAX_EVENTS + 10 }, (_, index) => event(index)))
    expect(events).toHaveLength(MAX_EVENTS)
    expect(events[0]!.id).toBe('event-10')
    expect(events.filter(item => item.observation)).toHaveLength(MAX_SCREENSHOTS)
    expect(events.at(-1)?.observation?.id).toBe(`frame-${MAX_EVENTS + 9}`)
  })
  it('round trips event order, screenshot references, and metadata, then clears', async () => {
    const history = new HistoryRepository(`test-${Date.now()}`)
    await history.save({ version: 1, task: null, mode: 'lab', savedAt: 'test', events: [event(1), event(2), { ...event(3), observation: event(2).observation }] })
    const loaded = await history.load()
    expect(loaded?.events.map(item => item.id)).toEqual(['event-1', 'event-2', 'event-3'])
    expect(loaded?.events[2]?.observation?.id).toBe('frame-2')
    await history.clear(); expect(await history.load()).toBeNull()
  })
})
