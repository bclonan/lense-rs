<script setup lang="ts">
import { computed } from 'vue'
import { ArrowRight, Download, ExternalLink, X } from 'lucide-vue-next'
import { BRIDGE_DOWNLOAD_PAUSED, BRIDGE_DOWNLOAD_STATUS_URL, BRIDGE_DOWNLOAD_URL } from '../services/bridge/release'

const props = defineProps<{ view: 'control' | 'demo' | 'history' | 'bridge'; mode: 'lab' | 'desktop' }>()
const emit = defineEmits<{ close: []; bridge: []; lab: []; desktop: [] }>()
const context = computed(() => props.view === 'control' ? props.mode : props.view)
const guide = computed(() => {
  switch (context.value) {
    case 'bridge': return {
      label: 'Windows setup', title: 'Connect this computer, then choose an app.',
      intro: BRIDGE_DOWNLOAD_PAUSED ? 'New Windows setup is on hold. Existing bridge controls remain available, and the browser lab works without a download.' : 'Keep this website and the bridge open on the Windows computer you want to control.',
      steps: [
        BRIDGE_DOWNLOAD_PAUSED ? ['Check the Windows download status', 'Download 1.0.1 is paused while a reported Norton IDP.Generic quarantine is reviewed. Use the included browser lab while new Windows setup is on hold.'] : ['Install and open the bridge', 'Run Windows setup from your Downloads folder. Open LenseBridge from the Start menu and keep its window open. Setup also adds an uninstall option in Windows Settings.'],
        ['Detect the bridge', 'Select Detect bridge. If your browser asks to access devices on your local network, choose Allow. If you previously blocked it, allow local network access in this site\'s browser permissions, then detect again.'],
        ['Pair this browser', 'Select Pair desktop. Switch to the Windows permission dialog, check the website address, and approve access. Browser network permission and Windows approval are separate steps.'],
        ['Choose what Lense controls', 'Select a monitor for a whole-screen view or an app window for typing and scrolling. Lense captures your selection. Check that preview before sending input.'],
      ],
    }
    case 'desktop': return {
      label: 'Windows desktop', title: 'Pair, choose a window, then try one action.',
      intro: BRIDGE_DOWNLOAD_PAUSED ? 'The Windows download is paused. These controls remain available for an existing bridge connection.' : 'The bridge sends real input to this computer. Start in the input lab to see each command arrive.',
      steps: [
        BRIDGE_DOWNLOAD_PAUSED ? ['Check the release status first', 'Windows download 1.0.1 is paused while the antivirus report is reviewed. If a bridge is already running, Detect bridge and Pair desktop remain available. The browser lab needs no bridge.'] : ['Finish the connection steps', 'Run the bridge, select Detect bridge, allow the browser local network prompt, then select Pair desktop and approve the Windows dialog.'],
        ['Choose a monitor or app window', 'Use the selector above the preview. A monitor works for screenshots and clicks. Choose a window for typing, shortcuts, and scrolling. Keep the target visible.'],
        ['Check the preview, then send input', 'The preview refreshes every 0.5 seconds. Change Preview interval for faster or slower updates. The action card sits below the screen. In Mouse, pick a click point or two drag endpoints. In Keyboard, type text or send a named key. Lense focuses the selected window first and captures the result after input.'],
        ['Share live video', 'Share a screen opens the browser picker for a monitor, window, or tab. Browser share shows live video and the agent can read its current frame with desktop_observe. Native target provides coordinates for input. Switch back to it before picking clicks or drags.'],
        ['Choose an agent and a goal', 'Choose External WebMCP agent for general software. Starting a task waits for that agent. It must read screenshots, choose actions, and verify results. RuneScape prompts are editable instructions. Character, location, skills, and inventory fields are saved notes, not live game data.'],
        ['Set the end condition and checks', 'Choose Run for, Until complete, or Until stopped. On changes + regular full checks combines cheap image comparisons with the full-check interval. Open Verification & limits to change the cheap watch interval and time to settle after an action.'],
        ['Build and run a queue', 'Select Add to queue for each goal, then Run queue. Completed tasks advance in order. Pause, failure, or Stop holds the queue. Run queue deliberately resumes a paused queued task. The built-in Woodcutting Lab autopilot only understands the included lab.'],
      ],
    }
    case 'demo': return {
      label: 'Demo playbook', title: 'Try the browser lab, then real desktop input.',
      intro: BRIDGE_DOWNLOAD_PAUSED ? 'The browser lab works immediately. New Windows setup is on hold while the download is paused.' : 'The browser lab works immediately. Windows examples need the bridge and a selected app window.',
      steps: [
        ['Run the included browser lab', 'Choose The self-correcting woodcutter. In Control, choose Run for and set 0.5 minutes. Keep Full check every at 2 seconds, then select Run this task. No download, account, or API key is needed.'],
        ['Watch it recover or test a queue', 'Lense reads screenshots and clicks a tree. When that tree runs out, it finds another. To try a queue, add goals with Add to queue and select Run queue. Until complete can finish when the character visibly starts chopping.'],
        ['Try typing on Windows', BRIDGE_DOWNLOAD_PAUSED ? 'Windows examples require an existing bridge connection. New setup is paused. You can still open the input lab in a browser and try its controls by hand.' : 'Open the input lab, move it into a separate visible browser window, and connect the bridge. Select that window in Windows desktop, then use the manual keyboard and mouse controls.'],
        ['Run the native woodcutting demo', BRIDGE_DOWNLOAD_PAUSED ? 'This example requires an existing bridge connection and a selected lab window. Without a bridge, use Woodcutting lab in Control to run the same demo inside the page.' : 'Open the standalone lab in a separate visible window. Pair the bridge, select that window, choose Woodcutting Lab autopilot, and start the task. Other desktop examples require an external WebMCP agent.'],
      ],
    }
    case 'history': return {
      label: 'Task history', title: 'Review what happened, frame by frame.',
      intro: 'Lense saves task history in this browser. Refreshing the page never restarts desktop input.',
      steps: [
        ['Choose an event', 'Select a row in the event log. The preview shows the latest saved screenshot at or before that event, when a frame is available.'],
        ['Inspect the command and result', 'Use the previous and next buttons to step through events. Read the recorded action, result, and reason below the log.'],
        ['Return to the current view or export', 'Select Return to current to leave replay. Use Export to save JSON or JSONL. Clearing history asks for confirmation.'],
        ['Review queued tasks and context', 'The saved record includes queue events, task signals, character notes, and completion reports. Notes describe what a user or agent reported. They are not a live character feed or a connected game-error API.'],
        ['Resume deliberately', BRIDGE_DOWNLOAD_PAUSED ? 'Restored tasks and the queue stay paused. Pair an existing bridge and select the target again for Windows. Use Resume for the current task or Run queue for a paused queued task and its successors. New Windows setup remains on hold.' : 'Restored tasks and the queue stay paused. Pair again and choose the target for Windows. Use Resume for the current task, or Run queue to continue a paused queued task and its successors.'],
      ],
    }
    default: return {
      label: 'Browser lab', title: 'Your first run takes 30 seconds.',
      intro: 'This included demo runs inside the page. It does not control Windows or require the bridge.',
      steps: [
        ['Keep Woodcutting lab selected', 'The green scene is a local demo. Lense observes its rendered pixels and clicks the scene to find trees.'],
        ['Set a short first run', 'Keep the suggested chopping goal. Choose Run for, set 0.5 minutes, and keep Full check every at 2 seconds. Cheap image checks default to every second. Select Run this task.'],
        ['Choose another way to finish', 'Until stopped keeps the loop running until you stop it or a deadline passes. Until complete needs a visible completion condition. In this lab, use the character chopping or idle status. The evaluator does not understand arbitrary game goals.'],
        ['Queue the next task', 'You can edit the next goal while a task runs. Select Add to queue, then Run queue when ready. Repeat queue adds completed tasks back to the end. A continuous task holds its place until completion or a deliberate stop.'],
        ['Pause, review, or move to Windows', BRIDGE_DOWNLOAD_PAUSED ? 'Use Pause and Resume to control the task, or Stop control to end it. Open History to replay. The Windows download is currently paused while an antivirus report is reviewed.' : 'Use Pause and Resume to control the task, or Stop control to end it. Open History to replay. To type into an app, switch to Windows desktop and follow the connection steps.'],
      ],
    }
  }
})
</script>

