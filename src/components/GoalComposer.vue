<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ArrowUpRight, ChevronDown, Clock3, Flag, Infinity, ListPlus, Play, Radio, SlidersHorizontal, Sparkles, UserRound } from 'lucide-vue-next'
import type { TaskConfig } from '../types/protocol'

type RunMode = 'timed' | 'until-complete' | 'continuous'
type Game = 'generic' | 'osrs' | 'rs3'
const props = defineProps<{ mode: 'lab' | 'desktop'; nativeLab?: boolean; busy: boolean; initialGoal?: string; initialTask?: TaskConfig; enabled: boolean }>()
const emit = defineEmits<{ start: [config: TaskConfig]; enqueue: [config: TaskConfig] }>()
const composerForm = ref<HTMLFormElement | null>(null)
const labTask = computed(() => props.mode === 'lab' || props.nativeLab)
const externalTask = computed(() => props.mode === 'desktop' && !props.nativeLab)
const goal = ref(labTask.value ? 'Chop wood. If chopping stops, find another tree and keep going.' : 'Describe a workflow for your connected WebMCP agent.')
const condition = ref(labTask.value ? 'The character is actively chopping a tree' : 'The expected application state is visible')
const completion = ref(labTask.value ? 'The character is actively chopping a tree' : '')
const runMode = ref<RunMode>('timed')
const minutes = ref(10)
const cadence = ref(2)
const monitoring = ref<'interval' | 'events-and-interval'>('events-and-interval')
const watchSeconds = ref(labTask.value ? 1 : .5)
const settleMs = ref(labTask.value ? 350 : 150)
const deadline = ref('')
const advanced = ref(false)
const contextOpen = ref(false)
const template = ref('')
const formError = ref('')
const invariants = ref('The selected application remains visible')
const maxFailures = ref(5)
const maxActions = ref(30)
const confidence = ref(80)
const context = reactive({ game: 'generic' as Game, characterName: '', location: '', skills: '', inventory: '', notes: '' })
const templates = [
  { id: 'lumbridge', name: 'OSRS · Woodcut near Lumbridge', game: 'osrs' as Game, goal: 'In my selected OSRS window, cut trees near Lumbridge. Read the visible inventory. When it is full, bank the logs and return to an available tree. Verify each step and pause if the location or next target is uncertain.', condition: 'The character appears to be woodcutting, walking to a selected tree, or banking logs as planned', completion: 'The requested woodcutting session is complete', runMode: 'continuous' as RunMode, location: 'Near Lumbridge', notes: 'Confirm the location, available tools, and inventory from the screenshot before acting.' },
  { id: 'bank-logs', name: 'Bank the logs', goal: 'Find a visible, reachable bank in my selected game window. Open the bank and deposit the logs from my inventory. Keep tools and other items. Verify that the logs were deposited before finishing.', condition: 'The character is following the visible route to the bank or depositing logs', completion: 'The bank is open and the logs are no longer in the visible inventory', runMode: 'until-complete' as RunMode },
  { id: 'find-bank', name: 'Find and open a bank', goal: 'Use the visible game view and map to find a nearby bank. Move there and open the bank. Verify the bank interface. Pause if the route or location is uncertain.', condition: 'The character is progressing toward a bank identified from the visible screen', completion: 'The bank interface is visible', runMode: 'until-complete' as RunMode },
  { id: 'train-skill', name: 'Train a selected skill', goal: 'Train the skill specified in my character notes, using the activity and location I chose. Read the visible skill, inventory, and activity state. Recover when the activity stops, and pause if the required activity or supplies are unclear.', condition: 'The selected training activity is visibly progressing', completion: 'The skill target specified in my notes is visibly reached', runMode: 'continuous' as RunMode },
  { id: 'monster', name: 'Defeat a selected monster', goal: 'Defeat the monster specified in my notes in the selected game window. Confirm the visible target and character state before each action. Pause if the target is uncertain or the character needs intervention.', condition: 'The character is engaged with the intended monster and the visible character state permits continuing', completion: 'The selected monster is visibly defeated', runMode: 'until-complete' as RunMode },
  { id: 'quest', name: 'Work on a chosen quest', goal: 'Work on the quest objective specified in my notes. Read the visible quest instructions and current location, choose one action, then verify the result. Pause if the objective or next step is unclear.', condition: 'The visible quest state matches the current planned step', completion: 'The quest objective specified in my notes is visibly complete', runMode: 'until-complete' as RunMode },
]
const modes = [
  { value: 'timed' as RunMode, label: 'Run for', icon: Clock3 },
  { value: 'until-complete' as RunMode, label: 'Until complete', icon: Flag },
  { value: 'continuous' as RunMode, label: 'Until stopped', icon: Infinity },
]

