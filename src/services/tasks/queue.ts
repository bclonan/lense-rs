import type { TaskConfig } from '../../types/protocol'
import { validateTask } from './engine'
import { eventId } from './helpers'

export interface QueuedTask { id: string; config: TaskConfig }
export interface ActiveQueuedTask { item: QueuedTask; taskId: string }
export interface SavedTaskQueue { items: QueuedTask[]; repeat: boolean; active?: ActiveQueuedTask }
export const MAX_QUEUED_TASKS = 50

export function queueEntry(config: TaskConfig): QueuedTask {
  validateTask(config)
  return { id: eventId(), config: JSON.parse(JSON.stringify(config)) }
}

export function restoreQueue(value: unknown): SavedTaskQueue {
  const empty = { items: [], repeat: false }
  if (!value || typeof value !== 'object') return empty
  const saved = value as Partial<SavedTaskQueue>
  if (!Array.isArray(saved.items) || saved.items.length > MAX_QUEUED_TASKS) return empty
  const seen = new Set<string>()
  const readItem = (item: QueuedTask): QueuedTask | undefined => {
    try {
      if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 128 || seen.has(item.id)) return
      // Expired deadlines remain visible. Starting the task still checks the real deadline.
      const deadline = Date.parse(item.config?.deadline ?? '')
      validateTask(Number.isFinite(deadline) && deadline <= Date.now() ? { ...item.config, deadline: new Date(Date.now() + 60000).toISOString() } : item.config)
      const copy = JSON.parse(JSON.stringify(item)) as QueuedTask
      seen.add(item.id)
      return { id: copy.id, config: copy.config }
    } catch { return }
  }
  let active: ActiveQueuedTask | undefined
  if (saved.active && typeof saved.active.taskId === 'string' && saved.active.taskId.length > 0 && saved.active.taskId.length <= 128) {
    const item = readItem(saved.active.item)
    if (item) active = { taskId: saved.active.taskId, item }
  }
  const items = saved.items.map(readItem).filter((item): item is QueuedTask => !!item).slice(0, MAX_QUEUED_TASKS - (active ? 1 : 0))
  return { items, repeat: saved.repeat === true, active }
}
