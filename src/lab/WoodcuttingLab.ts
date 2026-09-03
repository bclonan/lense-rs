const WIDTH = 960
const HEIGHT = 600
interface Tree { x: number; y: number; depletedAt: number | null; tint: number }

/** A small mouse-controlled application. Its state is private to the renderer. */
export class WoodcuttingLab {
  private readonly context: CanvasRenderingContext2D
  private readonly trees: Tree[] = [
    { x: 185, y: 217, depletedAt: null, tint: 0 }, { x: 444, y: 190, depletedAt: null, tint: 1 },
    { x: 744, y: 242, depletedAt: null, tint: 2 }, { x: 257, y: 423, depletedAt: null, tint: 1 },
    { x: 609, y: 408, depletedAt: null, tint: 0 },
  ]
  private active: number | null = null
  private choppingStarted = 0
  private logs = 0
  private lastLog = 0
  private character = { x: 474, y: 342 }
  private frame = 0
  private disposed = false
  private readonly start = performance.now()
  private pointerHandler = (event: PointerEvent) => {
    const rect = this.canvas.getBoundingClientRect()
    this.pointer((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height)
  }

  constructor(private readonly canvas: HTMLCanvasElement, animate = false) {
    canvas.width = WIDTH; canvas.height = HEIGHT
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('This browser does not support the Woodcutting Lab canvas.')
    this.context = context
    this.canvas.addEventListener('pointerdown', this.pointerHandler)
    this.draw()
    if (animate) {
      const tick = () => { if (!this.disposed) { this.draw(); this.frame = requestAnimationFrame(tick) } }
      this.frame = requestAnimationFrame(tick)
    }
  }

  pointer(x: number, y: number) {
    this.update(performance.now())
    const selected = this.trees.findIndex(tree => tree.depletedAt === null && Math.abs(x * WIDTH - tree.x) < 68 && y * HEIGHT > tree.y - 102 && y * HEIGHT < tree.y + 34)
    if (selected < 0) return
    this.active = selected
    this.choppingStarted = performance.now()
    this.lastLog = 0
    this.character = { x: this.trees[selected]!.x + 53, y: this.trees[selected]!.y + 38 }
    this.draw()
  }

  private update(now: number) {
    for (const tree of this.trees) if (tree.depletedAt !== null && now - tree.depletedAt >= 18000) tree.depletedAt = null
    if (this.active !== null) {
      const elapsed = now - this.choppingStarted
      const count = Math.min(5, Math.floor(elapsed / 1000))
      this.logs += count - this.lastLog; this.lastLog = count
      if (elapsed >= 5500) { this.trees[this.active]!.depletedAt = now; this.active = null }
    }
  }

  draw() {
    if (this.disposed) return
    const now = performance.now()
    this.update(now)
    const c = this.context
    c.fillStyle = '#132b25'; c.fillRect(0, 0, WIDTH, HEIGHT)
    // Fixed seeded terrain keeps visual comparisons repeatable.
    let seed = 813
    for (let i = 0; i < 420; i++) {
      seed = (seed * 16807) % 2147483647; const x = seed % WIDTH
      seed = (seed * 16807) % 2147483647; const y = 94 + seed % 465
      c.fillStyle = i % 3 ? '#1b3930' : '#234338'; c.fillRect(x, y, 3, 6)
    }
    c.strokeStyle = '#354638'; c.lineWidth = 84; c.lineCap = 'round'
    c.beginPath(); c.moveTo(345, 610); c.bezierCurveTo(446, 433, 349, 372, 525, 286); c.bezierCurveTo(674, 192, 698, 155, 883, 97); c.stroke()
    c.strokeStyle = '#40503e'; c.lineWidth = 66; c.stroke()
    for (let i = 0; i < this.trees.length; i++) this.tree(this.trees[i]!, i)
    const { x, y } = this.character
    c.fillStyle = '#0b201b88'; c.beginPath(); c.ellipse(x, y + 8, 19, 8, 0, 0, Math.PI * 2); c.fill()
    c.fillStyle = '#25405a'; c.fillRect(x - 10, y - 19, 8, 26); c.fillRect(x + 2, y - 19, 8, 26)
    c.fillStyle = '#e8aa55'; c.fillRect(x - 12, y - 34, 24, 23)
    c.fillStyle = '#efd4ae'; c.fillRect(x - 9, y - 49, 18, 17)
    c.fillStyle = '#485b88'; c.fillRect(x - 11, y - 52, 22, 8)
    c.save(); c.translate(x - 13, y - 28)
    c.rotate(this.active !== null ? Math.sin((now - this.start) / 180) * .75 : .6)
    c.fillStyle = '#c29c64'; c.fillRect(-22, -3, 28, 5); c.fillStyle = '#d6e4e1'; c.fillRect(-27, -8, 10, 15); c.restore()
    c.fillStyle = '#0a1916ee'; c.fillRect(0, 0, WIDTH, 83)
    c.fillStyle = this.active !== null ? '#40e1c4' : '#f2b85c'; c.fillRect(25, 26, 23, 23)
    c.font = 'bold 16px ui-monospace, monospace'; c.fillStyle = '#e6f1e8'
    c.fillText(this.active !== null ? 'CHOPPING' : 'IDLE', 63, 35)
    c.font = '13px ui-monospace, monospace'; c.fillStyle = '#91ab9c'
    c.fillText(this.active !== null ? 'Harvesting timber. Watch the next tree.' : 'Select a living tree to start chopping.', 63, 57)
    c.textAlign = 'right'; c.fillStyle = '#efd8a9'; c.font = 'bold 23px ui-monospace, monospace'; c.fillText(`${this.logs.toString().padStart(2, '0')} LOGS`, 926, 40)
    c.font = '11px ui-monospace, monospace'; c.fillStyle = '#91ab9c'; c.fillText('WOODCUTTING LAB / LOCAL SIMULATION', 926, 61); c.textAlign = 'left'
    c.fillStyle = '#0a1916ee'; c.fillRect(0, 560, WIDTH, 40)
    c.fillStyle = '#91ab9c'; c.font = '12px ui-monospace, monospace'; c.fillText('CLICK A TREE     /     5 LOGS PER TREE     /     TREES REGROW', 25, 585)
    if (this.active !== null) {
      const tree = this.trees[this.active]!
      c.fillStyle = '#0c251e'; c.fillRect(tree.x - 35, tree.y + 46, 70, 5)
      c.fillStyle = '#40e1c4'; c.fillRect(tree.x - 35, tree.y + 46, 70 * Math.min(1, (now - this.choppingStarted) / 5500), 5)
    }
  }

  private tree(tree: Tree, index: number) {
    const c = this.context; const { x, y } = tree
    c.fillStyle = '#071b164f'; c.beginPath(); c.ellipse(x + 8, y + 23, 56, 17, 0, 0, Math.PI * 2); c.fill()
    if (tree.depletedAt !== null) {
      c.fillStyle = '#6a4933'; c.fillRect(x - 16, y + 4, 32, 18)
      c.fillStyle = '#a58154'; c.beginPath(); c.ellipse(x, y + 4, 17, 7, 0, 0, Math.PI * 2); c.fill()
      c.strokeStyle = '#795637'; c.lineWidth = 2; c.beginPath(); c.ellipse(x, y + 4, 8, 3, 0, 0, Math.PI * 2); c.stroke()
      return
    }
    c.fillStyle = '#76543a'; c.fillRect(x - 12, y - 13, 24, 42)
    c.fillStyle = '#b18950'; c.fillRect(x - 6, y - 10, 5, 34)
    c.fillStyle = '#225b3e'; c.beginPath(); c.moveTo(x, y - 109); c.lineTo(x + 68, y + 1); c.lineTo(x - 68, y + 1); c.closePath(); c.fill()
    c.fillStyle = '#44b86a'; c.beginPath(); c.moveTo(x, y - 107); c.lineTo(x + 54, y - 13); c.lineTo(x - 54, y - 13); c.closePath(); c.fill()
    c.fillStyle = '#5cc57c'; c.beginPath(); c.moveTo(x, y - 105); c.lineTo(x, y - 13); c.lineTo(x - 52, y - 13); c.closePath(); c.fill()
    c.fillStyle = '#347e50'; c.beginPath(); c.moveTo(x, y - 67); c.lineTo(x + 40, y - 3); c.lineTo(x - 40, y - 3); c.closePath(); c.fill()
    c.fillStyle = '#a9c4ac'; c.font = '10px ui-monospace, monospace'; c.textAlign = 'center'; c.fillText(`PINE ${String(index + 1).padStart(2, '0')}`, x, y + 43); c.textAlign = 'left'
  }

  dispose() { this.disposed = true; cancelAnimationFrame(this.frame); this.canvas.removeEventListener('pointerdown', this.pointerHandler) }
}

export function mountLab(canvas: HTMLCanvasElement): { dispose(): void } {
  return new WoodcuttingLab(canvas, true)
}