watch(() => props.initialGoal, value => { if (value) goal.value = value }, { immediate: true })
watch(() => [props.mode, props.nativeLab] as const, () => {
  goal.value = labTask.value ? 'Chop wood. If chopping stops, find another tree and keep going.' : 'Describe a workflow for your connected WebMCP agent.'
  condition.value = labTask.value ? 'The character is actively chopping a tree' : 'The expected application state is visible'
  completion.value = labTask.value ? 'The character is actively chopping a tree' : ''
  cadence.value = 2
  watchSeconds.value = labTask.value ? 1 : .5
  settleMs.value = labTask.value ? 350 : 150
  template.value = ''
  applyReferenceDraft()
})

function applyReferenceDraft() {
  const draft = props.initialTask
  if (!draft || !externalTask.value) return
  goal.value = draft.goal; condition.value = draft.verification.condition; completion.value = draft.completionCondition ?? ''
  runMode.value = draft.runMode ?? 'timed'; minutes.value = draft.durationMs / 60000; cadence.value = draft.verification.intervalMs / 1000
  if (draft.monitoring) { monitoring.value = draft.monitoring.mode; watchSeconds.value = draft.monitoring.watchIntervalMs / 1000; settleMs.value = draft.monitoring.settleMs }
  if (draft.context) Object.assign(context, draft.context)
  contextOpen.value = true
}
watch(() => props.initialTask, applyReferenceDraft, { immediate: true })

function applyTemplate() {
  const preset = templates.find(item => item.id === template.value)
  if (!preset) return
  goal.value = preset.goal
  condition.value = preset.condition
  completion.value = preset.completion
  runMode.value = preset.runMode
  if ('game' in preset && preset.game) context.game = preset.game
  if ('location' in preset && preset.location) context.location = preset.location
  if ('notes' in preset && preset.notes) context.notes = preset.notes
  contextOpen.value = true
}

function configuration(): TaskConfig {
  const config: TaskConfig = {
    goal: goal.value.trim(),
    durationMs: Math.round(Math.max(0.5, Number(minutes.value)) * 60_000),
    runMode: runMode.value,
    verification: { condition: condition.value.trim(), intervalMs: Math.round(Number(cadence.value) * 1000) },
    monitoring: { mode: monitoring.value, watchIntervalMs: Math.round(Number(watchSeconds.value) * 1000), settleMs: Number(settleMs.value) },
    invariants: invariants.value.split('\n').map(value => value.trim()).filter(Boolean),
    limits: { maxConsecutiveFailures: Number(maxFailures.value), maxActionsPerMinute: Number(maxActions.value), confidenceThreshold: Number(confidence.value) / 100 },
  }
  if (runMode.value === 'until-complete') config.completionCondition = completion.value.trim()
  if (deadline.value) config.deadline = new Date(deadline.value).toISOString()
  if (externalTask.value) {
    config.context = { game: context.game }
    for (const key of ['characterName', 'location', 'skills', 'inventory', 'notes'] as const) {
      const value = context[key].trim()
      if (value) config.context[key] = value
    }
  }
  return config
}

