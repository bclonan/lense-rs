<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Cable, Check, ChevronRight, CircleHelp, Clock3, Command, ExternalLink, Eye, History, Keyboard, Layers, Leaf, Monitor, MousePointer2, Pause, Play, Radio, RefreshCw, ScanLine, ScreenShare, Square, Terminal, Workflow, X } from 'lucide-vue-next'
import BridgePanel from './components/BridgePanel.vue'
import EvaluationPanel from './components/EvaluationPanel.vue'
import EventLog from './components/EventLog.vue'
import GoalComposer from './components/GoalComposer.vue'
import TaskQueuePanel from './components/TaskQueuePanel.vue'
import ManualControls from './components/ManualControls.vue'
import PageGuide from './components/PageGuide.vue'
import ScreenPreview from './components/ScreenPreview.vue'
import { useBridgeStore } from './stores/bridge'
import { useControlStore } from './stores/control'
import { browserCapture, sharedObservation, captureSource, observeShared } from './services/capture/shared'
import { delay } from './services/tasks/helpers'
import { LabProvider } from './lab/evaluator'
import { webMcpState } from './services/webmcp/register'
import { BRIDGE_DOWNLOAD_PAUSED, BRIDGE_DOWNLOAD_STATUS_URL } from './services/bridge/release'
import type { DesktopAction, Observation, Point, Target, TaskConfig } from './types/protocol'
import './styles.css'

const bridge = useBridgeStore()
const control = useControlStore()
const view = ref<'control' | 'demo' | 'history' | 'bridge'>('control')
const selectedTarget = computed<Target | null>(() => control.mode === 'desktop' && bridge.session && (control.target.type === 'window' ? bridge.windows : bridge.monitors).some(item => item.id === control.target.id) ? control.target : null)
const selectingPoint = ref(false)
const selectionKind = ref<'click' | 'drag-start' | 'drag-end'>('click')
const dragEnd = ref<Point | null>(null)
const actionFeedback = ref('')
const nativePreview = shallowRef<Observation | null>(null)
const liveStream = shallowRef<MediaStream | null>(null)
const previewInterval = ref(500)
const previewBusy = ref(false)
const captureMs = ref(0)
const previewError = ref('')
let previewController: AbortController | undefined
let previewTimer: ReturnType<typeof setTimeout> | undefined
let previewGeneration = 0
const pending = ref(false)
const notice = ref('')
const expanded = ref(false)
const helpOpen = ref(false)
const helpButton = ref<HTMLButtonElement | null>(null)
let helpTrigger: HTMLElement | null = null
const provider = ref<'external' | 'woodcutting'>('external')
const sharing = ref(false)
const goalPreset = ref('')
const referenceDraft = ref<TaskConfig>()
const now = ref(Date.now())
const timer = window.setInterval(() => { now.value = Date.now() }, 1000)
let sharePreview: ReturnType<typeof setTimeout> | undefined
const active = computed(() => !!control.task && !['IDLE', 'COMPLETED', 'FAILED', 'STOPPED', 'PAUSED'].includes(control.task.state))
const paused = computed(() => control.task?.state === 'PAUSED')
const desktopReady = computed(() => !!bridge.session && !!selectedTarget.value)
const manualBlock = computed(() => paused.value ? 'The task is paused. Resume it before sending input, or stop it and start a new task.' : control.task && ['STOPPED','FAILED','COMPLETED'].includes(control.task.state) ? 'This task has ended. Start a new task before sending more input.' : '')
const showingShare = computed(() => sharing.value && captureSource.value === 'browser')
const targetName = computed(() => selectedTarget.value?.type === 'window' ? bridge.windows.find(item => item.id === selectedTarget.value?.id)?.title : bridge.monitors.find(item => item.id === selectedTarget.value?.id)?.name)
const frameStatus = computed(() => showingShare.value ? `${browserCapture.source?.displaySurface || 'Screen'} share · live video · ${browserCapture.source?.frameRate || 12} fps requested` : previewError.value || (previewInterval.value ? `Preview every ${previewInterval.value / 1000}s${captureMs.value ? ` · last capture ${captureMs.value} ms` : ''}` : 'Manual capture'))
const stateLabel = computed(() => control.task ? control.task.state.toLowerCase().replaceAll('_', ' ') : 'Ready when you are')
const elapsed = computed(() => formatTime(control.task?.elapsedMs || 0))
const nextCheck = computed(() => control.task?.nextCheckAt ? Math.max(0, Math.ceil((control.task.nextCheckAt - now.value) / 1000)) : null)
const replayObservation = computed(() => {
  if (control.selectedEvent >= 0) {
    for (let index = control.selectedEvent; index >= 0; index--) {
      const observation = control.events[index]?.observation
      if (observation) return observation
    }
    return null
  }
  if (showingShare.value) return sharedObservation.value
  const frame = nativePreview.value
  return control.mode === 'desktop' && frame && (!control.observation || frame.timestamp > control.observation.timestamp) ? frame : control.observation
})
const stats = computed(() => [
  { label: 'Observations', value: control.task?.observations || 0, icon: Eye },
  { label: control.mode === 'lab' ? 'Lab actions' : 'Native actions', value: control.task?.actions || 0, icon: MousePointer2 },
  { label: 'Watch checks', value: control.task?.watchChecks || 0, icon: Radio },
  { label: 'Evaluations', value: control.task?.evaluations || 0, icon: ScanLine },
  { label: 'Recoveries', value: control.task?.recoveries || 0, icon: RefreshCw },
  { label: 'Elapsed time', value: elapsed.value, icon: Clock3 },
])
const phase = computed(() => {
  const current = control.task?.state
  if (current === 'OBSERVING') return 0
  if (['PLANNING', 'LOCATING_TARGET', 'RECOVERING'].includes(current || '')) return 1
  if (['EXECUTING', 'SETTLING'].includes(current || '')) return 2
  if (['VERIFYING', 'WAITING'].includes(current || '')) return 3
  return -1
})
const demos = [
  { name: 'The self-correcting woodcutter', category: 'INCLUDED LAB', icon: Leaf, text: 'Chop wood for 10 minutes. If chopping stops, find another tree and continue.', sequence: 'observe → locate → click → watch → verify → recover', lab: true },
  { name: 'A blank page, filled', category: 'WINDOWS DESKTOP', icon: Terminal, text: "Observe Notepad, click the editor, type 'Hello from Lense', and verify it appears.", sequence: 'observe → click → type → observe → verify', lab: false },
  { name: 'Wait for the right moment', category: 'VISUAL WATCH', icon: Eye, text: 'Watch this application. If the expected dialog disappears, pause and tell me.', sequence: 'observe → watch → change → evaluate → pause', lab: false },
  { name: 'One step at a time', category: 'ANY VISIBLE WORKFLOW', icon: Workflow, text: 'Perform the visible workflow one step at a time and verify every action before continuing.', sequence: 'observe → plan → action → verify → continue', lab: false },
]

