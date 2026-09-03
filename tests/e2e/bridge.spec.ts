import { expect, test } from '@playwright/test'

test('bridge detection, human pairing, capture, unicode input, hotkeys and STOP use authenticated transport',async({page})=>{
  const actions:any[]=[];let paired=false;let unpaired=false;let image='';let captures=0;let captureFailure=false
  await page.route('http://127.0.0.1:17373/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname
    const headers={'Access-Control-Allow-Origin':'http://127.0.0.1:4174','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS','Access-Control-Allow-Private-Network':'true'}
    if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers});return}
    let body:unknown
    if(path==='/v1/status')body={name:'LenseBridge',version:'1.0.0',protocolVersion:1,platform:'windows',capabilities:['screen','pointer','keyboard','watches']}
    else if(path==='/v1/pair'){paired=true;body={id:'session-test',token:'test-token',origin:'http://127.0.0.1:4174',createdAt:new Date().toISOString(),scopes:['screen.read','pointer','keyboard','windows.read']}}
    else {
      if(!paired||request.headers().authorization!=='Bearer test-token'){await route.fulfill({status:401,headers,json:{error:{code:'INVALID_TOKEN',message:'Pair first'}}});return}
      if(path==='/v1/monitors')body=[{id:'primary',name:'Mock monitor',x:-1920,y:0,width:1920,height:1080,scaleFactor:1.25,primary:true}]
      else if(path==='/v1/windows')body=[{id:'123',title:'Disposable editor',x:-1600,y:10,width:960,height:600}]
      else if(path==='/v1/screen'){if(captureFailure){await route.fulfill({status:503,headers,json:{error:{code:'CAPTURE_FAILED',message:'Test capture unavailable'}}});return}captures++;body={id:crypto.randomUUID(),timestamp:new Date().toISOString(),target:request.postDataJSON().target,nativeWidth:960,nativeHeight:600,width:960,height:600,mimeType:'image/png',image}}
      else if(path==='/v1/action'){const action=request.postDataJSON();actions.push(action);body={id:crypto.randomUUID(),ok:true,startedAt:new Date().toISOString(),completedAt:new Date().toISOString(),action,result:{test:true}}}
      else if(path==='/v1/unpair'){unpaired=true;paired=false;body={ok:true}}
      else body=[]
    }
    await route.fulfill({status:200,headers,json:body})
  })
  await page.routeWebSocket('ws://127.0.0.1:17373/v1/events',socket=>{socket.onMessage(data=>{expect(JSON.parse(String(data)).token).toBe('test-token')})})
  await page.goto('/')
  await expect.poll(()=>page.evaluate(()=>!!(window as any).lense)).toBe(true)
  const frame=await page.evaluate(()=>(window as any).lense.call('desktop_observe',{}))
  image='data:image/png;base64,'+frame.content.find((item:any)=>item.type==='image').data
  await page.getByRole('button',{name:'Desktop bridge',exact:true}).click()
  await page.getByRole('button',{name:/Pair desktop/}).click()
  await expect.poll(()=>paired).toBe(true)
  await page.getByLabel('Capture & input target').selectOption('window:123')
  await page.getByRole('button',{name:'Go to desktop controls',exact:true}).click()
  await expect(page.getByLabel('Capture & input target')).toHaveValue('window:123')
  await expect(page.getByRole('button',{name:'Type on desktop'})).toBeEnabled()
  const captureBefore=captures
  await expect.poll(()=>captures).toBeGreaterThan(captureBefore+1)
  await page.getByLabel('Preview interval').selectOption('0')
  actions.length=0
  await page.getByLabel('Text to type').fill('Hello from Lense, 世界 🌲')
  await page.getByRole('button',{name:'Type on desktop'}).click()
  await expect.poll(()=>actions.length).toBeGreaterThanOrEqual(2)
  expect(actions[0]).toEqual({type:'window.focus',windowId:'123'})
  expect(actions[1]).toEqual({type:'keyboard.type',text:'Hello from Lense, 世界 🌲'})
  await page.getByRole('button',{name:'Send shortcut',exact:true}).click()
  await expect.poll(()=>actions.some(action=>action.type==='keyboard.hotkey')).toBe(true)
  await expect(page.getByRole('status').filter({hasText:'Result captured'})).toBeVisible()
  await page.getByRole('button',{name:'Mouse',exact:true}).click()
  await page.getByRole('button',{name:'Choose a click point',exact:true}).click()
  const preview=page.locator('.screen-image-wrap').first()
  let bounds=await preview.boundingBox()
  await preview.click({position:{x:bounds!.width*.25,y:bounds!.height*.3}})
  await page.getByRole('button',{name:'Send click',exact:true}).click()
  await expect.poll(()=>actions.some(action=>action.type==='pointer.click')).toBe(true)
  const clicked=actions.find(action=>action.type==='pointer.click')
  expect(clicked.x).toBeCloseTo(.25,2);expect(clicked.y).toBeCloseTo(.3,2)
  expect(actions[actions.indexOf(clicked)-1]).toEqual({type:'window.focus',windowId:'123'})
  await page.getByRole('button',{name:'Drag',exact:true}).click()
  await page.getByRole('button',{name:/Choose drag start/}).click()
  bounds=await preview.boundingBox()
  await preview.click({position:{x:bounds!.width*.2,y:bounds!.height*.4}})
  await page.getByRole('button',{name:/Choose drag end/}).click()
  await preview.click({position:{x:bounds!.width*.7,y:bounds!.height*.6}})
  await page.getByRole('button',{name:'Send drag',exact:true}).click()
  await expect.poll(()=>actions.some(action=>action.type==='pointer.drag')).toBe(true)
  const dragged=actions.find(action=>action.type==='pointer.drag')
  expect(dragged.from.x).toBeCloseTo(.2,2);expect(dragged.to.x).toBeCloseTo(.7,2)
  expect(dragged.durationMs).toBe(500);expect(dragged.target).toEqual({type:'window',id:'123'})
  await expect(page.getByRole('status').filter({hasText:'pointer.drag sent'})).toBeVisible()
  const combined=await page.evaluate(()=>(window as any).lense.call('desktop_action',{type:'keyboard.key',key:'ENTER',observeAfter:true,settleMs:0}))
  expect(combined.ok).toBe(true);expect(combined.observation.target).toEqual({type:'window',id:'123'})
  expect(combined.content.some((item:any)=>item.type==='image')).toBe(true)
  const last=actions.slice(-2)
  expect(last).toEqual([{type:'window.focus',windowId:'123'},{type:'keyboard.key',key:'ENTER'}])
  await page.screenshot({path:'artifacts/input-feedback-desktop.png',fullPage:true})
  await page.setViewportSize({width:390,height:844})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:'artifacts/input-feedback-mobile.png',fullPage:true})
  captureFailure=true
  const beforeFailure=actions.length
  const captureFailed=await page.evaluate(()=>(window as any).lense.call('desktop_action',{type:'keyboard.key',key:'TAB',observeAfter:true,settleMs:0}))
  expect(captureFailed.ok).toBe(true);expect(captureFailed.observationError).toContain('Test capture unavailable')
  expect(actions.length).toBe(beforeFailure+2)
  captureFailure=false
  const beforeDelayed=actions.length
  await page.evaluate(()=>{(window as any).__feedbackPending=(window as any).lense.call('desktop_action',{type:'keyboard.key',key:'ENTER',observeAfter:true,settleMs:1500})})
  await expect.poll(()=>actions.length).toBe(beforeDelayed+2)
  const switched=await page.evaluate(()=>(window as any).lense.call('desktop_observe',{source:'native',target:{type:'monitor',id:'primary'}}))
  const switchedId=JSON.parse(switched.content.find((part:any)=>part.type==='text').text).id
  const staleFeedback=await page.evaluate(()=>(window as any).__feedbackPending)
  expect(staleFeedback.ok).toBe(true);expect(staleFeedback.observationError).toContain('target or task changed')
  const switchedStatus=await page.evaluate(()=>(window as any).lense.call('desktop_status',{}))
  expect(switchedStatus.observationId).toBe(switchedId)
  await expect(page.getByLabel('Capture & input target')).toHaveValue('monitor:primary')
  await page.getByRole('button',{name:'Stop control',exact:true}).click()
  await expect.poll(()=>unpaired).toBe(true)
  const result=await page.evaluate(()=>(window as any).lense.call('desktop_action',{type:'keyboard.type',text:'blocked'}))
  expect(result.isError).toBe(true)
  expect(actions.filter(a=>a.text==='blocked')).toHaveLength(0)
})

