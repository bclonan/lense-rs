import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserScreenCapture } from './browser'

class Track extends EventTarget {
  readyState = 'live'
  label = 'Shared test window'
  stop = vi.fn(() => { this.readyState = 'ended' })
  getSettings() { return { displaySurface: 'window', width: 1920, height: 1080, frameRate: 12 } }
}
const media = () => {
  const track = new Track()
  return { track, stream: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream }
}
class Video {
  muted = false
  playsInline = false
  srcObject: unknown = null
  videoWidth = 1920
  videoHeight = 1080
  frame = 0
  play = vi.fn().mockResolvedValue(undefined)
  callbacks = new Map<number, VideoFrameRequestCallback>()
  nextId = 0
  requestVideoFrameCallback = vi.fn((callback: VideoFrameRequestCallback) => {
    const id = ++this.nextId
    this.callbacks.set(id, callback)
    return id
  })
  cancelVideoFrameCallback = vi.fn((id: number) => this.callbacks.delete(id))
  nextFrame() {
    this.frame++
    for (const [id, callback] of [...this.callbacks]) {
      this.callbacks.delete(id)
      callback(0, {} as VideoFrameCallbackMetadata)
    }
  }
}
function setup() {
  const videos: Video[] = []
  const canvases: Array<{ width: number; height: number; frame: number; getContext: ReturnType<typeof vi.fn>; toDataURL: ReturnType<typeof vi.fn> }> = []
  const drawImage = vi.fn()
  const createElement = vi.fn((tag: string) => {
    if (tag === 'video') { const video = new Video(); videos.push(video); return video }
    const canvas = {
      width: 0, height: 0, frame: 0,
      getContext: vi.fn(() => ({ drawImage: (...args: unknown[]) => { canvas.frame = (args[0] as Video).frame; drawImage(...args) } })),
      toDataURL: vi.fn(() => `data:image/jpeg;base64,frame${canvas.frame}`),
    }
    canvases.push(canvas)
    return canvas
  })
  const captureMedia = media()
  const getDisplayMedia = vi.fn().mockResolvedValue(captureMedia.stream)
  vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } })
  vi.stubGlobal('document', { createElement })
  return { ...captureMedia, videos, canvases, drawImage, getDisplayMedia, createElement }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('browser screen capture', () => {
  it('requests a useful share cadence and reports source identity without a bridge target', async () => {
    const fake = setup()
    const capture = new BrowserScreenCapture()
    await capture.start()
    expect(fake.getDisplayMedia).toHaveBeenCalledWith({ video: { frameRate: { ideal: 12, max: 12 } }, audio: false })
    expect(capture.source).toEqual({ label: 'Shared test window', displaySurface: 'window', width: 1920, height: 1080, frameRate: 12 })
    const pending = capture.snapshot()
    fake.videos[0].nextFrame()
    expect(await pending).toMatchObject({ target: { type: 'monitor', id: 'browser-share' }, width: 1280, height: 720 })
    capture.stop()
    expect(capture.source).toBeNull()
    expect(fake.track.stop).toHaveBeenCalledOnce()
  })

  it('waits for a decoded frame and reuses the canvas while encoding changed pixels and crops', async () => {
    const fake = setup()
    const capture = new BrowserScreenCapture()
    await capture.start()
    const first = capture.snapshot()
    expect(fake.drawImage).not.toHaveBeenCalled()
    fake.videos[0].nextFrame()
    expect((await first).image).toContain('frame1')
    const second = capture.snapshot(undefined, { region: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, maxDimension: 480, quality: 0.6 })
    fake.videos[0].nextFrame()
    expect(await second).toMatchObject({ image: 'data:image/jpeg;base64,frame2', width: 480, height: 270, nativeWidth: 1920, nativeHeight: 1080, region: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } })
    expect(fake.drawImage).toHaveBeenLastCalledWith(fake.videos[0], 480, 270, 960, 540, 0, 0, 480, 270)
    expect(fake.canvases).toHaveLength(1)
    expect(fake.canvases[0].toDataURL).toHaveBeenLastCalledWith('image/jpeg', 0.6)
    expect(capture.frameTimestamp).not.toBeNull()
    capture.stop()
  })

  it('releases a late picker result after Stop without resurrecting sharing', async () => {
    const fake = setup()
    let resolve!: (stream: MediaStream) => void
    fake.getDisplayMedia.mockImplementationOnce(() => new Promise<MediaStream>(done => { resolve = done }))
    const capture = new BrowserScreenCapture()
    const pending = capture.start()
    capture.stop()
    resolve(fake.stream)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(capture.active).toBe(false)
    expect(fake.track.stop).toHaveBeenCalledOnce()
    expect(fake.videos).toHaveLength(0)
  })

  it('keeps a newer share when an older picker finishes or its ended event arrives late', async () => {
    const fake = setup()
    let resolve!: (stream: MediaStream) => void
    fake.getDisplayMedia.mockImplementationOnce(() => new Promise<MediaStream>(done => { resolve = done }))
    const next = media()
    fake.getDisplayMedia.mockResolvedValueOnce(next.stream)
    const capture = new BrowserScreenCapture()
    const first = capture.start()
    await capture.start({ frameRate: 20 })
    resolve(fake.stream)
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(capture.stream).toBe(next.stream)
    expect(next.track.stop).not.toHaveBeenCalled()
    const third = media()
    fake.getDisplayMedia.mockResolvedValueOnce(third.stream)
    await capture.start()
    next.track.dispatchEvent(new Event('ended'))
    expect(capture.stream).toBe(third.stream)
    capture.stop()
  })

  it('cancels frame callbacks on abort and rejects pending captures when sharing ends', async () => {
    const fake = setup()
    const capture = new BrowserScreenCapture()
    await capture.start()
    const controller = new AbortController()
    const aborted = capture.snapshot(controller.signal)
    controller.abort(new Error('Cancelled observation'))
    await expect(aborted).rejects.toThrow('Cancelled observation')
    expect(fake.videos[0].callbacks.size).toBe(0)
    const stopped = capture.snapshot()
    fake.track.dispatchEvent(new Event('ended'))
    await expect(stopped).rejects.toMatchObject({ name: 'AbortError' })
    expect(fake.videos[0].callbacks.size).toBe(0)
    expect(fake.drawImage).not.toHaveBeenCalled()
    expect(capture.active).toBe(false)
  })

  it('uses a bounded wait for static shares and browsers without frame callbacks', async () => {
    vi.useFakeTimers()
    const fake = setup()
    const capture = new BrowserScreenCapture()
    await capture.start()
    const staticFrame = capture.snapshot()
    await vi.advanceTimersByTimeAsync(180)
    expect((await staticFrame).width).toBe(1280)
    expect(fake.videos[0].callbacks.size).toBe(0)
    Object.defineProperty(fake.videos[0], 'requestVideoFrameCallback', { value: undefined })
    const fallback = capture.snapshot()
    await vi.advanceTimersByTimeAsync(84)
    expect((await fallback).width).toBe(1280)
    capture.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects invalid crop coordinates before drawing an observation', async () => {
    const fake = setup()
    const capture = new BrowserScreenCapture()
    await capture.start()
    await expect(capture.snapshot(undefined, { waitForFrameMs: 0, region: { x: 0.8, y: 0, width: 0.5, height: 1 } })).rejects.toThrow('capture region')
    expect(fake.drawImage).not.toHaveBeenCalled()
    capture.stop()
  })
})
