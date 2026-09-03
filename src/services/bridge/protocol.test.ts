import { describe, expect, it, vi, afterEach } from 'vitest'
import { validateAction, validateRegion } from './protocol'
import { loopbackPermission } from './permissions'
import { BridgeClient } from './client'
describe('strict visual input protocol',()=>{
  it('accepts unicode typing and normalized negative-monitor-independent input',()=>{
    expect(()=>validateAction({type:'keyboard.type',text:'Hello, 世界 🌲'})).not.toThrow()
    expect(()=>validateAction({type:'pointer.click',x:0,y:1,target:{type:'monitor',id:'left-display'}})).not.toThrow()
  })
  it('rejects nonfinite/outside coordinates and executable payloads',()=>{
    for(const input of [{type:'pointer.click',x:NaN,y:0.4},{type:'pointer.move',x:-0.1,y:0},{type:'keyboard.type',text:'hi',command:'run'},{type:'shell',command:'x'},{type:'pointer.drag',from:{x:0,y:0},to:{x:1,y:1},durationMs:6000}])expect(()=>validateAction(input)).toThrow()
  })
  it('rejects regions extending beyond the captured image',()=>{
    expect(()=>validateRegion({x:0.9,y:0,width:0.2,height:0.1})).toThrow()
    expect(()=>validateRegion({x:0,y:0,width:1,height:1})).not.toThrow()
  })
  it('restricts bridge destinations to the three reserved loopback ports',()=>{
    for(const url of ['https://example.com','http://localhost:17373','http://127.0.0.1:9000','http://127.0.0.1:17374/path','http://127.0.0.1:17375?token=x','http://user@127.0.0.1:17374'])expect(()=>new BridgeClient(url)).toThrow()
    for(const port of [17373,17374,17375])expect(()=>new BridgeClient(`http://127.0.0.1:${port}`)).not.toThrow()
  })
})
describe('browser permissions',()=>{
  afterEach(()=>vi.unstubAllGlobals())
  it('survives unsupported permission names',async()=>{
    vi.stubGlobal('navigator',{permissions:{query:vi.fn().mockRejectedValue(new TypeError('unsupported'))}})
    expect(await loopbackPermission()).toBe('unsupported')
  })
  it('reports denied without obscuring the state',async()=>{
    vi.stubGlobal('navigator',{permissions:{query:vi.fn().mockResolvedValue({state:'denied'})}})
    expect(await loopbackPermission()).toBe('denied')
  })
})
