import type { ActionResult, AgentPlan, AgentProvider, DesktopAction, DesktopAdapter, EvaluationResult, LenseEvent, Observation, Target, TaskConfig, TaskContext, TaskRecord, TaskState, TaskWakeEvent, TaskWakeResult } from '../../types/protocol'
import { bounded, checkCancelled, ControlError, delay, eventId } from './helpers'

export interface TaskHooks {
  task(task: TaskRecord): void
  event(event: LenseEvent): void
  observation(observation: Observation): void
  evaluation(evaluation: EvaluationResult): void
  error(error: string): void
}

export const activeStates: TaskState[] = ['OBSERVING', 'PLANNING', 'LOCATING_TARGET', 'EXECUTING', 'SETTLING', 'VERIFYING', 'WAITING', 'RECOVERING']
export function validateTaskContext(context: TaskContext) {
  if (!context || typeof context !== 'object' || !['generic', 'osrs', 'rs3'].includes(context.game)) throw new ControlError('INVALID_TASK_CONTEXT', 'Choose generic, osrs or rs3 for the task context.')
  const limits: Record<string, number> = { characterName: 120, location: 240, skills: 2000, inventory: 2000, notes: 4000 }
  for (const [key, value] of Object.entries(context)) {
    if (key === 'game') continue
    if (!(key in limits) || typeof value !== 'string' || value.length > limits[key]!) throw new ControlError('INVALID_TASK_CONTEXT', `The context field ${key} is unknown or exceeds its text limit.`)
  }
}
export function validateTask(config: TaskConfig) {
  if (!config || typeof config.goal !== 'string' || !config.goal.trim() || config.goal.length > 4000) throw new ControlError('INVALID_TASK', 'Enter a goal of 1 to 4,000 characters.')
  if (!Number.isInteger(config.durationMs) || config.durationMs < 1000 || config.durationMs > 86400000) throw new ControlError('INVALID_TASK', 'Task duration must be between one second and 24 hours.')
  if (!config.verification || typeof config.verification.condition !== 'string' || !config.verification.condition.trim() || config.verification.condition.length > 2000 || !Number.isInteger(config.verification.intervalMs) || config.verification.intervalMs < 500 || config.verification.intervalMs > 3600000) throw new ControlError('INVALID_TASK', 'Enter a visual condition under 2,000 characters and an interval of 500 milliseconds to one hour.')
  if (!config.limits) throw new ControlError('INVALID_TASK', 'Specify failure, action and confidence limits.')
  if (!Number.isInteger(config.limits.maxConsecutiveFailures) || config.limits.maxConsecutiveFailures < 1 || config.limits.maxConsecutiveFailures > 20 || !Number.isInteger(config.limits.maxActionsPerMinute) || config.limits.maxActionsPerMinute < 1 || config.limits.maxActionsPerMinute > 120 || !Number.isFinite(config.limits.confidenceThreshold) || config.limits.confidenceThreshold < .5 || config.limits.confidenceThreshold > 1) throw new ControlError('INVALID_TASK', 'Use valid failure and action limits, and a confidence threshold between 50% and 100%.')
  if (config.deadline && (!Number.isFinite(Date.parse(config.deadline)) || Date.parse(config.deadline) <= Date.now())) throw new ControlError('INVALID_TASK', 'The task deadline must be in the future.')
  if (!Array.isArray(config.invariants) || config.invariants.length > 20 || config.invariants.some(invariant => typeof invariant !== 'string' || !invariant.trim() || invariant.length > 1000)) throw new ControlError('INVALID_TASK', 'Use up to 20 nonempty invariants, each under 1,000 characters.')
  if (config.runMode !== undefined && !['timed', 'until-complete', 'continuous'].includes(config.runMode)) throw new ControlError('INVALID_TASK', 'Choose timed, until-complete or continuous mode.')
  if (config.completionCondition !== undefined && (typeof config.completionCondition !== 'string' || !config.completionCondition.trim() || config.completionCondition.length > 2000)) throw new ControlError('INVALID_TASK', 'Use a completion condition of 1 to 2,000 characters.')
  if (config.runMode === 'until-complete' && !config.completionCondition) throw new ControlError('INVALID_TASK', 'Until-complete tasks need a visual completion condition.')
  if (config.monitoring && (!['interval', 'events-and-interval'].includes(config.monitoring.mode) || !Number.isInteger(config.monitoring.watchIntervalMs) || config.monitoring.watchIntervalMs < 500 || config.monitoring.watchIntervalMs > 60000 || !Number.isInteger(config.monitoring.settleMs) || config.monitoring.settleMs < 0 || config.monitoring.settleMs > 5000)) throw new ControlError('INVALID_TASK', 'Choose a watch interval of 500 to 60,000 milliseconds and a settle time of 0 to 5,000 milliseconds.')
  if (config.context !== undefined) validateTaskContext(config.context)
}

