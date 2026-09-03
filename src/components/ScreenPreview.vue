<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Crosshair, Expand, MousePointer2, ScanLine } from 'lucide-vue-next'
import type { Annotation, Observation, Point } from '../types/protocol'

const props = defineProps<{
  observation: Observation | null
  annotations?: Annotation[]
  clickPoint?: Point | null
  dragEnd?: Point | null
  selectionKind?: 'click' | 'drag-start' | 'drag-end'
  mode: 'lab' | 'desktop'
  replay: boolean
  selectEnabled: boolean
  liveStream?: MediaStream | null
  frameStatus?: string
  captureBusy?: boolean
}>()
const emit = defineEmits<{ select: [point: Point]; observe: []; expand: [] }>()
const video = ref<HTMLVideoElement | null>(null)
const videoReady = ref(false)
const isBrowserShare = computed(() => props.observation?.target.id === 'browser-share')
const showVideo = computed(() => !!props.liveStream && isBrowserShare.value && !props.replay)
const canSelect = computed(() => props.selectEnabled && !!props.observation && !props.replay && !isBrowserShare.value)
const size = computed(() => props.observation ? `${props.observation.nativeWidth} × ${props.observation.nativeHeight}` : 'No capture yet')
const selectionLabel = computed(() => props.selectionKind === 'drag-start' ? 'Click the drag start in the image.' : props.selectionKind === 'drag-end' ? 'Click the drag end in the image.' : 'Click the image to choose a point.')
function toDisplayPoint(point?: Point | null) {
  if (!point) return null
  const region = props.observation?.region
  if (!region) return point
  const local = { x: (point.x - region.x) / region.width, y: (point.y - region.y) / region.height }
  return local.x >= 0 && local.x <= 1 && local.y >= 0 && local.y <= 1 ? local : null
}
const displayPoint = computed(() => toDisplayPoint(props.clickPoint))
const displayDragEnd = computed(() => toDisplayPoint(props.dragEnd))
const showDrag = computed(() => !!props.dragEnd && props.selectionKind !== 'click')
watch([video, () => props.liveStream], ([element, stream]) => {
  videoReady.value = false
  if (!element) return
  element.srcObject = stream ?? null
  if (stream) void element.play().then(() => {
    if (video.value === element && element.srcObject === stream) videoReady.value = true
  }).catch(() => { /* Keep the captured image visible when playback cannot start. */ })
}, { flush: 'post' })
function selectPoint(event: MouseEvent) {
  if (!canSelect.value) return
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  if (!bounds.width || !bounds.height) return
  const local = { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) }
  emitLocalPoint(local)
}
function emitLocalPoint(point: Point) {
  if (!canSelect.value) return
  const region = props.observation?.region
  emit('select', region ? { x: region.x + point.x * region.width, y: region.y + point.y * region.height } : point)
}
</script>

