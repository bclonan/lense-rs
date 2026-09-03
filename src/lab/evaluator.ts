import type { AgentPlan, AgentProvider, Annotation, EvaluationResult, Observation, TaskConfig } from '../types/protocol'
import { readPixels, type PixelFrame } from '../services/evaluator/visual'

/** Recognizes only the documented visible colors in the included lab image. */
export function inspectLabPixels(frame: PixelFrame) {
  const { width, height, data } = frame
  const treePixels = new Uint8Array(width * height)
  const activePixels = new Uint8Array(width * height)
  const idlePixels = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const pixel = y * width + x; const i = pixel * 4
    const r = data[i]!; const g = data[i + 1]!; const b = data[i + 2]!
    if (Math.abs(r - 64) < 12 && Math.abs(g - 225) < 12 && Math.abs(b - 196) < 12) activePixels[pixel] = 1
    if (Math.abs(r - 242) < 12 && Math.abs(g - 184) < 12 && Math.abs(b - 92) < 12) idlePixels[pixel] = 1
    if (g > 150 && g < 220 && r > 35 && r < 120 && b > 70 && b < 150 && g > r * 1.8 && g > b * 1.3) treePixels[pixel] = 1
  }
  const regions: Annotation[] = []
  // Connected components find canopy positions from pixels, without scene coordinates.
  for (let start = 0; start < treePixels.length; start++) {
    if (!treePixels[start]) continue
    const queue = [start]; treePixels[start] = 0
    let minX = width; let minY = height; let maxX = 0; let maxY = 0; let count = 0
    for (let head = 0; head < queue.length; head++) {
      const point = queue[head]!; const x = point % width; const y = Math.floor(point / width)
      count++; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
      for (const next of [x > 0 ? point - 1 : -1, x + 1 < width ? point + 1 : -1, point - width, point + width]) {
        if (next >= 0 && next < treePixels.length && treePixels[next]) { treePixels[next] = 0; queue.push(next) }
      }
    }
    if (count > width * height * .0006 && maxX - minX > width * .025) regions.push({ label: 'Available tree', confidence: .97, box: { x: minX / width, y: minY / height, width: (maxX - minX + 1) / width, height: (maxY - minY + 1) / height } })
  }
  const beacon = (pixels: Uint8Array) => {
    for (let start = 0; start < pixels.length; start++) {
      if (!pixels[start]) continue
      const queue = [start]; pixels[start] = 0
      let minX = width; let minY = height; let maxX = 0; let maxY = 0; let count = 0
      for (let head = 0; head < queue.length; head++) {
        const point = queue[head]!; const x = point % width; const y = Math.floor(point / width)
        count++; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
        for (const next of [x > 0 ? point - 1 : -1, x + 1 < width ? point + 1 : -1, point - width, point + width]) if (next >= 0 && next < pixels.length && pixels[next]) { pixels[next] = 0; queue.push(next) }
      }
      const boxWidth = maxX - minX + 1; const boxHeight = maxY - minY + 1
      if (count >= 25 && boxWidth / boxHeight > .75 && boxWidth / boxHeight < 1.3 && count / (boxWidth * boxHeight) > .85) return true
    }
    return false
  }
  const active = beacon(activePixels); const idle = beacon(idlePixels)
  // Two status squares indicate overlapping lab views. Ask for a clearer capture.
  return { recognized: active !== idle, chopping: active && !idle, regions }
}

export class LabProvider implements AgentProvider {
  async evaluate(input: { frame: Observation; condition: string }, signal?: AbortSignal): Promise<EvaluationResult> {
    const pixels = inspectLabPixels(await readPixels(input.frame, signal))
    const condition = input.condition
    if (!pixels.recognized) return { condition, result: false, confidence: .1, explanation: 'The visible lab status indicator could not be identified. No action is safe.' }
    if (/chop|harvest|cutting/i.test(condition)) {
      const inverted = /no longer|not |stopped|stops|idle|isn.t/i.test(condition)
      return { condition, result: inverted ? !pixels.chopping : pixels.chopping, confidence: .99, explanation: pixels.chopping ? 'The screenshot has the cyan CHOPPING status indicator.' : 'The screenshot has the amber IDLE status indicator. The character has stopped chopping.', regions: pixels.regions }
    }
    if (/application.*visible|lab.*visible|game.*visible/i.test(condition)) return { condition, result: true, confidence: .98, explanation: 'The lab status indicator and scene are visible in the screenshot.', regions: pixels.regions }
    return { condition, result: false, confidence: .2, explanation: 'The included evaluator recognizes the lab chopping status and visible trees only. This condition needs an external visual agent.' }
  }

  async plan(input: { frame: Observation; task: TaskConfig }, signal?: AbortSignal): Promise<AgentPlan> {
    if (!/chop|wood|tree|timber|harvest/i.test(input.task.goal)) return { explanation: 'The lab evaluator supports woodcutting goals. Use desktop mode and an external WebMCP agent for other software.', actions: [], confidence: 0 }
    const pixels = inspectLabPixels(await readPixels(input.frame, signal))
    if (!pixels.recognized) return { explanation: 'The screenshot does not show the lab status indicator.', actions: [], confidence: .1 }
    if (pixels.chopping) return { explanation: 'The visible status already says CHOPPING. Keep watching.', actions: [], confidence: .99 }
    const target = pixels.regions.sort((a, b) => a.box.x - b.box.x)[0]
    if (!target) return { explanation: 'No green tree canopy appears in the current screenshot. Wait for a tree to regrow.', actions: [], confidence: .99 }
    const region = input.frame.region ?? { x: 0, y: 0, width: 1, height: 1 }
    return { explanation: 'A green tree canopy is visible. Click its center, then check the visible chopping indicator.', confidence: .97, actions: [{ type: 'pointer.click', button: 'left', x: region.x + (target.box.x + target.box.width / 2) * region.width, y: region.y + (target.box.y + target.box.height / 2) * region.height, target: input.frame.target }] }
  }

  async recover(input: { frame: Observation; task: TaskConfig; evaluation: EvaluationResult }, signal?: AbortSignal) { return this.plan(input, signal) }
}
