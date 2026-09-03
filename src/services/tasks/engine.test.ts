import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActionResult, AgentProvider, DesktopAction, DesktopAdapter, EvaluationResult, LenseEvent, Observation, TaskConfig, WatchSpec } from '../../types/protocol'
import { TaskEngine, validateTask } from './engine'
import { untilVisualCondition } from './until'

const config: TaskConfig = { goal: 'Chop wood', durationMs: 5000, verification: { condition: 'Character is chopping', intervalMs: 500 }, invariants: [], limits: { maxConsecutiveFailures: 3, maxActionsPerMinute: 20, confidenceThreshold: .8 } }

class TestAdapter implements DesktopAdapter {
  chopping = false
  actions: DesktopAction[] = []
  watches = new Map<string, WatchSpec>()
  listeners = new Set<(event: LenseEvent) => void>()
  async observe(): Promise<Observation> { return { id: String(Date.now()), timestamp: new Date().toISOString(), target: { type: 'monitor', id: 'test' }, nativeWidth: 100, nativeHeight: 100, width: 100, height: 100, mimeType: 'image/png', image: this.chopping ? 'chopping-fixture' : 'idle-fixture' } }
  async action(action: DesktopAction): Promise<ActionResult> { this.actions.push(action); this.chopping = true; return { id: 'action', action, ok: true, startedAt: '', completedAt: '', result: {} } }
  async createWatch(spec: WatchSpec) { this.watches.set(spec.id, spec) }
  async removeWatch(id: string) { this.watches.delete(id) }
  subscribe(listener: (event: LenseEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  change() { for (const [id] of this.watches) for (const listener of this.listeners) listener({ id: 'changed', timestamp: '', type: 'watch.changed', data: { watchId: id, changed: true } }) }
  disconnect() { for (const listener of this.listeners) listener({ id: 'disconnect', timestamp: '', type: 'bridge.disconnected', data: {} }) }
}

const provider: AgentProvider = {
  async evaluate({ frame, condition }): Promise<EvaluationResult> { return { condition, result: frame.image === 'chopping-fixture', confidence: .99, explanation: frame.image } },
  async plan() { return { confidence: .95, explanation: 'Click the visible tree.', actions: [{ type: 'pointer.click', x: .2, y: .3 }] } },
  async recover(input, signal) { return this.plan(input, signal) },
}

function setup(agent: AgentProvider | undefined = provider) {
  const adapter = new TestAdapter(); const events: LenseEvent[] = []
  const engine = new TaskEngine(adapter, agent, { task() {}, event(event) { events.push(event) }, observation() {}, evaluation() {}, error() {} })
  return { adapter, events, engine }
}

describe('deterministic task runtime', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('observes, acts, verifies, recovers from depletion, and completes', async () => {
    const { adapter, events, engine } = setup()
    engine.start(config); await vi.advanceTimersByTimeAsync(500)
    expect(adapter.actions).toHaveLength(1)
    expect(engine.task?.state).toBe('WAITING')
    adapter.chopping = false; adapter.change(); await vi.advanceTimersByTimeAsync(500)
    expect(adapter.actions).toHaveLength(2)
    expect(events.some(event => event.type === 'recovery.completed')).toBe(true)
    await vi.advanceTimersByTimeAsync(4100)
    expect(engine.task?.state).toBe('COMPLETED')
    expect(adapter.watches.size).toBe(0)
    expect(events.filter(event => event.type === 'evaluation.completed').some(event => event.data.result === false)).toBe(true)
  })

  it('stops pending observations and never issues a late action', async () => {
    const { adapter, engine } = setup()
    let resolveObservation!: (frame: Observation) => void
    const fixture = await adapter.observe()
    adapter.observe = () => new Promise(resolve => { resolveObservation = resolve })
    engine.start(config); await vi.advanceTimersByTimeAsync(0)
    engine.stop(); resolveObservation(fixture); await vi.advanceTimersByTimeAsync(2000)
    expect(engine.task?.state).toBe('STOPPED')
    expect(adapter.actions).toHaveLength(0)
    await expect(engine.action({ type: 'keyboard.type', text: 'late' })).rejects.toMatchObject({ code: 'CONTROL_DISABLED' })
  })

  it('pauses unknown state without attempting a click', async () => {
    const { adapter, engine } = setup({ ...provider, async evaluate({ condition }) { return { condition, result: false, confidence: .2, explanation: 'Unknown screen' } } })
    engine.start({ ...config, limits: { ...config.limits, maxConsecutiveFailures: 1 } }); await vi.advanceTimersByTimeAsync(0)
    expect(engine.task?.state).toBe('PAUSED'); expect(adapter.actions).toHaveLength(0)
  })

  it('guards low confidence plans independently of evaluation confidence', async () => {
    const { adapter, engine } = setup({ ...provider, async plan() { return { actions: [{ type: 'pointer.click', x: .2, y: .3 }], confidence: .4, explanation: 'Uncertain location' } } })
    engine.start(config); await vi.advanceTimersByTimeAsync(0)
    expect(engine.task?.state).toBe('PAUSED'); expect(adapter.actions).toHaveLength(0)
  })

  it('cancels manual input on Pause even when no task exists', async () => {
    const { adapter, engine } = setup()
    let actionSignal: AbortSignal | undefined
    adapter.action = (_action: DesktopAction, signal?: AbortSignal) => { actionSignal = signal; return new Promise(() => {}) }
    const action = engine.action({ type: 'keyboard.type', text: 'Pending input' })
    const assertion = expect(action).rejects.toMatchObject({ code: 'TASK_STOPPED' })
    engine.pause(); await assertion
    expect(actionSignal?.aborted).toBe(true)
  })

  it('restores running tasks as paused and resumes only after a user request', async () => {
    const { engine, adapter } = setup()
    engine.start(config); await vi.advanceTimersByTimeAsync(500)
    const saved = { ...engine.task! }; engine.dispose()
    const restored = setup(); restored.engine.restore(saved)
    await vi.advanceTimersByTimeAsync(1000)
    expect(restored.engine.task?.state).toBe('PAUSED'); expect(restored.adapter.actions).toHaveLength(0)
    restored.engine.resume(); await vi.advanceTimersByTimeAsync(500)
    expect(restored.adapter.actions).toHaveLength(1)
    restored.engine.stop(); expect(adapter.actions).toHaveLength(1)
  })

  it('waits for an external agent when no provider is configured and pauses on disconnect', async () => {
    const { adapter, engine } = setup(); engine.configure(adapter)
    engine.start(config); await vi.advanceTimersByTimeAsync(500)
    expect(engine.task?.state).toBe('WAITING'); expect(engine.task?.reason).toContain('external WebMCP agent')
    expect(adapter.actions).toHaveLength(0)
    await engine.action({ type: 'keyboard.type', text: 'Hello' })
    expect(adapter.actions).toHaveLength(1)
    adapter.disconnect(); expect(engine.task?.state).toBe('PAUSED')
  })

  it('permits manual input before a task and rejects the action limit', async () => {
    const { adapter, engine } = setup(); await engine.action({ type: 'keyboard.type', text: 'Manual' })
    expect(adapter.actions).toHaveLength(1)
    engine.configure(adapter)
    engine.start({ ...config, limits: { ...config.limits, maxActionsPerMinute: 1 } }); await vi.advanceTimersByTimeAsync(0)
    await engine.action({ type: 'keyboard.type', text: 'First' })
    await expect(engine.action({ type: 'keyboard.type', text: 'Second' })).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    expect(engine.task?.state).toBe('PAUSED')
  })

  it('uses cheap unchanged ticks and still performs every scheduled full audit', async () => {
    const evaluate = vi.fn(provider.evaluate)
    const { engine, adapter } = setup({ ...provider, evaluate })
    adapter.chopping = true
    engine.start({ ...config, verification: { ...config.verification, intervalMs: 2000 } }); await vi.advanceTimersByTimeAsync(500)
    for (const [watchId] of adapter.watches) for (const listener of adapter.listeners) listener({ id: 'unchanged', timestamp: '', type: 'watch.tick', data: { watchId, changed: false } })
    await vi.advanceTimersByTimeAsync(500)
    expect(evaluate).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(evaluate).toHaveBeenCalledTimes(2)
    engine.stop()
  })

  it.each(['duration', 'deadline'] as const)('blocks overdue input when the %s expires before a throttled timer fires', async limit => {
    const { adapter, engine } = setup(); engine.configure(adapter)
    engine.start({ ...config, ...(limit === 'deadline' ? { durationMs: 30000, deadline: new Date(Date.now() + 5000).toISOString() } : {}) })
    await vi.advanceTimersByTimeAsync(0)
    expect(engine.task?.state).toBe('WAITING')
    // Advance the wall clock without delivering the expiration callback.
    vi.setSystemTime(Date.now() + 6000)
    await expect(engine.action({ type: 'keyboard.type', text: 'Too late' })).rejects.toMatchObject({ code: 'CONTROL_DISABLED' })
    expect(adapter.actions).toHaveLength(0)
    expect(engine.task?.state).toBe('COMPLETED')
  })

  it('rejects invalid limits and expired deadlines before starting', () => {
    expect(() => validateTask({ ...config, durationMs: -1 })).toThrow()
    expect(() => validateTask({ ...config, deadline: '2000-01-01' })).toThrow()
    expect(() => validateTask({ ...config, limits: { ...config.limits, confidenceThreshold: .2 } })).toThrow()
  })
})

describe('continuous and event-driven tasks', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('continues past duration in continuous mode while tracking the full elapsed time', async () => {
    const { adapter, engine } = setup(); engine.configure(adapter)
    engine.start({ ...config, runMode: 'continuous' }); await vi.advanceTimersByTimeAsync(0)
    vi.setSystemTime(Date.now() + 12000)
    await engine.action({ type: 'keyboard.type', text: 'Still authorized' })
    expect(adapter.actions).toHaveLength(1)
    expect(engine.task?.state).toBe('WAITING')
    expect(engine.task?.elapsedMs).toBe(12000)
    engine.stop()
  })

  it('still enforces a continuous task deadline before input when timers are throttled', async () => {
    const { adapter, engine } = setup(); engine.configure(adapter)
    engine.start({ ...config, runMode: 'continuous', deadline: new Date(Date.now() + 5000).toISOString() }); await vi.advanceTimersByTimeAsync(0)
    vi.setSystemTime(Date.now() + 6000)
    await expect(engine.action({ type: 'keyboard.type', text: 'Overdue' })).rejects.toMatchObject({ code: 'CONTROL_DISABLED' })
    expect(adapter.actions).toHaveLength(0); expect(engine.task?.state).toBe('COMPLETED')
  })

  it('completes only after a fresh screenshot verifies the completion condition', async () => {
    const { adapter, engine, events } = setup({ ...provider, async evaluate(input) {
      if (input.condition === 'Target reached') return { condition: input.condition, result: input.frame.image === 'chopping-fixture', confidence: .99, explanation: 'The result is visible.' }
      return provider.evaluate(input)
    } })
    engine.start({ ...config, runMode: 'until-complete', completionCondition: 'Target reached', monitoring: { mode: 'events-and-interval', watchIntervalMs: 1000, settleMs: 0 } })
    await vi.advanceTimersByTimeAsync(0)
    expect(adapter.actions).toHaveLength(1); expect(engine.task?.state).toBe('COMPLETED')
    expect(events.find(event => event.type === 'task.completion.confirmed')?.data.source).toBe('visual-evaluator')
    expect(events.some(event => event.type === 'completion.evaluation.completed' && event.data.result === true && event.observation)).toBe(true)
  })

  it('does not mistake the until-complete safety budget for verified success', async () => {
    const { adapter, engine } = setup({ ...provider, async evaluate(input) {
      return { condition: input.condition, result: input.condition !== 'Target reached', confidence: .99, explanation: 'Target is not reached.' }
    } })
    adapter.chopping = true
    engine.start({ ...config, durationMs: 1000, runMode: 'until-complete', completionCondition: 'Target reached' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(engine.task?.state).toBe('FAILED')
    expect(engine.task?.reason).toContain('before the completion condition was verified')
  })

  it('checks invariants before accepting a completion result', async () => {
    const { adapter, engine } = setup({ ...provider, async evaluate({ condition }) {
      return { condition, result: condition !== 'Approved application is visible', confidence: .99, explanation: 'The approved application is hidden.' }
    } })
    engine.start({ ...config, runMode: 'until-complete', completionCondition: 'Target reached', invariants: ['Approved application is visible'] })
    await vi.advanceTimersByTimeAsync(0)
    expect(engine.task?.state).toBe('PAUSED'); expect(adapter.actions).toHaveLength(0)
  })

  it('does not accept an unverified completion claim in a plan', async () => {
    const { engine } = setup({ ...provider,
      async evaluate({ condition }) { return { condition, result: false, confidence: .99, explanation: 'Not complete.' } },
      async plan() { return { completed: true, actions: [], confidence: .99, explanation: 'I think it is complete.' } },
    })
    engine.start({ ...config, runMode: 'until-complete', completionCondition: 'Target reached' })
    await vi.advanceTimersByTimeAsync(0)
    expect(engine.task?.state).toBe('WAITING')
    engine.stop()
  })

  it('sends independent native-change and periodic audit events to an external agent', async () => {
    const { adapter, engine } = setup(); engine.configure(adapter)
    engine.start({ ...config, verification: { ...config.verification, intervalMs: 2000 }, runMode: 'continuous' }); await vi.advanceTimersByTimeAsync(0)
    expect([...adapter.watches.values()][0]?.intervalMs).toBe(1000)
    const wait = engine.waitForEvents({ afterSequence: 0, timeoutMs: 5000 })
    await vi.advanceTimersByTimeAsync(2000)
    const audit = await wait
    expect(audit.events[0]?.type).toBe('audit.due'); expect(audit.timedOut).toBe(false)
    adapter.change()
    const changed = await engine.waitForEvents({ afterSequence: audit.lastSequence, timeoutMs: 0 })
    expect(changed.events[0]?.type).toBe('watch.changed')
    expect(engine.task?.observations).toBe(0); expect(engine.task?.evaluations).toBe(0); expect(adapter.actions).toHaveLength(0)
    engine.stop()
  })

  it('uses only the periodic schedule in interval mode', async () => {
    const { adapter, engine } = setup(); engine.configure(adapter)
    engine.start({ ...config, monitoring: { mode: 'interval', watchIntervalMs: 1000, settleMs: 0 } }); await vi.advanceTimersByTimeAsync(0)
    expect(adapter.watches.size).toBe(0)
    const wait = engine.waitForEvents({ afterSequence: 0, timeoutMs: 1000 })
    await vi.advanceTimersByTimeAsync(500)
    expect((await wait).events[0]?.type).toBe('audit.due')
    engine.stop()
  })

  it('retains wakes received during evaluation and coalesces a burst into one later cycle', async () => {
    let release!: () => void; let calls = 0; let running = 0; let maximumRunning = 0
    const { adapter, engine } = setup({ ...provider, async evaluate(input) {
      calls++; running++; maximumRunning = Math.max(maximumRunning, running)
      if (calls === 1) await new Promise<void>(resolve => { release = resolve })
      running--; return provider.evaluate(input)
    } })
    adapter.chopping = true
    engine.start({ ...config, runMode: 'continuous', verification: { ...config.verification, intervalMs: 60000 } }); await vi.advanceTimersByTimeAsync(0)
    for (let i = 0; i < 150; i++) engine.signal({ type: 'custom.event', message: `Event ${i}` })
    expect(calls).toBe(1)
    const batch = await engine.waitForEvents({ afterSequence: 0, timeoutMs: 0 })
    expect(batch.events).toHaveLength(100); expect(batch.events[0]?.sequence).toBe(51); expect(batch.lastSequence).toBe(150)
    release(); await vi.advanceTimersByTimeAsync(0)
    expect(calls).toBe(2); expect(maximumRunning).toBe(1); expect(engine.task?.cycles).toBe(2)
    engine.stop()
  })

  it.each(['pause', 'stop'] as const)('cancels a waiting external agent on %s', async operation => {
    const { adapter, engine } = setup(); engine.configure(adapter)
    engine.start(config); await vi.advanceTimersByTimeAsync(0)
    const wait = engine.waitForEvents({ afterSequence: 0, timeoutMs: 60000 })
    const rejection = expect(wait).rejects.toMatchObject({ code: 'TASK_STOPPED' })
    engine[operation](); await rejection
  })

  it('supports an abortable timeout and an empty immediate event poll', async () => {
    const { adapter, engine } = setup(); engine.configure(adapter)
    engine.start(config); await vi.advanceTimersByTimeAsync(0)
    expect(await engine.waitForEvents({ afterSequence: 0, timeoutMs: 0 })).toEqual({ events: [], lastSequence: 0, timedOut: true })
    const timeout = engine.waitForEvents({ afterSequence: 0, timeoutMs: 100 }); await vi.advanceTimersByTimeAsync(100)
    expect((await timeout).timedOut).toBe(true)
    const controller = new AbortController()
    const wait = engine.waitForEvents({ afterSequence: 0, timeoutMs: 60000 }, controller.signal)
    const rejection = expect(wait).rejects.toThrow('Caller cancelled')
    controller.abort(new Error('Caller cancelled')); await rejection
    await expect(engine.waitForEvents({ afterSequence: 0, timeoutMs: 60001 })).rejects.toMatchObject({ code: 'INVALID_EVENT_WAIT' })
    engine.stop()
  })

  it('updates bounded task context and records external completion evidence', async () => {
    const { adapter, engine, events } = setup(); engine.configure(adapter)
    engine.start(config); await vi.advanceTimersByTimeAsync(0)
    engine.setContext({ game: 'generic', characterName: 'Test character', notes: 'Use only the disposable lab.' })
    expect(engine.task?.context?.notes).toContain('disposable lab')
    expect((await engine.waitForEvents({ afterSequence: 0, timeoutMs: 0 })).events[0]?.type).toBe('context.changed')
    await engine.observe(); engine.complete('The external agent verified the latest frame.')
    const receipt = events.find(event => event.type === 'task.completion.confirmed')
    expect(receipt?.data.source).toBe('external-agent'); expect(receipt?.data.observationId).toBeTruthy()
    expect(engine.task?.state).toBe('COMPLETED')
    expect(() => engine.complete('Again')).toThrow()
    expect(() => validateTask({ ...config, context: { game: 'generic', notes: 'x'.repeat(4001) } })).toThrow()
    expect(() => validateTask({ ...config, runMode: 'until-complete' })).toThrow()
  })

  it('ignores a late old plan after a newer task starts', async () => {
    let resolveOld!: (plan: Awaited<ReturnType<AgentProvider['plan']>>) => void
    const { adapter, engine, events } = setup({ ...provider, async plan({ task }) {
      if (task.goal === 'Old task') return new Promise(resolve => { resolveOld = resolve })
      return { confidence: .99, explanation: 'New task plan', actions: [] }
    } })
    engine.start({ ...config, goal: 'Old task' }); await vi.advanceTimersByTimeAsync(0)
    engine.start({ ...config, goal: 'New task' }); await vi.advanceTimersByTimeAsync(0)
    const newId = engine.task!.id
    resolveOld({ confidence: .99, explanation: 'Stale plan', actions: [{ type: 'keyboard.type', text: 'Wrong task' }] })
    await vi.advanceTimersByTimeAsync(0)
    expect(engine.task?.id).toBe(newId); expect(engine.task?.observations).toBe(1); expect(adapter.actions).toHaveLength(0)
    expect(events.some(event => event.type === 'plan.created' && event.data.explanation === 'Stale plan')).toBe(false)
    engine.stop()
  })

  it('does not let a delayed old watch cleanup delete the resumed watch', async () => {
    const { adapter, engine } = setup(); engine.configure(adapter)
    let release!: () => void; let calls = 0
    const ids: string[] = []
    adapter.createWatch = async spec => { calls++; ids.push(spec.id); adapter.watches.set(spec.id, spec); if (calls === 1) await new Promise<void>(resolve => { release = resolve }) }
    engine.start(config); await vi.advanceTimersByTimeAsync(0)
    engine.pause(); engine.resume(); await vi.advanceTimersByTimeAsync(0)
    release(); await vi.advanceTimersByTimeAsync(0)
    expect(ids).toHaveLength(2); expect(ids[0]).not.toBe(ids[1]); expect(adapter.watches.has(ids[1]!)).toBe(true)
    engine.stop()
  })
})

describe('until condition', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  it('matches after a watch change and removes the watch', async () => {
    const adapter = new TestAdapter()
    const wait = untilVisualCondition(adapter, provider, { condition: 'chopping', intervalMs: 500, timeoutMs: 5000 })
    await vi.advanceTimersByTimeAsync(0); adapter.chopping = true; adapter.change()
    expect((await wait).matched).toBe(true); expect(adapter.watches.size).toBe(0)
  })
  it('times out and removes its subscriptions', async () => {
    const adapter = new TestAdapter()
    const wait = untilVisualCondition(adapter, provider, { condition: 'chopping', intervalMs: 500, timeoutMs: 500 })
    const assertion = expect(wait).rejects.toMatchObject({ code: 'TIMEOUT' })
    await vi.advanceTimersByTimeAsync(600); await assertion
    expect(adapter.watches.size).toBe(0); expect(adapter.listeners.size).toBe(0)
  })
  it('does not invent semantic results without a provider', async () => {
    await expect(untilVisualCondition(new TestAdapter(), undefined, { condition: 'Save As dialog', intervalMs: 500, timeoutMs: 1000 })).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
  })
})
