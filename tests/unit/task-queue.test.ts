import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaptureOptions, TaskConfig } from '../../src/types/protocol'

const fixture = vi.hoisted(() => ({ captures: 0, fail: false }))
vi.mock('../../src/lab/adapter', () => ({ LabAdapter: class {
  async observe(options: CaptureOptions = {}) {
    return { id: `queue-frame-${++fixture.captures}`, timestamp: new Date().toISOString(), target: options.target ?? { type: 'monitor', id: 'primary' }, width: 100, height: 100, nativeWidth: 100, nativeHeight: 100, mimeType: 'image/png', image: 'queue-fixture' }
  }
  dispose() {}
} }))
vi.mock('../../src/lab/evaluator', () => ({ LabProvider: class {
  async evaluate({ condition }: { condition: string }) {
    if (fixture.fail) throw new Error('The test evaluator failed.')
    return { condition, result: true, confidence: .99, explanation: 'The fixture remains visible.' }
  }
  async plan() { return { confidence: .99, explanation: 'No fixture input required.', actions: [] } }
  async recover() { return this.plan() }
} }))

import { useControlStore } from '../../src/stores/control'
import { HistoryRepository, type HistorySnapshot } from '../../src/services/persistence/history'
import { queueEntry, restoreQueue } from '../../src/services/tasks/queue'

const controls: ReturnType<typeof useControlStore>[] = []
const config = (goal: string): TaskConfig => ({ goal, durationMs: 1000, verification: { condition: 'The expected state is visible', intervalMs: 500 }, invariants: [], limits: { maxConsecutiveFailures: 3, maxActionsPerMinute: 30, confidenceThreshold: .8 } })
function newControl() { setActivePinia(createPinia()); const control = useControlStore(); controls.push(control); return control }
async function readyQueue() { const control = newControl(); await control.initialize(); await control.enqueue(config('First task')); await control.enqueue(config('Second task')); return control }
async function settle() { await vi.advanceTimersByTimeAsync(0); await new Promise<void>(resolve => setImmediate(resolve)); await vi.advanceTimersByTimeAsync(0) }

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date('2026-09-03T02:00:00Z'))
  fixture.captures = 0; fixture.fail = false
  await new HistoryRepository().clear()
})
afterEach(async () => {
  for (const control of controls.splice(0)) { control.dispose(); await control.flushHistory().catch(() => {}); control.$dispose() }
  await new HistoryRepository().clear()
  vi.restoreAllMocks(); vi.useRealTimers()
})

