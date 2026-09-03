import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActionResult, CaptureOptions, DesktopAction, DesktopAdapter, Observation, TaskConfig } from '../../src/types/protocol'

const lab = vi.hoisted(() => ({ instances: 0, captures: 0, inputs: [] as DesktopAction[] }))
vi.mock('../../src/lab/adapter', () => ({ LabAdapter: class {
  constructor() { lab.instances++ }
  async observe(options: CaptureOptions = {}) {
    lab.captures++
    return { id: `lab-${lab.captures}`, timestamp: new Date().toISOString(), target: options.target ?? { type: 'monitor', id: 'primary' }, width: 100, height: 100, nativeWidth: 100, nativeHeight: 100, mimeType: 'image/png', image: 'test-frame' }
  }
  async action(action: DesktopAction) { lab.inputs.push(action); return { id: 'lab-input', action, ok: true, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), result: {} } }
  dispose() {}
} }))
vi.mock('../../src/lab/evaluator', () => ({ LabProvider: class {
  async evaluate({ condition }: { condition: string }) { return { condition, result: true, confidence: .99, explanation: 'The fixture is visible.' } }
  async plan() { return { confidence: .99, explanation: 'No fixture input required.', actions: [] } }
  async recover() { return this.plan() }
} }))

import { useControlStore } from '../../src/stores/control'
import { HistoryRepository, type HistorySnapshot } from '../../src/services/persistence/history'

const config: TaskConfig = { goal: 'Review the disposable test application', runMode: 'continuous', durationMs: 30000, verification: { condition: 'The expected state is visible', intervalMs: 10000 }, invariants: [], limits: { maxConsecutiveFailures: 3, maxActionsPerMinute: 30, confidenceThreshold: .8 } }
const controls: ReturnType<typeof useControlStore>[] = []

class RecordingAdapter implements DesktopAdapter {
  inputs: DesktopAction[] = []
  captures = 0
  async observe(options: CaptureOptions = {}): Promise<Observation> {
    return { id: `desktop-${++this.captures}`, timestamp: new Date().toISOString(), target: options.target ?? { type: 'monitor', id: 'test-monitor' }, width: 100, height: 100, nativeWidth: 100, nativeHeight: 100, mimeType: 'image/png', image: 'test-frame' }
  }
  async action(action: DesktopAction): Promise<ActionResult> { this.inputs.push(action); return { id: `input-${this.inputs.length}`, action, ok: true, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), result: {} } }
}

function newControl() { setActivePinia(createPinia()); const control = useControlStore(); controls.push(control); return control }
async function desktop() {
  const control = newControl(); await control.initialize()
  const adapter = new RecordingAdapter(); control.configure(adapter); await control.setMode('desktop'); control.target = { type: 'monitor', id: 'test-monitor' }
  await control.start(config)
  return { control, adapter }
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date('2026-09-03T01:00:00Z'))
  lab.instances = 0; lab.captures = 0; lab.inputs = []
  await new HistoryRepository().clear()
})
afterEach(async () => {
  for (const control of controls.splice(0)) { control.dispose(); await control.flushHistory().catch(() => {}); control.$dispose() }
  await new HistoryRepository().clear()
  vi.restoreAllMocks(); vi.useRealTimers()
})

describe('shared control initialization', () => {
  it('shares a pending history load and creates exactly one lab adapter and initial frame', async () => {
    let release!: (value: null) => void
    const load = vi.spyOn(HistoryRepository.prototype, 'load').mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const control = newControl()
    const first = control.initialize(); const second = control.initialize()
    expect(load).toHaveBeenCalledTimes(1); expect(lab.instances).toBe(1); expect(lab.captures).toBe(0)
    release(null); await Promise.all([first, second])
    expect(lab.instances).toBe(1); expect(lab.captures).toBe(1)
    expect(control.observation?.id).toBe('lab-1')
  })

  it.each(['act', 'until'] as const)('honors Stop while %s is waiting for initialization', async operation => {
    let release!: (value: null) => void
    vi.spyOn(HistoryRepository.prototype, 'load').mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const control = newControl()
    const pending = operation === 'act' ? control.act({ type: 'keyboard.key', key: 'ENTER' }) : control.until({ condition: 'Fixture visible', intervalMs: 500, timeoutMs: 1000 })
    const rejected = expect(pending).rejects.toMatchObject({ code: 'TASK_STOPPED' })
    const stopping = control.stop(); release(null); await stopping; await rejected
    expect(lab.inputs).toHaveLength(0)
  })

  it.each(['pause', 'stop'] as const)('preserves saved history when %s arrives during initialization', async operation => {
    const timestamp = new Date().toISOString()
    const saved: HistorySnapshot = { version: 1, mode: 'desktop', savedAt: timestamp, events: [{ id: 'saved-event', timestamp, type: 'task.started', data: { goal: 'Saved task' } }], task: { ...config, id: 'saved-task', state: 'WAITING', createdAt: timestamp, elapsedMs: 500, failures: 0, recoveries: 0, observations: 1, actions: 0, evaluations: 0, watchChecks: 0 } }
    const repository = new HistoryRepository(); await repository.save(saved)
    let release!: (snapshot: HistorySnapshot) => void
    vi.spyOn(HistoryRepository.prototype, 'load').mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const control = newControl(); const initializing = control.initialize(); const stopping = control[operation]()
    release(saved); await initializing; await stopping
    const restored = await repository.load()
    expect(restored?.task?.id).toBe('saved-task')
    expect(restored?.task?.state).toBe(operation === 'pause' ? 'PAUSED' : 'STOPPED')
    expect(restored?.events.some(event => event.id === 'saved-event')).toBe(true)
  })
})

