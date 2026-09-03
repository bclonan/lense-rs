<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowDown, ArrowUp, ArrowUpRight, Crosshair, Keyboard, MousePointer2, MoveRight, Send } from 'lucide-vue-next'
import type { DesktopAction, Point, Target } from '../types/protocol'

type SelectionKind = 'click' | 'drag-start' | 'drag-end'
const props = defineProps<{
  enabled: boolean
  point: Point | null
  dragEnd?: Point | null
  selecting: boolean
  selectionKind?: SelectionKind
  target: Target | null
  targetName?: string
  browserShare: boolean
  busy: boolean
  feedback?: string
  blockedReason?: string
}>()
const emit = defineEmits<{ action: [action: DesktopAction]; select: [kind: SelectionKind] }>()
const text = ref('Hello from Lense')
const tab = ref<'keyboard' | 'pointer'>('keyboard')
const pointerMode = ref<'click' | 'drag'>('click')
const button = ref<'left' | 'right' | 'middle'>('left')
const hotkey = ref('CTRL+S')
const durationMs = ref(500)
const canAct = computed(() => props.enabled && !props.busy && !props.browserShare)
const canType = computed(() => canAct.value && props.target?.type === 'window')
const canDrag = computed(() => canAct.value && !!props.point && !!props.dragEnd && Number.isInteger(durationMs.value) && durationMs.value >= 50 && durationMs.value <= 5000)
const targetLabel = computed(() => props.targetName || (props.target ? `${props.target.type === 'window' ? 'Window' : 'Monitor'} ${props.target.id}` : 'No target selected'))

function isSelecting(kind: SelectionKind) { return props.selecting && (props.selectionKind ?? 'click') === kind }
function coordinates(point?: Point | null) { return point ? `${point.x.toFixed(3)}, ${point.y.toFixed(3)}` : 'Not selected' }
function sendClick(double = false) {
  if (!canAct.value || !props.point || !props.target) return
  emit('action', { type: double ? 'pointer.doubleClick' : 'pointer.click', ...props.point, button: button.value, target: props.target })
}
function sendDrag() {
  if (!canDrag.value || !props.point || !props.dragEnd || !props.target) return
  emit('action', { type: 'pointer.drag', from: { ...props.point }, to: { ...props.dragEnd }, durationMs: durationMs.value, target: props.target })
}
</script>

<template>
  <section class="manual-panel panel" :aria-busy="busy" aria-label="Send desktop input">
    <div class="section-heading"><span class="eyebrow">DIRECT CONTROL</span><Keyboard :size="17" /></div>
    <div class="manual-title-row"><h2>Send an action</h2><span class="manual-target" :title="targetLabel">{{ targetLabel }}</span></div>
    <p class="manual-description">{{ blockedReason || (browserShare ? 'Live video is available to the agent. Choose Native target to pick input coordinates.' : enabled ? 'Choose the input, send it, then check the updated preview above.' : 'Pair the bridge and choose a monitor or window to send desktop input.') }}</p>
    <div class="control-tabs" aria-label="Input type">
      <button :class="{ active: tab === 'keyboard' }" :aria-pressed="tab === 'keyboard'" @click="tab = 'keyboard'"><Keyboard :size="14" />Keyboard</button>
      <button :class="{ active: tab === 'pointer' }" :aria-pressed="tab === 'pointer'" @click="tab = 'pointer'"><MousePointer2 :size="14" />Mouse</button>
    </div>
    <div v-if="tab === 'keyboard'" class="keyboard-controls">
      <p class="input-target-note">{{ target?.type === 'window' ? 'Use Mouse to choose the text field and Send click. Lense focuses this window before typing.' : 'Choose an app window for typing, shortcuts, and scrolling. This gives keyboard input a specific destination.' }}</p>
      <label for="desktop-text">Text to type</label>
      <textarea id="desktop-text" v-model="text" rows="2" placeholder="Type anything, including Unicode..." :disabled="!canType" />
      <button class="button button-primary" :disabled="!canType || !text" @click="emit('action', { type: 'keyboard.type', text })"><Send :size="14" />Type on desktop</button>
      <div class="keyboard-shortcuts">
        <div class="hotkey-row">
          <label for="hotkey-select" class="sr-only">Keyboard shortcut</label>
          <select id="hotkey-select" v-model="hotkey" :disabled="!canType">
            <option value="CTRL+S">Ctrl + S · Save</option><option value="CTRL+A">Ctrl + A · Select all</option><option value="CTRL+C">Ctrl + C · Copy</option><option value="CTRL+V">Ctrl + V · Paste</option><option value="CTRL+Z">Ctrl + Z · Undo</option><option value="ALT+TAB">Alt + Tab · Switch app</option>
          </select>
          <button class="button button-small" :disabled="!canType" @click="emit('action', { type: 'keyboard.hotkey', keys: hotkey.split('+') })">Send shortcut<ArrowUpRight :size="13" /></button>
        </div>
        <div class="key-buttons"><button v-for="key in ['ENTER', 'TAB', 'ESCAPE', 'BACKSPACE']" :key="key" :disabled="!canType" @click="emit('action', { type: 'keyboard.key', key })">{{ key === 'BACKSPACE' ? 'Backspace' : key.charAt(0) + key.slice(1).toLowerCase() }}</button></div>
      </div>
    </div>
    <div v-else class="pointer-controls">
      <div class="pointer-mode" aria-label="Mouse action">
        <button :class="{ active: pointerMode === 'click' }" :aria-pressed="pointerMode === 'click'" @click="pointerMode = 'click'">Click</button>
        <button :class="{ active: pointerMode === 'drag' }" :aria-pressed="pointerMode === 'drag'" @click="pointerMode = 'drag'">Drag</button>
      </div>
      <template v-if="pointerMode === 'click'">
        <button class="button choose-point" :class="{ active: isSelecting('click') }" :disabled="!canAct" @click="emit('select', 'click')"><Crosshair :size="15" />{{ isSelecting('click') ? 'Select a point on the preview' : 'Choose a click point' }}</button>
        <div class="point-readout"><span>X <b>{{ point ? point.x.toFixed(3) : '--' }}</b></span><span>Y <b>{{ point ? point.y.toFixed(3) : '--' }}</b></span><span>Normalized coordinates</span></div>
        <div class="click-row"><select v-model="button" aria-label="Mouse button" :disabled="!canAct"><option value="left">Left button</option><option value="right">Right button</option><option value="middle">Middle button</option></select><button class="button button-primary" :disabled="!canAct || !point" @click="sendClick()">Send click</button></div>
        <button class="text-button double-click" :disabled="!canAct || !point" @click="sendClick(true)">Send double click<ArrowUpRight :size="13" /></button>
      </template>
      <template v-else>
        <div class="drag-endpoints">
          <button class="button choose-point" :class="{ active: isSelecting('drag-start') }" :disabled="!canAct" @click="emit('select', 'drag-start')"><Crosshair :size="15" /><span>{{ isSelecting('drag-start') ? 'Pick start above' : 'Choose drag start' }}<small>{{ coordinates(point) }}</small></span></button>
          <MoveRight class="drag-direction" :size="17" />
          <button class="button choose-point" :class="{ active: isSelecting('drag-end') }" :disabled="!canAct" @click="emit('select', 'drag-end')"><Crosshair :size="15" /><span>{{ isSelecting('drag-end') ? 'Pick end above' : 'Choose drag end' }}<small>{{ coordinates(dragEnd) }}</small></span></button>
        </div>
        <div class="drag-send-row"><label for="drag-duration">Drag time <span><input id="drag-duration" v-model.number="durationMs" type="number" min="50" max="5000" step="50" :disabled="!canAct" /> ms</span></label><button class="button button-primary" :disabled="!canDrag" @click="sendDrag()"><MoveRight :size="14" />Send drag</button></div>
        <p class="fine-print">Choose both points, then Send drag holds the left mouse button between them.</p>
      </template>
      <div class="scroll-controls"><span>{{ target?.type === 'window' ? 'Scroll target window' : 'Choose a window to scroll' }}</span><button class="button button-small" :disabled="!canType" @click="emit('action', { type: 'scroll', deltaX: 0, deltaY: -600 })"><ArrowUp :size="14" />Up</button><button class="button button-small" :disabled="!canType" @click="emit('action', { type: 'scroll', deltaX: 0, deltaY: 600 })"><ArrowDown :size="14" />Down</button></div>
    </div>
    <p v-if="busy || feedback" class="input-feedback" role="status">{{ busy ? 'Sending input and reading the result...' : feedback }}</p>
  </section>