<template>
  <section class="preview-panel" aria-label="Screen observation">
    <div class="preview-toolbar">
      <div class="preview-title"><span class="signal-dot" :class="{ muted: replay || !observation }" />{{ replay ? 'Recorded observation' : isBrowserShare ? 'Browser screen share' : mode === 'lab' ? 'Woodcutting lab' : 'Desktop observation' }}<span class="preview-tag">{{ isBrowserShare ? videoReady ? 'LIVE VIDEO' : 'SHARED FRAME' : mode === 'lab' ? 'DEMO' : 'WINDOWS' }}</span></div>
      <div class="preview-tools"><span>{{ size }}</span><button class="icon-button" title="Capture a new observation" aria-label="Capture a new observation" :disabled="captureBusy" @click="emit('observe')"><ScanLine :size="17" /></button><button class="icon-button" title="Expand preview" aria-label="Expand preview" @click="emit('expand')"><Expand :size="16" /></button></div>
    </div>
    <div class="preview-stage">
      <div v-if="observation" class="screen-image-wrap" :class="{ selectable: canSelect }" :style="{ aspectRatio: `${observation.width} / ${observation.height}` }" :role="canSelect ? 'button' : undefined" :tabindex="canSelect ? 0 : undefined" :aria-label="canSelect ? `${selectionLabel} Press Enter to choose the center.` : undefined" @click="selectPoint" @keydown.enter.prevent="emitLocalPoint({ x: .5, y: .5 })" @keydown.space.prevent="emitLocalPoint({ x: .5, y: .5 })">
        <img v-show="!videoReady" class="screen-image" :src="observation.image" :alt="isBrowserShare ? 'Latest captured browser screen share' : mode === 'lab' ? 'Captured Woodcutting Lab scene' : 'Captured selected Windows desktop'" draggable="false" />
        <video v-if="showVideo" v-show="videoReady" ref="video" class="screen-image live-screen-video" autoplay muted playsinline aria-label="Live browser screen share" />
        <template v-if="!isBrowserShare">
          <div v-for="(annotation, index) in annotations" :key="`${annotation.label}-${index}`" class="annotation-box" :style="{ left: `${annotation.box.x * 100}%`, top: `${annotation.box.y * 100}%`, width: `${annotation.box.width * 100}%`, height: `${annotation.box.height * 100}%` }"><span>{{ annotation.label }} <b>{{ Math.round(annotation.confidence * 100) }}%</b></span></div>
          <svg v-if="showDrag && displayPoint && displayDragEnd" class="drag-path" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line :x1="displayPoint.x * 100" :y1="displayPoint.y * 100" :x2="displayDragEnd.x * 100" :y2="displayDragEnd.y * 100" /></svg>
          <div v-if="displayPoint" class="click-marker" :style="{ left: `${displayPoint.x * 100}%`, top: `${displayPoint.y * 100}%` }"><Crosshair :size="28" /><span>{{ showDrag ? 'Start · ' : '' }}{{ clickPoint!.x.toFixed(2) }}, {{ clickPoint!.y.toFixed(2) }}</span></div>
          <div v-if="showDrag && displayDragEnd" class="click-marker drag-end-marker" :style="{ left: `${displayDragEnd.x * 100}%`, top: `${displayDragEnd.y * 100}%` }"><Crosshair :size="28" /><span>End · {{ dragEnd!.x.toFixed(2) }}, {{ dragEnd!.y.toFixed(2) }}</span></div>
        </template>
      </div>
      <div v-else class="empty-capture"><div class="empty-capture-icon"><ScanLine :size="38" :stroke-width="1.3" /></div><h3>{{ mode === 'desktop' ? 'Your desktop starts here.' : 'Preparing the lab.' }}</h3><p>{{ mode === 'desktop' ? 'Run the bridge, pair this site, then choose a monitor or window to capture.' : 'The included lab runs in your browser. No download or account required.' }}</p></div>
      <div v-if="canSelect" class="selection-hint"><MousePointer2 :size="13" />{{ selectionLabel }} Send the action below.</div>
    </div>
    <div class="preview-footer"><span><span class="frame-dot" />{{ replay ? 'Replay mode' : frameStatus || (showVideo ? 'Live video · capture a frame for evaluation' : 'Captured frames, observed after actions') }}</span><span v-if="observation">{{ new Date(observation.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }}</span><span v-else>Waiting for a source</span></div>
  </section>
</template>

<style scoped>
.live-screen-video{position:absolute;inset:0;pointer-events:none}.drag-path{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible}.drag-path line{stroke:#e7f99f;stroke-width:2;stroke-dasharray:6 4;vector-effect:non-scaling-stroke;filter:drop-shadow(0 1px 1px #13291e)}.drag-end-marker{color:#e7f99f}.screen-image-wrap.selectable:focus-visible{outline:2px solid #e7f99f;outline-offset:-2px}.selection-hint{max-width:calc(100% - 24px);white-space:normal;text-align:center;line-height:1.4;pointer-events:none}.selection-hint svg{flex-shrink:0}.preview-footer>span:first-child{min-width:0}.preview-footer>span:last-child{white-space:nowrap}.preview-tools .icon-button:disabled{opacity:.4}
</style>
