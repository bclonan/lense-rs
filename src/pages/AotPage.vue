<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock3,
  Command,
  Database,
  Eye,
  GitBranch,
  Github,
  HardDrive,
  Layers,
  Monitor,
  Pause,
  Play,
  Radio,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Workflow,
} from 'lucide-vue-next'
import '../styles.css'

type ScenarioId = 'runescape' | 'photoshop' | 'rock'

type Scenario = {
  id: ScenarioId
  label: string
  eyebrow: string
  goal: string
  summary: string
  context: string[]
  active: string[]
  dormant: string[]
  packet: string
  result: string
}

const scenarios: Scenario[] = [
  {
    id: 'runescape',
    label: 'RuneScape',
    eyebrow: 'FAMILIAR DIGITAL WORLD',
    goal: 'Get one log, verify it, and continue without asking the agent to inspect every frame.',
    summary: 'The router activates Windows, RuneScape, woodcutting, visible trees, the player, inventory, and the current target watcher.',
    context: ['Windows', 'RuneScape', 'Woodcutting', 'Tree #17'],
    active: ['player state', 'visible trees', 'inventory count', 'woodcutting skill', 'target watcher'],
    dormant: ['Photoshop tools', 'weather-card patterns', 'physical rocks', 'AR clothing'],
    packet: `{
  "event": "tree_depleted",
  "target": "tree:17",
  "inventoryDelta": 1,
  "nextCandidates": 2,
  "confidence": 0.997
}`,
    result: 'The agent receives a verified state change instead of another full screenshot.',
  },
  {
    id: 'photoshop',
    label: 'Photoshop',
    eyebrow: 'NEW APPLICATION, KNOWN PATTERN',
    goal: 'Make a photo warmer, even when Lense has never used this exact version of the application.',
    summary: 'Generic UI and image-editing capsules stay active while the external agent teaches one unfamiliar control sequence.',
    context: ['Windows', 'Photoshop', 'Image editing', 'Current document'],
    active: ['canvas bounds', 'selected tool', 'visible controls', 'undo state', 'document watcher'],
    dormant: ['RuneScape entities', 'AR geology', 'browser dashboard skills', 'physical motion models'],
    packet: `{
  "goal": "make image warmer",
  "knownPattern": "adjustment-control",
  "unknownControls": ["entity:slider:8"],
  "evidence": "crop:blake3:7b...",
  "need": "identify control and expected result"
}`,
    result: 'The first successful demonstration becomes a structured before/action/after episode for later local execution.',
  },
  {
    id: 'rock',
    label: 'AR rock',
    eyebrow: 'NOVEL PHYSICAL OBJECT',
    goal: 'Identify the rock in the center of view, add it to a collection, and keep its details attached as the wearer moves.',
    summary: 'The target receives high-resolution attention; unrelated scene elements remain cheap motion and safety sentinels.',
    context: ['Physical world', 'Rocks', 'Target object', 'Collection'],
    active: ['target texture', 'shape and depth', 'hand relation', 'collection matches', 'projection anchor'],
    dormant: ['desktop controls', 'game skills', 'cloud classification', 'unrelated object semantics'],
    packet: `{
  "goal": "identify-and-collect-rock",
  "target": "rock:A927",
  "observed": ["dark gray", "fine-grained", "matte"],
  "depthMeters": 0.83,
  "evidence": ["front-crop", "texture-crop"]
}`,
    result: 'Once identified, the detail card follows the persistent rock entity without frame-by-frame LLM calls.',
  },
]

const selectedScenario = ref<ScenarioId>('runescape')
const scenario = computed(() => scenarios.find(item => item.id === selectedScenario.value) ?? scenarios[0])

const cycleLength = 24
const globalFrame = ref(0)
const playing = ref(true)
let timer: number | undefined

const cycleFrame = computed(() => globalFrame.value % cycleLength)
const cycleNumber = computed(() => Math.floor(globalFrame.value / cycleLength) + 1)

const phases = [
  { start: 0, end: 3, label: 'Observe', detail: 'Acquire one useful world state.' },
  { start: 4, end: 6, label: 'Locate', detail: 'Bind an action to a persistent entity.' },
  { start: 7, end: 9, label: 'Act', detail: 'Resolve the target at execution time.' },
  { start: 10, end: 15, label: 'Watch', detail: 'Track cheap deltas while the agent sleeps.' },
  { start: 16, end: 19, label: 'Verify', detail: 'Confirm the expected state transition.' },
  { start: 20, end: 23, label: 'Learn', detail: 'Store the episode and update local knowledge.' },
]

const currentPhase = computed(() => phases.find(item => cycleFrame.value >= item.start && cycleFrame.value <= item.end) ?? phases[0])

const eventDefinitions = [
  { frame: 0, source: 'camera', title: 'Scene keyframe accepted', detail: 'Relevant entities restored from the world graph.' },
  { frame: 4, source: 'tree:17', title: 'Target reacquired', detail: 'Current mask and safe click anchor resolved.' },
  { frame: 7, source: 'action', title: 'Interact dispatched', detail: 'Causal action event written before input.' },
  { frame: 10, source: 'player', title: 'Chopping state detected', detail: 'Player and target clocks advance; inventory remains asleep.' },
  { frame: 16, source: 'tree:17', title: 'Tree depleted', detail: 'Expected target transition observed.' },
  { frame: 17, source: 'inventory', title: 'Log count increased', detail: 'Independent evidence confirms success.' },
  { frame: 20, source: 'watcher', title: 'Goal verified', detail: 'The agent wakes with a compact event packet.' },
  { frame: 23, source: 'memory', title: 'Episode consolidated', detail: 'Representative evidence retained; routine frames expire.' },
]

const visibleEvents = computed(() => {
  const visible = eventDefinitions.filter(event => event.frame <= cycleFrame.value)
  return visible.slice(Math.max(0, visible.length - 4)).reverse()
})

function ticksAt(thresholds: number[]) {
  return thresholds.filter(frame => frame <= cycleFrame.value).length
}

const clockRows = computed(() => [
  {
    label: 'Capture stream',
    kind: 'global',
    value: globalFrame.value,
    unit: 'frames',
    note: 'Global evidence clock',
    thresholds: Array.from({ length: cycleLength }, (_, index) => index),
  },
  {
    label: 'Player',
    kind: 'entity',
    value: ticksAt([0, 4, 7, 10, 16]),
    unit: 'ticks',
    note: 'Movement and action state',
    thresholds: [0, 4, 7, 10, 16],
  },
  {
    label: 'Tree #17',
    kind: 'entity',
    value: ticksAt([0, 4, 10, 16, 20]),
    unit: 'ticks',
    note: 'Target-local operational time',
    thresholds: [0, 4, 10, 16, 20],
  },
  {
    label: 'Inventory',
    kind: 'entity',
    value: ticksAt([0, 17]),
    unit: 'ticks',
    note: 'Sleeps until a relevant change',
    thresholds: [0, 17],
  },
  {
    label: 'WebMCP agent',
    kind: 'agent',
    value: ticksAt([0, 7, 20]),
    unit: 'wakeups',
    note: 'Goal, action, verified result',
    thresholds: [0, 7, 20],
  },
])