test('an older companion on the first port never receives pairing, tokens or desktop input',async({page})=>{
  const requests:{port:string;path:string;method:string;authorization?:string}[]=[]
  const actions:Record<string,unknown>[]=[]
  const sockets:{port:string;token:string}[]=[]
  const activeWatches:Record<string,unknown>[]=[]
  let primaryNowCompatible=false,paired=false,unpaired=false,image=''
  const bridgeStatus={name:'LenseBridge',version:'1.0.0',protocolVersion:1,platform:'windows',capabilities:['screen','pointer','keyboard','watches']}
  const headers={'Access-Control-Allow-Origin':'http://127.0.0.1:4174','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS','Access-Control-Allow-Private-Network':'true'}
  await page.route(/^http:\/\/127\.0\.0\.1:1737[345]\//,async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname
    requests.push({port:url.port,path,method:request.method(),authorization:request.headers().authorization})
    if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers});return}
    if(url.port==='17373'){
      if(path!=='/v1/status'||request.method()!=='GET'){
        await route.fulfill({status:409,headers,json:{error:{code:'WRONG_SERVICE',message:'This is the older companion.'}}});return
      }
      await route.fulfill({status:200,headers,json:primaryNowCompatible?bridgeStatus:{...bridgeStatus,name:'LenseDesktopControlPoC'}});return
    }
    if(url.port==='17375'){await route.abort('connectionrefused');return}
    let body:unknown
    if(path==='/v1/status')body=bridgeStatus
    else if(path==='/v1/pair'){
      paired=true
      body={id:'fallback-session',token:'fallback-token',origin:'http://127.0.0.1:4174',createdAt:new Date().toISOString(),scopes:['screen.read','pointer','keyboard','windows.read']}
    }else{
      if(!paired||request.headers().authorization!=='Bearer fallback-token'){
        await route.fulfill({status:401,headers,json:{error:{code:'INVALID_TOKEN',message:'Pair first'}}});return
      }
      if(path==='/v1/monitors')body=[{id:'primary',name:'Fallback monitor',x:0,y:0,width:1920,height:1080,scaleFactor:1,primary:true}]
      else if(path==='/v1/windows')body=[{id:'456',title:'Fallback disposable editor',x:0,y:0,width:960,height:600}]
      else if(path==='/v1/screen')body={id:crypto.randomUUID(),timestamp:new Date().toISOString(),target:{type:'window',id:'456'},nativeWidth:960,nativeHeight:600,width:960,height:600,mimeType:'image/png',image}
      else if(path==='/v1/action'){
        const action=request.postDataJSON();actions.push(action)
        body={id:crypto.randomUUID(),ok:true,startedAt:new Date().toISOString(),completedAt:new Date().toISOString(),action,result:{test:true}}
      }else if(path==='/v1/watches'&&request.method()==='POST'){
        const watch=request.postDataJSON();activeWatches.push(watch);body=watch
      }else if(path==='/v1/watches')body=activeWatches
      else if(path==='/v1/watches/fallback-watch'&&request.method()==='DELETE'){activeWatches.splice(0);body={ok:true}}
      else if(path==='/v1/unpair'){unpaired=true;paired=false;body={ok:true}}
      else body=[]
    }
    await route.fulfill({status:200,headers,json:body})
  })
  await page.routeWebSocket(/^ws:\/\/127\.0\.0\.1:1737[345]\/v1\/events$/,socket=>{
    socket.onMessage(data=>sockets.push({port:new URL(socket.url()).port,token:JSON.parse(String(data)).token}))
  })
  await page.goto('/')
  await expect.poll(()=>page.evaluate(()=>!!(window as any).lense)).toBe(true)
  const frame=await page.evaluate(()=>(window as any).lense.call('desktop_observe',{}))
  image='data:image/png;base64,'+frame.content.find((item:any)=>item.type==='image').data
  await page.getByRole('button',{name:'Windows desktop',exact:true}).click()
  await page.getByRole('button',{name:/Pair desktop/}).click()
  await expect.poll(()=>sockets).toEqual([{port:'17374',token:'fallback-token'}])
  const connection=await page.evaluate(()=>(window as any).lense.call('desktop_status',{}))
  expect(connection.bridge.endpoint).toBe('http://127.0.0.1:17374')
  await page.getByLabel('Capture & input target').selectOption('window:456')
  primaryNowCompatible=true
  await page.getByRole('button',{name:'Refresh capture targets'}).click()
  actions.length=0
  await page.getByLabel('Text to type').fill('Typed through the available bridge.')
  await page.getByRole('button',{name:'Type on desktop'}).click()
  await expect.poll(()=>actions.length).toBeGreaterThanOrEqual(2)
  expect(actions[0]).toEqual({type:'window.focus',windowId:'456'})
  expect(actions[1]).toEqual({type:'keyboard.type',text:'Typed through the available bridge.'})
  const watchResult=await page.evaluate(()=>(window as any).lense.call('desktop_watch',{operation:'create',watch:{id:'fallback-watch',intervalMs:1000,mode:'visual-change',threshold:0.08}}))
  expect(watchResult).toMatchObject({id:'fallback-watch',target:{type:'window',id:'456'}})
  const queried=await page.evaluate(()=>(window as any).lense.call('desktop_watch',{operation:'query'}))
  expect(queried).toHaveLength(1)
  await page.evaluate(()=>(window as any).lense.call('desktop_watch',{operation:'remove',id:'fallback-watch'}))
  await page.getByRole('button',{name:'Stop control',exact:true}).click()
  await expect.poll(()=>unpaired).toBe(true)
  const blocked=await page.evaluate(()=>(window as any).lense.call('desktop_action',{type:'keyboard.type',text:'must not type'}))
  expect(blocked.isError).toBe(true)
  expect(actions.filter(action=>action.text==='must not type')).toHaveLength(0)
  const oldRequests=requests.filter(request=>request.port==='17373'&&request.method!=='OPTIONS')
  expect(oldRequests.length).toBeGreaterThan(0)
  expect(oldRequests.every(request=>request.path==='/v1/status'&&request.method==='GET'&&!request.authorization)).toBe(true)
  const authenticated=requests.filter(request=>request.authorization)
  expect(authenticated.length).toBeGreaterThan(5)
  expect(authenticated.every(request=>request.port==='17374'&&request.authorization==='Bearer fallback-token')).toBe(true)
  for(const path of ['/v1/pair','/v1/screen','/v1/action','/v1/watches','/v1/unpair']){
    expect(requests.some(request=>request.port==='17374'&&request.path===path),path).toBe(true)
  }
})
