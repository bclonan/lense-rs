import { ref } from 'vue'
import type { useControlStore } from '../../stores/control'
import type { useBridgeStore } from '../../stores/bridge'
import type { Tool, ModelContext } from './types'
import { createLenseTools } from './tools'
import { registeredTools, toolInspector, summarizeToolValue } from './inspector'

declare global {interface Window {lense?:{tools:Tool[];call:(name:string,input?:Record<string,unknown>)=>Promise<unknown>}}}
export const webMcpState = ref('local')
export function registerWebMCP(control:ReturnType<typeof useControlStore>,bridge:ReturnType<typeof useBridgeStore>) {
  const tools = createLenseTools(control, bridge, () => webMcpState.value)
  let callSequence = 0
  const wrapped=tools.map(tool=>({...tool,execute:async(input:Record<string,unknown>,context?:{signal?:AbortSignal})=>{
    const sequence=++callSequence, timestamp=new Date().toISOString()
    toolInspector.lastCall={name:tool.name,input:summarizeToolValue(input),timestamp}
    let result: unknown
    try {if (context?.signal?.aborted) throw context.signal.reason; if (tool.name === 'desktop_status' || (tool.name === 'desktop_task' && ['query','queue'].includes(String(input.operation)))) await control.initialize(); result=JSON.parse(JSON.stringify(await tool.execute(input,context)??null))}catch(e){result={isError:true,content:[{type:'text',text:JSON.stringify({error:{code:e&&typeof e==='object'&&'code' in e?String(e.code):'OPERATION_FAILED',message:e instanceof Error?e.message:String(e)}})}]}}
    if(sequence===callSequence)toolInspector.lastCall={name:tool.name,input:summarizeToolValue(input),timestamp,result:summarizeToolValue(result),...(result&&typeof result==='object'&&'isError'in result&&result.isError?{error:'The tool returned a structured error. See the result for recovery details.'}:{})}
    return result
  }}))
  registeredTools.value=wrapped;toolInspector.names=wrapped.map(tool=>tool.name)
  window.lense={tools:wrapped,call:async(name,input={})=>{const tool=wrapped.find(t=>t.name===name);if(!tool)throw new Error('Unknown Lense tool.');return tool.execute(input)}}
  const context=(document as Document&{modelContext?:ModelContext}).modelContext||(navigator as Navigator&{modelContext?:ModelContext}).modelContext
  const controller=new AbortController()
  webMcpState.value='local';toolInspector.availability='local'
  if(context?.registerTool)Promise.all(wrapped.map(tool=>Promise.resolve().then(()=>context.registerTool(tool,{signal:controller.signal})))).then(()=>{webMcpState.value='native';toolInspector.availability='native'},()=>{webMcpState.value='registration failed';toolInspector.availability='registration failed'})
  return ()=>{controller.abort();wrapped.forEach(tool=>context?.unregisterTool?.(tool.name));registeredTools.value=[];toolInspector.names=[];delete window.lense}
}
