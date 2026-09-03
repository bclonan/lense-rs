import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

async function call(page:Page,name:string,input:Record<string,unknown>={}) {
  return page.evaluate(({name,input})=>(window as any).lense.call(name,input),{name,input})
}
async function ready(page:Page) {
  await page.goto('/')
  await expect.poll(()=>page.evaluate(()=>!!(window as any).lense)).toBe(true)
  await expect.poll(async()=>(await call(page,'desktop_status')).observationId).toBeTruthy()
}
const config={goal:'Chop wood and recover after each tree depletes.',durationMs:30000,verification:{condition:'The character is actively chopping a tree',intervalMs:1000},invariants:['The selected application remains visible'],limits:{maxConsecutiveFailures:5,maxActionsPerMinute:30,confidenceThreshold:0.8}}

test('30-second visual task locates trees, recovers after depletion, completes and exports replay',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
  await ready(page)
  expect((await call(page,'desktop_status')).mode).toBe('lab')
  await page.getByLabel('Task duration in minutes').fill('0.5')
  await page.getByLabel('Verification interval in seconds').fill('1')
  await page.getByRole('button',{name:'Run this task'}).click()
  await expect.poll(async()=>(await call(page,'desktop_status')).task?.actions).toBeGreaterThan(0)
  const result=await call(page,'desktop_until',{condition:'character is chopping',intervalMs:500,timeoutMs:3000})
  expect(result.isError).not.toBe(true)
  await expect.poll(async()=>(await call(page,'desktop_status')).task?.recoveries,{timeout:22000}).toBeGreaterThan(0)
  await expect.poll(async()=>(await call(page,'desktop_status')).task?.state,{timeout:35000}).toBe('COMPLETED')
  const task=(await call(page,'desktop_status')).task
  expect(task.actions).toBeGreaterThan(2);expect(task.evaluations).toBeGreaterThan(3);expect(task.watchChecks).toBeGreaterThan(5)
  await page.getByRole('button',{name:'Export',exact:true}).click()
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download JSONL'}).click()
  const download=await pending;const path=await download.path();const events=(await readFile(path!,'utf8')).trim().split('\n').map(line=>JSON.parse(line))
  for(const type of ['observation.captured','plan.created','action.completed','evaluation.completed','recovery.started','recovery.completed','task.completed'])expect(events.some(e=>e.type===type),type).toBe(true)
  const clicks=events.filter(e=>e.type==='action.completed').map(e=>e.data.action).filter(a=>a?.type==='pointer.click')
  expect(new Set(clicks.map(a=>`${a.x},${a.y}`)).size).toBeGreaterThan(1)
  expect(events.some(e=>e.observation?.image.startsWith('data:image/'))).toBe(true)
  await page.reload();await expect.poll(async()=>(await call(page,'desktop_status')).task?.state).toBe('COMPLETED')
  expect(errors).toEqual([])
})

test('pause and refresh require explicit resume; stop prevents later input',async({page})=>{
  await ready(page);await call(page,'desktop_task',{operation:'start',config})
  await expect.poll(async()=>(await call(page,'desktop_status')).task?.actions).toBeGreaterThan(0)
  await call(page,'desktop_task',{operation:'pause'})
  expect((await call(page,'desktop_status')).task.state).toBe('PAUSED')
  const blocked=await call(page,'desktop_action',{type:'pointer.click',x:0.2,y:0.3});expect(blocked.isError).toBe(true)
  await page.reload();await expect.poll(async()=>(await call(page,'desktop_status')).task?.state).toBe('PAUSED')
  await call(page,'desktop_task',{operation:'resume'})
  await expect.poll(async()=>(await call(page,'desktop_status')).task?.state).not.toBe('PAUSED')
  await call(page,'desktop_task',{operation:'stop'})
  expect((await call(page,'desktop_status')).task.state).toBe('STOPPED')
  const later=await call(page,'desktop_action',{type:'pointer.click',x:0.7,y:0.4});expect(later.isError).toBe(true)
})

test('native tool registration uses the available browser API',async({page})=>{
  await page.addInitScript(()=>{(window as any).registered=[];Object.defineProperty(document,'modelContext',{value:{registerTool:(tool:unknown)=>{(window as any).registered.push(tool)},unregisterTool:()=>{}},configurable:true})})
  await ready(page)
  expect(await page.evaluate(()=>(window as any).registered.map((tool:any)=>tool.name))).toEqual(['desktop_status','desktop_observe','desktop_action','desktop_watch','desktop_task','desktop_until','osrs_reference'])
  const result=await page.evaluate(()=>(window as any).registered[0].execute({}))
  expect(result.webMcp).toBe('native');expect(result).not.toHaveProperty('token')
})