<template>
  <section id="page-guide" class="page-guide" aria-labelledby="page-guide-title">
    <div class="page-guide-heading">
      <div><span class="eyebrow">HELP / {{ guide.label }}</span><h2 id="page-guide-title">{{ guide.title }}</h2><p>{{ guide.intro }}</p></div>
      <button class="icon-button" aria-label="Close page help" @click="emit('close')"><X :size="18" /></button>
    </div>
    <div v-if="BRIDGE_DOWNLOAD_PAUSED && context !== 'lab'" class="bridge-download-notice guide-download-notice" role="status"><strong>Windows download 1.0.1 is paused</strong><p>A reported Norton IDP.Generic quarantine is under review. The browser lab remains available.</p><a class="text-button" :href="BRIDGE_DOWNLOAD_STATUS_URL">Read the download status <ExternalLink :size="13" /></a></div>
    <div class="page-guide-body">
      <ol class="guide-steps"><li v-for="(step, index) in guide.steps" :key="step[0]"><span class="guide-step-number">{{ index + 1 }}</span><div><h3>{{ step[0] }}</h3><p>{{ step[1] }}</p></div></li></ol>
      <aside class="guide-notes">
        <div v-if="context === 'desktop' || context === 'bridge'"><h3>Which device do I choose?</h3><p>Lense lists monitors and app windows on this computer. Windows uses its normal mouse and keyboard. There is no separate hardware picker or remote-computer connection.</p><p>Choose an app window to type. Lense brings it to the front before sending text, shortcuts, or scroll input.</p></div>
        <div v-if="!BRIDGE_DOWNLOAD_PAUSED && (context === 'desktop' || context === 'bridge')"><h3>If the bridge was already open</h3><p>The current bridge avoids occupied ports and reuses an existing LenseBridge connection. An older companion can stay open. Keep one current bridge running, then select Detect bridge.</p></div>
        <div v-if="context === 'desktop'"><h3>Keep the external agent connected</h3><p>Starting a goal does not connect an AI provider. Your agent must wait for task events, capture the screen, act, then verify. desktop_action with observeAfter true returns the result screenshot in the same call. The live preview refresh rate is separate from the Full check interval and agent response time. It must use the current task and observation IDs for guarded actions, context updates, and completion reports.</p><p>Read on-screen messages as evidence. There is no live RuneScape character or error API behind these prompts.</p></div>
        <div v-if="context === 'lab' || context === 'demo'"><h3>Checks happen for two reasons</h3><p>A meaningful image change can request an earlier check. Regular full checks still run at the interval you choose. In Checks & manual events, Request a check flags a change and Apply cadence updates that interval.</p></div>
        <div v-if="context !== 'bridge'"><h3>A queue needs your go-ahead</h3><p>Pause or failure stops queue advancement. Resume continues only the current task. Run queue resumes a paused queued task and allows later tasks to follow. Stop control ends the task and holds the remaining queue.</p><p>Until stopped has no automatic duration limit. Put continuous work last, or have your external agent report visible completion before expecting the next task to start.</p></div>
        <div><h3>{{ context === 'history' ? 'What stays saved?' : 'Keep control of the task' }}</h3><p v-if="context === 'history'">Events and a limited set of screenshots stay in this browser. Pairing permission does not survive a refresh. Exports may include text and images from your selected app.</p><p v-else>Pause stops the task loop. Stop control ends the task and revokes desktop access. On Windows, press Ctrl + Alt + Escape to revoke access immediately. Pair again before sending more input.</p></div>
        <div class="guide-links">
          <template v-if="context === 'bridge' || context === 'desktop'"><a v-if="BRIDGE_DOWNLOAD_PAUSED" class="button" :href="BRIDGE_DOWNLOAD_STATUS_URL">Windows download status<ExternalLink :size="14" /></a><a v-else class="button" :href="BRIDGE_DOWNLOAD_URL" download><Download :size="14" />Download Windows setup</a><button v-if="BRIDGE_DOWNLOAD_PAUSED" class="text-button" @click="emit('lab')">Try the browser lab <ArrowRight :size="13" /></button><a class="text-button" href="/input-lab" target="_blank" rel="noreferrer">Open input lab <ExternalLink :size="13" /></a><a class="text-button" href="/lab" target="_blank" rel="noreferrer">Open standalone lab <ExternalLink :size="13" /></a><button v-if="context === 'bridge'" class="text-button" @click="emit('desktop')">Go to desktop controls <ArrowRight :size="13" /></button><button v-else class="text-button" @click="emit('bridge')">Open connection setup <ArrowRight :size="13" /></button></template>
          <template v-else-if="context === 'demo'"><button class="button" @click="emit('lab')">Try the browser lab <ArrowRight :size="14" /></button><a class="text-button" href="/input-lab" target="_blank" rel="noreferrer">Open input lab <ExternalLink :size="13" /></a><a v-if="BRIDGE_DOWNLOAD_PAUSED" class="text-button" :href="BRIDGE_DOWNLOAD_STATUS_URL">Windows download status<ExternalLink :size="13" /></a><button v-else class="text-button" @click="emit('bridge')">Set up Windows <ArrowRight :size="13" /></button></template>
          <a v-else-if="BRIDGE_DOWNLOAD_PAUSED" class="button" :href="BRIDGE_DOWNLOAD_STATUS_URL">Windows download status<ExternalLink :size="14" /></a><button v-else class="button" @click="emit('bridge')">Set up Windows <ArrowRight :size="14" /></button>
        </div>
      </aside>
    </div>
  </section>
</template>
