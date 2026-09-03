import { reactive, shallowRef } from 'vue'
import type { Tool } from './types'

export interface ToolInspector {
  availability: string
  names: string[]
  validation: 'valid' | 'invalid' | 'pending'
  lastCall?: { name: string; input: unknown; result?: unknown; error?: string; timestamp: string }
}
export const registeredTools = shallowRef<Tool[]>([])
export const toolInspector = reactive<ToolInspector>({availability:'local',names:[],validation:'pending'})

/** The inspector stays in memory and excludes credentials, screenshot payloads, and typed text. */
export function summarizeToolValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[nested content omitted]'
  if (typeof value === 'string') {
    if (/^[{[]/.test(value)) { try { return JSON.stringify(summarizeToolValue(JSON.parse(value),depth+1)) } catch { /* Keep plain text results readable. */ } }
    return value.startsWith('data:image/') ? '[image omitted]' : value.length > 1200 ? `${value.slice(0,1200)}…` : value
  }
  if (Array.isArray(value)) return value.slice(0,20).map(item=>summarizeToolValue(item,depth+1))
  if (value && typeof value === 'object') {
    if ('type' in value && value.type === 'image') return {type:'image',mimeType:'mimeType' in value?value.mimeType:undefined,data:'[image omitted]'}
    return Object.fromEntries(Object.entries(value).slice(0,40).map(([key,item])=>[key,/token|authorization|password|secret|api.?key/i.test(key) || (key==='text' && 'type' in value && value.type==='keyboard.type') ? '[redacted]' : summarizeToolValue(item,depth+1)]))
  }
  return value
}
