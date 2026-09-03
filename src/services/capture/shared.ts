import { shallowRef, ref } from 'vue'
import type { CaptureOptions, Observation } from '../../types/protocol'
import { BrowserScreenCapture } from './browser'

export const browserCapture = new BrowserScreenCapture()
export const sharedObservation = shallowRef<Observation | null>(null)
export const captureSource = ref<'native' | 'browser'>('native')

export async function observeShared(options: CaptureOptions = {}, signal?: AbortSignal) {
  if (options.target || options.region) throw new Error('Browser sharing captures the source chosen in the browser picker. Use source native for target or region coordinates.')
  const frame = await browserCapture.snapshot(signal, {maxDimension:options.maxDimension, quality:options.quality})
  sharedObservation.value = frame
  return frame
}
