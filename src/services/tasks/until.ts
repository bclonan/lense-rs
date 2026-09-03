import type { DesktopAdapter, EvaluationResult, LenseEvent, Observation, Target, VisualEvaluator } from '../../types/protocol'
import { bounded, checkCancelled, ControlError, eventId } from './helpers'

export interface UntilOptions { condition: string; intervalMs: number; timeoutMs: number }
export interface UntilResult { matched: true; evaluation: EvaluationResult; observation: Observation; elapsedMs: number }

/** Waits on cheap watch notifications. Only changed frames or a periodic audit reach the evaluator. */
export async function untilVisualCondition(adapter: DesktopAdapter, evaluator: VisualEvaluator | undefined, options: UntilOptions, context: { target?: Target; signal?: AbortSignal; onEvent?: (event: LenseEvent) => void; confidenceThreshold?: number } = {}): Promise<UntilResult> {
  if (!evaluator) throw new ControlError('PROVIDER_UNAVAILABLE', 'An external WebMCP agent must evaluate this desktop condition. Use desktop_observe and desktop_watch, then evaluate the screenshot in your visual agent.')
  if (!options.condition.trim() || options.condition.length > 2000 || !Number.isFinite(options.intervalMs) || options.intervalMs < 500 || options.intervalMs > 3600000 || !Number.isFinite(options.timeoutMs) || options.timeoutMs < 500 || options.timeoutMs > 86400000) throw new ControlError('INVALID_WATCH', 'Use a condition under 2,000 characters, an interval of 500 milliseconds to one hour, and a timeout up to 24 hours.')
  const started = Date.now(); const watchId = `until-${eventId()}`
  let unsubscribe: (() => void) | undefined
  let created = false; let changed = true; let ticks = 0
  let wake: (() => void) | undefined
  const emit = (type: string, data: Record<string, unknown>, observation?: Observation) => context.onEvent?.({ id: eventId(), timestamp: new Date().toISOString(), type, data, observation })
  try {
    return await bounded(async signal => {
      if (adapter.createWatch && adapter.subscribe) {
        unsubscribe = adapter.subscribe(event => {
          if (event.data.watchId !== watchId) return
          context.onEvent?.(event)
          ticks++
          if (event.type === 'watch.changed' || event.data.changed === true) changed = true
          if (changed || ticks >= 6) wake?.()
        })
        await adapter.createWatch({ id: watchId, target: context.target, intervalMs: options.intervalMs, mode: 'visual-change', threshold: .003 })
        created = true
        if (signal.aborted) { await adapter.removeWatch?.(watchId); checkCancelled(signal) }
        emit('watch.created', { watchId, ...options })
      }
      let priorFrame: Observation | undefined
      while (!signal.aborted) {
        checkCancelled(signal)
        const frame = await bounded(s => adapter.observe({ target: context.target, maxDimension: 960, quality: .78 }, s), 10000, signal)
        emit('observation.captured', { frameId: frame.id, watchId }, frame)
        emit('evaluation.started', { condition: options.condition, watchId })
        const evaluation = await bounded(s => evaluator.evaluate({ frame, priorFrame, condition: options.condition }, s), 30000, signal)
        emit('evaluation.completed', { ...evaluation, watchId }, frame)
        if (evaluation.result && Number.isFinite(evaluation.confidence) && evaluation.confidence >= (context.confidenceThreshold ?? .8) && evaluation.confidence <= 1) return { matched: true, evaluation, observation: frame, elapsedMs: Date.now() - started }
        priorFrame = frame; changed = false; ticks = 0
        await new Promise<void>((resolve, reject) => {
          const finish = () => { cleanup(); resolve() }
          const abort = () => { cleanup(); reject(signal.reason) }
          const timer = setTimeout(finish, options.intervalMs * (created ? 6 : 1))
          const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); wake = undefined }
          wake = finish; signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort()
        })
      }
      throw new ControlError('TASK_STOPPED', 'The condition wait was cancelled.')
    }, options.timeoutMs, context.signal)
  } finally {
    unsubscribe?.()
    // Also remove after a timed-out create response, so no delayed watch is abandoned.
    if (adapter.removeWatch) await adapter.removeWatch(watchId).then(() => emit('watch.removed', { watchId })).catch(error => emit('watch.error', { watchId, message: String(error) }))
  }
}
