import { afterEach, describe, expect, it, vi } from 'vitest'
import { BridgeClient } from './client'
import type { DesktopAction } from '../../types/protocol'

const current = { name:'LenseBridge', version:'1.0.0', protocolVersion:1, platform:'windows', capabilities:['screen','pointer','keyboard','watches'] }
const session = { id:'test-session', token:'secret-test-token', origin:'https://lense-visual-control.netlify.app', scopes:['screen.read','keyboard','pointer'], createdAt:new Date().toISOString() }
const response = (body:unknown) => Promise.resolve(new Response(JSON.stringify(body),{status:200}))

describe('bounded bridge discovery',()=>{
  afterEach(()=>vi.unstubAllGlobals())

  it('skips an incompatible companion and keeps all authenticated requests on the paired port',async()=>{
    let oldNowCompatible = false
    const sockets:string[] = []
    vi.stubGlobal('WebSocket',class { constructor(url:URL){sockets.push(String(url))} close(){} })
    const fetch = vi.fn((url:string,options:RequestInit)=>{
      const endpoint = new URL(url)
      if(endpoint.pathname === '/v1/status') return response(endpoint.port === '17373' && !oldNowCompatible ? {...current,name:'LegacyCompanion'} : current)
      if(endpoint.pathname === '/v1/pair') return response(session)
      return response({ok:true})
    })
    vi.stubGlobal('fetch',fetch)
    const client = new BridgeClient()
    await client.pair()
    expect(client.base).toBe('http://127.0.0.1:17374')
    oldNowCompatible = true
    await client.status()
    client.setTarget({type:'window',id:'A1'})
    await client.action({type:'keyboard.type',text:'test'})
    await client.unpair()
    expect(sockets).toEqual(['ws://127.0.0.1:17374/v1/events'])
    const oldRequests = fetch.mock.calls.filter(([url])=>new URL(url).port === '17373')
    expect(oldRequests).toHaveLength(1)
    expect(oldRequests[0]![0]).toBe('http://127.0.0.1:17373/v1/status')
    expect(oldRequests[0]![1].headers).not.toHaveProperty('Authorization')
    for(const [url,options] of fetch.mock.calls.filter(([,options])=>'Authorization' in (options.headers || {}))) {
      expect(new URL(url).port).toBe('17374')
      expect(options.headers).toHaveProperty('Authorization','Bearer secret-test-token')
    }
  })

  it('tries the last reserved port after malformed and unavailable responses',async()=>{
    const fetch = vi.fn((url:string)=>{
      const port = new URL(url).port
      if(port === '17373') return response(null)
      if(port === '17374') return Promise.reject(new TypeError('connection refused'))
      return response(current)
    })
    vi.stubGlobal('fetch',fetch)
    const client = new BridgeClient()
    expect(await client.status()).toMatchObject({...current,endpoint:'http://127.0.0.1:17375',port:17375})
    expect(client.base).toBe('http://127.0.0.1:17375')
    expect(fetch.mock.calls.map(([url])=>new URL(url).port)).toEqual(['17373','17374','17375'])
  })

  it('does not send pairing to a wrong-protocol service or scan beyond the reserved ports',async()=>{
    const fetch = vi.fn(()=>response({...current,protocolVersion:99}))
    vi.stubGlobal('fetch',fetch)
    await expect(new BridgeClient().pair()).rejects.toMatchObject({code:'PROTOCOL_MISMATCH'})
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(fetch.mock.calls.every((args:any)=>args[1].method === 'GET')).toBe(true)
  })

  it('stops discovery immediately when browser local network access is denied',async()=>{
    vi.stubGlobal('navigator',{permissions:{query:vi.fn().mockResolvedValue({state:'denied'})}})
    const fetch = vi.fn().mockRejectedValue(new TypeError('blocked'))
    vi.stubGlobal('fetch',fetch)
    await expect(new BridgeClient().status()).rejects.toMatchObject({code:'LOOPBACK_PERMISSION_DENIED'})
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('rechecks a discovered process before sending pairing',async()=>{
    const fetch = vi.fn().mockImplementationOnce(()=>response(current)).mockImplementation(()=>response({...current,name:'ReplacementService'}))
    vi.stubGlobal('fetch',fetch)
    const client = new BridgeClient()
    await client.status()
    await expect(client.pair()).rejects.toMatchObject({code:'NOT_LENSE_BRIDGE'})
    expect(fetch.mock.calls.every(([,options])=>options.method === 'GET')).toBe(true)
  })

  it('a stop during discovery prevents a delayed response from starting pairing',async()=>{
    let finish!:(value:Response)=>void
    const fetch = vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve}))
    vi.stubGlobal('fetch',fetch)
    const client = new BridgeClient()
    const pairing = client.pair()
    const rejected = expect(pairing).rejects.toMatchObject({code:'CONTROL_DISABLED'})
    await client.unpair()
    finish(new Response(JSON.stringify(current)))
    await rejected
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

async function pairedWindow(onAction?: (action: DesktopAction, options: RequestInit) => Promise<Response>) {
  const actions: DesktopAction[] = []
  vi.stubGlobal('WebSocket', class { close() {} })
  const fetch = vi.fn((url: string, options: RequestInit) => {
    const path = new URL(url).pathname
    if (path === '/v1/status') return response(current)
    if (path === '/v1/pair') return response(session)
    if (path === '/v1/action') {
      const action = JSON.parse(options.body as string) as DesktopAction
      actions.push(action)
      return onAction?.(action, options) ?? response({ok: true})
    }
    return response({ok: true})
  })
  vi.stubGlobal('fetch', fetch)
  const client = new BridgeClient()
  await client.pair()
  client.setTarget({type: 'window', id: 'A1'})
  return { client, actions, fetch }
}

describe('focused desktop input', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps each focus and input together when two callers submit actions concurrently', async () => {
    const focusStarted = deferred<void>(), finishFocus = deferred<Response>()
    let firstFocus = true
    const {client, actions} = await pairedWindow(action => {
      if (action.type === 'window.focus' && firstFocus) {
        firstFocus = false
        focusStarted.resolve()
        return finishFocus.promise
      }
      return response({ok: true})
    })
    const typing = client.action({type: 'keyboard.type', text: 'Hello 世界'})
    const dragging = client.action({type: 'pointer.drag', from: {x: .1, y: .2}, to: {x: .7, y: .8}, durationMs: 300})
    await focusStarted.promise
    expect(actions).toEqual([{type: 'window.focus', windowId: 'A1'}])
    finishFocus.resolve(new Response(JSON.stringify({ok: true})))
    await Promise.all([typing, dragging])
    expect(actions).toEqual([
      {type: 'window.focus', windowId: 'A1'},
      {type: 'keyboard.type', text: 'Hello 世界'},
      {type: 'window.focus', windowId: 'A1'},
      {type: 'pointer.drag', from: {x: .1, y: .2}, to: {x: .7, y: .8}, durationMs: 300, target: {type: 'window', id: 'A1'}},
    ])
  })

  it('snapshots nested coordinates and the target before an action waits in the queue', async () => {
    const focusStarted = deferred<void>(), finishFocus = deferred<Response>()
    let firstFocus = true
    const {client, actions} = await pairedWindow(action => {
      if (action.type === 'window.focus' && firstFocus) {
        firstFocus = false
        focusStarted.resolve()
        return finishFocus.promise
      }
      return response({ok: true})
    })
    const first = client.action({type: 'keyboard.key', key: 'Enter'})
    await focusStarted.promise
    const drag: Extract<DesktopAction, {type: 'pointer.drag'}> = {
      type: 'pointer.drag', from: {x: .1, y: .2}, to: {x: .7, y: .8}, durationMs: 300,
      target: {type: 'window', id: 'B2'},
    }
    const queued = client.action(drag)
    drag.from.x = .9
    drag.to.y = .1
    drag.target!.id = 'C3'
    finishFocus.resolve(new Response(JSON.stringify({ok: true})))
    await Promise.all([first, queued])
    expect(actions.slice(2)).toEqual([
      {type: 'window.focus', windowId: 'B2'},
      {type: 'pointer.drag', from: {x: .1, y: .2}, to: {x: .7, y: .8}, durationMs: 300, target: {type: 'window', id: 'B2'}},
    ])
  })

  it.each<DesktopAction>([
    {type: 'keyboard.type', text: 'test'},
    {type: 'keyboard.key', key: 'Enter'},
    {type: 'keyboard.hotkey', keys: ['Ctrl', 'A']},
    {type: 'scroll', deltaX: 0, deltaY: 120},
  ])('rejects $type on a monitor before sending native input', async action => {
    const {client, actions} = await pairedWindow()
    client.setTarget({type: 'monitor', id: 'primary'})
    await expect(client.action(action)).rejects.toMatchObject({code: 'WINDOW_REQUIRED'})
    expect(actions).toEqual([])
  })

  it.each([
    {body: {ok: false}, status: 200, code: 'FOCUS_FAILED'},
    {body: {error: {code: 'INPUT_FAILED', message: 'Windows denied focus'}}, status: 500, code: 'INPUT_FAILED'},
  ])('does not send typing after a focus failure with status $status', async ({body, status, code}) => {
    const {client, actions} = await pairedWindow(() => Promise.resolve(new Response(JSON.stringify(body), {status})))
    await expect(client.action({type: 'keyboard.type', text: 'Must not be typed'})).rejects.toMatchObject({code})
    expect(actions).toEqual([{type: 'window.focus', windowId: 'A1'}])
  })

  it('checks cancellation again after focus completes even if transport ignores abort', async () => {
    const focusStarted = deferred<void>(), finishFocus = deferred<Response>()
    const {client, actions} = await pairedWindow(() => {
      focusStarted.resolve()
      return finishFocus.promise
    })
    const controller = new AbortController(), stopped = new Error('User stopped this action')
    const outcome = expect(client.action({type: 'pointer.click', x: .5, y: .5}, controller.signal)).rejects.toBe(stopped)
    await focusStarted.promise
    controller.abort(stopped)
    finishFocus.resolve(new Response(JSON.stringify({ok: true})))
    await outcome
    expect(actions).toEqual([{type: 'window.focus', windowId: 'A1'}])
  })

  it('does not start a queued action that was cancelled while another action was focusing', async () => {
    const focusStarted = deferred<void>(), finishFocus = deferred<Response>()
    let firstFocus = true
    const {client, actions} = await pairedWindow(action => {
      if (action.type === 'window.focus' && firstFocus) {
        firstFocus = false
        focusStarted.resolve()
        return finishFocus.promise
      }
      return response({ok: true})
    })
    const first = client.action({type: 'keyboard.key', key: 'Enter'})
    const controller = new AbortController(), stopped = new Error('Cancelled before sending')
    const queued = expect(client.action({type: 'keyboard.type', text: 'Stale queued input'}, controller.signal)).rejects.toBe(stopped)
    await focusStarted.promise
    controller.abort(stopped)
    finishFocus.resolve(new Response(JSON.stringify({ok: true})))
    await Promise.all([first, queued])
    expect(actions).toEqual([{type: 'window.focus', windowId: 'A1'}, {type: 'keyboard.key', key: 'Enter'}])
  })

  it('discards old active and queued input after the selected target changes', async () => {
    const focusStarted = deferred<void>(), finishFocus = deferred<Response>()
    let firstFocus = true
    const {client, actions} = await pairedWindow(action => {
      if (action.type === 'window.focus' && firstFocus) {
        firstFocus = false
        focusStarted.resolve()
        return finishFocus.promise
      }
      return response({ok: true})
    })
    const first = client.action({type: 'keyboard.type', text: 'Old target'})
    const queued = client.action({type: 'pointer.click', x: .2, y: .3})
    const outcomes = Promise.allSettled([first, queued])
    await focusStarted.promise
    client.setTarget({type: 'window', id: 'B2'})
    finishFocus.resolve(new Response(JSON.stringify({ok: true})))
    expect(await outcomes).toEqual([
      {status: 'rejected', reason: expect.objectContaining({code: 'TARGET_CHANGED'})},
      {status: 'rejected', reason: expect.objectContaining({code: 'TARGET_CHANGED'})},
    ])
    expect(actions).toEqual([{type: 'window.focus', windowId: 'A1'}])
    await client.action({type: 'keyboard.key', key: 'Space'})
    expect(actions.slice(1)).toEqual([{type: 'window.focus', windowId: 'B2'}, {type: 'keyboard.key', key: 'Space'}])
  })

  it('unpair cancels active focus and queued input without sending their payloads', async () => {
    const focusStarted = deferred<void>(), finishFocus = deferred<Response>()
    let requestSignal: AbortSignal | null | undefined
    const {client, actions, fetch} = await pairedWindow((_action, options) => {
      requestSignal = options.signal
      focusStarted.resolve()
      return finishFocus.promise
    })
    const outcomes = Promise.allSettled([
      client.action({type: 'keyboard.type', text: 'Must not run after stop'}),
      client.action({type: 'pointer.click', x: .3, y: .4}),
    ])
    await focusStarted.promise
    await client.unpair()
    expect(requestSignal?.aborted).toBe(true)
    finishFocus.resolve(new Response(JSON.stringify({ok: true})))
    expect(await outcomes).toEqual([
      {status: 'rejected', reason: expect.objectContaining({code: 'CONTROL_DISABLED'})},
      {status: 'rejected', reason: expect.objectContaining({code: 'CONTROL_DISABLED'})},
    ])
    expect(actions).toEqual([{type: 'window.focus', windowId: 'A1'}])
    expect(fetch.mock.calls.filter(([url]) => new URL(url).pathname === '/v1/unpair')).toHaveLength(1)
  })

  it('a failed focus does not prevent a later queued action from running', async () => {
    let firstFocus = true
    const {client, actions} = await pairedWindow(action => {
      if (action.type === 'window.focus' && firstFocus) {
        firstFocus = false
        return response({ok: false})
      }
      return response({ok: true})
    })
    const failed = expect(client.action({type: 'keyboard.type', text: 'Rejected'})).rejects.toMatchObject({code: 'FOCUS_FAILED'})
    const next = client.action({type: 'pointer.click', x: .2, y: .3})
    await Promise.all([failed, next])
    expect(actions).toEqual([
      {type: 'window.focus', windowId: 'A1'},
      {type: 'window.focus', windowId: 'A1'},
      {type: 'pointer.click', x: .2, y: .3, target: {type: 'window', id: 'A1'}},
    ])
  })

  it('preserves explicit pointer targets and avoids focus for pointer movement', async () => {
    const {client, actions} = await pairedWindow()
    await client.action({type: 'pointer.move', x: .1, y: .2})
    await client.action({type: 'pointer.click', x: .3, y: .4, target: {type: 'window', id: 'B2'}})
    client.setTarget({type: 'monitor', id: 'left'})
    await client.action({type: 'pointer.click', x: .6, y: .7})
    expect(actions).toEqual([
      {type: 'pointer.move', x: .1, y: .2, target: {type: 'window', id: 'A1'}},
      {type: 'window.focus', windowId: 'B2'},
      {type: 'pointer.click', x: .3, y: .4, target: {type: 'window', id: 'B2'}},
      {type: 'pointer.click', x: .6, y: .7, target: {type: 'monitor', id: 'left'}},
    ])
  })
})