describe('persistent task queue', () => {
  it('runs FIFO and advances only after the current task completes', async () => {
    const control = await readyQueue(); await control.runQueue()
    expect(control.task?.goal).toBe('First task'); expect(control.queue.map(item => item.config.goal)).toEqual(['Second task'])
    await vi.advanceTimersByTimeAsync(999)
    expect(control.task?.goal).toBe('First task')
    await vi.advanceTimersByTimeAsync(1); await settle()
    expect(control.task?.goal).toBe('Second task')
    await vi.advanceTimersByTimeAsync(1000); await settle()
    expect(control.task?.state).toBe('COMPLETED'); expect(control.queueRunning).toBe(false); expect(control.queue).toHaveLength(0)
    const starts = control.events.filter(event => event.type === 'task.created').map(event => (event.data.config as TaskConfig).goal)
    expect(starts).toEqual(['First task', 'Second task'])
  })

  it('repeats completed items at the back of the queue and stops repeating after Stop', async () => {
    const control = await readyQueue(); await control.setQueueRepeat(true); await control.runQueue()
    await vi.advanceTimersByTimeAsync(1000); await settle()
    expect(control.task?.goal).toBe('Second task'); expect(control.queue.map(item => item.config.goal)).toEqual(['First task'])
    await vi.advanceTimersByTimeAsync(1000); await settle()
    expect(control.task?.goal).toBe('First task'); expect(control.queue.map(item => item.config.goal)).toEqual(['Second task'])
    await control.stop(); await vi.advanceTimersByTimeAsync(5000); await settle()
    expect(control.queueRunning).toBe(false)
    expect(control.events.filter(event => event.type === 'task.created').map(event => (event.data.config as TaskConfig).goal)).toEqual(['First task', 'Second task', 'First task'])
  })

  it('halts on Pause and resumes the same item only after Run queue', async () => {
    const control = await readyQueue(); await control.runQueue(); await vi.advanceTimersByTimeAsync(200)
    const firstId = control.task!.id; await control.pause(); await vi.advanceTimersByTimeAsync(5000)
    expect(control.task?.id).toBe(firstId); expect(control.task?.state).toBe('PAUSED'); expect(control.queueRunning).toBe(false)
    expect(control.queue.map(item => item.config.goal)).toEqual(['Second task'])
    await control.runQueue(); expect(control.task?.id).toBe(firstId)
    await vi.advanceTimersByTimeAsync(800); await settle()
    expect(control.task?.goal).toBe('Second task')
  })

  it('halts on failure without starting the next item', async () => {
    const control = await readyQueue(); fixture.fail = true
    await control.runQueue(); await settle(); await vi.advanceTimersByTimeAsync(5000)
    expect(control.task?.goal).toBe('First task'); expect(control.task?.state).toBe('FAILED')
    expect(control.queueRunning).toBe(false); expect(control.queue.map(item => item.config.goal)).toEqual(['Second task'])
    expect(control.events.filter(event => event.type === 'task.created')).toHaveLength(1)
  })

  it('restores an active persisted queue as paused without starting another task', async () => {
    const original = await readyQueue(); await original.runQueue(); await original.flushHistory()
    const repository = new HistoryRepository(); const saved = (await repository.load())!
    expect(saved.queue?.active?.taskId).toBe(saved.task?.id)
    original.dispose(); await original.flushHistory(); original.$dispose(); controls.splice(controls.indexOf(original), 1)
    // Restore the committed snapshot that existed before the original page closed.
    await repository.save(saved)
    const restored = newControl(); await restored.initialize(); await vi.advanceTimersByTimeAsync(5000)
    expect(restored.task?.id).toBe(saved.task?.id); expect(restored.task?.state).toBe('PAUSED')
    expect(restored.queueRunning).toBe(false); expect(restored.queue.map(item => item.config.goal)).toEqual(['Second task'])
    expect(restored.events.filter(event => event.type === 'task.created')).toHaveLength(1)
    await restored.runQueue(); await vi.advanceTimersByTimeAsync(1000); await settle()
    expect(restored.task?.goal).toBe('Second task')
  })

  it('keeps previously saved items when enqueue is called before initialization finishes', async () => {
    const first = queueEntry(config('Already saved'))
    await new HistoryRepository().save({ version: 1, task: null, events: [], mode: 'lab', savedAt: new Date().toISOString(), queue: { items: [first], repeat: false } })
    const control = newControl()
    await control.enqueue(config('New request'))
    await control.initialize()
    expect(control.queue.map(item => item.config.goal)).toEqual(['Already saved', 'New request'])
  })

  it('cancels queued advancement when Stop arrives before the next item starts', async () => {
    const control = await readyQueue(); await control.runQueue()
    await control.stop(); await vi.advanceTimersByTimeAsync(5000); await settle()
    expect(control.task?.state).toBe('STOPPED'); expect(control.queueRunning).toBe(false)
    expect(control.events.filter(event => event.type === 'task.created')).toHaveLength(1)
  })

  it('does not start the next task while the first start is uncommitted, or requeue a completed task after save failure', async () => {
    const control = await readyQueue()
    let rejectSave!: (reason: Error) => void
    const save = vi.spyOn(HistoryRepository.prototype, 'save').mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSave = reject }))
    const run = control.runQueue().then(() => undefined, reason => reason as Error)
    await settle(); await vi.advanceTimersByTimeAsync(1000); await settle()
    if (!rejectSave) { save.mockRestore(); throw (await run) ?? new Error('The task did not attempt to save its start.') }
    const goalBeforeSaveSettles = control.task?.goal
    const startsBeforeSaveSettles = control.events.filter(event => event.type === 'task.created').map(event => (event.data.config as TaskConfig).goal)
    rejectSave(new Error('Test storage full')); expect((await run)?.message).toBe('Test storage full'); await settle()
    expect(goalBeforeSaveSettles).toBe('First task')
    expect(startsBeforeSaveSettles).toEqual(['First task'])
    expect(control.queueRunning).toBe(false)
    expect(control.queue.map(item => item.config.goal)).toEqual(['Second task'])
  })

  it('does not acknowledge a new queued task that a concurrent history clear would discard', async () => {
    const saved: HistorySnapshot = { version: 1, task: null, events: [], mode: 'lab', savedAt: new Date().toISOString(), queue: { items: [queueEntry(config('Saved task'))], repeat: false } }
    let release!: (value: HistorySnapshot) => void
    vi.spyOn(HistoryRepository.prototype, 'load').mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const control = newControl(); const initializing = control.initialize()
    const clearing = control.clearHistory()
    const adding = control.enqueue(config('Concurrent addition')).then(() => ({ accepted: true }), () => ({ accepted: false }))
    release(saved); await initializing; await clearing
    expect((await adding).accepted).toBe(false)
    expect(control.queue).toHaveLength(0); expect(control.events).toHaveLength(0)
    expect(await new HistoryRepository().load()).toBeNull()
  })
})

describe('saved queue recovery', () => {
  it('keeps expired tasks visible and retains other valid entries when one entry is malformed', () => {
    const expired = { id: 'expired', config: { ...config('Expired task'), deadline: new Date(Date.now() - 1000).toISOString() } }
    const valid = { id: 'valid', config: config('Still valid') }
    const result = restoreQueue({ items: [expired, { id: 'invalid', config: { ...config('Bad'), goal: '' } }, valid], repeat: false })
    expect(result.items.map(item => item.id)).toEqual(['expired', 'valid'])
    expect(result.items[0]?.config.deadline).toBe(expired.config.deadline)
  })

  it('includes the active item in the 50-task restore limit', () => {
    const active = { taskId: 'active-task', item: { id: 'active-entry', config: config('Current') } }
    const result = restoreQueue({ active, repeat: true, items: Array.from({ length: 50 }, (_, index) => ({ id: `pending-${index}`, config: config(`Pending ${index}`) })) })
    expect(result.active?.taskId).toBe('active-task'); expect(result.items).toHaveLength(49); expect(result.repeat).toBe(true)
  })
})