const architecture = [
  { name: 'Observe', text: 'Capture screen, camera, depth, DOM, accessibility, audio, and system events.', output: 'changed regions', cadence: 'continuous / cheap' },
  { name: 'Normalize', text: 'Assign persistent entities and observer-relative hierarchical grid addresses.', output: 'WorldDelta', cadence: 'event driven' },
  { name: 'Route', text: 'Activate only the domains, tasks, entities, and memories relevant to the goal.', output: 'active context', cadence: 'on goal or novelty' },
  { name: 'Predict', text: 'Estimate next states, event timing, affordances, changed regions, and uncertainty.', output: 'possible futures', cadence: 'per local clock' },
  { name: 'Act', text: 'Resolve current targets and execute permitted WebMCP, keyboard, pointer, or device actions.', output: 'causal action', cadence: 'as needed' },
  { name: 'Watch', text: 'Monitor expected predicates without keeping the expensive language model in the loop.', output: 'verified event', cadence: 'native watcher' },
  { name: 'Learn', text: 'Store episodes, update prototypes, train adapters, and promote validated rules.', output: 'reusable skill', cadence: 'fast + slow paths' },
]

const storageLayers = [
  { code: 'L0', title: 'Raw ring buffer', retention: '2–10 seconds', detail: 'GPU-resident evidence for recovery, novelty, and training capture.', ratio: 100 },
  { code: 'L1', title: 'Keyframes + deltas', retention: 'selected moments', detail: 'Changed tiles, motion, and short visual evidence instead of every frame.', ratio: 74 },
  { code: 'L2', title: 'Entity evidence', retention: 'state changes', detail: 'Canonical crops, masks, depth summaries, and persistent identity tracks.', ratio: 51 },
  { code: 'L3', title: 'Episodes', retention: 'durable', detail: 'Before state, action, after state, causal lineage, outcome, and confidence.', ratio: 33 },
  { code: 'L4', title: 'Rules + skills', retention: 'versioned', detail: 'Validated state machines and compact transition knowledge.', ratio: 16 },
]

const auditColumns = [
  {
    label: 'Working foundation',
    tone: 'solid',
    icon: Check,
    items: [
      'WebMCP-visible tools and structured actions',
      'Local Rust bridge for observation and input',
      'Observe → act → verify feedback loop',
      'Watchers, event history, and replayable evidence',
    ],
  },
  {
    label: 'Research hypotheses',
    tone: 'active',
    icon: Sparkles,
    items: [
      'Object-local clocks reduce semantic updates',
      'Task routing lowers memory and model cost',
      'Action-conditioned transitions generalize across apps',
      'Repeated transitions can crystallize into guarded rules',
    ],
  },
  {
    label: 'Not claimed yet',
    tone: 'guarded',
    icon: ShieldCheck,
    items: [
      'Universal visual understanding or autonomy',
      'Custom-number superiority without ablations',
      'Lossless compression of arbitrary visual data',
      'Safe unsupervised learning from untrusted environments',
    ],
  },
]

const roadmap = [
  { phase: '00', title: 'Contracts', text: 'Freeze Entity, WorldDelta, Action, Event, Watcher, Capsule, Rule, Episode, Projection, and LLM packet schemas.' },
  { phase: '01', title: 'Native loop', text: 'Move timing-critical capture, action, watcher, audit, and overlay work into the local runtime.' },
  { phase: '02', title: 'World graph', text: 'Add persistent identity, relationships, canonical grid coordinates, and event-sourced state reconstruction.' },
  { phase: '03', title: 'Object time', text: 'Benchmark fixed-rate processing against local clocks and dependency-triggered updates.' },
  { phase: '04', title: 'LenseNet v0', text: 'Train next-state, event-time, delta, affordance, evaluation, identity, routing, and uncertainty heads.' },
  { phase: '05', title: 'Rules + skills', text: 'Promote reliable transitions into guarded state machines with provenance, fallback, and rollback.' },
  { phase: '06', title: 'Spatial output', text: 'Attach labels, generated appearances, and interfaces to moving entities through the projection graph.' },
]

function step() {
  globalFrame.value += 1
}

function reset() {
  globalFrame.value = 0
}

function togglePlaying() {
  playing.value = !playing.value
}

function scrollToArchitecture() {
  document.querySelector('#architecture')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

onMounted(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  playing.value = !reducedMotion
  timer = window.setInterval(() => {
    if (playing.value) step()
  }, 520)
})

onUnmounted(() => {
  if (timer) window.clearInterval(timer)
})
</script>

