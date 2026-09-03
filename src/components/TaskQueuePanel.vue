<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronDown, Clock3, Inbox, ListOrdered, Pause, Play, Radio, Repeat2, Send, Trash2, X } from 'lucide-vue-next'
import type { TaskConfig, TaskRecord } from '../types/protocol'

const props = defineProps<{ items: Array<{ id: string; config: TaskConfig }>; running: boolean; repeat: boolean; enabled: boolean; resumable: boolean; task: TaskRecord | null }>()
const emit = defineEmits<{ run: []; pause: []; clear: []; remove: [id: string]; repeat: [value: boolean]; signal: [message: string]; cadence: [intervalMs: number] }>()
const message = ref('')
const checkSeconds = ref(2)
const adjustmentOpen = ref(false)
const canCheck = computed(() => props.enabled && !!props.task && !['IDLE', 'PAUSED', 'COMPLETED', 'FAILED', 'STOPPED'].includes(props.task.state))
const validCadence = computed(() => Number.isFinite(Number(checkSeconds.value)) && Number(checkSeconds.value) >= .5 && Number(checkSeconds.value) <= 3600)
const continuousQueued = computed(() => props.items.some(item => item.config.runMode === 'continuous'))
const characterSummary = computed(() => {
  const context = props.task?.context
  if (!context) return ''
  return [context.game === 'osrs' ? 'OSRS' : context.game === 'rs3' ? 'RuneScape 3' : 'Desktop', context.characterName, context.location].filter(Boolean).join(' · ')
})
watch(() => props.task?.verification.intervalMs, value => { if (value) checkSeconds.value = value / 1000 }, { immediate: true })

function runLabel(config: TaskConfig) {
  if (config.runMode === 'continuous') return 'Until stopped'
  if (config.runMode === 'until-complete') return 'Until complete'
  const minutes = config.durationMs / 60_000
  return minutes >= 60 ? `${Math.round(minutes / 60 * 10) / 10} hr` : `${Math.round(minutes * 10) / 10} min`
}
function requestCheck() {
  if (!canCheck.value) return
  emit('signal', message.value.trim() || 'Check the current visible state and choose the next action if needed.')
  message.value = ''
}
function applyCadence() { if (props.enabled && validCadence.value && props.task) emit('cadence', Math.round(Number(checkSeconds.value) * 1000)) }
</script>

<template>
  <section class="task-queue-panel panel" aria-labelledby="task-queue-title">
    <div class="section-heading"><span class="eyebrow">NEXT, IN ORDER</span><ListOrdered :size="16" /></div>
    <div class="queue-panel-heading"><h2 id="task-queue-title">The task queue.</h2><span class="queue-state" :class="{ running }"><span class="signal-dot" />{{ running ? 'Running' : 'Paused' }}</span></div>
    <p class="queue-description">Tasks run in the order you add them. Start the queue when you are ready.</p>
    <div v-if="task" class="queue-current-task"><span class="queue-current-label">Current task<span>{{ task.state.toLowerCase().replaceAll('_', ' ') }}</span></span><strong>{{ task.goal }}</strong><p v-if="task.reason">{{ task.reason }}</p><span v-if="characterSummary" class="queue-character-note">Saved context · {{ characterSummary }}</span><details v-if="task.context" class="queue-context-details"><summary>Current character notes</summary><p v-if="task.context.skills">Skills & targets: {{ task.context.skills }}</p><p v-if="task.context.inventory">Inventory: {{ task.context.inventory }}</p><p v-if="task.context.notes">{{ task.context.notes }}</p><p>Notes reflect user input or an agent report. They are not live game data.</p></details></div>

    <ol v-if="items.length" class="queued-task-list" aria-label="Queued tasks in execution order">
      <li v-for="(item, index) in items" :key="item.id"><span class="queue-position">{{ String(index + 1).padStart(2, '0') }}</span><div><p>{{ item.config.goal }}</p><span><Clock3 :size="11" />{{ runLabel(item.config) }}<span class="queue-meta-divider" />{{ item.config.verification.intervalMs / 1000 }}s full checks</span><small v-if="item.config.runMode === 'until-complete'">Finish when {{ item.config.completionCondition }}</small></div><button class="icon-button" :aria-label="`Remove queued task ${index + 1}: ${item.config.goal}`" title="Remove from queue" @click="emit('remove', item.id)"><X :size="14" /></button></li>
    </ol>
    <div v-else class="queue-empty"><Inbox :size="23" :stroke-width="1.3" /><p>No tasks waiting.</p><span>Write a goal above and choose Add to queue.</span></div>
    <p v-if="continuousQueued" class="queue-continuous-note">An Until stopped task has no automatic end. Put it last if later tasks should run.</p>
    <div class="queue-repeat-row"><label><input type="checkbox" :checked="repeat" @change="emit('repeat', ($event.target as HTMLInputElement).checked)" /><Repeat2 :size="14" />Repeat queue</label><button class="text-button danger-text" :disabled="!items.length" @click="emit('clear')"><Trash2 :size="12" />Clear pending</button></div>
    <div class="queue-actions"><button class="button button-primary" :disabled="!enabled || running || (!items.length && !resumable)" @click="emit('run')"><Play :size="13" fill="currentColor" />Run queue</button><button class="button" :disabled="!running" @click="emit('pause')"><Pause :size="13" />Pause queue</button></div>
    <p class="queue-refresh-note">Reloading leaves the queue paused. Run queue is always an explicit choice.</p>

    <div v-if="task" class="queue-runtime-controls">
      <button class="advanced-toggle" :aria-expanded="adjustmentOpen" aria-controls="queue-check-controls" @click="adjustmentOpen = !adjustmentOpen"><Radio :size="14" />Checks & manual events<ChevronDown :size="14" :class="{ rotated: adjustmentOpen }" /></button>
      <div v-if="adjustmentOpen" id="queue-check-controls" class="queue-check-controls">
        <form class="queue-cadence-form" @submit.prevent="applyCadence"><label for="queue-check-seconds">Full check every<div class="input-with-unit"><input id="queue-check-seconds" v-model="checkSeconds" type="number" min="0.5" max="3600" step="0.5" required :disabled="!enabled" /><span>seconds</span></div></label><button class="button button-small" :disabled="!enabled || !validCadence">Apply cadence</button></form>
        <form class="queue-signal-form" @submit.prevent="requestCheck"><label for="queue-event-message">Tell the agent what changed<textarea id="queue-event-message" v-model="message" rows="2" maxlength="2000" :disabled="!canCheck" placeholder="Inventory is full. Check the screen and replan." /></label><button class="button button-small" :disabled="!canCheck"><Send :size="12" />Request a check</button></form>
        <p>A manual event asks the evaluator or connected agent to check the screen. It does not supply an action.</p>
      </div>
    </div>
  </section>
</template>
