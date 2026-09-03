import type { ActionResult, CaptureOptions, DesktopAction, DesktopAdapter, LenseEvent, Observation, WatchSpec } from '../types/protocol'
import { imageDifference, type PixelFrame } from '../services/evaluator/visual'
import { checkCancelled, ControlError, eventId } from '../services/tasks/helpers'
import { WoodcuttingLab } from './WoodcuttingLab'

/** Explicit browser simulation. Native desktop traffic never passes through this adapter. */
export class LabAdapter implements DesktopAdapter {
  private readonly canvas = document.createElement('canvas')
  private readonly scene = new WoodcuttingLab(this.canvas)
  private readonly listeners = new Set<(event: LenseEvent) => void>()
  private readonly watches = new Map<string, { timer: ReturnType<typeof setInterval>; previous?: PixelFrame }>()

  async observe(options: CaptureOptions = {}, signal?: AbortSignal): Promise<Observation> {
    checkCancelled(signal); this.scene.draw()
    const output = document.createElement('canvas')
    const region = options.region ?? { x: 0, y: 0, width: 1, height: 1 }
    const nativeWidth = Math.round(this.canvas.width * region.width); const nativeHeight = Math.round(this.canvas.height * region.height)
    const scale = Math.min(1, (options.maxDimension ?? 1280) / Math.max(nativeWidth, nativeHeight))
    output.width = Math.max(1, Math.round(nativeWidth * scale)); output.height = Math.max(1, Math.round(nativeHeight * scale))
    output.getContext('2d')!.drawImage(this.canvas, region.x * this.canvas.width, region.y * this.canvas.height, nativeWidth, nativeHeight, 0, 0, output.width, output.height)
    return { id: eventId(), timestamp: new Date().toISOString(), target: { type: 'monitor', id: 'lab' }, nativeWidth, nativeHeight, width: output.width, height: output.height, mimeType: 'image/png', image: output.toDataURL('image/png'), ...(options.region ? { region: options.region } : {}) }
  }

  async action(action: DesktopAction, signal?: AbortSignal): Promise<ActionResult> {
    checkCancelled(signal)
    const startedAt = new Date().toISOString()
    if (action.type === 'pointer.click' || action.type === 'pointer.doubleClick') {
      if (!Number.isFinite(action.x) || !Number.isFinite(action.y) || action.x < 0 || action.x > 1 || action.y < 0 || action.y > 1) throw new ControlError('INVALID_ACTION', 'Lab pointer coordinates must be between zero and one.')
      if (action.button && action.button !== 'left') throw new ControlError('INVALID_ACTION', 'The lab accepts left clicks only.')
      this.scene.pointer(action.x, action.y)
    } else if (action.type !== 'pointer.move') throw new ControlError('INVALID_ACTION', 'The included lab accepts pointer movement and tree clicks. Use a paired desktop for keyboard, drag, and scroll actions.')
    return { id: eventId(), ok: true, startedAt, completedAt: new Date().toISOString(), action, result: { mode: 'lab', message: 'Pointer action delivered to the visible lab canvas.' } }
  }

  async createWatch(spec: WatchSpec) {
    await this.removeWatch(spec.id)
    if (spec.intervalMs < 250 || spec.intervalMs > 3600000 || spec.threshold < 0 || spec.threshold > 1) throw new ControlError('INVALID_WATCH', 'Choose a watch interval of 250 milliseconds to one hour and a threshold between zero and one.')
    const record: { timer: ReturnType<typeof setInterval>; previous?: PixelFrame } = { timer: undefined! }
    const tick = () => {
      this.scene.draw()
      const region = spec.region ?? { x: 0, y: 0, width: 1, height: 1 }
      const context = this.canvas.getContext('2d')!
      const pixels = context.getImageData(Math.round(region.x * this.canvas.width), Math.round(region.y * this.canvas.height), Math.max(1, Math.round(region.width * this.canvas.width)), Math.max(1, Math.round(region.height * this.canvas.height)))
      const frame = { width: pixels.width, height: pixels.height, data: pixels.data }
      const difference = record.previous ? imageDifference(record.previous, frame) : 0
      const changed = difference >= spec.threshold
      record.previous = frame
      const event: LenseEvent = { id: eventId(), timestamp: new Date().toISOString(), type: changed ? 'watch.changed' : 'watch.tick', data: { watchId: spec.id, changed, difference, frameId: eventId(), mode: 'lab' } }
      for (const listener of this.listeners) listener(event)
    }
    record.timer = setInterval(tick, spec.intervalMs)
    this.watches.set(spec.id, record); tick()
    return { ...spec }
  }

  async removeWatch(id: string) { const watch = this.watches.get(id); if (watch) clearInterval(watch.timer); this.watches.delete(id) }
  subscribe(listener: (event: LenseEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  dispose() { for (const watch of this.watches.values()) clearInterval(watch.timer); this.watches.clear(); this.listeners.clear(); this.scene.dispose() }
}