</template>

<style scoped>
.manual-title-row{display:flex;align-items:center;justify-content:space-between;gap:14px}.manual-title-row h2{flex-shrink:0}.manual-target{font-size:10px;color:#667d58;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid #dce4d1;border-radius:5px;background:#f3f6ec;padding:5px 7px;max-width:65%}.manual-description{font-size:10px}.input-target-note{font-size:10px;line-height:1.6;color:#6c7e60;margin:0 0 2px}.keyboard-shortcuts{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}.keyboard-shortcuts .hotkey-row,.keyboard-shortcuts .key-buttons{margin:0;align-items:stretch}.keyboard-shortcuts .hotkey-row select{min-width:0}.keyboard-shortcuts .key-buttons{gap:4px}.pointer-mode{display:flex;gap:5px;margin-bottom:10px}.pointer-mode button{border:1px solid #dce4d1;border-radius:6px;padding:7px 14px;font-size:10px;color:#7b8d6c}.pointer-mode button.active{background:#e7f0d6;border-color:#b7ca9c;color:#426230}.drag-endpoints{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:10px;align-items:center}.drag-endpoints .choose-point{white-space:normal;text-align:left;justify-content:flex-start}.drag-endpoints .choose-point>svg{flex-shrink:0}.drag-endpoints small{display:block;font-size:9px;color:#81956d;margin-top:4px;font-variant-numeric:tabular-nums}.drag-direction{color:#839970}.drag-send-row{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-top:13px}.drag-send-row label{display:flex;flex-direction:column;gap:5px;font-size:10px;color:#7b8f6b}.drag-send-row label span{display:flex;align-items:center;gap:5px}.drag-send-row input{width:83px;padding:7px;font-size:11px}.input-feedback{border-top:1px solid var(--line);padding-top:11px;margin-top:13px;font-size:10px;line-height:1.5;color:#5b7749}.pointer-controls .point-readout{margin:9px 0}
@media(max-width:1150px){.keyboard-shortcuts{grid-template-columns:1fr}.keyboard-shortcuts .key-buttons>button{padding:8px}}
@media(max-width:580px){.manual-title-row{align-items:flex-start;flex-direction:column;gap:8px}.manual-target{max-width:100%}.drag-endpoints{gap:5px}.drag-endpoints .choose-point{padding:10px 7px;gap:5px;font-size:10px}.drag-direction{width:13px}.keyboard-controls .button,.click-row .button,.drag-send-row .button{font-size:11px}.manual-panel{padding:18px}}
</style>
