<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, CircleHelp, Compass, Copy, Crosshair, ExternalLink, Eye, Landmark, ListChecks, Map, MapPin, Minus, Plus, Search, Shield, Sprout, Swords, Trash2, TreePine, Upload } from 'lucide-vue-next'
import { OSRS_CATALOG, OSRS_CHECKED_AT, type OsrsEntry } from './catalog'
import { getOsrsAsset } from './assets'
import { loadExamples, removeExample, saveExample, type VisualExample } from './examples'
import '../styles.css'
import './osrs.css'

type Tab = 'map' | 'visual' | 'prompt' | 'skill'
const tabs = [
  { id: 'map' as Tab, name: 'Map', kind: 'place', icon: Map, label: 'Places to start', description: 'A regional guide to towns, banks, and resources. Select a marker or browse the place list.' },
  { id: 'visual' as Tab, name: 'Visual dictionary', kind: 'visual', icon: Eye, label: 'Know the visible cues', description: 'Compare an item or interface cue, check what it can be confused with, then verify it on screen.' },
  { id: 'prompt' as Tab, name: 'Prompt library', kind: 'prompt', icon: ListChecks, label: 'Start with a clear task', description: 'Editable goals with a completion condition. Open one as a draft, add your character details, and review it before starting.' },
  { id: 'skill' as Tab, name: 'Skill guides', kind: 'skill', icon: Sprout, label: 'Check the next step', description: 'Short guides for common activities. Check requirements and use the linked source for the full guide.' },
]
const initialUrl = new URL(window.location.href)
const initialEntry = OSRS_CATALOG.find(entry => entry.id === initialUrl.searchParams.get('entry'))
const initialTab = initialEntry ? tabs.find(tab => tab.kind === initialEntry.kind)?.id : initialUrl.searchParams.get('tab')
const activeTab = ref<Tab>(tabs.some(tab => tab.id === initialTab) ? initialTab as Tab : 'map')
const search = ref(initialUrl.searchParams.get('q')?.slice(0, 200) || '')
const filter = ref(initialUrl.searchParams.get('tag') || '')
const selectedId = ref(initialEntry?.id || '')
const helpOpen = ref(false)
const copyStatus = ref('')
const zoom = ref(1)
const pan = ref({ x: 0, y: 0 })
const dragging = ref(false)
const mapSvg = ref<SVGSVGElement | null>(null)
const examples = ref<VisualExample[]>([])
const exampleBusy = ref(false)
const exampleStatus = ref('')
const exampleError = ref('')
let exampleRequest = 0
let dragOrigin: { clientX: number; clientY: number; x: number; y: number } | undefined
const tab = computed(() => tabs.find(item => item.id === activeTab.value)!)
const sectionEntries = computed(() => OSRS_CATALOG.filter(entry => entry.kind === tab.value.kind))
const filterOptions = computed(() => {
  if (activeTab.value === 'map') return ['town', 'bank', 'resource']
  const counts = new globalThis.Map<string, number>()
  for (const entry of sectionEntries.value) for (const tag of entry.tags) counts.set(tag, (counts.get(tag) || 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12).map(([tag]) => tag)
})
const filteredEntries = computed(() => {
  const terms = search.value.toLowerCase().trim().split(/\s+/).filter(Boolean)
  return sectionEntries.value.filter(entry => {
    const categoryMatch = !filter.value || (activeTab.value === 'map' ? entry.map?.category === filter.value : entry.tags.includes(filter.value))
    const text = [entry.title, entry.summary, ...entry.tags, ...entry.details, entry.visual?.cue, entry.visual?.verify, ...(entry.visual?.confusions || []), entry.prompt?.goal, entry.prompt?.completionCondition, entry.prompt?.notes, ...(entry.skill?.requirements || []), ...(entry.skill?.steps || [])].filter(Boolean).join(' ').toLowerCase()
    return categoryMatch && terms.every(term => text.includes(term))
  })
})
const selectedEntry = computed(() => filteredEntries.value.find(entry => entry.id === selectedId.value) || filteredEntries.value[0])
const relatedEntries = computed(() => selectedEntry.value?.relatedIds.map(id => OSRS_CATALOG.find(entry => entry.id === id)).filter((entry): entry is OsrsEntry => !!entry) || [])
const selectedAsset = computed(() => selectedEntry.value ? entryAsset(selectedEntry.value) : undefined)
const mapTransform = computed(() => `translate(${500 * (1 - zoom.value) + pan.value.x} ${325 * (1 - zoom.value) + pan.value.y}) scale(${zoom.value})`)
const stats = computed(() => [
  { label: 'places', value: OSRS_CATALOG.filter(entry => entry.kind === 'place').length },
  { label: 'visual cues', value: OSRS_CATALOG.filter(entry => entry.kind === 'visual').length },
  { label: 'prompts', value: OSRS_CATALOG.filter(entry => entry.kind === 'prompt').length },
])
const mapTrees = [{ x: 149, y: 286 }, { x: 177, y: 277 }, { x: 200, y: 295 }, { x: 323, y: 392 }, { x: 345, y: 372 }, { x: 364, y: 394 }, { x: 658, y: 430 }, { x: 682, y: 414 }, { x: 703, y: 436 }, { x: 725, y: 415 }, { x: 684, y: 458 }, { x: 94, y: 402 }, { x: 116, y: 389 }, { x: 855, y: 188 }, { x: 878, y: 171 }, { x: 900, y: 194 }]

function entryAsset(entry: OsrsEntry) { return getOsrsAsset(entry.visual?.icon || entry.id) }
function entryIcon(entry: OsrsEntry) {
  const text = `${entry.id} ${entry.title} ${entry.tags.join(' ')}`.toLowerCase()
  if (text.includes('bank')) return Landmark
  if (text.includes('combat') || text.includes('monster') || text.includes('attack')) return Swords
  if (text.includes('wood') || text.includes('tree') || text.includes('logs')) return TreePine
  if (text.includes('quest')) return Compass
  if (text.includes('inventory') || text.includes('item')) return Shield
  return entry.kind === 'place' ? MapPin : entry.kind === 'skill' ? Sprout : entry.kind === 'prompt' ? ListChecks : Crosshair
}
function sourceLabel(url: string) {
  try {
    const parsed = new URL(url)
    const title = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).at(-1) || parsed.hostname).replaceAll('_', ' ')
    return parsed.hostname === 'oldschool.runescape.wiki' ? `OSRS Wiki · ${title}` : `${parsed.hostname.replace(/^www\./, '')} · ${title}`
  } catch { return 'Reference source' }
}
function kindLabel(kind: OsrsEntry['kind']) { return kind === 'place' ? 'Place' : kind === 'visual' ? 'Visual cue' : kind === 'prompt' ? 'Prompt' : 'Skill guide' }
function modeLabel(mode: string) { return mode === 'continuous' ? 'Until stopped' : mode === 'until-complete' ? 'Until complete' : 'Timed task' }
function chooseTab(id: Tab) { activeTab.value = id; filter.value = ''; selectedId.value = ''; copyStatus.value = '' }
function chooseEntry(entry: OsrsEntry, scroll = false) {
  if (entry.kind !== tab.value.kind || !filteredEntries.value.some(item => item.id === entry.id)) { activeTab.value = tabs.find(item => item.kind === entry.kind)!.id; filter.value = ''; search.value = '' }
  selectedId.value = entry.id
  copyStatus.value = ''
  if (scroll) void nextTick(() => document.getElementById('osrs-entry-detail')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
}
function tabKey(event: KeyboardEvent) {
  const current = tabs.findIndex(item => item.id === activeTab.value)
  let index: number | undefined
  if (event.key === 'ArrowRight') index = (current + 1) % tabs.length
  if (event.key === 'ArrowLeft') index = (current - 1 + tabs.length) % tabs.length
  if (event.key === 'Home') index = 0
  if (event.key === 'End') index = tabs.length - 1
  if (index !== undefined) { event.preventDefault(); chooseTab(tabs[index]!.id); void nextTick(() => document.getElementById(`osrs-tab-${activeTab.value}`)?.focus()) }
}
function resetMap() { zoom.value = 1; pan.value = { x: 0, y: 0 } }
function changeZoom(amount: number) { zoom.value = Math.min(2.5, Math.max(1, Math.round((zoom.value + amount) * 100) / 100)); if (zoom.value === 1) pan.value = { x: 0, y: 0 } }
function startDrag(event: PointerEvent) {
  if (zoom.value <= 1 || (event.target as Element)?.closest('[data-map-marker]')) return
  dragOrigin = { clientX: event.clientX, clientY: event.clientY, x: pan.value.x, y: pan.value.y }
  dragging.value = true
  mapSvg.value?.setPointerCapture(event.pointerId)
}
function drag(event: PointerEvent) {
  if (!dragOrigin || !mapSvg.value) return
  const factor = 1000 / mapSvg.value.getBoundingClientRect().width
  const xBound = 500 * (zoom.value - 1)
  const yBound = 325 * (zoom.value - 1)
  pan.value = { x: Math.max(-xBound, Math.min(xBound, dragOrigin.x + (event.clientX - dragOrigin.clientX) * factor)), y: Math.max(-yBound, Math.min(yBound, dragOrigin.y + (event.clientY - dragOrigin.clientY) * factor)) }
}
function endDrag() { dragOrigin = undefined; dragging.value = false }
async function copyPrompt(entry: OsrsEntry) {
  if (!entry.prompt) return
  try { await navigator.clipboard.writeText(`${entry.prompt.goal}\n\nComplete when: ${entry.prompt.completionCondition}\n\nCharacter notes: ${entry.prompt.notes}`); copyStatus.value = 'Prompt copied.' }
  catch { copyStatus.value = 'Clipboard is unavailable. Select and copy the prompt text below.' }
}
async function addExample(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  const entry = selectedEntry.value
  if (!file || !entry || entry.kind !== 'visual') return
  exampleBusy.value = true; exampleStatus.value = ''; exampleError.value = ''
  try {
    await saveExample(entry.id, file)
    const saved = await loadExamples(entry.id)
    if (selectedEntry.value?.id === entry.id) { examples.value = saved; exampleStatus.value = 'Screenshot example saved in this browser.' }
  } catch (error) { if (selectedEntry.value?.id === entry.id) exampleError.value = error instanceof Error ? error.message : String(error) }
  finally { input.value = ''; exampleBusy.value = false }
}
async function deleteExample(example: VisualExample) {
  exampleBusy.value = true; exampleError.value = ''; exampleStatus.value = ''
  try { await removeExample(example.id); if (selectedEntry.value?.id === example.entryId) { examples.value = examples.value.filter(item => item.id !== example.id); exampleStatus.value = 'Screenshot example removed.' } }
  catch (error) { exampleError.value = error instanceof Error ? error.message : String(error) }
  finally { exampleBusy.value = false }
}
function syncFromUrl() {
  const url = new URL(window.location.href)
  const entry = OSRS_CATALOG.find(item => item.id === url.searchParams.get('entry'))
  const requestedTab = entry ? tabs.find(item => item.kind === entry.kind)?.id : url.searchParams.get('tab')
  activeTab.value = tabs.some(item => item.id === requestedTab) ? requestedTab as Tab : 'map'
  search.value = url.searchParams.get('q')?.slice(0, 200) || ''; filter.value = url.searchParams.get('tag') || ''; selectedId.value = entry?.id || ''
}
watch([activeTab, search, filter, selectedEntry], () => {
  const url = new URL(window.location.href)
  url.searchParams.set('tab', activeTab.value)
  for (const [key, value] of [['q', search.value.trim()], ['tag', filter.value], ['entry', selectedEntry.value?.id || '']]) value ? url.searchParams.set(key!, value!) : url.searchParams.delete(key!)
  window.history.replaceState(null, '', url)
})
watch(() => selectedEntry.value?.id, async () => {
  const request = ++exampleRequest
  examples.value = []; exampleStatus.value = ''; exampleError.value = ''; copyStatus.value = ''
  if (selectedEntry.value?.kind !== 'visual') return
  try { const saved = await loadExamples(selectedEntry.value.id); if (request === exampleRequest) examples.value = saved }
  catch (error) { if (request === exampleRequest) exampleError.value = error instanceof Error ? error.message : String(error) }
}, { immediate: true })
function closeHelp(event: KeyboardEvent) { if (event.key === 'Escape' && helpOpen.value) { helpOpen.value = false; document.getElementById('osrs-help-toggle')?.focus() } }
onMounted(() => { document.title = 'OSRS field guide · Lense'; window.addEventListener('popstate', syncFromUrl); window.addEventListener('keydown', closeHelp) })
onUnmounted(() => { window.removeEventListener('popstate', syncFromUrl); window.removeEventListener('keydown', closeHelp); exampleRequest++ })
</script>

<template>
  <div class="osrs-page">
    <header class="osrs-header">
      <a href="/" class="osrs-wordmark" aria-label="Lense control"><span class="osrs-brand-symbol" aria-hidden="true"><i></i><i></i></span>lense<span class="osrs-header-divider"></span><span class="osrs-product-label">FIELD GUIDE</span></a>
      <a class="osrs-back-link" href="/"><ArrowLeft :size="15" /><span>Back to control</span></a>
    </header>

    <main class="osrs-main">
      <section class="osrs-hero" aria-labelledby="osrs-title">
        <div class="osrs-hero-copy"><div class="osrs-eyebrow"><span></span>OLD SCHOOL RUNESCAPE</div><h1 id="osrs-title">The OSRS <em>field guide.</em></h1><p>Find locations, compare visual cues, and turn a guide into a task draft.</p></div>
        <div class="osrs-hero-aside"><div class="osrs-stats"><div v-for="stat in stats" :key="stat.label"><strong>{{ stat.value }}</strong><span>{{ stat.label }}</span></div></div><button id="osrs-help-toggle" class="osrs-help-toggle" :aria-expanded="helpOpen" aria-controls="osrs-help" aria-label="Help with the OSRS field guide" @click="helpOpen = !helpOpen"><CircleHelp :size="19" /></button></div>
      </section>

      <section v-if="helpOpen" id="osrs-help" class="osrs-help" aria-labelledby="osrs-help-title">
        <div><div class="osrs-eyebrow">HOW TO USE THIS GUIDE</div><h2 id="osrs-help-title">Look up a cue. Check it on screen.</h2><p>This guide is a reference. Your character's location, inventory, and progress still need to be checked in a current screenshot.</p></div>
        <ol><li><strong>Find a place or activity.</strong> Search this section or choose a map marker. Source links open the full reference.</li><li><strong>Compare visible details.</strong> The dictionary names useful cues and possible mix-ups. Add a cropped screenshot to keep your own examples.</li><li><strong>Review a task draft.</strong> Choose a prompt, add your character details in Control, then choose a window and start when ready. The guide does not start tasks.</li></ol>
        <p class="osrs-help-foot">A connected screenshot-reading agent makes decisions. Reference symbols are illustrations, not game screenshots. Map positions are schematic, not click coordinates.</p>
      </section>

      <nav class="osrs-tabs" role="tablist" aria-label="OSRS reference sections" @keydown="tabKey"><button v-for="item in tabs" :id="`osrs-tab-${item.id}`" :key="item.id" role="tab" :aria-selected="activeTab === item.id" :tabindex="activeTab === item.id ? 0 : -1" aria-controls="osrs-reference-panel" :class="{ active: activeTab === item.id }" @click="chooseTab(item.id)"><component :is="item.icon" :size="17" /><span>{{ item.name }}</span><span class="osrs-tab-count">{{ OSRS_CATALOG.filter(entry => entry.kind === item.kind).length }}</span></button></nav>

      <section id="osrs-reference-panel" class="osrs-reference-panel" role="tabpanel" :aria-labelledby="`osrs-tab-${activeTab}`" tabindex="0">
        <div class="osrs-section-top"><div><h2>{{ tab.label }}</h2><p>{{ tab.description }}</p></div><div class="osrs-search-row"><label class="osrs-search"><Search :size="17" /><span class="sr-only">Search {{ tab.name.toLowerCase() }}</span><input v-model="search" type="search" :placeholder="`Search ${tab.name.toLowerCase()}…`" maxlength="200" /></label><label class="osrs-filter"><span class="sr-only">Filter {{ tab.name.toLowerCase() }}</span><select v-model="filter" :aria-label="`Filter ${tab.name.toLowerCase()}`"><option value="">All {{ activeTab === 'map' ? 'places' : 'topics' }}</option><option v-for="option in filterOptions" :key="option" :value="option">{{ option.replaceAll('-', ' ') }}</option></select></label></div></div>

        <div class="osrs-reference-layout" :class="{ 'is-map': activeTab === 'map' }">
          <div class="osrs-browse">
            <template v-if="activeTab === 'map'">
              <div class="osrs-map-card">
                <div class="osrs-map-heading"><div><Compass :size="17" /><span>Starter region atlas</span></div><span>SCHEMATIC</span></div>
                <div class="osrs-map-canvas" :class="{ 'is-dragging': dragging, 'is-zoomed': zoom > 1 }">
                  <svg ref="mapSvg" class="osrs-map-svg" viewBox="0 0 1000 650" aria-labelledby="osrs-map-title osrs-map-desc" @pointerdown="startDrag" @pointermove="drag" @pointerup="endDrag" @pointercancel="endDrag" @lostpointercapture="endDrag">
                    <title id="osrs-map-title">OSRS starter region schematic map</title><desc id="osrs-map-desc">An original regional diagram. Select a named marker to read its entry. It does not show your current location or game coordinates.</desc>
                    <defs><pattern id="osrs-map-grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0H0V50" fill="none" stroke="#617951" stroke-opacity=".08" stroke-width="1" /></pattern><pattern id="osrs-map-dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#76896a" opacity=".13" /></pattern><filter id="osrs-marker-shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#294734" flood-opacity=".2" /></filter></defs>
                    <rect width="1000" height="650" fill="#e9ede0" /><rect width="1000" height="650" fill="url(#osrs-map-grid)" />
                    <g :transform="mapTransform">
                      <path d="M0 0H1000V650H0Z" fill="url(#osrs-map-dots)" />
                      <path d="M0 495Q76 452 134 473T258 494Q333 487 404 524T535 564Q620 570 665 650H0Z" fill="#d7e5dd" stroke="#b5ccbe" stroke-width="2" />
                      <path d="M0 534Q95 499 166 517T303 535M21 573Q113 553 198 566M57 611Q169 589 275 621" fill="none" stroke="#b7cec0" stroke-width="2" stroke-linecap="round" />
                      <path d="M759 348Q829 319 905 366T1042 408V690H686Q679 596 700 542T726 448Q710 381 759 348Z" fill="#eee8ce" stroke="#d4cfae" stroke-width="2" />
                      <path d="M815 468Q839 455 861 469M862 506Q884 492 912 509M758 568Q790 550 821 569M921 576Q943 563 969 575" fill="none" stroke="#d6cba4" stroke-width="2" stroke-linecap="round" />
                      <path d="M510 -50Q461 40 500 120T577 253Q645 317 706 355T730 416Q747 472 711 531T741 700" fill="none" stroke="#b6d2c5" stroke-width="22" /><path d="M510 -50Q461 40 500 120T577 253Q645 317 706 355T730 416Q747 472 711 531T741 700" fill="none" stroke="#d1e4db" stroke-width="13" />
                      <path d="M327 -50Q305 58 335 109T386 200Q370 225 396 260" fill="none" stroke="#c4d9cd" stroke-width="10" />
                      <g fill="#cfdcc2" stroke="#aabf99" stroke-width="1.5"><path d="M74 43L98 84H50Z" /><path d="M106 56L128 94H84Z" /><path d="M154 64L181 106H127Z" /><path d="M130 29L160 79H100Z" /><path d="M854 69L882 115H826Z" /><path d="M892 38L925 91H859Z" /></g>
                      <g v-for="(tree, index) in mapTrees" :key="index" :transform="`translate(${tree.x} ${tree.y})`"><path d="M0-15L-9 1H-5L-12 13H12L5 1H9Z" fill="#aec398" stroke="#95ad7f" stroke-width="1" /><path d="M0 13v5" stroke="#92a17e" stroke-width="2" /></g>
                      <text x="253" y="80" class="osrs-map-region">ASGARNIA</text><text x="657" y="60" class="osrs-map-region">MISTHALIN</text><text x="828" y="597" class="osrs-map-region osrs-desert-label">KHARIDIAN DESERT</text><text x="235" y="591" class="osrs-water-label">The southern coast</text>
                      <g v-for="entry in filteredEntries.filter(item => item.map)" :key="entry.id" :transform="`translate(${entry.map!.x * 10} ${entry.map!.y * 6.5})`" class="osrs-map-marker" :class="[entry.map!.category, { selected: selectedEntry?.id === entry.id }]" role="button" tabindex="0" :aria-label="`${entry.title}, ${entry.map!.category}`" :aria-pressed="selectedEntry?.id === entry.id" data-map-marker @click="chooseEntry(entry)" @keydown.enter.prevent="chooseEntry(entry)" @keydown.space.prevent="chooseEntry(entry)">
                        <title>{{ entry.title }}</title><circle v-if="selectedEntry?.id === entry.id" r="23" class="osrs-marker-halo" /><circle r="13" class="osrs-marker-body" filter="url(#osrs-marker-shadow)" /><path v-if="entry.map!.category === 'bank'" d="M-6-2L0-6L6-2ZM-4 0v5M0 0v5M4 0v5M-6 7H6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /><path v-else-if="entry.map!.category === 'resource'" d="M0-7L-5 1H-3L-6 5H6L3 1H5ZM0 5v3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" /><path v-else d="M-6-1L0-6L6-1M-4-1v7h8V-1M-1 6V2h2v4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /><text v-if="entry.map!.category === 'town' || selectedEntry?.id === entry.id" :y="entry.map!.category === 'bank' ? -24 : 31" text-anchor="middle" class="osrs-marker-label">{{ entry.title }}</text>
                      </g>
                    </g>
                    <g transform="translate(942 47)" class="osrs-map-compass"><path d="M0-13L-5 2H5Z" fill="#66815b" /><path d="M0 13L-5-2H5Z" fill="#b9c8aa" /><text y="-22" text-anchor="middle">N</text></g>
                  </svg>
                  <div class="osrs-map-tools" aria-label="Map controls"><button aria-label="Zoom out" :disabled="zoom <= 1" @click="changeZoom(-0.3)"><Minus :size="16" /></button><span>{{ Math.round(zoom * 100) }}%</span><button aria-label="Zoom in" :disabled="zoom >= 2.5" @click="changeZoom(0.3)"><Plus :size="16" /></button><button class="osrs-map-reset" aria-label="Reset map view" @click="resetMap"><Crosshair :size="16" /></button></div>
                  <span class="osrs-map-hint">{{ zoom > 1 ? 'Drag to move the map' : 'Select a marker to explore' }}</span>
                </div>
                <div class="osrs-map-footer"><div class="osrs-map-legend"><span><i class="town"></i>Towns</span><span><i class="bank"></i>Banks</span><span><i class="resource"></i>Resources</span></div><a href="https://oldschool.runescape.wiki/w/World_map" target="_blank" rel="noopener noreferrer">Full OSRS map<ExternalLink :size="12" /></a></div>
              </div>
              <p class="osrs-map-disclaimer">Original regional diagram for orientation. Positions are approximate, not navigation or click coordinates.</p>
              <div class="osrs-place-list-heading"><h3>Browse places</h3><span>{{ filteredEntries.length }} matches</span></div>
              <div class="osrs-place-list"><button v-for="entry in filteredEntries" :key="entry.id" :class="{ selected: selectedEntry?.id === entry.id }" @click="chooseEntry(entry, true)"><component :is="entryIcon(entry)" :size="16" /><span>{{ entry.title }}</span><ChevronRight :size="14" /></button></div>
            </template>

            <template v-else><div class="osrs-results-summary"><span>{{ filteredEntries.length }} {{ filteredEntries.length === 1 ? 'entry' : 'entries' }}</span><span v-if="activeTab === 'visual'"><Eye :size="13" />Symbols are references, not game screenshots</span><span v-else-if="activeTab === 'prompt'"><ListChecks :size="13" />Every prompt opens as a draft</span></div><div class="osrs-entry-grid" :class="`osrs-${activeTab}-grid`"><button v-for="entry in filteredEntries" :key="entry.id" class="osrs-entry-card" :class="{ selected: selectedEntry?.id === entry.id }" :aria-pressed="selectedEntry?.id === entry.id" @click="chooseEntry(entry, true)"><div class="osrs-card-top"><span class="osrs-entry-illustration" :class="{ 'has-asset': !!entryAsset(entry) }"><img v-if="entryAsset(entry)" :src="entryAsset(entry)!.src" :alt="entryAsset(entry)!.alt" loading="lazy" /><component v-else :is="entryIcon(entry)" :size="activeTab === 'visual' ? 35 : 22" :stroke-width="1.5" /></span><ArrowRight :size="16" /></div><span class="osrs-card-category">{{ entry.tags[0]?.replaceAll('-', ' ') || kindLabel(entry.kind) }}</span><h3>{{ entry.title }}</h3><p>{{ entry.summary }}</p><div class="osrs-card-meta"><span v-if="entry.prompt">{{ modeLabel(entry.prompt.runMode) }}</span><span v-else-if="entry.skill">{{ entry.skill.steps.length }} steps</span><span v-else>Compare & verify</span><span v-if="selectedEntry?.id === entry.id">Selected<Check :size="12" /></span></div></button></div></template>
            <div v-if="!filteredEntries.length" class="osrs-empty"><Search :size="28" /><h3>No matching entries</h3><p>Try a shorter search or choose another topic.</p><button class="button button-small" @click="search = ''; filter = ''">Clear filters</button></div>
          </div>

          <aside v-if="selectedEntry" id="osrs-entry-detail" class="osrs-detail" :aria-label="`${selectedEntry.title} details`">
            <div class="osrs-detail-heading"><span class="osrs-detail-kind"><component :is="tab.icon" :size="14" />{{ kindLabel(selectedEntry.kind) }}</span><span class="osrs-detail-number">{{ String(OSRS_CATALOG.indexOf(selectedEntry) + 1).padStart(2, '0') }}</span></div>
            <div v-if="selectedEntry.kind === 'visual'" class="osrs-detail-illustration"><img v-if="selectedAsset" :src="selectedAsset.src" :alt="selectedAsset.alt" /><component v-else :is="entryIcon(selectedEntry)" :size="64" :stroke-width="1.2" /><span>{{ selectedAsset?.caption || 'Reference symbol, not a game screenshot.' }}</span></div>
            <h2>{{ selectedEntry.title }}</h2><p class="osrs-detail-summary">{{ selectedEntry.summary }}</p><div class="osrs-entry-tags"><span v-for="tag in selectedEntry.tags" :key="tag">{{ tag.replaceAll('-', ' ') }}</span></div>
            <div v-if="selectedEntry.visual" class="osrs-visual-details"><section><h3><Eye :size="14" />Look for</h3><p>{{ selectedEntry.visual.cue }}</p></section><section v-if="selectedEntry.visual.confusions.length"><h3><Crosshair :size="14" />Possible mix-ups</h3><ul><li v-for="confusion in selectedEntry.visual.confusions" :key="confusion">{{ confusion }}</li></ul></section><section class="osrs-verify-cue"><h3><Check :size="14" />Verify on screen</h3><p>{{ selectedEntry.visual.verify }}</p></section></div>
            <div v-if="selectedEntry.prompt" class="osrs-prompt-details"><div class="osrs-prompt-mode"><span class="signal-dot"></span>{{ modeLabel(selectedEntry.prompt.runMode) }}</div><section><h3>The task</h3><p class="osrs-prompt-text">{{ selectedEntry.prompt.goal }}</p></section><section><h3>Complete when</h3><p>{{ selectedEntry.prompt.completionCondition }}</p></section><section><h3>Add your character details</h3><p>{{ selectedEntry.prompt.notes }}</p></section><a class="button button-primary osrs-use-prompt" :href="`/?osrsPrompt=${encodeURIComponent(selectedEntry.id)}`">Use this prompt<ArrowRight :size="15" /></a><button class="osrs-copy-prompt" @click="copyPrompt(selectedEntry)"><Check v-if="copyStatus === 'Prompt copied.'" :size="14" /><Copy v-else :size="14" />Copy prompt text</button><p v-if="copyStatus" class="osrs-inline-status" role="status">{{ copyStatus }}</p><p class="osrs-draft-note">Opens in Control for review. Nothing starts automatically.</p></div>
            <div v-if="selectedEntry.skill" class="osrs-skill-details"><section><h3>Before you start</h3><ul><li v-for="requirement in selectedEntry.skill.requirements" :key="requirement">{{ requirement }}</li></ul></section><section><h3>Follow the steps</h3><ol><li v-for="step in selectedEntry.skill.steps" :key="step">{{ step }}</li></ol></section></div>
            <section v-if="selectedEntry.details.length" class="osrs-detail-notes"><h3>{{ selectedEntry.kind === 'place' ? 'At this location' : 'Reference notes' }}</h3><p v-for="detail in selectedEntry.details" :key="detail">{{ detail }}</p></section>
            <details v-if="selectedEntry.kind === 'visual'" class="osrs-examples"><summary><span><Upload :size="14" />Your screenshot examples</span><span>{{ examples.length }}/4</span></summary><p>Use a tightly cropped screenshot from your game. Examples stay in this browser and are shared with the agent only when it requests this entry with images.</p><div v-if="examples.length" class="osrs-example-grid"><figure v-for="example in examples" :key="example.id"><img :src="example.image" :alt="`Saved screenshot example of ${selectedEntry.title}`" /><figcaption>{{ example.width }} × {{ example.height }}</figcaption><button :disabled="exampleBusy" :aria-label="`Remove screenshot example from ${new Date(example.createdAt).toLocaleString()}`" @click="deleteExample(example)"><Trash2 :size="13" /></button></figure></div><label class="osrs-example-upload" :class="{ disabled: exampleBusy || examples.length >= 4 }"><Plus :size="15" /><span>{{ exampleBusy ? 'Saving…' : 'Add screenshot example' }}</span><input type="file" accept="image/png,image/jpeg" :disabled="exampleBusy || examples.length >= 4" @change="addExample" /></label><small>PNG or JPEG. Up to 512 KB each, 4 per entry.</small><p v-if="exampleStatus" class="osrs-inline-status" role="status">{{ exampleStatus }}</p><p v-if="exampleError" class="osrs-inline-error" role="alert">{{ exampleError }}</p></details>
            <section v-if="relatedEntries.length" class="osrs-related"><h3>Related entries</h3><button v-for="entry in relatedEntries" :key="entry.id" @click="chooseEntry(entry)"><component :is="entryIcon(entry)" :size="14" /><span>{{ entry.title }}<small>{{ kindLabel(entry.kind) }}</small></span><ChevronRight :size="14" /></button></section>
            <section class="osrs-sources"><h3>Read the source</h3><a v-for="url in selectedEntry.sourceUrls" :key="url" :href="url" target="_blank" rel="noopener noreferrer">{{ sourceLabel(url) }}<ExternalLink :size="12" /></a><p v-if="selectedAsset">{{ selectedAsset.attribution }}</p></section>
          </aside>
        </div>
      </section>

      <footer class="osrs-footer"><span><BookOpen :size="13" />Reference notes checked {{ OSRS_CHECKED_AT }}. Game details can change.</span><a href="/">Return to control<ArrowRight :size="13" /></a></footer>
    </main>
  </div>
</template>
