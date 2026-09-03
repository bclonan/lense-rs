import type { Box, DesktopAction, Point, Target } from '../../types/protocol'
export * from '../../types/protocol'
export class BridgeError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'BridgeError' }
}
export function validatePoint(value: unknown): asserts value is Point {
  const p = value as Point
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) throw new BridgeError('INVALID_ACTION', 'Coordinates must be numbers between 0 and 1.')
}
export function validateTarget(value: unknown): asserts value is Target {
  const target = value as Target
  if (!target || !['monitor', 'window'].includes(target.type) || typeof target.id !== 'string' || !target.id || target.id.length > 128) throw new BridgeError('INVALID_ACTION', 'Select a valid monitor or window.')
}
export function validateRegion(value: Box) {
  validatePoint(value)
  if (!Number.isFinite(value.width) || !Number.isFinite(value.height) || value.width <= 0 || value.height <= 0 || value.x + value.width > 1 || value.y + value.height > 1) throw new BridgeError('INVALID_ACTION', 'The capture region must fit inside the selected source.')
}
export function validateAction(value: unknown): asserts value is DesktopAction {
  if (!value || typeof value !== 'object') throw new BridgeError('INVALID_ACTION', 'An action object is required.')
  const a = value as DesktopAction
  const keys: Record<string, string[]> = {
    'pointer.move': ['type','x','y','target'], 'pointer.click':['type','x','y','target','button'], 'pointer.doubleClick':['type','x','y','target','button'],
    'pointer.drag':['type','from','to','durationMs','target'], 'keyboard.type':['type','text'], 'keyboard.key':['type','key'], 'keyboard.hotkey':['type','keys'], 'scroll':['type','deltaX','deltaY'], 'window.focus':['type','windowId'],
  }
  if (!keys[a.type] || Object.keys(a).some(k => !keys[a.type]!.includes(k))) throw new BridgeError('INVALID_ACTION', 'Unknown action type or field.')
  if ('target' in a && a.target) validateTarget(a.target)
  switch (a.type) {
    case 'pointer.move': case 'pointer.click': case 'pointer.doubleClick':
      validatePoint(a)
      if (a.button && !['left','right','middle'].includes(a.button)) throw new BridgeError('INVALID_ACTION', 'Unknown mouse button.')
      break
    case 'pointer.drag': validatePoint(a.from); validatePoint(a.to); if (!Number.isInteger(a.durationMs) || a.durationMs < 50 || a.durationMs > 5000) throw new BridgeError('INVALID_ACTION','Drag duration must be 50 to 5000 milliseconds.'); break
    case 'keyboard.type': if (typeof a.text !== 'string' || !a.text.length || a.text.length > 10000) throw new BridgeError('INVALID_ACTION','Enter 1 to 10,000 characters.'); break
    case 'keyboard.key': if (typeof a.key !== 'string' || !/^[A-Za-z0-9_+.-]{1,32}$/.test(a.key)) throw new BridgeError('INVALID_ACTION','Invalid key name.'); break
    case 'keyboard.hotkey': if (!Array.isArray(a.keys) || a.keys.length < 1 || a.keys.length > 5 || a.keys.some(k => typeof k !== 'string' || !/^[A-Za-z0-9_+.-]{1,32}$/.test(k))) throw new BridgeError('INVALID_ACTION','Use 1 to 5 named keys.'); break
    case 'scroll': if (![a.deltaX,a.deltaY].every(n=>Number.isInteger(n) && Math.abs(n)<=10000)) throw new BridgeError('INVALID_ACTION','Scroll must be within 10,000 units.'); break
    case 'window.focus': if (typeof a.windowId !== 'string' || !a.windowId || a.windowId.length>128) throw new BridgeError('INVALID_ACTION','Select a valid window.'); break
  }
}