<template>
  <div class="aot-page">
    <a class="aot-skip" href="#aot-main">Skip to content</a>

    <header class="aot-nav-shell">
      <div class="aot-nav">
        <a class="aot-brand" href="/" aria-label="Lense control workspace">
          <span class="aot-brand-mark" aria-hidden="true"><i></i><i></i></span>
          <span>lense</span>
          <small>RESEARCH</small>
        </a>
        <nav aria-label="Project resources">
          <a class="active" href="/research" aria-current="page">Research</a>
          <a href="/">Control</a>
          <a href="/webmcp">WebMCP</a>
          <a href="/hackathon">Hackathon</a>
          <a class="aot-github" href="https://github.com/bclonan/lense-rs" target="_blank" rel="noreferrer">
            <Github :size="15" aria-hidden="true" />
            <span>GitHub</span>
          </a>
        </nav>
      </div>
    </header>

    <main id="aot-main" tabindex="-1">
      <section class="aot-hero">
        <div class="aot-hero-copy">
          <div class="aot-kicker"><span></span>LENSE-AOT · PRODUCT AND RESEARCH DIRECTION</div>
          <h1>A visual agent that learns in <em>object time.</em></h1>
          <p class="aot-lede">
            Lense turns screens and camera streams into persistent entities, local clocks, causal transitions,
            watchers, rules, and reusable skills. The language model plans and handles novelty; the local runtime
            increasingly sees, predicts, verifies, and acts on its own.
          </p>
          <div class="aot-actions">
            <a class="aot-button aot-button-primary" href="/">
              Open live control <ArrowRight :size="15" aria-hidden="true" />
            </a>
            <button class="aot-button" type="button" @click="scrollToArchitecture">
              Explore architecture <ArrowRight :size="15" aria-hidden="true" />
            </button>
          </div>
          <div class="aot-hero-principles" aria-label="Core principles">
            <span><Eye :size="14" /> Pixels are evidence</span>
            <span><GitBranch :size="14" /> Events are state</span>
            <span><Command :size="14" /> LLM is fallback</span>
          </div>
        </div>

        <div class="aot-world-card" aria-label="Active world model example">
          <div class="aot-world-toolbar">
            <span><i></i> ACTIVE WORLD</span>
            <small>observer 01 · cycle {{ cycleNumber }}</small>
          </div>
          <div class="aot-world-goal">
            <span>GOAL</span>
            <strong>Obtain one log and verify the outcome.</strong>
          </div>
          <div class="aot-context-route" aria-label="Active context route">
            <template v-for="(node, index) in scenarios[0].context" :key="node">
              <span>{{ node }}</span>
              <ArrowRight v-if="index < scenarios[0].context.length - 1" :size="12" aria-hidden="true" />
            </template>
          </div>
          <div class="aot-entity-map">
            <div class="aot-entity player"><span>PLAYER</span><b>idle → chopping</b><small>tick 04</small></div>
            <div class="aot-entity tree"><span>TARGET</span><b>Tree #17</b><small>grid D7·B4·C2</small></div>
            <div class="aot-entity inventory"><span>EVIDENCE</span><b>Logs 18 → 19</b><small>tick 02</small></div>
            <svg class="aot-map-lines" viewBox="0 0 540 250" preserveAspectRatio="none" aria-hidden="true">
              <path d="M130 192 C190 170 208 100 288 86" />
              <path d="M302 97 C352 120 364 183 420 196" />
            </svg>
          </div>
          <div class="aot-world-result">
            <Radio :size="14" aria-hidden="true" />
            <span>Watcher armed</span>
            <b>tree depleted OR inventory +1</b>
          </div>
        </div>
      </section>

      <section id="object-time" class="aot-section aot-time-section" aria-labelledby="object-time-heading">
        <div class="aot-section-heading">
          <div>
            <span class="aot-index">01 · OBJECT TIME</span>
            <h2 id="object-time-heading">One scene. Several useful clocks.</h2>
          </div>
          <p>
            The global stream preserves evidence and causality. Each entity advances only when its own state,
            dependencies, task relevance, or predicted deadline requires an update.
          </p>
        </div>

        <div class="aot-time-demo">
          <div class="aot-clock-panel">
            <div class="aot-demo-toolbar">
              <div>
                <span class="aot-live-dot"></span>
                <strong>Woodcutting transition</strong>
                <small aria-live="polite">{{ currentPhase.label }} · {{ currentPhase.detail }}</small>
              </div>
              <div class="aot-demo-controls">
                <button type="button" :aria-label="playing ? 'Pause simulation' : 'Play simulation'" @click="togglePlaying">
                  <Pause v-if="playing" :size="14" aria-hidden="true" />
                  <Play v-else :size="14" aria-hidden="true" />
                </button>
                <button type="button" aria-label="Advance one frame" @click="step"><ArrowRight :size="14" aria-hidden="true" /></button>
                <button type="button" aria-label="Reset simulation" @click="reset"><RefreshCw :size="14" aria-hidden="true" /></button>
              </div>
            </div>

            <div class="aot-phase-strip" aria-label="Feedback loop phases">
              <div
                v-for="phase in phases"
                :key="phase.label"
                :class="['aot-phase', { active: phase.label === currentPhase.label }]"
              >
                <span></span>{{ phase.label }}
              </div>
            </div>

            <div class="aot-clock-list">
              <div v-for="row in clockRows" :key="row.label" :class="['aot-clock-row', `is-${row.kind}`]">
                <div class="aot-clock-label">
                  <strong>{{ row.label }}</strong>
                  <span>{{ row.note }}</span>
                </div>
                <div class="aot-clock-track" aria-hidden="true">
                  <span
                    v-for="frame in row.thresholds"
                    :key="frame"
                    class="aot-tick"
                    :class="{ passed: frame <= cycleFrame }"
                    :style="{ left: `${(frame / (cycleLength - 1)) * 100}%` }"
                  ></span>
                  <i :style="{ width: `${(cycleFrame / (cycleLength - 1)) * 100}%` }"></i>
                </div>
                <div class="aot-clock-value"><strong>{{ row.value }}</strong><span>{{ row.unit }}</span></div>
              </div>
            </div>

            <div class="aot-time-summary">
              <div><span>24</span><small>capture opportunities</small></div>
              <ArrowRight :size="16" aria-hidden="true" />
              <div><span>5</span><small>tree updates</small></div>
              <ArrowRight :size="16" aria-hidden="true" />
              <div><span>3</span><small>agent wakeups</small></div>
            </div>
          </div>

          <aside class="aot-event-panel" aria-label="Recent causal events">
            <div class="aot-event-heading">
              <div><Activity :size="15" aria-hidden="true" /><span>CAUSAL EVENT LOG</span></div>
              <small>frame {{ String(cycleFrame).padStart(2, '0') }}</small>
            </div>
            <ol>
              <li v-for="event in visibleEvents" :key="`${cycleNumber}-${event.frame}`">
                <span>{{ String(event.frame).padStart(2, '0') }}</span>
                <div><strong>{{ event.title }}</strong><small>{{ event.detail }}</small></div>
                <code>{{ event.source }}</code>
              </li>
            </ol>
            <div class="aot-event-rule">
              <Clock3 :size="15" aria-hidden="true" />
              <div><strong>Composite time</strong><span>global · logical · local tick · state phase</span></div>
            </div>
          </aside>
        </div>
      </section>

      <section class="aot-section" aria-labelledby="principles-heading">
        <div class="aot-section-heading compact">
          <div>
            <span class="aot-index">02 · PRODUCT PRINCIPLES</span>
            <h2 id="principles-heading">Spend intelligence where it changes the outcome.</h2>
          </div>
        </div>
        <div class="aot-principle-grid">
          <article>
            <div class="aot-principle-icon"><Layers :size="20" /></div>
            <span>01</span>
            <h3>Reason over objects, not whole frames.</h3>
            <p>Persistent entities retain identity, state, local memory, affordances, timing, and relationships while pixels expire.</p>
          </article>
          <article>
            <div class="aot-principle-icon"><ScanLine :size="20" /></div>
            <span>02</span>
            <h3>Route attention from the user’s actual goal.</h3>
            <p>Relevant regions and capsules receive detailed processing. The rest of the scene stays a cheap novelty, motion, and safety sentinel.</p>
          </article>
          <article>
            <div class="aot-principle-icon"><Workflow :size="20" /></div>
            <span>03</span>
            <h3>Compile repetition into guarded behavior.</h3>
            <p>Neural predictions remain probabilistic. Reliable transitions can become versioned rules with evidence, time windows, fallback, and rollback.</p>
          </article>
        </div>
      </section>

      <section id="contexts" class="aot-section aot-context-section" aria-labelledby="contexts-heading">
        <div class="aot-section-heading">
          <div>
            <span class="aot-index">03 · SPARSE CONTEXT</span>
            <h2 id="contexts-heading">Load the world the task needs.</h2>
          </div>
          <p>
            A polyhierarchy connects environments, skills, object types, instances, and relationships. The router activates a small useful subgraph instead of every memory Lense has ever learned.
          </p>
        </div>

        <div class="aot-context-console">
          <div class="aot-scenario-tabs" role="tablist" aria-label="Context examples">
            <button
              v-for="item in scenarios"
              :key="item.id"
              type="button"
              role="tab"
              :aria-selected="selectedScenario === item.id"
              :class="{ active: selectedScenario === item.id }"
              @click="selectedScenario = item.id"
            >
              {{ item.label }}
            </button>
          </div>

          <div class="aot-context-content">
            <div class="aot-context-copy">
              <span>{{ scenario.eyebrow }}</span>
              <h3>{{ scenario.goal }}</h3>
              <p>{{ scenario.summary }}</p>
              <div class="aot-route-line" aria-label="Selected context path">
                <template v-for="(node, index) in scenario.context" :key="node">
                  <b>{{ node }}</b>
                  <ArrowRight v-if="index < scenario.context.length - 1" :size="12" aria-hidden="true" />
                </template>
              </div>
              <div class="aot-context-lists">
                <div>
                  <span><Radio :size="13" /> ACTIVE</span>
                  <ul><li v-for="item in scenario.active" :key="item">{{ item }}</li></ul>
                </div>
                <div class="dormant">
                  <span>DORMANT</span>
                  <ul><li v-for="item in scenario.dormant" :key="item">{{ item }}</li></ul>
                </div>
              </div>
            </div>

            <div class="aot-packet">
              <div class="aot-packet-heading">
                <div><Command :size="15" /><span>SMALLEST SUFFICIENT PACKET</span></div>
                <small>external model boundary</small>
              </div>
              <pre>{{ scenario.packet }}</pre>
              <div class="aot-packet-result"><Check :size="14" /><span>{{ scenario.result }}</span></div>
            </div>
          </div>
        </div>
      </section>

      <section id="architecture" class="aot-section aot-architecture-section" aria-labelledby="architecture-heading">
        <div class="aot-section-heading">
          <div>
            <span class="aot-index">04 · SYSTEM ARCHITECTURE</span>
            <h2 id="architecture-heading">One loop, separated by latency and trust.</h2>
          </div>
          <p>
            Native capture, tracking, watchers, input, and projections stay inside the real-time loop. The WebMCP or language layer receives structured world state and handles goals, novelty, ambiguity, and long-horizon planning.
          </p>
        </div>

        <ol class="aot-architecture-flow">
          <li v-for="(stepItem, index) in architecture" :key="stepItem.name">
            <div class="aot-step-number">{{ String(index + 1).padStart(2, '0') }}</div>
            <div class="aot-step-copy">
              <h3>{{ stepItem.name }}</h3>
              <p>{{ stepItem.text }}</p>
              <span>{{ stepItem.cadence }}</span>
            </div>
            <div class="aot-step-output"><small>OUTPUT</small><strong>{{ stepItem.output }}</strong></div>
            <ArrowRight v-if="index < architecture.length - 1" class="aot-step-arrow" :size="16" aria-hidden="true" />
          </li>
        </ol>

        <div class="aot-plane-grid">
          <article><Monitor :size="17" /><span>REAL-TIME PLANE</span><strong>capture · tracking · input · render</strong><small>milliseconds</small></article>
          <article><GitBranch :size="17" /><span>WORLD PLANE</span><strong>entities · relations · clocks · predictions</strong><small>events</small></article>
          <article><Command :size="17" /><span>AGENT PLANE</span><strong>goals · novelty · semantics · replanning</strong><small>as needed</small></article>
          <article><Database :size="17" /><span>LEARNING PLANE</span><strong>episodes · prototypes · adapters · rules</strong><small>fast + offline</small></article>
        </div>
      </section>

      <section class="aot-section aot-storage-section" aria-labelledby="storage-heading">
        <div class="aot-section-heading">
          <div>
            <span class="aot-index">05 · MEMORY AND STORAGE</span>
            <h2 id="storage-heading">Keep meaning. Let routine pixels expire.</h2>
          </div>
          <p>
            The durable record moves from visual evidence toward causal events, transitions, rules, and skills. High-fidelity evidence survives when it is novel, uncertain, failed, disputed, or useful for training.
          </p>
        </div>

        <div class="aot-storage-layout">
          <div class="aot-storage-funnel">
            <article v-for="layer in storageLayers" :key="layer.code" :style="{ width: `${layer.ratio}%` }">
              <span>{{ layer.code }}</span>
              <div><strong>{{ layer.title }}</strong><small>{{ layer.detail }}</small></div>
              <b>{{ layer.retention }}</b>
            </article>
          </div>
          <aside>
            <HardDrive :size="22" aria-hidden="true" />
            <span>RETENTION SCORE</span>
            <code>novelty + uncertainty + failure + training utility</code>
            <p>Routine success compresses aggressively. Hard examples keep their evidence and provenance.</p>
          </aside>
        </div>
      </section>

      <section class="aot-section aot-audit-section" aria-labelledby="audit-heading">
        <div class="aot-section-heading">
          <div>
            <span class="aot-index">06 · HONEST RESEARCH AUDIT</span>
            <h2 id="audit-heading">Separate the product, the hypotheses, and the claims.</h2>
          </div>
          <p>
            The integration is advanced and potentially distinctive. Its value must be demonstrated against fixed-frame, monolithic, standard-grid, retrieval-only, and external-agent baselines.
          </p>
        </div>

        <div class="aot-audit-grid">
          <article v-for="column in auditColumns" :key="column.label" :class="column.tone">
            <component :is="column.icon" :size="19" aria-hidden="true" />
            <h3>{{ column.label }}</h3>
            <ul><li v-for="item in column.items" :key="item">{{ item }}</li></ul>
          </article>
        </div>

        <div class="aot-hypothesis">
          <div>
            <span>PRIMARY TESTABLE HYPOTHESIS</span>
            <strong>Interacting local event streams can represent a visual world more efficiently than one uniform semantic frame stream.</strong>
          </div>
          <div class="aot-hypothesis-metrics">
            <span>same or better completion</span>
            <span>fewer semantic updates</span>
            <span>lower persisted bytes</span>
            <span>calibrated uncertainty</span>
          </div>
        </div>
      </section>

      <section class="aot-section aot-roadmap-section" aria-labelledby="roadmap-heading">
        <div class="aot-section-heading">
          <div>
            <span class="aot-index">07 · BUILD PLAN</span>
            <h2 id="roadmap-heading">Prove the clock before expanding the world.</h2>
          </div>
          <p>
            Start with a controlled visual environment, one Windows workflow, and one WebMCP page. AR and broad continual learning come after the event model, benchmark, and safety boundaries are stable.
          </p>
        </div>

        <ol class="aot-roadmap">
          <li v-for="item in roadmap" :key="item.phase">
            <span>{{ item.phase }}</span>
            <div><h3>{{ item.title }}</h3><p>{{ item.text }}</p></div>
          </li>
        </ol>
      </section>

      <section class="aot-final-cta">
        <div>
          <span>NEXT CONCRETE ARTIFACT</span>
          <h2>Build the Lense-AOT protocol and benchmark harness.</h2>
          <p>Every later feature—the desktop runtime, custom model, rule compiler, WebMCP packets, storage engine, glasses, and AR projection graph—depends on those contracts.</p>
        </div>
        <div class="aot-actions">
          <a class="aot-button aot-button-lime" href="https://github.com/bclonan/lense-rs" target="_blank" rel="noreferrer">
            View repository <ArrowUpRight :size="15" />
          </a>
          <a class="aot-button aot-button-dark" href="/webmcp">Inspect WebMCP tools <ArrowRight :size="15" /></a>
        </div>
      </section>
    </main>

    <footer class="aot-footer">
      <div><strong>lense</strong><span>Local visual control, verification, and learning.</span></div>
      <nav aria-label="Footer links"><a href="/">Control</a><a href="/webmcp">WebMCP</a><a href="/hackathon">Hackathon</a></nav>
    </footer>
  </div>