/** Deterministic orchestration. Reasoning is delegated through AgentProvider. */
export class TaskEngine {
  task: TaskRecord | null = null
  private controller?: AbortController
  private expires?: ReturnType<typeof setTimeout>
  private ticker?: ReturnType<typeof setInterval>
  private auditTimer?: ReturnType<typeof setInterval>
  private startedSegment = 0
  private elapsedBeforeSegment = 0
  private watchId?: string
  private unsubscribe?: () => void
  private wake?: () => void
  private readonly wakeListeners = new Set<() => void>()
  private wakeEvents: TaskWakeEvent[] = []
  private wakeSequence = 0
  private consumedWakeSequence = 0
  private nextAuditAt = 0
  private generation = 0
  private readonly actionTimes: number[] = []
  private readonly actionControllers = new Set<AbortController>()
  private previousFrame?: Observation
  private latestObservation?: Observation
  private disposed = false
  target: Target = { type: 'monitor', id: 'primary' }

  constructor(private adapter: DesktopAdapter, private provider: AgentProvider | undefined, private readonly hooks: TaskHooks) {}

  configure(adapter: DesktopAdapter, provider?: AgentProvider) {
    this.cancelActions()
    if (this.task && activeStates.includes(this.task.state)) this.pause('The control source changed. Resume to use the selected source.')
    this.adapter = adapter; this.provider = provider
  }

  restore(task: TaskRecord | null) {
    if (!task) return
    this.cancel()
    this.task = { ...task, state: activeStates.includes(task.state) || task.state === 'PAIRING' ? 'PAUSED' : task.state, nextCheckAt: undefined }
    this.wakeEvents = []; this.wakeSequence = task.wakeSequence ?? 0; this.consumedWakeSequence = this.wakeSequence
    if (this.task.state === 'PAUSED') this.task.reason = 'History restored. Press Resume to authorize further control.'
    this.publish()
  }

  start(config: TaskConfig) {
    validateTask(config)
    this.cancel()
    this.task = { ...structuredClone(config), id: eventId(), state: 'IDLE', createdAt: new Date().toISOString(), elapsedMs: 0, failures: 0, recoveries: 0, observations: 0, actions: 0, evaluations: 0, watchChecks: 0, cycles: 0, wakeSequence: 0 }
    this.previousFrame = undefined; this.latestObservation = undefined; this.actionTimes.length = 0
    this.wakeEvents = []; this.wakeSequence = 0; this.consumedWakeSequence = 0
    this.emit('task.created', { config }); this.begin(false)
  }

  private begin(resumed: boolean) {
    if (!this.task) return
    this.generation++
    this.controller = new AbortController()
    const signal = this.controller.signal
    this.startedSegment = Date.now(); this.elapsedBeforeSegment = this.task.elapsedMs
    this.task.startedAt ??= new Date().toISOString(); this.task.reason = undefined
    const remaining = this.remainingTime()
    if (remaining <= 0) { this.expire(); return }
    // Long absolute deadlines are checked again when the platform's timer limit is reached.
    this.scheduleExpiration(signal)
    this.ticker = setInterval(() => this.publish(), 500)
    this.emit(resumed ? 'task.resumed' : 'task.started', {})
    this.transition('OBSERVING')
    this.nextAuditAt = Date.now() + this.task.verification.intervalMs
    this.task.nextCheckAt = this.nextAuditAt
    this.auditTimer = setInterval(() => { if (!signal.aborted) this.auditIfDue() }, this.task.verification.intervalMs)
    void this.run(signal).catch(error => {
      if (signal.aborted || this.controller?.signal !== signal) return
      const message = error instanceof Error ? error.message : String(error)
      this.hooks.error(message); this.finish('FAILED', message)
    })
  }