describe('external task evidence', () => {
  it('rejects an action based on a replaced frame and accepts the current frame', async () => {
    const { control, adapter } = await desktop()
    const first = await control.observe(); const current = await control.observe(); const taskId = control.task!.id
    await expect(control.act({ type: 'keyboard.type', text: 'Stale input' }, undefined, { taskId, observationId: first.id })).rejects.toMatchObject({ code: 'STALE_OBSERVATION' })
    expect(adapter.inputs).toHaveLength(0)
    await control.act({ type: 'keyboard.type', text: 'Reviewed input' }, undefined, { taskId, observationId: current.id })
    expect(adapter.inputs).toEqual([{ type: 'keyboard.type', text: 'Reviewed input' }])
  })

  it('rejects input and completion reports for a task that has been replaced', async () => {
    const { control, adapter } = await desktop()
    const oldTask = control.task!.id; const oldFrame = await control.observe()
    vi.setSystemTime(Date.now() + 10)
    await control.start({ ...config, goal: 'The next task' }); const currentTask = control.task!.id
    await expect(control.act({ type: 'keyboard.key', key: 'ENTER' }, undefined, { taskId: oldTask, observationId: oldFrame.id })).rejects.toMatchObject({ code: 'STALE_TASK' })
    await expect(control.completeTask(oldTask, oldFrame.id, 'Old task is complete.')).rejects.toMatchObject({ code: 'STALE_TASK' })
    await expect(control.completeTask(currentTask, oldFrame.id, 'Old image reused for new task.')).rejects.toMatchObject({ code: 'STALE_OBSERVATION' })
    expect(adapter.inputs).toHaveLength(0); expect(control.task?.id).toBe(currentTask); expect(control.task?.state).toBe('WAITING')
  })

  it('rejects a frame older than one minute even when no newer capture exists', async () => {
    const { control, adapter } = await desktop()
    const frame = await control.observe(); const taskId = control.task!.id
    vi.setSystemTime(Date.now() + 60001)
    await expect(control.completeTask(taskId, frame.id, 'Expired visual evidence.')).rejects.toMatchObject({ code: 'STALE_OBSERVATION' })
    await expect(control.act({ type: 'keyboard.key', key: 'ENTER' }, undefined, { taskId, observationId: frame.id })).rejects.toMatchObject({ code: 'STALE_OBSERVATION' })
    expect(adapter.inputs).toHaveLength(0)
  })

  it('requires evidence from the selected target, then persists an accepted completion receipt', async () => {
    const { control } = await desktop(); const taskId = control.task!.id
    const wrongTarget = await control.observe({ target: { type: 'monitor', id: 'other-monitor' } })
    await expect(control.completeTask(taskId, wrongTarget.id, 'Other monitor evidence.')).rejects.toMatchObject({ code: 'STALE_OBSERVATION' })
    const frame = await control.observe()
    await control.completeTask(taskId, frame.id, 'The expected result is visible in the selected application.')
    const saved = await new HistoryRepository().load()
    expect(saved?.task?.state).toBe('COMPLETED')
    expect(saved?.events.find(event => event.type === 'task.completion.reported')?.data.observationId).toBe(frame.id)
    expect(saved?.events.find(event => event.type === 'task.completion.confirmed')?.data.source).toBe('external-agent')
  })
})
