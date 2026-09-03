import type { ActionResult, BridgeStatus, CaptureOptions, DesktopAction, DesktopAdapter, DesktopWindow, LenseEvent, Monitor, Observation, Session, Target, WatchSpec } from '../../types/protocol'
import { BridgeError, validateAction, validateRegion, validateTarget } from './protocol'
import { loopbackPermission, loopbackRequestOptions } from './permissions'
import { BridgeEvents } from './websocket'

export const BRIDGE_PORTS = [17373, 17374, 17375] as const

export class BridgeClient implements DesktopAdapter {
  private session:Session|null = null
  private controlDisabled = true
  private target:Target = {type:'monitor',id:'primary'}
  private events = new BridgeEvents()
  private controllers = new Set<AbortController>()
  private targetRevision = 0
  private actionTail: Promise<unknown> = Promise.resolve()
  private endpoint:string
  private readonly candidates:string[]
  private discovered = false
  private discovery?:Promise<BridgeStatus>
  private pairing?:Promise<Session>
  private generation = 0
  get base() { return this.endpoint }
  constructor(base = import.meta.env.VITE_BRIDGE_URL || 'http://127.0.0.1:17373') {
    const url = new URL(base)
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !BRIDGE_PORTS.some(port => String(port) === url.port) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new BridgeError('INVALID_BRIDGE_URL','The bridge must use 127.0.0.1 on port 17373, 17374, or 17375.')
    this.endpoint = url.origin
    this.candidates = [url.origin, ...BRIDGE_PORTS.map(port => `http://127.0.0.1:${port}`).filter(candidate => candidate !== url.origin)]
    this.events.subscribe(event=>{if(event.type==='bridge.disconnected'){this.controlDisabled=true;void this.unpair().catch(()=>{/* The user can always revoke locally with the emergency shortcut. */})}})
  }
  setTarget(target:Target) {validateTarget(target); if (target.type !== this.target.type || target.id !== this.target.id) this.targetRevision++; this.target = {...target}}
  private async request<T>(path:string, method='GET', body?:unknown, signal?:AbortSignal, publicRequest=false, endpoint=this.base, timeoutMs=path==='/v1/pair'?120000:15000):Promise<T> {
    if (!publicRequest && (!this.session || (this.controlDisabled && path!=='/v1/unpair'))) throw new BridgeError('NOT_PAIRED','Pair the Windows bridge before controlling your desktop.')
    if (signal?.aborted) throw signal.reason
    const controller = new AbortController(); this.controllers.add(controller)
    const timeout = setTimeout(()=>controller.abort(new BridgeError('TIMEOUT','The bridge did not respond in time.')),timeoutMs)
    const abort = ()=>controller.abort(signal?.reason); signal?.addEventListener('abort',abort,{once:true})
    try {
      const response = await fetch(endpoint + path, {...loopbackRequestOptions(), method, cache:'no-store', credentials:'omit', signal:controller.signal, headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(!publicRequest && this.session?{Authorization:`Bearer ${this.session.token}`}:{})}, ...(body!==undefined?{body:JSON.stringify(body)}:{})})
      const payload = await response.json()
      if (!response.ok) throw new BridgeError(payload.error?.code || 'BRIDGE_ERROR',payload.error?.message || `Bridge request failed with ${response.status}.`)
      return payload as T
    } catch(error) {
      if (error instanceof BridgeError) throw error
      if (controller.signal.aborted) throw controller.signal.reason
      const permission = await loopbackPermission()
      throw new BridgeError(permission==='denied'?'LOOPBACK_PERMISSION_DENIED':'BRIDGE_NOT_FOUND',permission==='denied'?'Allow local network access for this site in your browser, then detect the bridge again.':'Lense cannot reach the bridge. Run LenseBridge on this Windows computer, allow the browser connection prompt, and check that this site is a trusted origin.')
    } finally {clearTimeout(timeout); signal?.removeEventListener('abort',abort); this.controllers.delete(controller)}
  }
  private validateStatus(value:unknown,endpoint=this.base):BridgeStatus {
    const status = value as Partial<BridgeStatus> | null
    if (!status || status.name !== 'LenseBridge' || status.platform !== 'windows' || typeof status.version !== 'string' || !Array.isArray(status.capabilities) || !['screen','pointer','keyboard','watches'].every(capability => status.capabilities!.includes(capability))) throw new BridgeError('NOT_LENSE_BRIDGE','Another app is using this local connection.')
    if (status.protocolVersion !== Number(import.meta.env.VITE_BRIDGE_PROTOCOL_VERSION || 1)) throw new BridgeError('PROTOCOL_MISMATCH','Download and run the current bridge, then detect again. The running bridge uses a different protocol.')
    return {...status, endpoint, port:Number(new URL(endpoint).port)} as BridgeStatus
  }
  async status():Promise<BridgeStatus> {
    // Never move an active session or an in-flight pairing request to another process.
    if (this.session || this.pairing) return this.validateStatus(await this.request('/v1/status','GET',undefined,undefined,true))
    if (this.discovery) return this.discovery
    const pending = this.discover(this.generation)
    this.discovery = pending
    try { return await pending } finally { if (this.discovery === pending) this.discovery = undefined }
  }
  private async discover(generation:number):Promise<BridgeStatus> {
    let mismatch:BridgeError | undefined
    this.discovered = false
    for (const endpoint of this.candidates) {
      try {
        const status = this.validateStatus(await this.request('/v1/status','GET',undefined,undefined,true,endpoint,2500),endpoint)
        if (generation !== this.generation) throw new BridgeError('CONTROL_DISABLED','Desktop control stopped.')
        this.endpoint = endpoint
        this.discovered = true
        return status
      } catch (error) {
        if (generation !== this.generation || (error instanceof BridgeError && ['LOOPBACK_PERMISSION_DENIED','CONTROL_DISABLED'].includes(error.code))) throw error
        if (error instanceof BridgeError && error.code === 'PROTOCOL_MISMATCH') mismatch = error
      }
    }
    throw mismatch || new BridgeError('BRIDGE_NOT_FOUND','Run the latest Windows bridge and keep its window open. Allow local network access if your browser asks, then select Detect bridge. Older companion apps can stay open.')
  }
  async pair():Promise<Session> {
    if (this.session && !this.controlDisabled) return this.session
    if (this.pairing) return this.pairing
    const pending = this.connect(this.generation)
    this.pairing = pending
    try { return await pending } finally { if (this.pairing === pending) this.pairing = undefined }
  }
  private async connect(generation:number):Promise<Session> {
    try {
      if (!this.discovered) await this.status()
      else this.validateStatus(await this.request('/v1/status','GET',undefined,undefined,true))
      if (generation !== this.generation) throw new BridgeError('CONTROL_DISABLED','Desktop control stopped.')
      const session = await this.request<Session>('/v1/pair','POST',{},undefined,true)
      if (generation !== this.generation) throw new BridgeError('CONTROL_DISABLED','Desktop control stopped.')
      this.session = session
      this.controlDisabled = false
      this.events.open(this.base,session.token)
      return session
    } catch(error) { this.discovered = false; throw error }
  }
  async unpair() {
    this.generation++
    this.discovered=false
    this.controlDisabled=true
    for (const controller of this.controllers) controller.abort(new BridgeError('CONTROL_DISABLED','Desktop control stopped.'))
    this.events.close()
    try {if (this.session) await this.request('/v1/unpair','POST',{})} finally {this.session=null}
  }
  monitors() {return this.request<Monitor[]>('/v1/monitors')}
  windows() {return this.request<DesktopWindow[]>('/v1/windows')}
  cursor() {return this.request<{x:number;y:number}>('/v1/cursor')}
  async observe(options:CaptureOptions={},signal?:AbortSignal) {
    if (options.region) validateRegion(options.region)
    const frame=await this.request<Observation>('/v1/screen','POST',{maxDimension:1280,quality:0.8,...options,target:options.target||this.target},signal)
    return frame
  }
  action(action:DesktopAction,signal?:AbortSignal):Promise<ActionResult> {
    validateAction(action)
    action = JSON.parse(JSON.stringify(action)) as DesktopAction
    const selected = {...this.target}, revision = this.targetRevision, generation = this.generation
    const inputTarget = ('target' in action && action.target) || selected
    const payload = action.type.startsWith('pointer.') ? {...action, target: inputTarget} : {...action}
    const assertCurrent = () => {
      if (signal?.aborted) throw signal.reason
      if (generation !== this.generation || this.controlDisabled) throw new BridgeError('CONTROL_DISABLED','Desktop control stopped.')
      if (revision !== this.targetRevision) throw new BridgeError('TARGET_CHANGED','The target changed before input was sent. Observe it again.')
    }
    // Keep focus + input together, including calls arriving from different tools.
    const pending = this.actionTail.then(async () => {
      assertCurrent()
      const keyboard = action.type.startsWith('keyboard.') || action.type === 'scroll'
      if (keyboard && inputTarget.type !== 'window') throw new BridgeError('WINDOW_REQUIRED','Choose an app window for typing, shortcuts, or scrolling so Lense can focus it first.')
      if (inputTarget.type === 'window' && action.type !== 'window.focus' && action.type !== 'pointer.move') {
        const focused = await this.request<ActionResult>('/v1/action','POST',{type:'window.focus',windowId:inputTarget.id},signal)
        if (!focused.ok) throw new BridgeError('FOCUS_FAILED','Windows did not focus the selected app. No input was sent.')
        assertCurrent()
      }
      const result = await this.request<ActionResult>('/v1/action','POST',payload,signal)
      if (!result.ok) throw new BridgeError('INPUT_FAILED','The bridge could not send this input. Check the target and try again.')
      return result
    })
    this.actionTail = pending.catch(() => undefined)
    return pending
  }
  createWatch(spec:WatchSpec) {return this.request<WatchSpec>('/v1/watches','POST',{...spec,target:spec.target||this.target})}
  watches() {return this.request<WatchSpec[]>('/v1/watches')}
  async removeWatch(id:string) {await this.request('/v1/watches/'+encodeURIComponent(id),'DELETE')}
  subscribe(listener:(event:LenseEvent)=>void) {return this.events.subscribe(listener)}
}
