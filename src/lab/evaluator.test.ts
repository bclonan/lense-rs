import { describe, expect, it } from 'vitest'
import { inspectLabPixels } from './evaluator'
import { imageDifference, perceptualHash, type PixelFrame } from '../services/evaluator/visual'

function fixture(chopping: boolean): PixelFrame {
  const width = 400; const height = 300; const data = new Uint8ClampedArray(width * height * 4)
  const fill = (x: number, y: number, w: number, h: number, color: number[]) => {
    for (let row = y; row < y + h; row++) for (let column = x; column < x + w; column++) { const index = (row * width + column) * 4; data[index] = color[0]!; data[index + 1] = color[1]!; data[index + 2] = color[2]!; data[index + 3] = 255 }
  }
  // Status is deliberately away from the top left, as in a native window capture.
  fill(260, 115, 12, 12, chopping ? [64, 225, 196] : [242, 184, 92])
  fill(150, 190, 32, 40, [68, 184, 106])
  fill(310, 200, 30, 42, [68, 184, 106])
  // The character's coat is amber too, but has a different visible color.
  fill(80, 190, 24, 23, [232, 170, 85])
  return { width, height, data }
}

describe('pixel-only lab evaluation', () => {
  it('finds the visible status and connected tree canopies without scene state', () => {
    const result = inspectLabPixels(fixture(true))
    expect(result.recognized).toBe(true); expect(result.chopping).toBe(true); expect(result.regions).toHaveLength(2)
    expect(result.regions[0]?.box.x).toBeCloseTo(.375)
  })
  it('recognizes stopped chopping and rejects an unrelated screen', () => {
    expect(inspectLabPixels(fixture(false)).chopping).toBe(false)
    expect(inspectLabPixels({ width: 20, height: 20, data: new Uint8ClampedArray(1600) }).recognized).toBe(false)
  })
  it('computes zero change for identical frames and detects status changes', () => {
    expect(imageDifference(fixture(true), fixture(true))).toBe(0)
    expect(imageDifference(fixture(true), fixture(false))).toBeGreaterThan(0)
    expect(perceptualHash(fixture(true))).toHaveLength(64)
  })
})