</template>

<style scoped>
.aot-page{--aot-ink:#173d2f;--aot-deep:#102d23;--aot-paper:#fffffa;--aot-bg:#f7f7f0;--aot-line:#dde2d6;--aot-muted:#747d70;--aot-lime:#daf58a;min-height:100vh;background:var(--aot-bg);color:var(--aot-ink);font-family:'DM Sans','Segoe UI',sans-serif}.aot-skip{position:fixed;left:18px;top:-60px;z-index:100;background:var(--aot-lime);color:var(--aot-deep);padding:10px 14px;border-radius:7px;font-weight:700}.aot-skip:focus{top:14px}.aot-nav-shell{position:sticky;top:0;z-index:40;background:#f7f7f0e8;border-bottom:1px solid var(--aot-line);backdrop-filter:blur(18px)}.aot-nav{max-width:1240px;height:74px;margin:0 auto;padding:0 28px;display:flex;align-items:center;justify-content:space-between;gap:28px}.aot-brand{display:flex;align-items:center;gap:10px;font-size:24px;font-weight:600;letter-spacing:-1.2px}.aot-brand small{font-size:7px;letter-spacing:1.8px;color:#7d8877;border-left:1px solid #ccd4c5;padding-left:12px;margin-left:2px}.aot-brand-mark{position:relative;width:26px;height:28px;display:block;transform:rotate(-18deg)}.aot-brand-mark i{position:absolute;left:3px;top:4px;width:14px;height:20px;border:1.8px solid var(--aot-ink);border-radius:50%}.aot-brand-mark i+i{left:10px}.aot-nav nav{display:flex;align-items:center;gap:6px}.aot-nav nav a{font-size:11px;color:#727c70;padding:9px 10px;border-radius:7px}.aot-nav nav a:hover,.aot-nav nav a.active{color:var(--aot-ink);background:#edf1e7}.aot-nav nav a.active{font-weight:600}.aot-nav .aot-github{display:flex;align-items:center;gap:6px;border:1px solid #d7ddd1;margin-left:6px;background:#fffffa}main{overflow:hidden}.aot-hero{max-width:1240px;margin:0 auto;padding:90px 28px 76px;display:grid;grid-template-columns:minmax(0,1.03fr) minmax(460px,.97fr);gap:80px;align-items:center}.aot-kicker,.aot-index{font-size:8px;letter-spacing:1.7px;font-weight:700;color:#74806e}.aot-kicker{display:flex;align-items:center;gap:9px;margin-bottom:25px}.aot-kicker span{width:20px;height:1px;background:#8a9f67}.aot-hero h1{font-family:'Instrument Serif',Georgia,serif;font-size:76px;line-height:.98;letter-spacing:-2.7px;font-weight:400;max-width:680px}.aot-hero h1 em{font-weight:400;color:#4c6c48}.aot-lede{max-width:650px;margin-top:27px;font-size:16px;line-height:1.75;color:#59675c}.aot-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.aot-hero .aot-actions{margin-top:34px}.aot-button{min-height:43px;padding:0 17px;border:1px solid #d5dccf;border-radius:8px;background:#fffffa;display:inline-flex;align-items:center;justify-content:center;gap:9px;font-size:11px;font-weight:600;transition:transform .16s,background .16s}.aot-button:hover{background:#edf2e7;transform:translateY(-1px)}.aot-button-primary,.aot-button-dark{background:var(--aot-ink);border-color:var(--aot-ink);color:#f5f7ec}.aot-button-primary:hover,.aot-button-dark:hover{background:#28503d}.aot-button-lime{background:var(--aot-lime);border-color:var(--aot-lime);color:var(--aot-deep)}.aot-button-lime:hover{background:#e5faa8}.aot-hero-principles{display:flex;align-items:center;gap:20px;flex-wrap:wrap;margin-top:28px;color:#768074;font-size:10px}.aot-hero-principles span{display:flex;align-items:center;gap:7px}.aot-world-card{background:var(--aot-deep);color:#e9f0e2;border:1px solid #22493a;border-radius:18px;padding:18px;box-shadow:0 28px 70px #173d2f20;position:relative}.aot-world-card:after{content:'';position:absolute;inset:7px;border:1px solid #ffffff08;border-radius:13px;pointer-events:none}.aot-world-toolbar,.aot-packet-heading,.aot-event-heading{display:flex;align-items:center;justify-content:space-between;gap:14px}.aot-world-toolbar>span,.aot-packet-heading>div,.aot-event-heading>div{display:flex;align-items:center;gap:7px;font-size:8px;letter-spacing:1.5px;font-weight:700}.aot-world-toolbar i,.aot-live-dot{display:inline-block;width:6px;height:6px;background:var(--aot-lime);border-radius:50%;box-shadow:0 0 0 5px #daf58a10}.aot-world-toolbar small,.aot-packet-heading small,.aot-event-heading small{font-size:8px;color:#829a88}.aot-world-goal{margin:23px 0 13px;padding:14px;border:1px solid #355647;background:#18372b;border-radius:10px;display:flex;flex-direction:column;gap:5px}.aot-world-goal span{font-size:7px;letter-spacing:1.4px;color:#8ba090}.aot-world-goal strong{font-size:13px;font-weight:500}.aot-context-route,.aot-route-line{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.aot-context-route{padding:0 3px 15px}.aot-context-route span{font-size:8px;color:#a7b7aa;padding:5px 7px;border:1px solid #365546;border-radius:5px}.aot-context-route svg{color:#60796a}.aot-entity-map{height:250px;border:1px solid #2b4b3d;background:linear-gradient(#ffffff05 1px,transparent 1px),linear-gradient(90deg,#ffffff05 1px,transparent 1px),#122f25;background-size:32px 32px;border-radius:12px;position:relative;overflow:hidden}.aot-entity{position:absolute;border:1px solid #4f6b5a;background:#17382cdd;border-radius:9px;padding:10px 12px;display:flex;flex-direction:column;gap:4px;z-index:2;box-shadow:0 8px 22px #071c1540}.aot-entity span{font-size:6px;letter-spacing:1.2px;color:#8ba18f}.aot-entity b{font-size:11px;font-weight:600}.aot-entity small{font-size:7px;color:#7f9584}.aot-entity.player{left:7%;bottom:15%;border-color:#768f64}.aot-entity.tree{left:46%;top:18%;border-color:#b8d277}.aot-entity.inventory{right:6%;bottom:12%;border-color:#5e7d67}.aot-map-lines{position:absolute;inset:0;width:100%;height:100%}.aot-map-lines path{fill:none;stroke:#bcd97a;stroke-width:1.3;stroke-dasharray:4 5;opacity:.48}.aot-world-result{margin-top:13px;border:1px solid #375646;border-radius:9px;padding:11px 12px;display:grid;grid-template-columns:auto auto 1fr;align-items:center;gap:8px;color:#9fb2a3;font-size:8px}.aot-world-result b{text-align:right;color:#dce8d7;font-weight:500}.aot-section{max-width:1240px;margin:0 auto;padding:94px 28px}.aot-section-heading{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,460px);align-items:end;gap:60px;margin-bottom:40px}.aot-section-heading.compact{grid-template-columns:1fr}.aot-section-heading h2,.aot-final-cta h2{font-family:'Instrument Serif',Georgia,serif;font-size:49px;line-height:1.05;letter-spacing:-1.5px;font-weight:400;margin-top:13px;max-width:700px}.aot-section-heading>p{color:#667268;font-size:13px;line-height:1.75}.aot-time-section{border-top:1px solid var(--aot-line)}.aot-time-demo{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(300px,.75fr);gap:16px}.aot-clock-panel,.aot-event-panel,.aot-context-console{border:1px solid var(--aot-line);background:var(--aot-paper);border-radius:15px}.aot-clock-panel{padding:18px}.aot-demo-toolbar{display:flex;align-items:center;justify-content:space-between;gap:20px;padding-bottom:16px;border-bottom:1px solid #e4e8df}.aot-demo-toolbar>div:first-child{display:grid;grid-template-columns:auto auto;align-items:center;gap:5px 8px}.aot-demo-toolbar strong{font-size:11px}.aot-demo-toolbar small{grid-column:2;color:#7a8478;font-size:9px}.aot-demo-controls{display:flex;align-items:center;gap:5px}.aot-demo-controls button{width:31px;height:31px;display:grid;place-items:center;border:1px solid #dce2d7;background:#f7f9f2;border-radius:7px}.aot-demo-controls button:hover{background:#edf2e6}.aot-phase-strip{display:grid;grid-template-columns:repeat(6,1fr);gap:5px;margin:18px 0}.aot-phase{font-size:7px;letter-spacing:.8px;color:#8d968a;text-transform:uppercase;display:flex;align-items:center;gap:5px;min-width:0}.aot-phase span{height:3px;flex:1;background:#dfe4da;border-radius:3px;transition:background .2s}.aot-phase.active{color:#365d43;font-weight:700}.aot-phase.active span{background:#87aa58}.aot-clock-list{display:flex;flex-direction:column}.aot-clock-row{display:grid;grid-template-columns:160px 1fr 74px;gap:15px;align-items:center;padding:15px 2px;border-top:1px solid #edf0ea}.aot-clock-row:first-child{border-top:none}.aot-clock-label{display:flex;flex-direction:column;gap:3px}.aot-clock-label strong{font-size:10px}.aot-clock-label span{font-size:8px;color:#8a9287}.aot-clock-track{position:relative;height:12px}.aot-clock-track:before{content:'';position:absolute;left:0;right:0;top:5px;height:1px;background:#dce2d8}.aot-clock-track>i{position:absolute;left:0;top:5px;height:1px;background:#71954d;transition:width .2s}.aot-tick{position:absolute;top:2px;width:7px;height:7px;border:1px solid #bec9b9;background:#fffffa;border-radius:50%;transform:translateX(-50%);z-index:1}.aot-tick.passed{background:#789d52;border-color:#789d52}.aot-clock-row.is-global .aot-tick{width:3px;height:3px;top:4px;border:none;background:#c6cec2}.aot-clock-row.is-global .aot-tick.passed{background:#7e9a69}.aot-clock-row.is-agent .aot-tick.passed{background:#173d2f;border-color:#173d2f}.aot-clock-value{text-align:right;display:flex;align-items:baseline;justify-content:flex-end;gap:4px}.aot-clock-value strong{font-size:17px;font-weight:500;font-variant-numeric:tabular-nums}.aot-clock-value span{font-size:7px;color:#899288;text-transform:uppercase}.aot-time-summary{margin-top:16px;padding:15px;border-radius:10px;background:#eef3e7;display:flex;align-items:center;justify-content:center;gap:18px}.aot-time-summary div{display:flex;align-items:baseline;gap:5px}.aot-time-summary span{font-family:'Instrument Serif',Georgia,serif;font-size:27px}.aot-time-summary small{font-size:8px;color:#758073}.aot-time-summary svg{color:#9aa793}.aot-event-panel{background:var(--aot-deep);color:#e8efe4;padding:18px;display:flex;flex-direction:column}.aot-event-heading{padding-bottom:15px;border-bottom:1px solid #2b4a3c}.aot-event-panel ol{list-style:none;padding:0;margin:12px 0 0;display:flex;flex-direction:column}.aot-event-panel li{display:grid;grid-template-columns:25px 1fr auto;gap:10px;padding:13px 0;border-bottom:1px solid #263f35}.aot-event-panel li>span{font-size:8px;color:#758d7d;font-variant-numeric:tabular-nums}.aot-event-panel li div{display:flex;flex-direction:column;gap:4px}.aot-event-panel li strong{font-size:9px;font-weight:600}.aot-event-panel li small{font-size:8px;color:#839a8a;line-height:1.45}.aot-event-panel code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#cfe895;font-size:7px}.aot-event-rule{margin-top:auto;border:1px solid #345446;border-radius:9px;padding:11px;display:flex;align-items:center;gap:9px;color:#91a596}.aot-event-rule div{display:flex;flex-direction:column;gap:3px}.aot-event-rule strong{font-size:9px;color:#dce8dd}.aot-event-rule span{font-size:7px}.aot-principle-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.aot-principle-grid article{border:1px solid var(--aot-line);background:var(--aot-paper);border-radius:14px;padding:24px;min-height:245px;position:relative;display:flex;flex-direction:column}.aot-principle-icon{width:44px;height:44px;border:1px solid #d7dfd1;background:#f0f4e9;border-radius:11px;display:grid;place-items:center;color:#5f7f4c}.aot-principle-grid article>span{position:absolute;right:24px;top:27px;font-size:8px;color:#9ba399}.aot-principle-grid h3{font-family:'Instrument Serif',Georgia,serif;font-size:27px;line-height:1.08;margin-top:31px;font-weight:400;max-width:290px}.aot-principle-grid p{font-size:11px;color:#6c766d;margin-top:auto;padding-top:20px}.aot-context-section,.aot-storage-section,.aot-roadmap-section{border-top:1px solid var(--aot-line)}.aot-context-console{overflow:hidden}.aot-scenario-tabs{height:58px;padding:0 18px;display:flex;align-items:center;gap:5px;border-bottom:1px solid var(--aot-line);background:#f1f3eb}.aot-scenario-tabs button{padding:9px 13px;border-radius:7px;font-size:10px;color:#778176}.aot-scenario-tabs button.active{background:#fffffa;color:#244236;box-shadow:0 1px 5px #253c2b12;font-weight:600}.aot-context-content{display:grid;grid-template-columns:1fr 1fr}.aot-context-copy{padding:34px;border-right:1px solid var(--aot-line)}.aot-context-copy>span{font-size:7px;letter-spacing:1.5px;color:#72806e;font-weight:700}.aot-context-copy h3{font-family:'Instrument Serif',Georgia,serif;font-size:34px;line-height:1.08;font-weight:400;margin-top:13px;max-width:520px}.aot-context-copy>p{font-size:11px;color:#6f786f;margin-top:15px}.aot-route-line{margin-top:24px;padding:12px;border:1px solid #dde3d8;border-radius:8px;background:#f7f9f2}.aot-route-line b{font-size:8px;font-weight:600}.aot-route-line svg{color:#9aa596}.aot-context-lists{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:24px}.aot-context-lists>div{border:1px solid #dfe5d9;border-radius:9px;padding:14px;background:#fbfcf7}.aot-context-lists>div>span{font-size:7px;letter-spacing:1.2px;display:flex;align-items:center;gap:6px;color:#52713f;font-weight:700}.aot-context-lists ul{list-style:none;margin:11px 0 0;padding:0;display:flex;flex-direction:column;gap:8px}.aot-context-lists li{font-size:9px;color:#5e6b60}.aot-context-lists li:before{content:'·';margin-right:7px;color:#82a054}.aot-context-lists .dormant{opacity:.63}.aot-packet{background:var(--aot-deep);color:#e8efe4;padding:34px;display:flex;flex-direction:column}.aot-packet pre{margin:28px 0 22px;white-space:pre-wrap;font:10px/1.8 ui-monospace,SFMono-Regular,Menlo,monospace;color:#caddc8;border:1px solid #315044;background:#0d281f;border-radius:10px;padding:19px;min-height:225px}.aot-packet-result{margin-top:auto;padding:12px;border:1px solid #3d594c;background:#19382c;border-radius:9px;display:flex;gap:9px;align-items:flex-start;color:#b8cab9;font-size:9px;line-height:1.6}.aot-packet-result svg{color:#d7ef8e;margin-top:1px}.aot-architecture-flow{list-style:none;margin:0;padding:0;border-top:1px solid var(--aot-line)}.aot-architecture-flow li{display:grid;grid-template-columns:44px minmax(0,1fr) 170px;gap:20px;align-items:center;position:relative;border-bottom:1px solid var(--aot-line);padding:20px 0}.aot-step-number{font-size:8px;color:#8e978c}.aot-step-copy h3{font-family:'Instrument Serif',Georgia,serif;font-size:26px;font-weight:400}.aot-step-copy p{font-size:10px;color:#68736a;margin-top:5px;max-width:720px}.aot-step-copy>span{display:inline-block;font-size:7px;text-transform:uppercase;letter-spacing:1px;color:#7b8a72;background:#edf2e7;border-radius:4px;padding:4px 6px;margin-top:9px}.aot-step-output{display:flex;flex-direction:column;gap:3px;border-left:1px solid #dce2d7;padding-left:18px}.aot-step-output small{font-size:6px;letter-spacing:1.2px;color:#929b90}.aot-step-output strong{font-size:10px;font-weight:600}.aot-step-arrow{position:absolute;left:14px;bottom:-9px;padding:3px;background:var(--aot-bg);color:#9aa495;box-sizing:content-box;z-index:2;transform:rotate(90deg)}.aot-plane-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:24px}.aot-plane-grid article{border:1px solid var(--aot-line);background:#fffffa;border-radius:10px;padding:15px;display:grid;grid-template-columns:auto 1fr;gap:5px 9px;align-items:center}.aot-plane-grid svg{grid-row:1/4;color:#6c8d53}.aot-plane-grid span{font-size:6px;letter-spacing:1.2px;color:#879185}.aot-plane-grid strong{font-size:9px;font-weight:600}.aot-plane-grid small{font-size:7px;color:#8e968c}.aot-storage-layout{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(260px,.5fr);gap:16px;align-items:stretch}.aot-storage-funnel{display:flex;align-items:center;flex-direction:column;gap:8px}.aot-storage-funnel article{min-width:52%;display:grid;grid-template-columns:38px 1fr 100px;align-items:center;gap:12px;border:1px solid #dce2d7;background:#fffffa;border-radius:9px;padding:13px 15px;transition:width .2s}.aot-storage-funnel article>span{font-size:8px;color:#72816b;font-weight:700}.aot-storage-funnel article>div{display:flex;flex-direction:column;gap:3px}.aot-storage-funnel strong{font-size:10px}.aot-storage-funnel small{font-size:8px;color:#838c82;line-height:1.45}.aot-storage-funnel b{text-align:right;font-size:8px;font-weight:500;color:#66785d}.aot-storage-layout aside{border:1px solid #2b4c3e;border-radius:13px;background:var(--aot-deep);color:#dfe9df;padding:26px;display:flex;flex-direction:column;align-items:flex-start}.aot-storage-layout aside svg{color:#d6ed90}.aot-storage-layout aside>span{font-size:7px;letter-spacing:1.3px;color:#90a596;margin-top:20px}.aot-storage-layout aside code{font:10px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace;color:#dceaa9;margin-top:12px}.aot-storage-layout aside p{font-size:10px;color:#8fa395;margin-top:auto;padding-top:25px}.aot-audit-section{max-width:none;background:#eef1e8;border-top:1px solid var(--aot-line);border-bottom:1px solid var(--aot-line);padding-left:max(28px,calc((100vw - 1184px)/2));padding-right:max(28px,calc((100vw - 1184px)/2))}.aot-audit-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:13px}.aot-audit-grid article{background:#fffffa;border:1px solid #d9dfd4;border-radius:13px;padding:22px;min-height:285px}.aot-audit-grid article>svg{color:#65864e}.aot-audit-grid article.guarded>svg{color:#916c49}.aot-audit-grid h3{font-family:'Instrument Serif',Georgia,serif;font-size:25px;font-weight:400;margin-top:19px}.aot-audit-grid ul{list-style:none;padding:0;margin:20px 0 0;display:flex;flex-direction:column;gap:13px}.aot-audit-grid li{font-size:10px;color:#657068;line-height:1.5;padding-left:15px;position:relative}.aot-audit-grid li:before{content:'';position:absolute;left:0;top:6px;width:5px;height:5px;border-radius:50%;background:#91a682}.aot-audit-grid .active{border-color:#bdce99}.aot-audit-grid .guarded{background:#fbf8f1}.aot-hypothesis{margin-top:14px;background:var(--aot-deep);color:#edf3e7;border-radius:13px;padding:25px 27px;display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,.65fr);gap:40px;align-items:center}.aot-hypothesis>div:first-child{display:flex;flex-direction:column;gap:9px}.aot-hypothesis>div:first-child span{font-size:7px;letter-spacing:1.3px;color:#91a696}.aot-hypothesis strong{font-family:'Instrument Serif',Georgia,serif;font-size:24px;line-height:1.2;font-weight:400}.aot-hypothesis-metrics{display:grid;grid-template-columns:1fr 1fr;gap:7px}.aot-hypothesis-metrics span{font-size:8px;color:#aabaaa;border:1px solid #355446;border-radius:6px;padding:9px}.aot-roadmap{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid var(--aot-line);border-left:1px solid var(--aot-line)}.aot-roadmap li{min-height:205px;padding:19px;border-right:1px solid var(--aot-line);border-bottom:1px solid var(--aot-line);display:flex;flex-direction:column}.aot-roadmap li>span{font-size:8px;color:#8c9689}.aot-roadmap h3{font-family:'Instrument Serif',Georgia,serif;font-size:25px;font-weight:400;margin-top:29px}.aot-roadmap p{font-size:9px;color:#6f796f;margin-top:auto;padding-top:18px}.aot-final-cta{max-width:1184px;margin:36px auto 90px;padding:45px;background:var(--aot-lime);border-radius:18px;display:grid;grid-template-columns:1fr auto;gap:50px;align-items:end}.aot-final-cta>div:first-child>span{font-size:7px;letter-spacing:1.3px;font-weight:700}.aot-final-cta h2{font-size:43px;margin-top:11px}.aot-final-cta p{font-size:11px;max-width:720px;margin-top:13px;color:#3e543e}.aot-final-cta .aot-button{border-color:#adc66a}.aot-footer{max-width:1184px;margin:0 auto;padding:24px 0 38px;border-top:1px solid var(--aot-line);display:flex;align-items:center;justify-content:space-between;color:#7c857b}.aot-footer>div{display:flex;align-items:center;gap:13px}.aot-footer strong{font-size:17px;color:var(--aot-ink)}.aot-footer span,.aot-footer nav{font-size:9px}.aot-footer nav{display:flex;gap:16px}.aot-footer a:hover{text-decoration:underline;text-underline-offset:3px}@media (max-width:1000px){.aot-hero{grid-template-columns:1fr;gap:48px;padding-top:70px}.aot-hero-copy{max-width:760px}.aot-time-demo,.aot-storage-layout{grid-template-columns:1fr}.aot-context-content{grid-template-columns:1fr}.aot-context-copy{border-right:none;border-bottom:1px solid var(--aot-line)}.aot-plane-grid{grid-template-columns:1fr 1fr}.aot-roadmap{grid-template-columns:repeat(2,1fr)}.aot-final-cta{margin-left:28px;margin-right:28px;grid-template-columns:1fr}.aot-footer{margin-left:28px;margin-right:28px}}@media (max-width:720px){.aot-nav{height:auto;min-height:66px;padding:12px 18px}.aot-brand small{display:none}.aot-nav nav{gap:0}.aot-nav nav a{padding:8px 7px;font-size:10px}.aot-nav nav a:nth-child(3),.aot-nav nav a:nth-child(4){display:none}.aot-github span{display:none}.aot-hero{padding:58px 19px}.aot-hero h1{font-size:54px;letter-spacing:-1.8px}.aot-lede{font-size:14px}.aot-world-card{padding:13px}.aot-entity-map{height:230px}.aot-section{padding:72px 19px}.aot-section-heading{grid-template-columns:1fr;gap:19px}.aot-section-heading h2{font-size:39px}.aot-time-demo{grid-template-columns:1fr}.aot-clock-row{grid-template-columns:105px 1fr 57px;gap:8px}.aot-clock-label span{display:none}.aot-phase{font-size:0}.aot-phase span{height:4px}.aot-time-summary{gap:8px;justify-content:space-between}.aot-time-summary div{flex-direction:column;align-items:center}.aot-time-summary small{text-align:center}.aot-principle-grid,.aot-audit-grid{grid-template-columns:1fr}.aot-context-copy,.aot-packet{padding:24px 19px}.aot-context-lists{grid-template-columns:1fr}.aot-architecture-flow li{grid-template-columns:32px 1fr}.aot-step-output{grid-column:2;border-left:none;padding-left:0}.aot-plane-grid{grid-template-columns:1fr}.aot-storage-funnel article{width:100%!important;min-width:0;grid-template-columns:28px 1fr}.aot-storage-funnel article>b{grid-column:2;text-align:left}.aot-audit-section{padding-left:19px;padding-right:19px}.aot-hypothesis{grid-template-columns:1fr}.aot-roadmap{grid-template-columns:1fr}.aot-roadmap li{min-height:170px}.aot-final-cta{margin:25px 19px 70px;padding:29px 22px}.aot-final-cta h2{font-size:36px}.aot-footer{margin:0 19px;align-items:flex-start;gap:20px}.aot-footer>div{flex-direction:column;align-items:flex-start}.aot-footer nav{flex-wrap:wrap}}@media (prefers-reduced-motion:reduce){.aot-button,.aot-clock-track>i,.aot-storage-funnel article{transition:none}.aot-button:hover{transform:none}}
</style>
