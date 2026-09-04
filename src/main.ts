import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { useControlStore } from './stores/control'
import { useBridgeStore } from './stores/bridge'
import { registerWebMCP } from './services/webmcp/register'
import { applyPageMetadata } from './site/metadata'

applyPageMetadata(location.pathname)

if (location.pathname === '/research' || location.pathname === '/research/') {
  const { default: AotPage } = await import('./pages/AotPage.vue')
  createApp(AotPage).mount('#app')
} else if(location.pathname==='/osrs' || location.pathname==='/osrs/') {
  const [{ default: OsrsReference }, { registerOsrsReference }] = await Promise.all([import('./osrs/OsrsReference.vue'), import('./services/webmcp/osrs')])
  document.title = 'OSRS field guide | Lense'
  createApp(OsrsReference).mount('#app')
  const cleanup = registerOsrsReference()
  window.addEventListener('pagehide', cleanup, { once: true })
} else if(location.pathname==='/input-lab') {
  const {mountInputLab}=await import('./input-lab')
  mountInputLab(document.querySelector('#app')!)
} else if(location.pathname==='/lab') {
  const {mountLab}=await import('./lab/WoodcuttingLab')
  document.title='Woodcutting Lab | Lense'
  document.body.style.cssText='margin:0;background:#0b1813;color:#eaf0e5;font:15px system-ui;display:grid;place-items:center;min-height:100vh'
  document.querySelector('#app')!.innerHTML='<main style="max-width:1100px;width:96vw"><header style="display:flex;justify-content:space-between;align-items:center;padding:16px 0"><div><strong>Woodcutting Lab</strong><span style="color:#91ab9c;margin-left:18px">Click a tree to chop. Trees regrow.</span></div><a style="color:#c0de77" href="/">Open Lense</a></header><canvas aria-label="Woodcutting Lab game" style="display:block;width:100%;border:1px solid #304c3a;border-radius:12px"></canvas><p style="color:#91ab9c">A standalone visual application. Select this window in Lense to control it with the Windows bridge.</p></main>'
  const lab=mountLab(document.querySelector('canvas')!)
  window.addEventListener('pagehide',()=>lab.dispose(),{once:true})
} else {
  const app=createApp(App)
  const pinia=createPinia()
  app.use(pinia)
  app.mount('#app')

  const resourceNav = document.querySelector<HTMLElement>('.resource-nav')
  if (resourceNav && !resourceNav.querySelector('[data-research-link]')) {
    const researchLink = document.createElement('a')
    researchLink.href = '/research'
    researchLink.textContent = 'Research'
    researchLink.dataset.researchLink = ''
    researchLink.setAttribute('aria-label', 'Lense-AOT research direction')
    const hackathonLink = resourceNav.querySelector<HTMLAnchorElement>('a[href="/hackathon"]')
    resourceNav.insertBefore(researchLink, hackathonLink)
  }

  const cleanup=registerWebMCP(useControlStore(pinia),useBridgeStore(pinia))
  window.addEventListener('pagehide',event=>{if(!event.persisted)cleanup()})
}
