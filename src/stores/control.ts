import { defineStore } from 'pinia'
import { computed, markRaw, ref, watch } from 'vue'
import type { AgentProvider, CaptureOptions, DesktopAction, DesktopAdapter, EvaluationResult, LenseEvent, Observation, Point, Target, TaskConfig, TaskContext, TaskRecord } from '../types/protocol'
import { LabAdapter } from '../lab/adapter'
import { LabProvider } from '../lab/evaluator'
import { boundHistory, HistoryRepository } from '../services/persistence/history'
import { TaskEngine, activeStates, validateTask } from '../services/tasks/engine'
import { MAX_QUEUED_TASKS, queueEntry, restoreQueue, type QueuedTask, type ActiveQueuedTask } from '../services/tasks/queue'
import { bounded, ControlError, eventId } from '../services/tasks/helpers'
import { untilVisualCondition, type UntilOptions } from '../services/tasks/until'

export const useControlStore = defineStore('control', () => {
  const task = ref<TaskRecord | null>(null)
  const events = ref<LenseEvent[]>([])
  const observation = ref<Observation | null>(null)
  const evaluation = ref<EvaluationResult | null>(null)
  const error = ref('')
  const mode = ref<'lab' | 'desktop'>('lab')
  const target = ref<Target>({ type: 'monitor', id: 'primary' })
  const selectedEvent = ref(-1)
  const clickPoint = ref<Point | null>(null)
  const queue = ref<QueuedTask[]>([])
  const queueRunning = ref(false)
  const queueRepeat = ref(false)
  const activeQueuedTask = ref<ActiveQueuedTask>()
  const queueResumable = computed(() => !!task.value && ['PAUSED', 'FAILED'].includes(task.value.state) && activeQueuedTask.value?.taskId === task.value.id)
  const agentLastSeen = ref<string>()
  const repository = new HistoryRepository()
  let labAdapter: LabAdapter | undefined
  let desktopAdapter: DesktopAdapter | undefined
  let desktopProvider: AgentProvider | undefined
  let engine: TaskEngine | undefined
  let initialized = false
  let initialization: Promise<void> | undefined
  let disposed = false
  let clearingHistory = false
  let saving: ReturnType<typeof setTimeout> | undefined
  let saveChain = Promise.resolve()
  let preview: ReturnType<typeof setInterval> | undefined
  let observationRequest = 0
  let currentObserve: AbortController | undefined
  let unsubscribeDesktop: (() => void) | undefined
  let lastTaskSave = 0
  const waits = new Set<AbortController>()
  let queueEpoch = 0
  let queueTarget = ''
  let queueStart: { itemId: string; epoch: number } | undefined
  let queueAdvancePending = false
  const targetKey = () => `${mode.value}:${target.value.type}:${target.value.id}`
  const queueSnapshot = () => ({ items: queue.value, repeat: queueRepeat.value, active: activeQueuedTask.value })

  const getAdapter = () => {
    const adapter = mode.value === 'lab' ? labAdapter : desktopAdapter
    if (!adapter) throw new ControlError('NOT_PAIRED', 'Connect and pair the desktop bridge first.')
    return adapter
  }
  const getProvider = () => mode.value === 'lab' ? new LabProvider() : desktopProvider
  const showError = (reason: unknown) => { error.value = reason instanceof Error ? reason.message : String(reason) }
  const persist = () => {
    clearTimeout(saving)
    saving = setTimeout(() => {
      const snapshot = JSON.parse(JSON.stringify({ version: 1, task: task.value, events: events.value, mode: mode.value, queue: queueSnapshot(), savedAt: new Date().toISOString() }))
      saveChain = saveChain.then(() => repository.save(snapshot)).catch(reason => { error.value = `History could not be saved: ${reason instanceof Error ? reason.message : String(reason)}` })
    }, 150)
  }
  async function flushHistory() {
    clearTimeout(saving)
    const snapshot = JSON.parse(JSON.stringify({ version: 1, task: task.value, events: events.value, mode: mode.value, queue: queueSnapshot(), savedAt: new Date().toISOString() }))
    const write = saveChain.then(() => repository.save(snapshot))
    saveChain = write.catch(reason => { error.value = `History could not be saved: ${reason instanceof Error ? reason.message : String(reason)}` })
    await write
  }
  const record = (event: LenseEvent) => {
    if (events.value.some(existing => existing.id === event.id)) return
    if (event.type === 'task.created') event = { ...event, data: { ...event.data, source: mode.value } }
    events.value = boundHistory([...events.value, markRaw(event)])
    if (event.type === 'action.started') {
      const action = event.data.action as DesktopAction | undefined
      if (action && 'x' in action) clickPoint.value = { x: action.x, y: action.y }
    }
    persist()
  }
  function recordEvent(event: LenseEvent) {
    const redact = (value: unknown, depth = 0): unknown => {
      if (depth > 8) return '[nested data omitted]'
      if (Array.isArray(value)) return value.map(item => redact(item, depth + 1))
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !/token|authorization|password|secret|api.?key/i.test(key)).map(([key, item]) => [key, redact(item, depth + 1)]))
      return value
    }
    record({ ...event, data: redact(event.data) as Record<string, unknown> })
  }
  const makeEngine = () => {
    engine = new TaskEngine(getAdapter(), getProvider(), {
      task: receiveTask, event: record,
      observation: value => { if (!observation.value || value.timestamp >= observation.value.timestamp) observation.value = markRaw(value) },
      evaluation: value => { evaluation.value = markRaw(value) }, error: showError,
    })
    engine.target = target.value
  }

  function haltQueue() { queueRunning.value = false; queueAdvancePending = false; queueEpoch++ }
  function advanceQueueWhenReady() {
    if (!queueRunning.value || queueStart || !queueAdvancePending) return
    queueAdvancePending = false
    const epoch = queueEpoch
    queueMicrotask(() => { if (queueRunning.value && epoch === queueEpoch) void nextQueuedTask(epoch).catch(reason => { if (epoch === queueEpoch) { haltQueue(); showError(reason); persist() } }) })
  }
  function receiveTask(value: TaskRecord) {
    task.value = value
    if (initialized && ['PAUSED', 'FAILED', 'STOPPED'].includes(value.state)) haltQueue()
    if (value.state === 'COMPLETED' && activeQueuedTask.value?.taskId === value.id) {
      const completed = activeQueuedTask.value.item
      activeQueuedTask.value = undefined
      if (queueRepeat.value && queue.value.length < MAX_QUEUED_TASKS) {
        try { queue.value = [...queue.value, queueEntry(completed.config)] } catch (reason) { haltQueue(); showError(reason) }
      }
      record({ id: eventId(), timestamp: new Date().toISOString(), type: 'queue.item.completed', taskId: value.id, data: { id: completed.id } })
      if (queueRunning.value) {
        queueAdvancePending = true
        advanceQueueWhenReady()
      }
    }
    if (Date.now() - lastTaskSave >= 2000) { lastTaskSave = Date.now(); persist() }
  }

  watch(target, (value, previous) => {
    if (engine && (value.id !== previous.id || value.type !== previous.type)) {
      haltQueue(); cancelPending(); engine.pause('The capture target changed. Review the new screenshot and Resume before further input.'); engine.target = value
      observation.value = null; evaluation.value = null; clickPoint.value = null
    }
  }, { flush: 'sync' })

  async function initialize() {
    if (disposed) throw new ControlError('CONTROL_DISABLED', 'This control session has closed.')
    if (initialization) return initialization
    initialization = initializeStore().catch(reason => { engine?.dispose(); engine = undefined; initialized = false; initialization = undefined; throw reason })
    return initialization
  }
  async function ready() {
    if (clearingHistory) throw new ControlError('HISTORY_CLEARING', 'Wait until history has finished clearing before starting another operation.')
    await initialize()
    if (disposed || clearingHistory) throw new ControlError('CONTROL_DISABLED', 'The control session closed or history is being cleared.')
  }
  async function initializeStore() {
    labAdapter = markRaw(new LabAdapter())
    try {
      const saved = await repository.load()
      if (saved) {
        task.value = saved.task; events.value = saved.events; mode.value = saved.mode
        const restored = restoreQueue(saved.queue)
        queue.value = restored.items; queueRepeat.value = restored.repeat
        activeQueuedTask.value = restored.active?.taskId === saved.task?.id ? restored.active : undefined
        queueRunning.value = false
      }
      // Saved frames belong to replay. A fresh desktop session has no selected
      // target or permission, so it must not present an old frame as current.
      observation.value = null; evaluation.value = null
    } catch (reason) { showError(`History is unavailable in this browser: ${reason instanceof Error ? reason.message : String(reason)}`) }
    if (disposed) throw new ControlError('CONTROL_DISABLED', 'This control session has closed.')
    // A restored desktop session has no token. Keep its history paused until pairing.
    if (mode.value === 'desktop' && !desktopAdapter) {
      engine = new TaskEngine(labAdapter, undefined, { task: receiveTask, event: record, observation: value => { observation.value = markRaw(value) }, evaluation: value => { evaluation.value = markRaw(value) }, error: showError })
    } else makeEngine()
    engine!.restore(task.value)
    if (mode.value === 'lab') await capture()
    if (disposed) throw new ControlError('CONTROL_DISABLED', 'This control session has closed.')
    preview = setInterval(() => {
      if (mode.value === 'lab' && task.value && activeStates.includes(task.value.state)) {
        void labAdapter!.observe().then(frame => { if (mode.value === 'lab') observation.value = markRaw(frame) }).catch(showError)
      }
    }, 900)
    initialized = true
  }

  function configure(adapter: DesktopAdapter, provider?: AgentProvider) {
    haltQueue()
    desktopAdapter = markRaw(adapter); desktopProvider = provider ? markRaw(provider) : undefined
    unsubscribeDesktop?.()
    unsubscribeDesktop = adapter.subscribe?.(event => {
      if (/^(bridge|watch)\./.test(event.type)) recordEvent({ ...event, taskId: event.taskId ?? (typeof event.data.watchId === 'string' && event.data.watchId.startsWith(`task-${task.value?.id}-`) ? task.value?.id : undefined) })
      if (event.type === 'bridge.disconnected' && mode.value === 'desktop') { void pause().catch(showError); error.value = 'The bridge connection was lost. Reconnect and Resume before further input.' }
    })
    if (mode.value === 'desktop' && initialized && !clearingHistory) { if (engine) engine.configure(adapter, provider); else makeEngine() }
  }

  async function setMode(nextMode: 'lab' | 'desktop') {
    const epoch = queueEpoch
    await ready()
    if (epoch !== queueEpoch) throw new ControlError('TASK_STOPPED', 'The pending source change was cancelled.')
    if (nextMode === mode.value) return
    void pause().catch(showError)
    queue.value = []; activeQueuedTask.value = undefined; queueRepeat.value = false
    if (task.value) record({ id: eventId(), timestamp: new Date().toISOString(), taskId: task.value.id, type: 'task.archived', data: { task: { ...task.value }, source: mode.value, reason: 'The user selected another control source.' } })
    engine?.dispose(); engine = undefined; task.value = null
    currentObserve?.abort(); observationRequest++; mode.value = nextMode; selectedEvent.value = -1; clickPoint.value = null; observation.value = null; evaluation.value = null
    target.value = { type: 'monitor', id: nextMode === 'lab' ? 'lab' : 'primary' }
    if (nextMode === 'desktop' && !desktopAdapter) { persist(); return }
    makeEngine()
    persist()
    if (nextMode === 'lab') void observe().catch(showError)
  }

  async function start(config: TaskConfig) {
    validateTask(config)
    haltQueue(); activeQueuedTask.value = undefined
    await startTask(config, undefined, queueEpoch)
  }
  async function startTask(config: TaskConfig, queued?: QueuedTask, epoch = queueEpoch) {
    error.value = ''; selectedEvent.value = -1; evaluation.value = null
    let startedTaskId: string | undefined
    let runEpoch = epoch
    try {
      await ready()
      if (epoch !== queueEpoch) throw new ControlError('TASK_STOPPED', 'The pending task start was cancelled.')
      if (queued && !queue.value.some(item => item.id === queued.id)) throw new ControlError('TASK_STOPPED', 'The queued task was removed before it started.')
      getAdapter()
      if (!engine) makeEngine()
      engine!.configure(getAdapter(), getProvider())
      runEpoch = queueEpoch
      engine!.target = target.value; engine!.start(JSON.parse(JSON.stringify(config)) as TaskConfig)
      startedTaskId = engine!.task?.id
      if (queued && engine!.task) {
        queue.value = queue.value.filter(item => item.id !== queued.id)
        activeQueuedTask.value = { item: queued, taskId: engine!.task.id }
        receiveTask(engine!.task)
      }
      await flushHistory()
    } catch (reason) {
      if (runEpoch === queueEpoch) {
        if (startedTaskId && engine?.task?.id === startedTaskId) engine.pause('Task history could not be saved. Review storage before resuming.')
        showError(reason)
      }
      throw reason
    }
  }
  function cancelPending() { currentObserve?.abort(); observationRequest++; for (const controller of waits) controller.abort(new ControlError('TASK_STOPPED', 'The user stopped or paused control.')); waits.clear() }
  async function pause() {
    haltQueue(); cancelPending(); engine?.pause()
    const epoch = queueEpoch
    if (!initialized) {
      if (disposed) return
      await initialize()
      if (disposed || epoch !== queueEpoch) return
      engine?.pause()
    }
    await flushHistory()
  }
  async function resume() {
    error.value = ''
    const epoch = queueEpoch
    let resumedTaskId: string | undefined
    let reservation: { itemId: string; epoch: number } | undefined
    try {
      await ready()
      if (epoch !== queueEpoch) throw new ControlError('TASK_STOPPED', 'The pending resume was cancelled.')
      getAdapter(); if (!engine) makeEngine()
      engine!.configure(getAdapter(), getProvider()); engine!.target = target.value
      resumedTaskId = engine!.task?.id
      const active = activeQueuedTask.value
      if (queueRunning.value && active && active.taskId === resumedTaskId) {
        if (queueStart) throw new ControlError('QUEUE_BUSY', 'The previous task start is still being saved.')
        reservation = { itemId: active.item.id, epoch }
        queueStart = reservation
      }
      engine!.resume()
      await flushHistory()
    } catch (reason) {
      if (epoch === queueEpoch) {
        if (resumedTaskId && engine?.task?.id === resumedTaskId) engine.pause('Resume could not finish. Review the task before trying again.')
        haltQueue(); showError(reason)
      }
      throw reason
    } finally {
      if (reservation && queueStart === reservation) queueStart = undefined
      advanceQueueWhenReady()
    }
  }
  async function stop() {
    haltQueue(); activeQueuedTask.value = undefined; cancelPending(); engine?.stop()
    const epoch = queueEpoch
    if (!initialized) {
      if (disposed) return
      await initialize()
      if (disposed || epoch !== queueEpoch) return
      activeQueuedTask.value = undefined
      engine?.stop()
    }
    await flushHistory()
  }

  async function enqueue(config: TaskConfig) {
    await ready()
    if (queue.value.length + (activeQueuedTask.value ? 1 : 0) >= MAX_QUEUED_TASKS) throw new ControlError('QUEUE_FULL', 'The queue holds up to 50 tasks, including its current task.')
    const item = queueEntry(config)
    queue.value = [...queue.value, item]
    record({ id: eventId(), timestamp: new Date().toISOString(), type: 'queue.enqueued', data: { id: item.id, goal: config.goal } })
    await flushHistory()
    return item
  }
  async function removeQueued(id: string) {
    await ready()
    queue.value = queue.value.filter(item => item.id !== id)
    await flushHistory()
  }
  async function clearQueue() { await ready(); haltQueue(); queue.value = []; queueRepeat.value = false; await flushHistory() }
  async function setQueueRepeat(value: boolean) { await ready(); queueRepeat.value = value; await flushHistory() }
  async function nextQueuedTask(epoch: number) {
    if (!queueRunning.value || epoch !== queueEpoch) return
    if (queueStart) throw new ControlError('QUEUE_BUSY', 'The previous task start is still being saved.')
    if (targetKey() !== queueTarget) { haltQueue(); throw new ControlError('TARGET_CHANGED', 'Review the selected target before running the queue again.') }
    const item = queue.value[0]
    if (!item) { haltQueue(); await flushHistory(); return }
    const reservation = { itemId: item.id, epoch }
    queueStart = reservation
    try { await startTask(item.config, item, epoch) }
    catch (reason) {
      if (epoch === queueEpoch) {
        haltQueue()
      }
      throw reason
    } finally {
      if (queueStart === reservation) queueStart = undefined
      advanceQueueWhenReady()
    }
  }
  async function runQueue() {
    const initialEpoch = queueEpoch
    await ready()
    if (initialEpoch !== queueEpoch) throw new ControlError('TASK_STOPPED', 'The pending queue start was cancelled.')
    getAdapter()
    if (queueStart) throw new ControlError('QUEUE_BUSY', 'Wait for the previous task start to finish saving before running the queue.')
    if (task.value && activeStates.includes(task.value.state)) throw new ControlError('TASK_RUNNING', 'Pause the current task before starting the queue.')
    if (task.value?.state === 'PAUSED' && activeQueuedTask.value?.taskId !== task.value.id) throw new ControlError('TASK_PAUSED', 'Resume or stop the current task before running the queue.')
    if (!queue.value.length && !activeQueuedTask.value) throw new ControlError('QUEUE_EMPTY', 'Add a task to the queue first.')
    queueTarget = targetKey()
    if (task.value?.state === 'PAUSED' && activeQueuedTask.value) {
      queueRunning.value = true; const epoch = ++queueEpoch
      try { await resume() } catch (reason) { if (epoch === queueEpoch) haltQueue(); throw reason }
    } else {
      if (task.value?.state === 'FAILED' && activeQueuedTask.value?.taskId === task.value.id) {
        queue.value = [activeQueuedTask.value.item, ...queue.value]; activeQueuedTask.value = undefined
      }
      queueRunning.value = true; const epoch = ++queueEpoch; await nextQueuedTask(epoch)
    }
    await flushHistory()
  }
  function assertCurrentTask(expectedTaskId: string) {
    if (!engine?.task || engine.task.id !== expectedTaskId) throw new ControlError('STALE_TASK', 'The task changed. Read desktop_status before continuing.')
    return engine
  }
  async function signalTask(input: { type: string; message: string }, expectedTaskId = task.value?.id) {
    if (!expectedTaskId) throw new ControlError('NO_TASK', 'Start a task before sending an event.')
    const result = assertCurrentTask(expectedTaskId).signal(input)
    await flushHistory(); return result
  }
  async function waitForEvents(options: { afterSequence: number; timeoutMs: number }, expectedTaskId: string, signal?: AbortSignal) {
    agentLastSeen.value = new Date().toISOString()
    return assertCurrentTask(expectedTaskId).waitForEvents(options, signal)
  }
  async function setTaskContext(context: TaskContext, expectedTaskId: string, observationId: string) {
    const current = assertCurrentTask(expectedTaskId)
    assertObservation(observationId)
    current.setContext(context)
    agentLastSeen.value = new Date().toISOString()
    record({ id: eventId(), timestamp: new Date().toISOString(), taskId: expectedTaskId, type: 'context.evidence', data: { observationId, source: 'agent' } })
    await flushHistory()
  }
  function assertObservation(id: string) {
    const capturedAt = Date.parse(observation.value?.timestamp ?? '')
    if (!observation.value || observation.value.id !== id || !Number.isFinite(capturedAt) || Date.now() - capturedAt > 60000 || capturedAt < Date.parse(task.value?.createdAt ?? '') || observation.value.target.type !== target.value.type || observation.value.target.id !== target.value.id) throw new ControlError('STALE_OBSERVATION', 'Capture and review a fresh observation of this task target before reporting progress.')
  }
  async function completeTask(expectedTaskId: string, observationId: string, reason: string) {
    const current = assertCurrentTask(expectedTaskId)
    assertObservation(observationId)
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 2000) throw new ControlError('INVALID_COMPLETION', 'Describe the visible evidence of completion in up to 2,000 characters.')
    record({ id: eventId(), timestamp: new Date().toISOString(), taskId: expectedTaskId, type: 'task.completion.reported', data: { observationId, reason, source: 'external-agent' } })
    current.complete(reason); await flushHistory()
  }
  async function setCadence(intervalMs: number) {
    if (!task.value || !Number.isInteger(intervalMs) || intervalMs < 500 || intervalMs > 3600000) throw new ControlError('INVALID_TASK', 'Check interval must be between 0.5 seconds and one hour.')
    const wasRunning = activeStates.includes(task.value.state)
    const wasQueueRunning = queueRunning.value
    const current = assertCurrentTask(task.value.id)
    current.pause('Check interval changed.')
    current.task!.verification.intervalMs = intervalMs
    if (wasRunning) { queueRunning.value = wasQueueRunning; await resume() }
    else await flushHistory()
  }

  async function observe(options: CaptureOptions = {}, signal?: AbortSignal) {
    await ready()
    return capture(options, signal)
  }
  async function capture(options: CaptureOptions = {}, signal?: AbortSignal) {
    error.value = ''; const request = ++observationRequest; currentObserve?.abort(); currentObserve = new AbortController()
    const capturedTaskId = task.value?.id, capturedTargetKey = targetKey()
    const controller = currentObserve
    const abort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort()
    try {
      const frame = await bounded(signal => getAdapter().observe({ target: target.value, maxDimension: 1280, quality: .78, ...options }, signal), 10000, controller.signal)
      if (request !== observationRequest || capturedTaskId !== task.value?.id || capturedTargetKey !== targetKey() || (options.target && (options.target.type !== target.value.type || options.target.id !== target.value.id))) return frame
      observation.value = markRaw(frame)
      if (engine) engine.recordObservation(frame)
      else record({ id: eventId(), timestamp: new Date().toISOString(), taskId: task.value?.id, type: 'observation.captured', data: { frameId: frame.id, source: 'manual' }, observation: frame })
      return frame
    } catch (reason) { if (request === observationRequest) showError(reason); throw reason }
    finally { signal?.removeEventListener('abort', abort) }
  }

  async function act(action: DesktopAction, signal?: AbortSignal, guard?: { taskId: string; observationId: string }) {
    error.value = ''
    const epoch = queueEpoch
    try {
      await ready()
      if (epoch !== queueEpoch) throw new ControlError('TASK_STOPPED', 'The pending action was cancelled.')
      getAdapter(); if (!engine) makeEngine()
      if (guard) { assertCurrentTask(guard.taskId); assertObservation(guard.observationId); agentLastSeen.value = new Date().toISOString() }
      if (guard && 'target' in action && action.target && (action.target.type !== target.value.type || action.target.id !== target.value.id)) throw new ControlError('TARGET_CHANGED', 'Capture the action target before sending guarded input to it.')
      if (guard && action.type === 'window.focus' && (target.value.type !== 'window' || action.windowId !== target.value.id)) throw new ControlError('TARGET_CHANGED', 'Capture the selected window before sending guarded focus input to it.')
      engine!.target = target.value; const result = await engine!.action(action, signal); await flushHistory(); return result
    } catch (reason) { showError(reason); throw reason }
  }

  async function until(options: UntilOptions, signal?: AbortSignal) {
    const epoch = queueEpoch
    await ready()
    if (epoch !== queueEpoch) throw new ControlError('TASK_STOPPED', 'The pending condition wait was cancelled.')
    error.value = ''; const controller = new AbortController(); waits.add(controller)
    const cancel = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel()
    try { return await untilVisualCondition(getAdapter(), getProvider(), options, { target: target.value, signal: controller.signal, confidenceThreshold: task.value?.limits.confidenceThreshold, onEvent: event => { record(event); if (event.observation) observation.value = markRaw(event.observation); if (event.type === 'evaluation.completed') evaluation.value = event.data as unknown as EvaluationResult } }) } catch (reason) { showError(reason); throw reason } finally { waits.delete(controller); signal?.removeEventListener('abort', cancel) }
  }

  function exportEvents(format: 'json' | 'jsonl') { return format === 'jsonl' ? events.value.map(event => JSON.stringify(event)).join('\n') : JSON.stringify({ version: 1, task: task.value, queue: queueSnapshot(), events: events.value }, null, 2) }
  async function clearHistory() {
    if (disposed || clearingHistory) throw new ControlError('CONTROL_DISABLED', 'The control session closed or history is already being cleared.')
    clearingHistory = true
    haltQueue(); cancelPending(); engine?.stop()
    try {
      await initialize()
      if (disposed) throw new ControlError('CONTROL_DISABLED', 'The control session has closed.')
      await stop(); engine?.dispose(); engine = undefined; clearTimeout(saving); await saveChain; await repository.clear()
      task.value = null; queue.value = []; activeQueuedTask.value = undefined; queueRepeat.value = false; events.value = []; selectedEvent.value = -1; evaluation.value = null; clickPoint.value = null; error.value = ''
    } finally { clearingHistory = false }
  }
  function dispose() { disposed = true; void stop().catch(showError); engine?.dispose(); clearInterval(preview); unsubscribeDesktop?.(); labAdapter?.dispose() }

  return { task, events, observation, evaluation, error, mode, target, selectedEvent, clickPoint, queue, queueRunning, queueRepeat, queueResumable, agentLastSeen, initialize, configure, start, pause, resume, stop, observe, act, until, exportEvents, clearHistory, setMode, dispose, recordEvent, flushHistory, enqueue, runQueue, removeQueued, clearQueue, setQueueRepeat, signalTask, waitForEvents, setTaskContext, completeTask, setCadence, assertCurrentTask }
})