test('standalone game and disposable native-input target render at mobile size',async({page})=>{
  await page.goto('/lab');await expect(page.getByLabel('Woodcutting Lab game')).toBeVisible()
  await page.goto('/input-lab');await page.getByLabel('Native typing test editor').fill('Hello 世界 🌲');await page.getByLabel('Native typing test editor').press('Control+s');await expect(page.getByRole('status')).toContainText('Ctrl+S received')
  await page.getByRole('button',{name:'Show test dialog'}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button',{name:'Close test dialog'}).click()
  await page.setViewportSize({width:390,height:844});await ready(page)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1)).toBe(true)
})

test('page help follows the current view and explains setup, device selection and task control',async({page})=>{
  await ready(page)
  const toggle=page.getByRole('button',{name:'Help for this page',exact:true})
  await expect(toggle).toHaveAttribute('aria-expanded','false')
  await expect(page.locator('#page-guide')).toHaveCount(0)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded','true')
  const guide=page.locator('#page-guide')
  await expect(guide.getByRole('heading',{name:'Your first run takes 30 seconds.',exact:true})).toBeVisible()
  await expect(guide.getByText('Set a short first run', {exact:true})).toBeVisible()
  await expect(guide).toContainText('does not control Windows or require the bridge')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded','false')
  await expect(guide).toHaveCount(0)
  await toggle.click()
  await page.keyboard.press('Escape')
  await expect(toggle).toHaveAttribute('aria-expanded','false')
  await expect(toggle).toBeFocused()
  await toggle.click()

  await page.getByRole('button',{name:'Windows desktop',exact:true}).click()
  await expect(guide.getByRole('heading',{name:'Pair, choose a window, then try one action.',exact:true})).toBeVisible()
  await expect(guide.getByRole('heading',{name:'Which device do I choose?',exact:true})).toBeVisible()
  await expect(guide).toContainText('Choose an app window to type')
  await expect(guide).toContainText('Starting a task waits for that agent')
  await expect(guide.getByRole('link',{name:'Open input lab',exact:true})).toHaveAttribute('href','/input-lab')
  await guide.getByRole('button',{name:'Open connection setup',exact:true}).click()
  await expect(guide.getByRole('heading',{name:'Connect this computer, then choose an app.',exact:true})).toBeVisible()
  for(const step of ['Check the Windows download status','Detect the bridge','Pair this browser','Choose what Lense controls']){
    await expect(guide.getByRole('heading',{name:step,exact:true})).toBeVisible()
  }
  await expect(guide).toContainText('Browser network permission and Windows approval are separate steps')
  await expect(guide).toContainText('Download 1.0.1 is paused')
  await expect(guide.getByRole('link',{name:'Windows download status',exact:true})).toHaveAttribute('href','/bridge-download-status.html')
  await expect(page.locator('a[download]')).toHaveCount(0)

  await page.getByRole('button',{name:'Demo playbook',exact:true}).click()
  await expect(guide.getByRole('heading',{name:'Try the browser lab, then real desktop input.',exact:true})).toBeVisible()
  await guide.getByRole('button',{name:'Try the browser lab',exact:true}).click()
  await expect(guide.getByRole('heading',{name:'Your first run takes 30 seconds.',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Event history',exact:true}).click()
  await expect(guide.getByRole('heading',{name:'Review what happened, frame by frame.',exact:true})).toBeVisible()
  await expect(guide).toContainText('Pairing permission does not survive a refresh')
  await guide.getByRole('button',{name:'Close page help',exact:true}).click()
  await expect(toggle).toHaveAttribute('aria-expanded','false')
  await expect(toggle).toBeFocused()

  await page.setViewportSize({width:390,height:844})
  await toggle.click()
  await expect(guide).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1)).toBe(true)
  await page.getByRole('button',{name:'Desktop bridge',exact:true}).click()
  await expect(guide.getByRole('heading',{name:'Connect this computer, then choose an app.',exact:true})).toBeVisible()
  await expect(guide.getByRole('heading',{name:'Which device do I choose?',exact:true})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1)).toBe(true)
})
