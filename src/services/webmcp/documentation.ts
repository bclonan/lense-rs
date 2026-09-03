import { computed } from 'vue'
import { Validator, type Schema } from '@cfworker/json-schema'
import type { Tool } from './types'
import { registeredTools, toolInspector } from './inspector'
export type { ToolInspector } from './inspector'

export interface ToolDoc {
  name: string; title: string; description: string
  classification: 'read-only' | 'mutating' | 'destructive' | 'approval-required'
  inputSchema: Record<string, unknown>; exampleArguments: Record<string, unknown>; exampleResult: unknown
  errors: {code:string;recovery:string}[]; state: string[]; source: string; prompt: string; safeRun: boolean
}
type Override = Partial<Omit<ToolDoc,'name'|'description'|'inputSchema'|'safeRun'>>
/** Optional editorial detail keyed by real tool name. This object never defines or registers tools. */
export const documentationOverrides: Record<string,Override> = {
  desktop_status: {
    title:'Inspect the shared control session', exampleArguments:{},
    exampleResult:{mode:'lab',paired:false,target:{type:'monitor',id:'lab'},task:null,queue:{items:[],running:false,repeat:false},observationId:'EXAMPLE_FRAME_ID',webMcp:'local'},
    state:['Reads the selected target, task, queue, pairing scopes, capture source, and registration state. No desktop input.'],
    errors:[{code:'CONTROL_DISABLED',recovery:'Reopen Control if the page session has closed.'}],
    prompt:'Check Lense status. Tell me the selected target, pairing state, and whether a task or queue is running. Do not start anything.',
  },
  desktop_observe: {
    title:'Read a current frame', exampleArguments:{source:'native',maxDimension:960,quality:.75},
    exampleResult:{content:[{type:'text',text:'{"id":"EXAMPLE_FRAME_ID","target":{"type":"monitor","id":"lab"},"width":960,"height":600,"source":"native","inputCoordinates":true}'},{type:'image',mimeType:'image/png',data:'BASE64_IMAGE_OMITTED'}]},
    state:['Records an observation and updates the preview/history. An explicit target also changes the selection and pauses active work. Browser-share frames do not identify native input coordinates.'],
    errors:[{code:'NOT_PAIRED',recovery:'Use the browser lab, or have the person pair the native bridge.'},{code:'CAPTURE_FAILED',recovery:'Check that the chosen window is visible and capture again.'},{code:'OPERATION_FAILED',recovery:'Start browser sharing before requesting source browser.'}],
    prompt:'Observe the current Lense target. Describe the visible state. Use source native before choosing input coordinates; never treat a browser-share frame as a mapped Windows target.',
  },
  desktop_action: {
    title:'Send one action and inspect its result', classification:'approval-required',
    exampleArguments:{type:'pointer.click',x:.5,y:.5,expectedTaskId:'EXAMPLE_TASK_ID',observationId:'EXAMPLE_FRAME_ID',observeAfter:true,settleMs:100},
    exampleResult:{id:'EXAMPLE_ACTION_ID',ok:true,action:{type:'pointer.click',x:.5,y:.5},observation:{id:'EXAMPLE_NEXT_FRAME_ID',target:{type:'window',id:'EXAMPLE_WINDOW_ID'},width:960,height:600}},
    state:['Sends real native input when paired, or a local lab action. Records the receipt and optional result frame. Native approval is required for pairing; it is not repeated for every authorized input.'],
    errors:[{code:'TASK_CONTEXT_REQUIRED',recovery:'Supply the current task ID and an observation ID returned for that task.'},{code:'STALE_OBSERVATION',recovery:'Observe the selected native target again and review the new image.'},{code:'WINDOW_REQUIRED',recovery:'Select an app window before keyboard or scroll input.'},{code:'FOCUS_FAILED',recovery:'Make the intended app available; no subsequent input was sent.'},{code:'RATE_LIMITED',recovery:'Pause and review the task limits before resuming.'},{code:'observationError',recovery:'The input already succeeded. Capture again without repeating the input.'}],
    prompt:'In the selected, authorized input-lab window, observe the editor, click its visible text field, type Hello from Lense, and use observeAfter true to check the result. Use current task and frame IDs when required. Stop if the target is uncertain.',
  },
  desktop_watch: {
    title:'Manage visual-change watches', classification:'mutating', exampleArguments:{operation:'query'}, exampleResult:[{id:'example-watch',target:{type:'window',id:'EXAMPLE_WINDOW_ID'},intervalMs:500,mode:'visual-change',threshold:.003}],
    state:['Query reads native watches. Create/remove change the paired bridge watch list; they do not send mouse or keyboard input.'],
    errors:[{code:'NOT_PAIRED',recovery:'Native watches require desktop mode and human pairing.'},{code:'OPERATION_FAILED',recovery:'Use a bounded interval, threshold, and valid watch ID.'}],
    prompt:'List the native visual watches in this Lense session. Explain their targets and intervals without creating or removing any watch.',
  },
  desktop_task: {
    title:'Coordinate a task or queue', classification:'approval-required', exampleArguments:{operation:'query'},
    exampleResult:{id:'EXAMPLE_TASK_ID',goal:'Chop wood in the included lab',state:'WAITING',runMode:'continuous',actions:2,observations:3,wakeSequence:4},
    state:['Shares task, queue, context notes, cadence, and wake events with the UI. Query/queue read state. Start/resume/run-queue authorize work. Stop revokes native access. Clear/remove discard queued entries. Refresh never resumes work.','Context replaces the saved context object. Read the current task and preserve existing fields when reporting new observations.'],
    errors:[{code:'INVALID_TASK',recovery:'Check the goal, duration, verification condition, monitoring, and limits.'},{code:'STALE_TASK',recovery:'Read desktop_status and use the current task ID.'},{code:'QUEUE_EMPTY',recovery:'Add a reviewed goal before running the queue.'},{code:'TASK_PAUSED',recovery:'Ask the person to review the paused work before resuming.'}],
    prompt:'Inspect the current Lense task and queue. Explain the next step and any pause reason. Do not resume, start, remove, or clear work without my direction.',
  },
  desktop_until: {
    title:'Wait for visible evidence', exampleArguments:{condition:'character is chopping',intervalMs:1000,timeoutMs:10000},
    exampleResult:{matched:true,evaluation:{condition:'character is chopping',result:true,confidence:.96,explanation:'The included lab shows the chopping indicator.'},observation:{id:'EXAMPLE_FRAME_ID',target:{type:'monitor',id:'lab'},image:'BASE64_IMAGE_OMITTED'},elapsedMs:1000},
    state:['Records observations and evaluation events while waiting. Does not send input. The built-in provider recognizes only the Woodcutting Lab.'],
    errors:[{code:'PROVIDER_UNAVAILABLE',recovery:'Use the included Lab provider or connect an evaluator for the selected application.'},{code:'TIMEOUT',recovery:'Inspect the latest frame and explain what prevented the expected condition.'}],
    prompt:'In the included Woodcutting Lab, wait up to 10 seconds for the character to be visibly chopping. Check every second. Report the evidence or timeout without sending input.',
  },
  osrs_reference: {
    title:'Look up OSRS reference notes', source:'src/services/webmcp/osrs.ts', exampleArguments:{operation:'search',query:'bank',kind:'visual',limit:3},
    exampleResult:{items:[{id:'EXAMPLE_REFERENCE_ID',kind:'visual',title:'Bank interface',summary:'Reference cues, not current game state.'}],total:1,offset:0,nextOffset:null,checkedAt:'2026-09-03'},
    state:['Reads the local reference catalog. Optional get/includeImages reads user-saved IndexedDB screenshot examples. Never pairs, sends input, or infers live character state.'],
    errors:[{code:'INVALID_REFERENCE_QUERY',recovery:'Use search with bounded query/limit, or get with an ID returned by search.'},{code:'REFERENCE_NOT_FOUND',recovery:'Search again and use an existing entry ID.'}],
    prompt:'Search the OSRS visual dictionary for bank cues. Read one matching entry and explain how to distinguish it from similar interfaces. Do not control the game.',
  },
}