function submit(operation: 'start' | 'enqueue') {
  formError.value = ''
  if (operation === 'start' && (props.busy || !props.enabled)) return
  if (!composerForm.value?.reportValidity() || !goal.value.trim()) return
  if (!condition.value.trim()) { advanced.value = true; formError.value = 'Enter an expected condition in Verification & limits.'; return }
  if (runMode.value === 'until-complete' && !completion.value.trim()) return
  if (deadline.value && Date.parse(deadline.value) <= Date.now()) { advanced.value = true; formError.value = 'Choose a deadline in the future.'; return }
  if (operation === 'start') emit('start', configuration())
  else emit('enqueue', configuration())
}
</script>

<template>
  <section class="goal-panel panel">
    <div class="section-heading"><span class="eyebrow">01 / THE DIRECTION</span><Sparkles :size="16" /></div>
    <h2>What should Lense do?</h2>
    <form ref="composerForm" @submit.prevent="submit('start')">
      <label v-if="externalTask" class="task-template-field" for="task-template">Start with a prompt
        <select id="task-template" v-model="template" @change="applyTemplate"><option value="">Write my own goal</option><optgroup label="Editable game prompts"><option v-for="preset in templates" :key="preset.id" :value="preset.id">{{ preset.name }}</option></optgroup></select>
      </label>
      <p v-if="externalTask && template" class="template-explanation">A prompt for your connected agent. Lense has no built-in RuneScape player or live game data.</p>
      <p v-if="externalTask" class="reference-library-link"><a href="/osrs" target="_blank" rel="noreferrer">OSRS map, prompts & visual dictionary <ArrowUpRight :size="13" /></a></p>
      <label class="sr-only" for="task-goal">Task goal</label>
      <div class="goal-input-wrap"><textarea id="task-goal" v-model="goal" rows="4" required maxlength="4000" placeholder="Describe the task and what success looks like..." /><ArrowUpRight :size="18" /></div>
      <fieldset class="task-run-modes">
        <legend>When should this task end?</legend>
        <label v-for="option in modes" :key="option.value" :class="{ selected: runMode === option.value }"><input v-model="runMode" type="radio" name="task-run-mode" :value="option.value" /><component :is="option.icon" :size="13" /><span>{{ option.label }}</span></label>
      </fieldset>
      <label v-if="runMode === 'until-complete'" class="completion-field" for="task-completion">Finish when this is visibly true<input id="task-completion" v-model="completion" required maxlength="2000" placeholder="The bank interface is visible" /></label>
      <p v-else-if="runMode === 'continuous'" class="run-mode-description">Continue until you stop the task or its optional deadline passes.</p>
      <div class="task-timing" :class="{ 'continuous-timing': runMode === 'continuous' }">
        <label v-if="runMode !== 'continuous'">{{ runMode === 'until-complete' ? 'Maximum run time' : 'Run for' }}<div class="input-with-unit"><input v-model="minutes" aria-label="Task duration in minutes" type="number" min="0.5" max="1440" step="0.5" required /><span>minutes</span></div></label>
        <label>Full check every<div class="input-with-unit"><input v-model="cadence" aria-label="Verification interval in seconds" type="number" min="0.5" max="3600" step="0.5" required /><span>seconds</span></div></label>
      </div>
      <label class="monitoring-field" for="task-monitoring"><Radio :size="13" />When to check the screen<select id="task-monitoring" v-model="monitoring"><option value="events-and-interval">On changes + regular full checks</option><option value="interval">Regular full checks only</option></select></label>
      <p class="monitoring-description">{{ monitoring === 'events-and-interval' ? 'Cheap image checks flag changes. Full checks still run on the interval above.' : 'The task checks the visible state at the interval above.' }}</p>
      <template v-if="externalTask">
        <button class="advanced-toggle context-toggle" type="button" :aria-expanded="contextOpen" aria-controls="task-character-context" @click="contextOpen = !contextOpen"><UserRound :size="14" />Character & game notes<ChevronDown :size="14" :class="{ rotated: contextOpen }" /></button>
        <div v-if="contextOpen" id="task-character-context" class="character-context">
          <p>These are notes you provide, not live telemetry. Your agent must check the screenshot before acting.</p>
          <label for="task-game">Application or game<select id="task-game" v-model="context.game"><option value="generic">Generic desktop application</option><option value="osrs">Old School RuneScape</option><option value="rs3">RuneScape 3</option></select></label>
          <div class="context-field-pair"><label for="character-name">Character name<input id="character-name" v-model="context.characterName" maxlength="120" placeholder="Optional" /></label><label for="character-location">Location<input id="character-location" v-model="context.location" maxlength="240" placeholder="Last known location" /></label></div>
          <label for="character-skills">Skills & targets<input id="character-skills" v-model="context.skills" maxlength="2000" placeholder="Chosen skill, current level, target" /></label>
          <label for="character-inventory">Inventory notes<textarea id="character-inventory" v-model="context.inventory" rows="2" maxlength="2000" placeholder="Tools, supplies, items to keep" /></label>
          <label for="character-notes">Task context & notes<textarea id="character-notes" v-model="context.notes" rows="3" maxlength="4000" placeholder="Monster, quest objective, route, or limits to follow" /></label>
        </div>
      </template>
      <button class="advanced-toggle" type="button" :aria-expanded="advanced" aria-controls="task-verification-settings" @click="advanced = !advanced"><SlidersHorizontal :size="14" />Verification & limits<ChevronDown :size="14" :class="{ rotated: advanced }" /></button>
      <div v-if="advanced" id="task-verification-settings" class="advanced-fields">
        <label>Expected condition<input v-model="condition" required maxlength="2000" /></label>
        <p v-if="labTask && runMode === 'until-complete'" class="monitoring-description">The lab evaluator can confirm visible chopping or idle status. Other completion conditions need an external agent.</p>
        <div class="task-timing"><label>Cheap watch interval, seconds<input v-model="watchSeconds" aria-label="Cheap watch interval in seconds" type="number" min="0.5" max="60" step="0.5" required /></label><label>Settle after action, ms<input v-model="settleMs" aria-label="Action settling time in milliseconds" type="number" min="0" max="5000" step="50" required /></label></div>
        <label>Invariants<textarea v-model="invariants" rows="2" placeholder="One condition per line" /></label>
        <div class="task-timing"><label>Failure limit<input v-model="maxFailures" type="number" min="1" max="20" required /></label><label>Actions per minute<input v-model="maxActions" type="number" min="1" max="120" required /></label></div>
        <label>Confidence minimum, %<input v-model="confidence" type="number" min="50" max="100" required /></label><label>Optional deadline<input v-model="deadline" aria-label="Task deadline" type="datetime-local" /></label>
      </div>
      <p v-if="busy" class="queue-draft-note">A task is active. Edit this draft and add it to the queue for later.</p>
      <p v-if="formError" class="inline-error" role="alert">{{ formError }}</p>
      <div class="composer-actions"><button class="button button-primary run-task" type="submit" :disabled="busy || !enabled || !goal.trim()"><Play :size="14" fill="currentColor" />{{ busy ? 'Task in progress' : mode === 'lab' ? 'Run this task' : 'Start agent task' }}</button><button class="button enqueue-task" type="button" :disabled="!goal.trim()" @click="submit('enqueue')"><ListPlus :size="16" />Add to queue</button></div>
    </form>
    <p class="fine-print">{{ mode === 'lab' ? 'Local demo. Lense reads rendered frames and clicks the scene.' : nativeLab ? 'Native lab demo only. Lense captures the selected lab window and sends real mouse input.' : 'A connected vision or WebMCP agent must read the screen and choose each next action.' }}</p>
  </section>
</template>
