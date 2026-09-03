import type { Box, CaptureOptions, Observation } from '../../types/protocol'

export interface BrowserCaptureSource {
  label: string
  displaySurface: string | null
  width: number
  height: number
  frameRate: number
}

export interface BrowserSnapshotOptions extends Pick<CaptureOptions, 'region' | 'maxDimension' | 'quality'> {
  /** Wait for the next decoded frame, then use the latest available frame. */
  waitForFrameMs?: number
}

const abortError = () => new DOMException('Screen sharing was stopped.', 'AbortError')
const bounded = (value: number | undefined, fallback: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value!)) : fallback

export class BrowserScreenCapture {
  stream: MediaStream | null = null
  private video: HTMLVideoElement | null = null
  private canvas: HTMLCanvasElement | null = null
  private generation = 0
  private requestedFrameRate = 12
  private lastFrameTimestamp: string | null = null
  private pendingFrames = new Set<(error: unknown) => void>()

  get active() { return !!this.stream?.getVideoTracks().some(track => track.readyState === 'live') }
  get frameTimestamp() { return this.lastFrameTimestamp }
  get source(): BrowserCaptureSource | null {
    const track = this.stream?.getVideoTracks().find(track => track.readyState === 'live')
    if (!track) return null
    const settings = track.getSettings()
    return {
      label: track.label || 'Shared screen',
      displaySurface: (settings as MediaTrackSettings & { displaySurface?: string }).displaySurface || null,
      width: this.video?.videoWidth || settings.width || 0,
      height: this.video?.videoHeight || settings.height || 0,
      frameRate: settings.frameRate || this.requestedFrameRate,
    }
  }

  async start(options: { frameRate?: number } = {}) {
    this.stop()
    const generation = this.generation
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('This browser does not support screen sharing. Use native bridge capture.')
    this.requestedFrameRate = bounded(options.frameRate, 12, 2, 30)
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: this.requestedFrameRate, max: this.requestedFrameRate } },
      audio: false,
    })
    // A picker can finish after Stop or a newer picker. Release only its own stream.
    if (generation !== this.generation) {
      stream.getTracks().forEach(track => track.stop())
      throw abortError()
    }
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    this.stream = stream
    this.video = video
    stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
      if (generation === this.generation) this.stop()
    }, { once: true }))
    try {
      await video.play()
      if (generation !== this.generation || !this.active) throw abortError()
    } catch (error) {
      if (generation === this.generation) this.stop()
      else { stream.getTracks().forEach(track => track.stop()); video.srcObject = null }
      throw error
    }
  }

  stop() {
    this.generation++
    for (const cancel of [...this.pendingFrames]) cancel(abortError())
    const stream = this.stream
    const video = this.video
    this.stream = null
    this.video = null
    this.canvas = null
    this.lastFrameTimestamp = null
    stream?.getTracks().forEach(track => track.stop())
    if (video) video.srcObject = null
  }

  private waitForFrame(video: HTMLVideoElement, signal: AbortSignal | undefined, timeoutMs: number) {
    if (signal?.aborted) return Promise.reject(signal.reason ?? abortError())
    if (timeoutMs <= 0) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      let callbackId: number | undefined
      let finished = false
      const finish = (error?: unknown) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        if (callbackId !== undefined) video.cancelVideoFrameCallback?.(callbackId)
        signal?.removeEventListener('abort', aborted)
        this.pendingFrames.delete(cancel)
        if (error !== undefined) reject(error)
        else resolve()
      }
      const cancel = (error: unknown) => finish(error)
      const aborted = () => finish(signal?.reason ?? abortError())
      const hasFrameCallback = typeof video.requestVideoFrameCallback === 'function'
      const timer = setTimeout(() => finish(), hasFrameCallback ? timeoutMs : Math.min(timeoutMs, 1000 / this.requestedFrameRate))
      this.pendingFrames.add(cancel)
      signal?.addEventListener('abort', aborted, { once: true })
      if (hasFrameCallback) callbackId = video.requestVideoFrameCallback(() => {
        this.lastFrameTimestamp = new Date().toISOString()
        finish()
      })
    })
  }

  async snapshot(signal?: AbortSignal, options: BrowserSnapshotOptions = {}): Promise<Observation> {
    if (signal?.aborted) throw signal.reason ?? abortError()
    const video = this.video
    const generation = this.generation
    if (!video || !this.active) throw new Error('Start screen sharing before taking an observation.')
    await this.waitForFrame(video, signal, bounded(options.waitForFrameMs, 180, 0, 1000))
    if (signal?.aborted) throw signal.reason ?? abortError()
    if (generation !== this.generation || video !== this.video || !this.active) throw abortError()
    if (!video.videoWidth || !video.videoHeight) throw new Error('The shared screen has not supplied a frame yet. Try Observe again.')

    const region = options.region ? this.validateRegion(options.region) : undefined
    const nativeWidth = video.videoWidth
    const nativeHeight = video.videoHeight
    const sourceX = (region?.x || 0) * nativeWidth
    const sourceY = (region?.y || 0) * nativeHeight
    const sourceWidth = (region?.width ?? 1) * nativeWidth
    const sourceHeight = (region?.height ?? 1) * nativeHeight
    const ratio = Math.min(1, bounded(options.maxDimension, 1280, 64, 4096) / Math.max(sourceWidth, sourceHeight))
    const canvas = this.canvas ??= document.createElement('canvas')
    const width = Math.max(1, Math.round(sourceWidth * ratio))
    const height = Math.max(1, Math.round(sourceHeight * ratio))
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('This browser could not prepare the shared screen image.')
    context.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height)
    const timestamp = new Date().toISOString()
    if (!this.lastFrameTimestamp || typeof video.requestVideoFrameCallback !== 'function') this.lastFrameTimestamp = timestamp
    return {
      id: crypto.randomUUID(), timestamp,
      // Browser sharing does not identify a bridge monitor or window.
      target: { type: 'monitor', id: 'browser-share' },
      ...(region ? { region } : {}),
      nativeWidth, nativeHeight, width, height, mimeType: 'image/jpeg',
      image: canvas.toDataURL('image/jpeg', bounded(options.quality, 0.78, 0.1, 1)),
    }
  }

  private validateRegion(region: Box): Box {
    const { x, y, width, height } = region
    if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
      throw new Error('The capture region must fit inside the shared screen using coordinates between 0 and 1.')
    }
    return { x, y, width, height }
  }
}