function schemaExample(schema: Record<string,unknown>): unknown {
  if ('const' in schema) return schema.const
  if (Array.isArray(schema.enum)) return schema.enum[0]
  const variants = schema.oneOf || schema.anyOf
  if (Array.isArray(variants) && variants.length) return schemaExample(variants[0])
  if (schema.type === 'object' || schema.properties) {
    const properties = (schema.properties || {}) as Record<string,Record<string,unknown>>
    return Object.fromEntries(((schema.required || []) as string[]).filter(key=>properties[key]).map(key=>[key,schemaExample(properties[key]!)]))
  }
  if (schema.type === 'array') return Array.from({length:typeof schema.minItems==='number'?schema.minItems:0},()=>schemaExample((schema.items || {}) as Record<string,unknown>))
  if (schema.type === 'integer' || schema.type === 'number') return typeof schema.minimum==='number'?schema.minimum:0
  if (schema.type === 'boolean') return false
  if (schema.type === 'null') return null
  return 'example'.padEnd(typeof schema.minLength==='number'?schema.minLength:0,'x').slice(0,typeof schema.maxLength==='number'?schema.maxLength:100)
}
export function documentationMayRun(name:string,args:Record<string,unknown>): boolean {
  if (name==='desktop_status') return Object.keys(args).length===0
  if (name==='desktop_task') return ['query','queue'].includes(String(args.operation)) && Object.keys(args).length===1
  if (name==='desktop_watch') return args.operation==='query' && Object.keys(args).length===1
  return name==='osrs_reference' && ['search','get'].includes(String(args.operation)) && args.includeImages!==true
}
export function describeTools(tools:Tool[]): ToolDoc[] {
  return tools.map(tool=>{
    const curated = documentationOverrides[tool.name] || {}
    const exampleArguments = curated.exampleArguments || schemaExample(tool.inputSchema) as Record<string,unknown>
    return {name:tool.name,title:tool.name.replaceAll('_',' '),description:tool.description,inputSchema:tool.inputSchema,
      classification:tool.annotations?.readOnlyHint?'read-only':'mutating',exampleArguments,
      exampleResult:{notice:'Illustrative result. Run a reviewed read-only example for the current session.'},
      errors:[{code:'OPERATION_FAILED',recovery:'Read the structured error, check the schema, and inspect current state before retrying.'}],
      state:['See the canonical description for application state and permission requirements.'],source:'src/services/webmcp/tools.ts',
      prompt:`Use ${tool.name} to ${tool.description.split('.')[0]!.replace(/^./,character=>character.toLowerCase())}. Review its schema and any approval boundary before acting.`,
      ...curated,safeRun:documentationMayRun(tool.name,exampleArguments),
    } as ToolDoc
  })
}
export function validateToolArguments(schema:Record<string,unknown>,args:unknown): {valid:boolean;errors:string[]} {
  try {const result=new Validator(schema as Schema,'7',false).validate(args);return {valid:result.valid,errors:result.errors.map(error=>`${error.instanceLocation}: ${error.error}`)}}
  catch(error){return {valid:false,errors:[error instanceof Error?error.message:String(error)]}}
}
export const documentationTools = computed(()=>describeTools(registeredTools.value))
export function checkDocumentationSchemas() {
  toolInspector.validation=registeredTools.value.length && documentationTools.value.every(tool=>validateToolArguments(tool.inputSchema,tool.exampleArguments).valid)?'valid':'invalid'
}
export async function runDocumentationTool(name:string,args:Record<string,unknown>) {
  const tool=registeredTools.value.find(tool=>tool.name===name)
  if (!tool) throw new Error('This tool is not registered in the current application shell.')
  const validation=validateToolArguments(tool.inputSchema,args)
  if (!validation.valid) throw new Error(validation.errors.join('\n'))
  if (!documentationMayRun(name,args)) throw new Error('Preview only. Review this action in Control before executing it.')
  return tool.execute(args)
}
