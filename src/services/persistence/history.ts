import { openDB } from 'idb'
import type { LenseEvent, Observation, TaskRecord } from '../../types/protocol'
import type { SavedTaskQueue } from '../tasks/queue'

export const MAX_EVENTS = 10000
export const MAX_SCREENSHOTS = 32
const MAX_IMAGE_BYTES = 12 * 1024 * 1024
export interface HistorySnapshot { version: 1; task: TaskRecord | null; events: LenseEvent[]; mode: 'lab' | 'desktop'; savedAt: string; queue?: SavedTaskQueue }

/** Keeps full event metadata, with a bounded number of screenshots for replay. */
export function boundHistory(events: LenseEvent[]): LenseEvent[] {
  const retained = events.slice(-MAX_EVENTS)
  const images = new Set<string>(); let bytes = 0
  for (let i = retained.length - 1; i >= 0; i--) {
    const frame = retained[i]!.observation
    if (frame && !images.has(frame.id) && images.size < MAX_SCREENSHOTS && bytes + frame.image.length <= MAX_IMAGE_BYTES) { images.add(frame.id); bytes += frame.image.length }
  }
  return retained.map(event => ({ ...event, observation: event.observation && images.has(event.observation.id) ? event.observation : undefined }))
}

export class HistoryRepository {
  constructor(private readonly databaseName = 'lense-visual-history-v1') {}
  private async database() { return openDB(this.databaseName, 1, { upgrade(database) { database.createObjectStore('history') } }) }
  async save(snapshot: HistorySnapshot) {
    const database = await this.database()
    const frames: Record<string, Observation> = {}
    const events = boundHistory(snapshot.events).map(event => {
      if (event.observation) frames[event.observation.id] = event.observation
      return { ...event, observation: undefined, frameId: event.observation?.id }
    })
    try { await database.put('history', JSON.parse(JSON.stringify({ ...snapshot, events, frames })), 'current') } finally { database.close() }
  }
  async load(): Promise<HistorySnapshot | null> {
    const database = await this.database()
    try {
      const record = await database.get('history', 'current')
      if (!record || record.version !== 1 || !Array.isArray(record.events)) return null
      return { version: 1, task: record.task ?? null, mode: record.mode === 'desktop' ? 'desktop' : 'lab', savedAt: record.savedAt, queue: record.queue, events: boundHistory(record.events.map((event: LenseEvent & { frameId?: string }) => { const { frameId, ...data } = event; return { ...data, observation: frameId ? record.frames?.[frameId] : undefined } })) }
    } finally { database.close() }
  }
  async clear() { const database = await this.database(); try { await database.delete('history', 'current') } finally { database.close() } }
}
