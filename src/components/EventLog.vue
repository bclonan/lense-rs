<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowDownToLine, Check, ChevronLeft, ChevronRight, Circle, Eye, ListFilter, MousePointer2, RotateCcw } from 'lucide-vue-next'
import type { LenseEvent } from '../types/protocol'
const props = defineProps<{ events: LenseEvent[]; selected: number; expanded?: boolean }>()
const emit = defineEmits<{ select: [index: number]; export: [format: 'json' | 'jsonl']; clear: [] }>()
const filter = ref('all')
const exportOpen = ref(false)
const selectedRecord = computed(() => props.selected >= 0 ? props.events[props.selected] : undefined)
const visibleEvents = computed(() => props.events.map((event, index) => ({ event, index })).filter(({ event }) => filter.value === 'all' || event.type.startsWith(filter.value)).slice(props.expanded ? -200 : -8).reverse())
const eventLabel = (type: string) => type.replaceAll('.', ' ').replaceAll('_', ' ')
function detail(event: LenseEvent) {
  const data = event.data
  if (typeof data.explanation === 'string') return data.explanation
  if (typeof data.reason === 'string') return data.reason
  if (typeof data.to === 'string') return `Entered ${data.to.toLowerCase()}`
  if (typeof data.condition === 'string') return data.condition
  if (data.action && typeof data.action === 'object' && 'type' in data.action) return String(data.action.type)
  if (typeof data.goal === 'string') return data.goal
  return event.observation ? `${event.observation.width} × ${event.observation.height} captured frame` : 'Recorded in this session'
}
</script>

<template>
  <section class="event-panel panel">
    <div class="event-heading"><div><span class="eyebrow">THE PAPER TRAIL</span><h2>Every step, accounted for.<span class="count-pill">{{ events.length }}</span></h2></div><div class="event-actions"><div class="filter-control"><ListFilter :size="14" /><select v-model="filter" aria-label="Filter events"><option value="all">All events</option><option value="observation">Observations</option><option value="action">Actions</option><option value="evaluation">Evaluations</option><option value="recovery">Recoveries</option><option value="task">Task events</option></select></div><div class="export-control"><button class="button button-small button-quiet" :disabled="!events.length" :aria-expanded="exportOpen" @click="exportOpen = !exportOpen"><ArrowDownToLine :size="14" />Export</button><div v-if="exportOpen" class="export-menu"><button @click="emit('export', 'json'); exportOpen = false">Download JSON</button><button @click="emit('export', 'jsonl'); exportOpen = false">Download JSONL</button></div></div></div></div>
    <div v-if="!visibleEvents.length" class="events-empty"><div class="empty-event-lines"><span /><span /><span /></div><p>Your task's story will appear here.</p><span>Observations, actions, checks, and recoveries.</span></div>
    <div v-else class="event-list" :class="{ expanded }"><button v-for="{ event, index } in visibleEvents" :key="event.id" class="event-row" :class="{ selected: selected === index, 'has-capture': !!event.observation }" @click="emit('select', index)"><time>{{ new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }}</time><span class="event-icon" :class="event.type.split('.')[0]"><Eye v-if="event.type.startsWith('observation')" :size="14" /><MousePointer2 v-else-if="event.type.startsWith('action')" :size="14" /><Check v-else-if="event.type.startsWith('evaluation')" :size="14" /><RotateCcw v-else-if="event.type.startsWith('recovery')" :size="14" /><Circle v-else :size="11" /></span><span class="event-description"><strong>{{ eventLabel(event.type) }}</strong><span>{{ detail(event) }}</span></span><span v-if="event.observation" class="frame-label">View frame</span><ChevronRight :size="14" /></button></div>
    <div v-if="selectedRecord" class="replay-inspector"><div class="replay-notice"><div class="replay-stepper"><button class="icon-button" aria-label="Previous recorded event" :disabled="selected <= 0" @click="emit('select', selected - 1)"><ChevronLeft :size="14" /></button><span>Event {{ selected + 1 }} / {{ events.length }}</span><button class="icon-button" aria-label="Next recorded event" :disabled="selected >= events.length - 1" @click="emit('select', selected + 1)"><ChevronRight :size="14" /></button></div><button @click="emit('select', -1)">Return to current <ChevronRight :size="13" /></button></div><div class="record-details"><span>{{ selectedRecord.type }} · {{ new Date(selectedRecord.timestamp).toLocaleTimeString() }}</span><pre>{{ JSON.stringify(selectedRecord.data, null, 2) }}</pre></div></div>
    <div v-if="expanded && events.length" class="history-footer"><span>Stored on this browser. Reloaded tasks stay paused.</span><button class="text-button danger-text" @click="emit('clear')">Clear history</button></div>
  </section>
</template>
