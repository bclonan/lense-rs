import { defineStore } from 'pinia'
import { markRaw, ref } from 'vue'
import { BridgeClient } from '../services/bridge/client'
import { loopbackPermission } from '../services/bridge/permissions'
import type { BridgeStatus, DesktopWindow, Monitor, Session } from '../types/protocol'
export const useBridgeStore = defineStore('bridge',()=>{
  const client=markRaw(new BridgeClient())
  const status=ref<BridgeStatus|null>(null), session=ref<Session|null>(null), permission=ref('unsupported'), error=ref(''), connecting=ref(false)
  const monitors=ref<Monitor[]>([]), windows=ref<DesktopWindow[]>([])
  async function detect() {if(connecting.value)return;connecting.value=true;error.value='';try{permission.value=await loopbackPermission();status.value=await client.status()}catch(e){status.value=null;error.value=(e as Error).message}finally{connecting.value=false}}
  async function refreshTargets() {try{[monitors.value,windows.value]=await Promise.all([client.monitors(),client.windows()])}catch(e){error.value=(e as Error).message}}
  async function pair() {connecting.value=true;error.value='';try{session.value=await client.pair();await refreshTargets();permission.value=await loopbackPermission()}catch(e){error.value=(e as Error).message}finally{connecting.value=false}}
  async function unpair() {error.value='';try{await client.unpair()}catch(e){error.value=(e as Error).message+' Close the bridge window or press Ctrl+Alt+Escape to revoke control locally.'}finally{session.value=null;monitors.value=[];windows.value=[]}}
  client.subscribe(event=>{if(event.type==='bridge.disconnected'){session.value=null;error.value='The native event connection closed. Pair again before sending input.'}})
  if(typeof window!=='undefined') {
    const detection=window.setInterval(()=>{if(!status.value&&!connecting.value&&permission.value!=='denied')void detect()},5000)
    window.addEventListener('pagehide',()=>clearInterval(detection),{once:true})
  }
  return {client,status,session,permission,error,connecting,monitors,windows,detect,pair,unpair,refreshTargets}
})
