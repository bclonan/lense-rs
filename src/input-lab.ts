export function mountInputLab(root:HTMLElement) {
  document.title='Input Lab | Lense'
  document.body.style.cssText='margin:0;background:#f4f4ec;color:#18372a;font:16px system-ui'
  root.innerHTML=`<main style="max-width:920px;margin:40px auto;padding:24px"><a href="/" style="color:inherit">Back to Lense</a><h1>Desktop input lab</h1><p>A disposable page for testing real Windows typing, hotkeys, drawing, scrolling, and dialogs.</p><label for="editor">Text editor</label><textarea id="editor" aria-label="Native typing test editor" style="display:block;box-sizing:border-box;width:100%;height:180px;margin:12px 0;font:24px system-ui;padding:16px" placeholder="Click here in the captured preview, then type Hello from Lense."></textarea><p id="receipt" role="status">No keyboard shortcut received yet.</p><button id="dialog-button" style="padding:12px 18px">Show test dialog</button><dialog><h2>The expected dialog is visible</h2><p>Observe this state, then close the dialog.</p><button id="close-dialog">Close test dialog</button></dialog><h2>Drawing canvas</h2><canvas width="860" height="340" aria-label="Native drag test canvas" style="background:white;border:1px solid #aaa;width:100%;touch-action:none"></canvas><p id="paint-status">Drag across the canvas to leave a stroke.</p><div style="height:700px;border-left:2px dashed #afbfac;padding:20px">Scroll down to find the green marker.</div><div style="background:#256d42;color:white;padding:28px">Scroll verification marker reached.</div></main>`
  const dialog=root.querySelector('dialog')!
  root.querySelector('#dialog-button')!.addEventListener('click',()=>dialog.showModal())
  root.querySelector('#close-dialog')!.addEventListener('click',()=>dialog.close())
  window.addEventListener('keydown',event=>{
    if(event.ctrlKey&&event.key.toLowerCase()==='s'){event.preventDefault();root.querySelector('#receipt')!.textContent='Ctrl+S received. This disposable test page does not write a file.'}
  })
  const canvas=root.querySelector('canvas')!,context=canvas.getContext('2d')!
  let drawing=false,strokes=0
  const point=(e:PointerEvent)=>{const rect=canvas.getBoundingClientRect();return {x:(e.clientX-rect.left)*canvas.width/rect.width,y:(e.clientY-rect.top)*canvas.height/rect.height}}
  canvas.addEventListener('pointerdown',event=>{drawing=true;canvas.setPointerCapture(event.pointerId);const p=point(event);context.beginPath();context.moveTo(p.x,p.y)})
  canvas.addEventListener('pointermove',event=>{if(!drawing)return;const p=point(event);context.lineWidth=5;context.strokeStyle='#287546';context.lineCap='round';context.lineTo(p.x,p.y);context.stroke()})
  canvas.addEventListener('pointerup',()=>{drawing=false;root.querySelector('#paint-status')!.textContent=`${++strokes} stroke recorded.`})
}
