export class ControlError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'ControlError' }
}

let sequence = 0
export function eventId() {
  return `${Date.now().toString(36).padStart(10, '0')}-${(++sequence).toString(36).padStart(5, '0')}`
}

export function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? new ControlError('TASK_STOPPED', 'The operation was cancelled.')
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  checkCancelled(signal)
  return new Promise((resolve, reject) => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve() }
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason ?? new ControlError('TASK_STOPPED', 'The operation was cancelled.')) }
    const timer = setTimeout(done, Math.max(0, ms))
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export async function bounded<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  checkCancelled(signal)
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason ?? new ControlError('TASK_STOPPED', 'The operation was cancelled.'))
  signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(new ControlError('TIMEOUT', `The operation exceeded ${timeoutMs / 1000} seconds.`)), timeoutMs)
  let rejectAbort: (() => void) | undefined
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<T>((_, reject) => {
        rejectAbort = () => reject(controller.signal.reason)
        controller.signal.addEventListener('abort', rejectAbort, { once: true })
        if (controller.signal.aborted) rejectAbort()
      }),
    ])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort)
  }
}