  pause(reason = 'Paused by the user.') {
    this.cancelActions()
    if (!this.task || !activeStates.includes(this.task.state)) return
    this.updateElapsed(); this.cancel(); this.transition('PAUSED', reason); this.emit('task.paused', { reason })
  }

  resume() {
    if (!this.task || this.task.state !== 'PAUSED') throw new ControlError('INVALID_TASK_STATE', 'Only a paused task can resume.')
    this.begin(true)
  }

  stop() { this.cancelActions(); if (this.task && !['COMPLETED', 'STOPPED', 'FAILED'].includes(this.task.state)) this.finish('STOPPED', 'Stopped by the user. No further task actions will run.') }

  complete(reason: string) {
    this.requireActiveTask()
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 2000) throw new ControlError('INVALID_COMPLETION', 'Provide a completion reason of 1 to 2,000 characters.')
    this.emit('task.completion.confirmed', { source: 'external-agent', reason, observationId: this.latestObservation?.id }, this.latestObservation)
    this.finish('COMPLETED', reason)
  }

  setContext(context: TaskContext) {
    if (!this.task || (!activeStates.includes(this.task.state) && this.task.state !== 'PAUSED')) throw new ControlError('INVALID_TASK_STATE', 'Start or resume a task before changing its context.')
    validateTaskContext(context)
    this.task.context = structuredClone(context)
    this.emit('task.context.updated', { context: this.task.context }); this.publish()
    if (activeStates.includes(this.task.state)) this.signal({ type: 'context.changed', message: 'The task context changed. Reobserve and use the updated context.' })
  }

  signal(input: { type: string; message: string }): TaskWakeEvent {
    this.requireActiveTask()
    if (!input || typeof input.type !== 'string' || !input.type.trim() || input.type.length > 80 || typeof input.message !== 'string' || !input.message.trim() || input.message.length > 2000) throw new ControlError('INVALID_TASK_SIGNAL', 'Use an event type of 1 to 80 characters and a message of 1 to 2,000 characters.')
    const event = { sequence: ++this.wakeSequence, type: input.type.trim(), message: input.message.trim(), timestamp: new Date().toISOString() }
    this.wakeEvents.push(event)
    if (this.wakeEvents.length > 100) this.wakeEvents.splice(0, this.wakeEvents.length - 100)
    this.task!.wakeSequence = this.wakeSequence
    this.emit('task.signal', { ...event }); this.publish()
    this.wake?.(); for (const listener of this.wakeListeners) listener()
    return { ...event }
  }

  async waitForEvents(options: { afterSequence: number; timeoutMs: number }, signal?: AbortSignal): Promise<TaskWakeResult> {
    checkCancelled(signal)
    this.requireActiveTask()
    if (!Number.isInteger(options.afterSequence) || options.afterSequence < 0 || !Number.isInteger(options.timeoutMs) || options.timeoutMs < 0 || options.timeoutMs > 60000) throw new ControlError('INVALID_EVENT_WAIT', 'Use a nonnegative event sequence and a timeout of 0 to 60,000 milliseconds.')
    this.auditIfDue()
    const result = (timedOut: boolean): TaskWakeResult => ({ events: this.wakeEvents.filter(event => event.sequence > options.afterSequence).map(event => ({ ...event })), lastSequence: this.wakeSequence, timedOut })
    if (this.wakeSequence > options.afterSequence || options.timeoutMs === 0) return result(this.wakeSequence <= options.afterSequence)
    const runSignal = this.controller!.signal
    return new Promise<TaskWakeResult>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); this.wakeListeners.delete(changed); runSignal.removeEventListener('abort', cancelled); signal?.removeEventListener('abort', cancelled) }
      const changed = () => { if (this.wakeSequence > options.afterSequence) { cleanup(); resolve(result(false)) } }
      const cancelled = () => { cleanup(); reject(signal?.aborted ? signal.reason : runSignal.reason) }
      const timer = setTimeout(() => { cleanup(); resolve(result(true)) }, options.timeoutMs)
      this.wakeListeners.add(changed); runSignal.addEventListener('abort', cancelled, { once: true }); signal?.addEventListener('abort', cancelled, { once: true })
      if (runSignal.aborted || signal?.aborted) cancelled(); else changed()
    })
  }

  private finish(state: 'COMPLETED' | 'STOPPED' | 'FAILED', reason: string) {
    if (!this.task) return
    this.updateElapsed(); this.cancel(); this.transition(state, reason); this.emit(`task.${state.toLowerCase()}`, { reason })
  }

  private cancel() {
    this.cancelActions()
    this.controller?.abort(new ControlError('TASK_STOPPED', 'The task has stopped or paused.'))
    this.controller = undefined; clearTimeout(this.expires); clearInterval(this.ticker); clearInterval(this.auditTimer)
    this.unsubscribe?.(); this.unsubscribe = undefined; this.wake = undefined
    if (this.watchId) {
      const watchId = this.watchId; this.watchId = undefined
      const taskId = this.task?.id
      void this.adapter.removeWatch?.(watchId).then(() => this.emit('watch.removed', { watchId }, undefined, taskId)).catch(error => this.emit('watch.error', { watchId, message: String(error) }, undefined, taskId))
    }
  }

  private async run(signal: AbortSignal) {
    const task = this.task!
    await this.installWatch(signal)
    this.checkRun(signal, task)
    if (!this.provider) {
      this.transition('WAITING', 'Waiting for an external WebMCP agent. Observe and act through the desktop tools.')
      return
    }
    let first = true
    while (!signal.aborted) {
      this.checkRun(signal, task)
      this.consumedWakeSequence = this.wakeSequence
      task.cycles = (task.cycles ?? 0) + 1
      const frame = await this.observe(signal)
      this.checkRun(signal, task)
      const invariantFailure = await this.checkInvariants(frame, signal)
      this.checkRun(signal, task)
      if (invariantFailure) { this.pause(invariantFailure); return }
      if (await this.checkCompletion(frame, signal)) return
      this.checkRun(signal, task)
      const evaluation = await this.evaluate(frame, task.verification.condition, signal)
      this.checkRun(signal, task)
      if (evaluation.confidence < task.limits.confidenceThreshold) {
        this.recordFailure('The evaluator is uncertain. No action was issued.')
        if (task.failures >= task.limits.maxConsecutiveFailures) { this.pause('The visual state is still uncertain after repeated observations. Review the screenshot before resuming.'); return }
      } else if (!evaluation.result) {
        this.recordFailure(evaluation.explanation)
        if (task.failures > task.limits.maxConsecutiveFailures) { this.pause('Recovery reached the consecutive failure limit. Review the target before resuming.'); return }
        this.transition(first ? 'PLANNING' : 'RECOVERING')
        if (!first) { task.recoveries++; this.emit('recovery.started', { reason: evaluation.explanation }) }
        const provider = this.provider
        const plan = await bounded(s => first ? provider.plan({ frame, task }, s) : provider.recover({ frame, task, evaluation }, s), 30000, signal)
        this.checkRun(signal, task)
        this.emit('plan.created', { ...plan })
        if (plan.completed) this.emit('task.completion.claimed', { verified: false, explanation: 'A plan alone cannot complete a task. The configured visual completion condition must pass.' })
        if (!await this.executePlan(plan, signal)) return
        this.checkRun(signal, task)
        if (plan.actions.length) {
          this.transition('SETTLING'); await delay(task.monitoring?.settleMs ?? 350, signal)
          this.checkRun(signal, task)
          const resultFrame = await this.observe(signal)
          this.checkRun(signal, task)
          const postActionInvariant = await this.checkInvariants(resultFrame, signal)
          this.checkRun(signal, task)
          if (postActionInvariant) { this.pause(postActionInvariant); return }
          if (await this.checkCompletion(resultFrame, signal)) return
          this.checkRun(signal, task)
          const result = await this.evaluate(resultFrame, task.verification.condition, signal)
          this.checkRun(signal, task)
          if (result.result && result.confidence >= task.limits.confidenceThreshold) {
            task.failures = 0
            if (!first) this.emit('recovery.completed', { explanation: result.explanation })
          }
        }
      } else task.failures = 0
      first = false
      await this.waitForCheck(signal)
    }
  }

  private async installWatch(signal: AbortSignal) {
    if (!this.adapter.subscribe) return
    const task = this.task!
    const watchId = `task-${task.id}-${this.generation}`
    const usesWatch = task.monitoring?.mode !== 'interval' && !!this.adapter.createWatch
    if (usesWatch) this.watchId = watchId
    this.unsubscribe = this.adapter.subscribe(event => {
      if (event.type === 'bridge.disconnected' && !signal.aborted) { this.pause('The bridge connection was lost. Reconnect and Resume before further input.'); return }
      if (event.data.watchId !== watchId || signal.aborted) return
      if (event.type === 'watch.tick' || event.type === 'watch.changed') task.watchChecks++
      this.hooks.event({ ...event, taskId: task.id })
      this.auditIfDue()
      if (!signal.aborted && (event.type === 'watch.changed' || event.data.changed === true)) this.signal({ type: 'watch.changed', message: 'The selected capture changed. Observe the current screen and verify the task.' })
      this.publish()
    })
    if (!usesWatch) return
    const adapter = this.adapter
    const intervalMs = task.monitoring?.watchIntervalMs ?? 1000
    await bounded(async () => {
      await adapter.createWatch!({ id: watchId, target: this.target, intervalMs, mode: 'visual-change', threshold: .003 })
      if (signal.aborted) { await adapter.removeWatch?.(watchId); checkCancelled(signal) }
    }, 10000, signal)
    this.checkRun(signal, task)
    this.emit('watch.created', { watchId, intervalMs })
  }

  private async waitForCheck(signal: AbortSignal) {
    this.transition('WAITING', 'Local visual checks are active. A meaningful change wakes the evaluator.')
    this.auditIfDue()
    checkCancelled(signal)
    this.task!.nextCheckAt = this.nextAuditAt; this.publish()
    // A wake received during an observation, plan or action remains pending here.
    if (this.wakeSequence > this.consumedWakeSequence) return
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { signal.removeEventListener('abort', abort); this.wake = undefined }
      const finish = () => { cleanup(); resolve() }
      const abort = () => { cleanup(); reject(signal.reason) }
      this.wake = finish; signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort(); else if (this.wakeSequence > this.consumedWakeSequence) finish()
    })
  }

  private async checkCompletion(frame: Observation, signal: AbortSignal) {
    const task = this.task!
    if (task.runMode !== 'until-complete') return false
    const condition = task.completionCondition!
    this.emit('completion.evaluation.started', { condition, frameId: frame.id })
    const result = await bounded(s => this.provider!.evaluate({ frame, priorFrame: this.previousFrame, condition, context: task.context }, s), 30000, signal)
    this.checkRun(signal, task)
    this.validateEvaluation(result)
    task.evaluations++
    this.emit('completion.evaluation.completed', { ...result, frameId: frame.id }, frame); this.publish()
    if (!result.result || result.confidence < task.limits.confidenceThreshold) return false
    this.hooks.evaluation(result)
    this.emit('task.completion.confirmed', { source: 'visual-evaluator', condition, confidence: result.confidence, frameId: frame.id }, frame)
    this.finish('COMPLETED', `Completion condition verified: ${condition}`)
    return true
  }

  private async checkInvariants(frame: Observation, signal: AbortSignal) {
    for (const condition of this.task!.invariants) {
      const result = await bounded(s => this.provider!.evaluate({ frame, condition, context: this.task!.context }, s), 30000, signal)
      checkCancelled(signal)
      this.validateEvaluation(result)
      this.emit('invariant.evaluated', { ...result })
      if (!result.result || result.confidence < this.task!.limits.confidenceThreshold) return `Invariant needs review: ${condition}. ${result.explanation}`
    }
    return undefined
  }

  async observe(signal?: AbortSignal): Promise<Observation> {
    const task = this.task
    if (this.task && activeStates.includes(this.task.state)) this.transition('OBSERVING')
    const observation = await bounded(s => this.adapter.observe({ target: this.target, maxDimension: 1280, quality: .78 }, s), 10000, signal)
    checkCancelled(signal)
    if (task !== this.task) throw new ControlError('TASK_STOPPED', 'A newer task replaced this observation.')
    this.recordObservation(observation, 'task')
    return observation
  }

  recordObservation(observation: Observation, source = 'manual') {
    this.latestObservation = observation
    if (this.task) this.task.observations++
    this.hooks.observation(observation); this.emit('observation.captured', { frameId: observation.id, source }, observation); this.publish()
  }

  private async evaluate(frame: Observation, condition: string, signal: AbortSignal) {
    const task = this.task!
    this.transition('VERIFYING'); this.emit('evaluation.started', { condition, frameId: frame.id })
    const result = await bounded(s => this.provider!.evaluate({ frame, condition, priorFrame: this.previousFrame, context: task.context }, s), 30000, signal)
    this.checkRun(signal, task)
    this.validateEvaluation(result)
    this.previousFrame = frame
    this.task!.evaluations++; this.hooks.evaluation(result); this.emit('evaluation.completed', { ...result }, frame); this.publish()
    return result
  }

  private async executePlan(plan: AgentPlan, signal: AbortSignal) {
    if (!Number.isFinite(plan.confidence) || plan.confidence < this.task!.limits.confidenceThreshold || plan.confidence > 1) { this.pause(`No action issued. Plan confidence is below the configured threshold. ${plan.explanation}`); return false }
    if (plan.actions.length > 20) { this.pause('The provider returned more than 20 actions in one plan. Review the plan before continuing.'); return false }
    if (plan.actions.length) this.transition('LOCATING_TARGET')
    for (const action of plan.actions) { checkCancelled(signal); this.transition('EXECUTING'); await this.action(action, signal) }
    return true
  }

  async action(action: DesktopAction, signal?: AbortSignal): Promise<ActionResult> {
    checkCancelled(signal)
    if (this.task && ['PAUSED', 'STOPPED', 'FAILED', 'COMPLETED'].includes(this.task.state)) throw new ControlError('CONTROL_DISABLED', 'Task control is stopped. Resume a paused task or start a new task before sending input.')
    this.assertActionDeadline()
    const now = Date.now()
    while (this.actionTimes.length && this.actionTimes[0]! < now - 60000) this.actionTimes.shift()
    if (this.actionTimes.length >= (this.task?.limits.maxActionsPerMinute ?? 30)) { this.pause('The action limit was reached. Review the task before resuming.'); throw new ControlError('RATE_LIMITED', 'The maximum actions per minute was reached.') }
    const taskId = this.task?.id
    this.actionTimes.push(now); this.emit('action.requested', { action }); this.emit('action.started', { action })
    const controller = new AbortController(); this.actionControllers.add(controller)
    const parentSignal = signal ?? this.controller?.signal
    const abort = () => controller.abort(parentSignal?.reason)
    parentSignal?.addEventListener('abort', abort, { once: true }); if (parentSignal?.aborted) abort()
    try {
      const result = await bounded(s => { this.assertActionDeadline(); return this.adapter.action(action, s) }, 10000, controller.signal)
      checkCancelled(controller.signal)
      if (!result.ok) throw new ControlError('INPUT_FAILED', 'The adapter reported that input failed.')
      if (this.task) this.task.actions++
      this.emit('action.completed', { ...result }); this.publish(); return result
    } catch (error) { this.emit('action.failed', { action, message: error instanceof Error ? error.message : String(error) }, undefined, taskId); throw error }
    finally { this.actionControllers.delete(controller); parentSignal?.removeEventListener('abort', abort) }
  }

  private cancelActions() { for (const controller of this.actionControllers) controller.abort(new ControlError('TASK_STOPPED', 'The user stopped or paused control.')); this.actionControllers.clear() }

  private assertActionDeadline() {
    if (!this.task || !activeStates.includes(this.task.state)) return
    if (this.remainingTime() <= 0) {
      this.expire()
      throw new ControlError('CONTROL_DISABLED', 'The task duration or deadline has elapsed. No further input will be sent.')
    }
  }

  private remainingTime() {
    if (!this.task) return Infinity
    this.updateElapsed()
    const duration = this.task.runMode === 'continuous' ? Infinity : this.task.durationMs - this.task.elapsedMs
    return Math.min(duration, this.task.deadline ? Date.parse(this.task.deadline) - Date.now() : Infinity)
  }

  private scheduleExpiration(signal: AbortSignal) {
    const remaining = this.remainingTime()
    if (!Number.isFinite(remaining)) return
    this.expires = setTimeout(() => {
      if (signal.aborted || this.controller?.signal !== signal) return
      if (this.remainingTime() <= 0) this.expire(); else this.scheduleExpiration(signal)
    }, Math.max(0, Math.min(remaining, 2147483647)))
  }

  private expire() {
    if (this.task?.runMode === 'until-complete') this.finish('FAILED', 'The safety duration or deadline elapsed before the completion condition was verified.')
    else this.finish('COMPLETED', 'The task duration or deadline has elapsed.')
  }

  private requireActiveTask() {
    if (!this.task || !activeStates.includes(this.task.state) || !this.controller || this.controller.signal.aborted) throw new ControlError('INVALID_TASK_STATE', 'This operation requires an active task.')
    this.assertActionDeadline()
  }

  private checkRun(signal: AbortSignal, task: TaskRecord) {
    checkCancelled(signal)
    if (this.task !== task || this.controller?.signal !== signal) throw new ControlError('TASK_STOPPED', 'A newer task or run replaced this operation.')
  }

  private auditIfDue() {
    if (!this.task || !activeStates.includes(this.task.state) || !this.controller || this.controller.signal.aborted) return
    if (this.remainingTime() <= 0) { this.expire(); return }
    if (Date.now() < this.nextAuditAt) return
    this.nextAuditAt = Date.now() + this.task.verification.intervalMs
    this.task.nextCheckAt = this.nextAuditAt
    this.signal({ type: 'audit.due', message: 'The scheduled full visual audit is due. Observe the screen and verify the task conditions.' })
  }

  private validateEvaluation(result: EvaluationResult) {
    if (typeof result.result !== 'boolean' || !Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1) throw new ControlError('INVALID_EVALUATION', 'The evaluator returned an invalid result or confidence score.')
  }

  private recordFailure(reason: string) { this.task!.failures++; this.task!.reason = reason; this.publish() }
  private transition(state: TaskState, reason?: string) {
    if (!this.task) return
    const from = this.task.state; this.task.state = state; this.task.reason = reason; this.task.nextCheckAt = activeStates.includes(state) ? this.nextAuditAt || undefined : undefined
    if (from !== state) this.emit('state.transition', { from, to: state, reason })
    this.publish()
  }
  private emit(type: string, data: Record<string, unknown>, observation?: Observation, taskId = this.task?.id) { if (!this.disposed) this.hooks.event({ id: eventId(), taskId, timestamp: new Date().toISOString(), type, data, observation }) }
  private updateElapsed() {
    if (this.task && this.controller) {
      const elapsed = Math.max(0, this.elapsedBeforeSegment + Date.now() - this.startedSegment)
      this.task.elapsedMs = this.task.runMode === 'continuous' ? elapsed : Math.min(this.task.durationMs, elapsed)
    }
  }
  private publish() { if (this.task) { this.updateElapsed(); this.hooks.task({ ...this.task }) } }
  dispose() { this.disposed = true; this.cancel() }
}
