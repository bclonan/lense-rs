import type { LenseEvent } from '../../types/protocol'
export class BridgeEvents {
  private socket?: WebSocket
  private listeners = new Set<(event: LenseEvent) => void>()
  private retry?: ReturnType<typeof setTimeout>
  private generation = 0
  open(base: string, token: string) {
    this.close()
    const generation = this.generation
    const connect = () => {
      if (generation !== this.generation) return
      const url = new URL('/v1/events', base); url.protocol = 'ws:'
      const socket = this.socket = new WebSocket(url)
      socket.onopen = () => socket.send(JSON.stringify({token}))
      socket.onmessage = message => {
        try {
          const parsed = JSON.parse(message.data)
          if(parsed.error){this.notify('bridge.disconnected',{message:parsed.error.message,code:parsed.error.code});if(parsed.error.code==='INVALID_TOKEN')this.close();return}
          const event = parsed as LenseEvent
          if (typeof event.type === 'string') this.listeners.forEach(fn => fn(event))
        } catch { this.notify('bridge.error', {message:'The bridge sent an unreadable event.'}) }
      }
      socket.onerror = () => this.notify('bridge.error',{message:'The event connection was interrupted.'})
      socket.onclose = event => {
        if (generation !== this.generation) return
        this.notify('bridge.disconnected', {message:'The native event connection closed.'})
        if (event.code !== 1008) this.retry = setTimeout(connect, 3000)
      }
    }
    connect()
  }
  private notify(type:string, data:Record<string,unknown>) {
    const event = {id:crypto.randomUUID(), timestamp:new Date().toISOString(), type, data}
    this.listeners.forEach(fn=>fn(event))
  }
  subscribe(listener:(event:LenseEvent)=>void) { this.listeners.add(listener); return ()=>{this.listeners.delete(listener)} }
  close() { this.generation++; clearTimeout(this.retry); this.socket?.close(); this.socket = undefined }
}
