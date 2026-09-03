import { describe, expect, it, vi, afterEach } from 'vitest'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { createLenseTools } from './tools'
import { describeTools, documentationMayRun, documentationOverrides, runDocumentationTool, validateToolArguments } from './documentation'
import { registeredTools, summarizeToolValue } from './inspector'
import { workflows, promptLibrary } from '../../pages/webmcp-content'
import { getYouTubeEmbedUrl, demoSegments } from '../../pages/hackathon'
import type { Tool } from './types'

const tools=createLenseTools({} as never,{} as never)
const docs=describeTools(tools)
const ajv=new Ajv({strict:false,allErrors:true});addFormats(ajv)

afterEach(()=>{registeredTools.value=[]})
describe('documentation from the canonical registry',()=>{
  it('documents every tool exactly once and keeps every schema and description authoritative',()=>{
    expect(docs.map(doc=>doc.name)).toEqual(tools.map(tool=>tool.name))
    expect(new Set(docs.map(doc=>doc.name)).size).toBe(tools.length)
    for(const tool of tools){const doc=docs.find(item=>item.name===tool.name)!;expect(doc.inputSchema).toBe(tool.inputSchema);expect(doc.description).toBe(tool.description);expect(doc.prompt.length).toBeGreaterThan(20);expect(doc.errors.length).toBeGreaterThan(0)}
    for(const name of Object.keys(documentationOverrides))expect(tools.some(tool=>tool.name===name),`orphan documentation override ${name}`).toBe(true)
  })
  it('validates every tool schema and representative example with a full JSON Schema validator',()=>{
    for(const doc of docs){expect(ajv.validateSchema(doc.inputSchema),doc.name).toBe(true);const validate=ajv.compile(doc.inputSchema);expect(validate(doc.exampleArguments),`${doc.name}: ${ajv.errorsText(validate.errors)}`).toBe(true);expect(validateToolArguments(doc.inputSchema,doc.exampleArguments).valid,doc.name).toBe(true)}
  })
  it('validates every chain step and rejects references to nonexistent tools',()=>{
    expect(workflows.length).toBeGreaterThanOrEqual(5)
    for(const workflow of workflows){expect(workflow.approval).toBeTruthy();expect(workflow.partialFailure).toBeTruthy();for(const step of workflow.steps){const tool=tools.find(tool=>tool.name===step.tool);expect(tool,`${workflow.name}: ${step.tool}`).toBeDefined();const validate=ajv.compile(tool!.inputSchema);expect(validate(step.args),`${workflow.name}: ${step.tool}: ${ajv.errorsText(validate.errors)}`).toBe(true)}}
    for(const prompt of promptLibrary)for(const name of prompt.tools)expect(tools.some(tool=>tool.name===name),`${prompt.id}: ${name}`).toBe(true)
  })
  it('automatically creates documentation and a prompt for a newly defined tool',()=>{
    const added:Tool={name:'example_future_tool',description:'Inspect a local demo item.',inputSchema:{type:'object',properties:{id:{type:'string',minLength:2}},required:['id']},annotations:{readOnlyHint:true},execute:async()=>({})}
    const newDoc=describeTools([...tools,added]).at(-1)!
    expect(newDoc.name).toBe(added.name);expect(newDoc.prompt).toContain(added.name);expect(newDoc.safeRun).toBe(false);expect(validateToolArguments(newDoc.inputSchema,newDoc.exampleArguments).valid).toBe(true)
  })
  it('runs only schema-valid reviewed read-only operations even if a caller changes the arguments',async()=>{
    const execute=vi.fn().mockResolvedValue({task:null})
    registeredTools.value=tools.map(tool=>({...tool,execute}))
    await runDocumentationTool('desktop_task',{operation:'query'})
    expect(execute).toHaveBeenCalledTimes(1)
    for(const operation of ['start','stop','resume','run-queue','clear-queue'])await expect(runDocumentationTool('desktop_task',{operation})).rejects.toThrow('Preview only')
    await expect(runDocumentationTool('desktop_status',{surprise:true})).rejects.toThrow()
    await expect(runDocumentationTool('desktop_action',{type:'keyboard.type',text:'must not run'})).rejects.toThrow('Preview only')
    expect(documentationMayRun('osrs_reference',{operation:'get',id:'visual-bank',includeImages:true})).toBe(false)
    expect(execute).toHaveBeenCalledTimes(1)
  })
  it('redacts tokens, typed input and screenshot payloads from the in-memory inspector',()=>{
    const result=JSON.stringify(summarizeToolValue({token:'secret-value',action:{type:'keyboard.type',text:'private typed message'},content:[{type:'image',mimeType:'image/png',data:'private pixels'},{type:'text',text:JSON.stringify({token:'nested-secret'})}]}))
    for(const secret of ['secret-value','private typed message','private pixels','nested-secret'])expect(result).not.toContain(secret)
  })
})
describe('recording readiness',()=>{
  it('supports configured YouTube URLs and never turns a placeholder or arbitrary URL into an embed',()=>{
    expect(getYouTubeEmbedUrl('[YOUTUBE_URL]')).toBeNull()
    for(const value of ['https://youtu.be/abcdefghijk','https://www.youtube.com/watch?v=abcdefghijk','https://youtube.com/embed/abcdefghijk'])expect(getYouTubeEmbedUrl(value)).toBe('https://www.youtube-nocookie.com/embed/abcdefghijk')
    for(const value of ['https://youtube.com.evil.test/watch?v=abcdefghijk','javascript:alert(1)','http://youtube.com/watch?v=abcdefghijk','https://user:password@youtube.com/watch?v=abcdefghijk','https://youtube.com/watch?v=short'])expect(getYouTubeEmbedUrl(value)).toBeNull()
  })
  it('provides a complete 2:50 narration at the requested speaking pace',()=>{
    expect(demoSegments).toHaveLength(6)
    const words=demoSegments.map(segment=>segment.narration).join(' ').trim().split(/\s+/).length
    expect(words).toBeGreaterThanOrEqual(369);expect(words).toBeLessThanOrEqual(425)
    for(const segment of demoSegments){expect(segment.action).toBeTruthy();expect(segment.tools).toBeTruthy();expect(segment.result).toBeTruthy()}
  })
})