function formatTime(milliseconds: number) { const seconds = Math.floor(milliseconds / 1000); return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}` }
async function perform(operation: () => unknown | Promise<unknown>) {
  notice.value = ''
  pending.value = true
  try { await operation() } catch (error) { notice.value = error instanceof Error ? error.message : String(error) } finally { pending.value = false }
}
async function setMode(mode: 'lab' | 'desktop') {
  if (mode === control.mode) return
  if (active.value) { notice.value = 'Pause or stop the current task before changing its source.'; return }
  stopSharing()
  selectingPoint.value = false
  control.selectedEvent = -1
  await perform(async () => {
    await control.setMode(mode)
    if (mode === 'desktop') { control.configure(bridge.client, provider.value === 'woodcutting' ? new LabProvider() : undefined); if (bridge.session) await bridge.refreshTargets() }
  })
}
function configureProvider() { if (control.mode === 'desktop') control.configure(bridge.client, provider.value === 'woodcutting' ? new LabProvider() : undefined) }
async function selectTarget(target: Target) {
  if (control.mode === 'lab') { if (active.value) { notice.value = 'Pause or stop the lab task before selecting a Windows target.'; return } await setMode('desktop') }
  await perform(async () => {
    control.target = target; bridge.client.setTarget(target); captureSource.value = 'native'; selectingPoint.value = false; control.selectedEvent = -1
    if (target.type === 'window') await bridge.client.action({ type: 'window.focus', windowId: target.id })
    await control.observe()
  })
}
async function observe() { await perform(async () => { control.selectedEvent = -1; if (showingShare.value) await observeShared(); else await control.observe() }) }
async function pair() { await perform(async () => { control.configure(bridge.client, provider.value === 'woodcutting' ? new LabProvider() : undefined); await bridge.pair(); await bridge.refreshTargets() }) }
async function disconnect() { await perform(async () => { await Promise.all([control.stop(), bridge.unpair()]); selectingPoint.value = false; stopSharing() }) }
async function stop() { await perform(async () => { if (control.mode === 'desktop' && bridge.session) { await Promise.all([control.stop(), bridge.unpair()]); notice.value = 'Desktop control stopped. Pair again to send more input.' } else await control.stop() }) }
async function start(config: TaskConfig) { await perform(async () => { control.selectedEvent = -1; await control.start(config) }) }
async function act(action: DesktopAction) {
  selectingPoint.value = false; actionFeedback.value = ''
  await perform(async () => {
    const started = performance.now()
    await control.act(action)
    actionFeedback.value = `Bridge accepted ${action.type}. Capturing the result…`
    try { await delay(100); await control.observe() }
    catch(error) { actionFeedback.value = 'Input sent; result capture failed. Capture again without repeating the input.'; throw error }
    actionFeedback.value = `${action.type} sent. Result captured in ${Math.round(performance.now() - started)} ms. Check the preview to confirm it worked.`
  })
}
function choosePoint(kind: 'click' | 'drag-start' | 'drag-end') { previewController?.abort(); selectionKind.value = kind; selectingPoint.value = true; control.selectedEvent = -1 }
function selectPoint(point: Point) { if (selectionKind.value === 'drag-end') dragEnd.value = point; else control.clickPoint = point; selectingPoint.value = false }
async function startSharing() {
  await perform(async () => {
    try { await browserCapture.start({frameRate:12}); await observeShared() } catch(error) { stopSharing(); throw error }
    sharing.value = true; liveStream.value = browserCapture.stream; captureSource.value = 'browser'; selectingPoint.value = false; dragEnd.value = null; control.clickPoint = null; control.selectedEvent = -1
    browserCapture.stream?.getVideoTracks()[0]?.addEventListener('ended', stopSharing, { once: true })
    const update = async () => {
      if (!browserCapture.active) { stopSharing(); return }
      try { if (!document.hidden && showingShare.value) await observeShared() }
      catch (error) { if (sharing.value) { notice.value = error instanceof Error ? error.message : String(error); stopSharing() } }
      if (sharing.value) sharePreview = setTimeout(update, 500)
    }
    sharePreview = setTimeout(update, 500)
  })
}
function stopSharing() { clearTimeout(sharePreview); sharePreview = undefined; browserCapture.stop(); sharing.value = false; liveStream.value = null; sharedObservation.value = null; captureSource.value = 'native' }
function restartPreview() {
  const generation = ++previewGeneration
  clearTimeout(previewTimer); previewController?.abort(); previewBusy.value = false
  const tick = async () => {
    if (generation !== previewGeneration) return
    if (desktopReady.value && control.mode === 'desktop' && !showingShare.value && previewInterval.value && !pending.value && !selectingPoint.value && control.selectedEvent < 0 && !document.hidden) {
      const target = {...control.target}, controller = new AbortController(); previewController = controller; previewBusy.value = true
      const started = performance.now()
      try {
        const frame = await bridge.client.observe({target,maxDimension:1280,quality:.72},controller.signal)
        if (generation === previewGeneration && !controller.signal.aborted) { nativePreview.value = frame; captureMs.value = Math.round(performance.now() - started); previewError.value = '' }
      } catch (error) { if (generation === previewGeneration && !controller.signal.aborted) previewError.value = error instanceof Error ? error.message : String(error) }
      finally { if (generation === previewGeneration) previewBusy.value = false }
    }
    if (generation === previewGeneration) previewTimer = setTimeout(tick, Math.max(250,previewInterval.value || 1000))
  }
  previewTimer = setTimeout(tick, 0)
}
watch(() => control.target, target => { if (control.mode === 'desktop') bridge.client.setTarget(target) }, {flush:'sync'})
watch([() => control.target, () => bridge.session, () => control.mode], () => { nativePreview.value = null; dragEnd.value = null; control.clickPoint = null; actionFeedback.value = ''; restartPreview() })
watch([previewInterval, showingShare], restartPreview)
async function exportEvents(format: 'json' | 'jsonl') { await perform(async () => { const contents = await control.exportEvents(format); const url = URL.createObjectURL(new Blob([contents], { type: format === 'json' ? 'application/json' : 'application/x-ndjson' })); const link = document.createElement('a'); link.href = url; link.download = `lense-events-${new Date().toISOString().replaceAll(':', '-')}.${format}`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000) }) }
async function chooseDemo(demo: typeof demos[number]) { await setMode(demo.lab ? 'lab' : 'desktop'); goalPreset.value = demo.text; view.value = 'control' }
function clearHistory() { if (window.confirm('Clear the task and event history saved in this browser?')) void perform(() => control.clearHistory()) }
async function toggleGuide(event: MouseEvent) {
  if (helpOpen.value) { closeGuide(); return }
  helpTrigger = event.currentTarget as HTMLElement
  helpOpen.value = true
  await nextTick()
  document.getElementById('page-guide')?.scrollIntoView({ block: 'nearest' })
}
function closeGuide() { helpOpen.value = false; (helpTrigger?.isConnected ? helpTrigger : helpButton.value)?.focus() }
function closeHelpOnEscape(event: KeyboardEvent) { if (event.key === 'Escape' && helpOpen.value) { event.preventDefault(); closeGuide() } }
async function openDesktop() { await setMode('desktop'); view.value = 'control' }
async function openLab() { await setMode('lab'); view.value = 'control' }
async function loadReferenceDraft() {
  const id = new URLSearchParams(location.search).get('osrsPrompt')
  if (!id) return
  const { getReference } = await import('./osrs/reference')
  const entry = getReference(id)
  if (!entry.prompt || entry.kind !== 'prompt') throw new Error('Choose a prompt from the OSRS field guide.')
  referenceDraft.value = {
    goal: entry.prompt.goal, runMode: entry.prompt.runMode, durationMs: 30 * 60000,
    completionCondition: entry.prompt.completionCondition,
    verification: { condition: 'The visible game state matches the current step toward the requested goal', intervalMs: 2000 },
    monitoring: { mode: 'events-and-interval', watchIntervalMs: 500, settleMs: 150 },
    invariants: ['The selected game remains visible', 'Pause if the current target or next action is uncertain'],
    limits: { maxConsecutiveFailures: 5, maxActionsPerMinute: 30, confidenceThreshold: .8 },
    context: { game: 'osrs', notes: `Reference ${entry.id}. Read it with osrs_reference before acting. ${entry.prompt.notes}` },
  }
  if (control.mode !== 'desktop' && !control.task && !control.queue.length) await setMode('desktop')
  notice.value = control.mode === 'desktop' ? `Loaded "${entry.title}" as a draft. Review the goal and character notes, then start or add it to the queue.` : `The OSRS draft is ready. Switch to Windows desktop when you are ready to use it. Your current task and queue are preserved.`
}
onMounted(async () => { window.addEventListener('keydown', closeHelpOnEscape); await perform(async () => { await control.initialize(); control.configure(bridge.client, provider.value === 'woodcutting' ? new LabProvider() : undefined); await loadReferenceDraft() }); void bridge.detect() })
onUnmounted(() => { window.removeEventListener('keydown', closeHelpOnEscape); window.clearInterval(timer); stopSharing(); previewGeneration++; clearTimeout(previewTimer); previewController?.abort(); control.dispose() })
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar" aria-label="Main navigation">
      <a class="brand-mark" href="/" aria-label="Lense home"><span /><span /></a>
      <nav><button class="nav-item" :class="{ active: view === 'control' }" title="Control center" aria-label="Control center" @click="view = 'control'"><Layers :size="21" /><span>Control</span></button><button class="nav-item" :class="{ active: view === 'demo' }" title="Demo playbook" aria-label="Demo playbook" @click="view = 'demo'"><Play :size="20" /><span>Demos</span></button><button class="nav-item" :class="{ active: view === 'history' }" title="Event history" aria-label="Event history" @click="view = 'history'"><History :size="21" /><span>History</span></button><button class="nav-item" :class="{ active: view === 'bridge' }" title="Desktop bridge" aria-label="Desktop bridge" @click="view = 'bridge'"><Cable :size="21" /><span>Bridge</span><i v-if="bridge.session" /></button></nav>
      <div class="sidebar-bottom"><button class="nav-item" title="Help for this page" aria-label="How Lense works" :aria-expanded="helpOpen" aria-controls="page-guide" @click="toggleGuide"><CircleHelp :size="21" /><span>Guide</span></button><div class="sidebar-version">L / 01</div></div>
    </aside>
    <div class="workspace">
      <header class="topbar"><div class="wordmark">lense<span>VISUAL COMPUTER CONTROL</span></div><div class="topbar-right"><span class="local-note webmcp-status"><Command :size="13" />{{ webMcpState === 'native' ? 'WebMCP · 7 tools live' : webMcpState === 'local' ? 'WebMCP · local fallback' : 'WebMCP registration failed' }}</span><button class="connection-badge" :class="{ connected: bridge.session }" @click="view = 'bridge'"><span class="signal-dot" />{{ bridge.session ? 'Desktop paired' : bridge.status ? 'Bridge detected' : 'Bridge offline' }}<ChevronRight :size="13" /></button></div></header>
      <main>
        <div class="page-heading"><div><div class="eyebrow page-eyebrow"><span />{{ view === 'demo' ? 'THE DEMO PLAYBOOK' : view === 'history' ? 'A RECORD YOU CAN REPLAY' : view === 'bridge' ? 'CONNECT YOUR COMPUTER' : 'THE CONTROL CENTER' }}</div><h1>{{ view === 'demo' ? 'Put it to work.' : view === 'history' ? 'Nothing behind the curtain.' : view === 'bridge' ? 'Connect your Windows desktop.' : 'Your desktop. Your direction.' }}</h1><p>{{ view === 'demo' ? BRIDGE_DOWNLOAD_PAUSED ? 'Try the included browser lab. Windows setup is on hold.' : 'Try the included lab, then connect a Windows app.' : view === 'history' ? 'See what Lense observed, what it did, and why it continued.' : view === 'bridge' ? BRIDGE_DOWNLOAD_PAUSED ? 'Windows setup is on hold while the antivirus report is reviewed.' : 'Run the bridge, approve access, and choose a monitor or app window.' : 'Give it a goal. Watch every action. Step in whenever you need.' }}</p></div><div class="page-heading-actions"><div v-if="view === 'control'" class="heading-index"><span>OBSERVE</span><i /><span>ACT</span><i /><span>VERIFY</span></div><button v-else class="button button-quiet back-to-control" @click="view = 'control'"><ArrowLeft :size="15" />Control center</button><button ref="helpButton" class="page-help-toggle" :class="{ active: helpOpen }" aria-label="Help for this page" :aria-expanded="helpOpen" aria-controls="page-guide" title="Setup and help for this page" @click="toggleGuide"><CircleHelp :size="21" /><span>Help</span></button></div></div>

        <PageGuide v-if="helpOpen" :view="view" :mode="control.mode" @close="closeGuide" @bridge="view = 'bridge'" @desktop="openDesktop" @lab="openLab" />
        <a v-if="view === 'control'" class="osrs-reference-banner" href="/osrs" target="_blank" rel="noreferrer"><BookOpen :size="18" /><span><strong>OSRS field guide</strong><span>Map, prompt library, visual dictionary and skill notes</span></span><ArrowUpRight :size="17" /></a>

        <div v-if="notice || control.error" class="notice-banner" role="alert"><CircleHelp :size="16" /><span>{{ notice || control.error }}</span><button class="icon-button" aria-label="Dismiss notification" @click="notice = ''; control.error = ''"><X :size="14" /></button></div>

        <template v-if="view === 'control' || view === 'history'">
          <div class="workspace-toolbar"><div class="source-tabs" role="group" aria-label="Control source"><button :class="{ active: control.mode === 'lab' }" :disabled="active" @click="setMode('lab')"><Leaf :size="15" />Woodcutting lab<span>DEMO</span></button><button :class="{ active: control.mode === 'desktop' }" :disabled="active" @click="setMode('desktop')"><Monitor :size="15" />Windows desktop</button></div><button v-if="control.mode === 'lab'" class="text-button open-lab" @click="view = 'demo'">Explore demos <ArrowUpRight :size="14" /></button><div v-else class="capture-mode"><span v-if="sharing">Shared video available</span><button class="text-button" :disabled="pending" @click="sharing ? stopSharing() : startSharing()"><ScreenShare :size="14" />{{ sharing ? 'Stop sharing' : 'Share a screen' }}</button></div></div>
          <div class="control-grid" :class="{ 'history-grid': view === 'history' }"><div class="main-column">
            <BridgePanel v-if="control.mode === 'desktop' && view !== 'history' && !bridge.session" :status="bridge.status" :session="bridge.session" :permission="bridge.permission" :error="bridge.error" :connecting="bridge.connecting" :monitors="bridge.monitors" :windows="bridge.windows" :target="selectedTarget" @detect="perform(() => bridge.detect())" @pair="pair" @unpair="disconnect" @target="selectTarget" @refresh="perform(() => bridge.refreshTargets())" />
            <section v-if="control.mode === 'desktop'" class="screen-controls panel" aria-label="Screen controls">
              <div v-if="bridge.session" class="screen-target-row"><label for="control-target">Capture &amp; input target</label><div><select id="control-target" :value="selectedTarget ? `${selectedTarget.type}:${selectedTarget.id}` : ''" :disabled="pending" @change="selectTarget({type:($event.target as HTMLSelectElement).value.startsWith('window:') ? 'window' : 'monitor',id:($event.target as HTMLSelectElement).value.slice(($event.target as HTMLSelectElement).value.indexOf(':') + 1)})"><option value="" disabled>Choose a monitor or app window</option><optgroup label="Monitors"><option v-for="monitor in bridge.monitors" :key="monitor.id" :value="`monitor:${monitor.id}`">{{ monitor.name }} · {{ monitor.width }} × {{ monitor.height }}</option></optgroup><optgroup label="App windows"><option v-for="window in bridge.windows" :key="window.id" :value="`window:${window.id}`">{{ window.title }}{{ window.minimized ? ' · Minimized' : '' }}</option></optgroup></select><button class="icon-button" aria-label="Refresh capture targets" :disabled="pending" @click="perform(() => bridge.refreshTargets())"><RefreshCw :size="15" /></button></div></div>
              <div class="screen-cadence-row"><div v-if="sharing" class="capture-source-tabs" role="group" aria-label="Preview source"><button :class="{ active: !showingShare }" @click="captureSource = 'native'; selectingPoint = false">Native target</button><button :class="{ active: showingShare }" @click="captureSource = 'browser'; selectingPoint = false">Browser share</button></div><label v-if="!showingShare" for="preview-interval">Preview interval <select id="preview-interval" v-model.number="previewInterval"><option :value="250">0.25 seconds</option><option :value="500">0.5 seconds</option><option :value="1000">1 second</option><option :value="2000">2 seconds</option><option :value="0">Manual</option></select></label><span v-else>Live video. Agent observations read the current frame.</span></div>
              <p v-if="showingShare">The browser picker chooses what the agent can see. Use Native target for clicks and drags because shared tabs and windows can have different borders.</p><p v-else-if="selectedTarget">{{ selectedTarget.type === 'window' ? 'Lense focuses this window before input. Keep it uncovered for native screenshots.' : 'Monitor coordinates work across this screen. Choose an app window for keyboard input and scrolling.' }} Task verification uses its own Full check interval.</p><p v-else>Pair the bridge below to choose a native target, or Share a screen for browser observations.</p>
            </section>
            <ScreenPreview :observation="replayObservation" :annotations="control.selectedEvent < 0 && !showingShare && replayObservation?.id === control.observation?.id ? control.evaluation?.regions : []" :click-point="control.selectedEvent < 0 && !showingShare ? control.clickPoint : null" :mode="control.mode" :replay="control.selectedEvent >= 0" :select-enabled="selectingPoint && desktopReady && !showingShare && control.selectedEvent < 0" :drag-end="dragEnd" :selection-kind="selectionKind" :live-stream="showingShare && control.selectedEvent < 0 ? liveStream : null" :frame-status="control.mode === 'desktop' ? frameStatus : undefined" :capture-busy="previewBusy || pending" @select="selectPoint" @observe="observe" @expand="expanded = true" />
            <ManualControls v-if="control.mode === 'desktop' && view !== 'history'" :enabled="desktopReady && !manualBlock" :blocked-reason="manualBlock" :point="control.clickPoint" :drag-end="dragEnd" :selection-kind="selectionKind" :target-name="targetName" :feedback="actionFeedback" :selecting="selectingPoint" :target="selectedTarget" :browser-share="showingShare" :busy="pending || (active && provider === 'woodcutting') || control.selectedEvent >= 0" @action="act" @select="choosePoint" />
            <div class="loop-strip"><span class="loop-label">THE LOOP</span><template v-for="(step, index) in ['Observe', 'Plan', 'Act', 'Verify']" :key="step"><ArrowRight v-if="index" :size="12" /><span class="loop-step" :class="{ active: phase === index }"><span>{{ String(index + 1).padStart(2, '0') }}</span>{{ step }}</span></template><RefreshCw :size="13" class="loop-return" /></div>
            <div class="task-status-bar"><div class="task-state"><span class="signal-dot" :class="{ muted: !active, waiting: control.task?.state === 'WAITING' }" /><span>{{ stateLabel }}</span><span v-if="nextCheck !== null && active" class="next-check">Next check in {{ nextCheck }}s</span></div><div class="task-buttons"><span class="elapsed-small"><Clock3 :size="13" />{{ elapsed }}</span><button v-if="active" class="button button-small" @click="perform(() => control.pause())"><Pause :size="13" />Pause</button><button v-else-if="paused" class="button button-small" :disabled="control.mode === 'desktop' && !desktopReady" @click="perform(() => control.resume())"><Play :size="13" />Resume</button><button class="button button-stop button-small" :disabled="!active && !paused && !bridge.session" @click="stop"><Square :size="10" fill="currentColor" />Stop control</button></div></div>
            <p v-if="control.task?.reason" class="task-reason">{{ control.task.reason }}</p>
            <div class="metrics-grid"><div v-for="stat in stats" :key="stat.label" class="metric"><component :is="stat.icon" :size="14" /><strong>{{ stat.value }}</strong><span>{{ stat.label }}</span></div></div>
            <EventLog :events="control.events" :selected="control.selectedEvent" :expanded="view === 'history'" @select="control.selectedEvent = $event" @export="exportEvents" @clear="clearHistory" />
          </div><aside class="detail-column">
            <div v-if="control.mode === 'desktop'" class="provider-select panel"><label for="agent-provider"><Command :size="14" />Agent mode</label><select id="agent-provider" v-model="provider" :disabled="active" @change="configureProvider"><option value="external">External WebMCP agent</option><option value="woodcutting">Woodcutting Lab autopilot</option></select><p v-if="provider === 'woodcutting'">Open the lab in a separate window, select its native capture, and keep the lab visible.</p><p v-else>Your agent reads screenshots and sends input through six shared desktop tools.</p><a v-if="provider === 'woodcutting'" class="text-button" href="/lab" target="_blank" rel="noreferrer">Open standalone lab <ExternalLink :size="13" /></a></div>
            <GoalComposer :mode="control.mode" :busy="active || paused" :enabled="!pending && (control.mode === 'lab' || desktopReady)" :initial-goal="goalPreset" :initial-task="referenceDraft" :native-lab="provider === 'woodcutting'" @start="start" @enqueue="config => perform(() => control.enqueue(config))" />
            <TaskQueuePanel :items="control.queue" :running="control.queueRunning" :repeat="control.queueRepeat" :task="control.task" :resumable="control.queueResumable" :enabled="!pending && (control.mode === 'lab' || desktopReady)" @run="perform(() => control.runQueue())" @pause="perform(() => control.pause())" @clear="perform(() => control.clearQueue())" @remove="id => perform(() => control.removeQueued(id))" @repeat="value => perform(() => control.setQueueRepeat(value))" @signal="message => perform(() => control.signalTask({ type: 'user.event', message }))" @cadence="interval => perform(() => control.setCadence(interval))" />
            <EvaluationPanel :evaluation="control.evaluation" :task="control.task" :mode="control.mode" :native-lab="provider === 'woodcutting'" />
            <div v-if="control.mode === 'lab'" class="desktop-invitation"><div class="invitation-icon"><Monitor :size="21" /></div><div><h3>Next stop, your desktop.</h3><p>Type into apps, click real controls, and verify the result.</p><button class="text-button" @click="setMode('desktop')">Connect Windows <ArrowUpRight :size="14" /></button></div></div>
          </aside></div>
        </template>

        <template v-else-if="view === 'demo'">
          <div class="demo-intro"><div><span class="eyebrow">A COMPLETE LOOP, IN ONE MINUTE</span><h2>A tree falls.<br />Lense finds the next one.</h2><p>The included lab gives you a repeatable task with a visible failure and recovery. No game account, API key, or desktop access needed.</p><button class="button button-lime" @click="chooseDemo(demos[0]!)"><Play :size="14" fill="currentColor" />Open the Woodcutting lab<ArrowUpRight :size="16" /></button></div><div class="demo-loop"><div><Eye :size="20" /><span>01</span><strong>Read the frame</strong></div><ArrowDownToLine :size="15" /><div><MousePointer2 :size="20" /><span>02</span><strong>Click a visible tree</strong></div><ArrowDownToLine :size="15" /><div><Check :size="20" /><span>03</span><strong>Verify & recover</strong></div></div></div>
          <div class="demo-cards"><button v-for="demo in demos" :key="demo.name" class="demo-card" @click="chooseDemo(demo)"><div class="demo-card-top"><component :is="demo.icon" :size="21" /><span class="eyebrow">{{ demo.category }}</span><ArrowUpRight :size="17" /></div><h3>{{ demo.name }}</h3><p>"{{ demo.text }}"</p><div class="demo-sequence">{{ demo.sequence }}</div><span class="demo-card-footer">{{ demo.lab ? 'Runs here, in your browser' : 'Requires Windows bridge + external agent' }}<ChevronRight :size="13" /></span></button></div>
          <div class="native-demo-note"><Monitor :size="22" /><div><h3>Prove the same loop on Windows.</h3><p>Open the standalone lab, pair the bridge, select the lab window, then choose Woodcutting Lab autopilot. Lense will use real screenshots and native mouse input.</p></div><a class="button" href="/lab" target="_blank" rel="noreferrer">Open lab window<ExternalLink :size="14" /></a></div>
          <div class="input-lab-link"><Keyboard :size="16" /><span>Test typing, hotkeys, and drawing in the included input lab.</span><a class="text-button" href="/input-lab" target="_blank" rel="noreferrer">Open input lab<ExternalLink :size="13" /></a></div>
          <div class="metrics-grid demo-metrics"><div v-for="stat in stats" :key="stat.label" class="metric"><component :is="stat.icon" :size="15" /><strong>{{ stat.value }}</strong><span>{{ stat.label }}</span></div></div>
        </template>

        <div v-else class="connection-page"><BridgePanel :status="bridge.status" :session="bridge.session" :permission="bridge.permission" :error="bridge.error" :connecting="bridge.connecting" :monitors="bridge.monitors" :windows="bridge.windows" :target="selectedTarget" @detect="perform(() => bridge.detect())" @pair="pair" @unpair="disconnect" @target="selectTarget" @refresh="perform(() => bridge.refreshTargets())" /><section class="connection-explainer panel"><span class="eyebrow">THIS COMPUTER ONLY</span><h2>Choose the app.<br />See each action.</h2><div class="architecture-row"><span><Layers :size="21" />This website</span><ArrowRight :size="17" /><span><Cable :size="21" />Local bridge</span><ArrowRight :size="17" /><span><Monitor :size="21" />Windows app</span></div><p v-if="BRIDGE_DOWNLOAD_PAUSED">The Windows download is paused while an antivirus report is reviewed. Keep a quarantined copy in quarantine. <a :href="BRIDGE_DOWNLOAD_STATUS_URL">Read the download status.</a></p><p v-else>Run the approved bridge on the same Windows computer as this browser and keep its window open.</p><p>Allow the browser's local network prompt, then approve pairing in the Windows dialog. Choose an app window to type or scroll, or choose a monitor to view and click across a screen.</p><p>Open the input lab in a separate window for your first test. Select that window and check its preview before sending text or a click. General automation requires a connected WebMCP agent.</p><div class="connection-actions"><a class="button" href="/input-lab" target="_blank" rel="noreferrer">Open input lab<ExternalLink :size="14" /></a><button class="button button-primary" @click="openDesktop">Go to desktop controls<ArrowRight :size="15" /></button></div><p class="connection-stop-note">Stop control revokes access. Ctrl + Alt + Escape is the Windows emergency stop.</p></section></div>
      </main>
      <footer class="app-footer"><span>LENSE / <span>Visual computer control</span></span><button aria-label="Open page guide from footer" :aria-expanded="helpOpen" aria-controls="page-guide" @click="toggleGuide"><BookOpen :size="12" />Help for this page<ArrowUpRight :size="12" /></button><span class="footer-local"><span class="signal-dot" />History stays in this browser</span></footer>
    </div>
    <div v-if="expanded" class="modal-backdrop" @click.self="expanded = false"><section class="preview-modal" role="dialog" aria-modal="true" aria-label="Expanded screen observation"><button class="modal-close icon-button" aria-label="Close expanded preview" @click="expanded = false"><X :size="22" /></button><ScreenPreview :observation="replayObservation" :annotations="control.selectedEvent < 0 ? control.evaluation?.regions : []" :click-point="control.clickPoint" :mode="control.mode" :replay="control.selectedEvent >= 0" :select-enabled="selectingPoint && desktopReady && !showingShare && control.selectedEvent < 0" :drag-end="dragEnd" :selection-kind="selectionKind" :live-stream="showingShare && control.selectedEvent < 0 ? liveStream : null" :frame-status="control.mode === 'desktop' ? frameStatus : undefined" :capture-busy="previewBusy || pending" @select="selectPoint" @observe="observe" @expand="expanded = false" /></section></div>
  </div>
</template>
