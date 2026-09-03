import type { Observation } from '../../types/protocol'
import { checkCancelled, ControlError } from '../tasks/helpers'

export interface PixelFrame { width: number; height: number; data: Uint8ClampedArray }

export async function readPixels(frame: Observation, signal?: AbortSignal): Promise<PixelFrame> {
  checkCancelled(signal)
  const image = new Image()
  image.src = frame.image.startsWith('data:') ? frame.image : `data:${frame.mimeType};base64,${frame.image}`
  await image.decode()
  checkCancelled(signal)
  const canvas = document.createElement('canvas')
  canvas.width = frame.width
  canvas.height = frame.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new ControlError('CAPTURE_FAILED', 'The browser could not decode the observation.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data }
}

/** Mean absolute channel difference, normalized to 0..1. No semantic inference. */
export function imageDifference(first: PixelFrame, second: PixelFrame) {
  if (first.width !== second.width || first.height !== second.height) return 1
  if (!first.data.length) return 0
  let difference = 0
  let channels = 0
  for (let i = 0; i < first.data.length; i += 16) {
    for (let c = 0; c < 3; c++) { difference += Math.abs(first.data[i + c]! - second.data[i + c]!); channels++ }
  }
  return difference / (channels * 255)
}

export function perceptualHash(frame: PixelFrame): string {
  const luminance: number[] = []
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const i = (Math.min(frame.height - 1, Math.floor((y + .5) * frame.height / 8)) * frame.width + Math.min(frame.width - 1, Math.floor((x + .5) * frame.width / 8))) * 4
    luminance.push(frame.data[i]! * .299 + frame.data[i + 1]! * .587 + frame.data[i + 2]! * .114)
  }
  const average = luminance.reduce((a, b) => a + b, 0) / 64
  return luminance.map(value => value >= average ? '1' : '0').join('')
}
