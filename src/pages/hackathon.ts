/** Judge overview copy and recording plan. URLs live in src/site/site-config.json. */
export function getYouTubeEmbedUrl(value: string | null | undefined): string | null {
  if (!value || value.startsWith('[')) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
    let id: string | null = null
    if (url.hostname === 'youtu.be' && /^\/[\w-]{11}\/?$/.test(url.pathname)) id = url.pathname.split('/')[1] ?? null
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
      if (url.pathname === '/watch') id = url.searchParams.get('v')
      else if (/^\/(embed|shorts)\/[\w-]{11}\/?$/.test(url.pathname)) id = url.pathname.split('/')[2] ?? null
    }
    return id && /^[\w-]{11}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null
  } catch { return null }
}

export const architectureSteps = [
  { title: 'User request', detail: 'A person states the goal and chooses a target.' },
  { title: 'Tool discovery', detail: 'WebMCP exposes named tools and JSON Schemas.' },
  { title: 'Validated call', detail: 'The tool checks arguments and task context.' },
  { title: 'Application services', detail: 'The task engine calls a capture or input adapter.' },
  { title: 'Shared state', detail: 'Pinia holds the task, queue, observations, and events.' },
  { title: 'Visible update', detail: 'Vue renders the same state the tools just changed.' },
  { title: 'Structured result', detail: 'The agent receives a receipt, image, or error.' },
]

export const featureShowcase = [
  { title: 'Keep a task moving', goal: 'Recover when the next screenshot changes.', human: 'Choose Woodcutting lab and review the goal and limits.', tools: 'desktop_task → desktop_observe → desktop_until', outcome: 'Tree clicks, verification, and recovery appear in the preview and event log.', prompt: 'In Woodcutting lab, run a 30-second task to chop wood. Check every two seconds, recover when a tree depletes, and show the final task result. Use desktop_status first and leave desktop access unpaired.' },
  { title: 'Work through a queue', goal: 'Run a sequence with a visible stopping point.', human: 'Review queued goals, start the queue, and pause it at any time.', tools: 'desktop_task enqueue → run-queue → query', outcome: 'The queue card shows the current goal and remaining tasks. Reload restores it paused.', prompt: 'In Woodcutting lab, prepare two six-second woodcutting tasks with a two-second verification interval. Show me the queue before starting. When I confirm, run it once and report each result.' },
  { title: 'Read the current screen', goal: 'Inspect a shared tab, window, or monitor.', human: 'Choose Share a screen and select a source in the browser picker.', tools: 'desktop_status → desktop_observe', outcome: 'The preview shows live video. The tool returns a current image and capture metadata.', prompt: 'Read desktop_status, then observe the browser-shared frame. Describe what is visible and what remains uncertain. Treat it as observation only and do not send native mouse or keyboard input.' },
  { title: 'Act, then check', goal: 'Verify the result of one desktop action.', human: 'Pair a supported bridge, select a window, and review the target.', tools: 'desktop_observe → desktop_action with observeAfter', outcome: 'An action receipt and fresh native image share one response. A capture failure does not invite repeating input.', prompt: 'After I pair and select the input-lab window, observe the native target. Click the editor, type Hello from Lense, and request observeAfter for each action. Verify the text. Do not save a file or change another application.', note: 'Native demonstration requires an approved bridge release. Distribution is paused and real Windows input remains unverified.' },
  { title: 'Give an agent context', goal: 'Look up a visual cue before making a decision.', human: 'Browse the OSRS field guide and optionally save a cropped reference image.', tools: 'osrs_reference search → get', outcome: 'The result contains cues, lookalikes, source links, and optional local examples.', prompt: 'Search osrs_reference for a bank interface. Get a matching visual entry and explain its identifying cues and possible lookalikes. This is reference lookup only, not a claim about my current game state.' },
  { title: 'Review what happened', goal: 'Understand a recovery or failed step.', human: 'Inspect the event log, step through replay, and export JSONL from the interface.', tools: 'desktop_status → desktop_task query', outcome: 'The visible task history and structured task result explain the current state. Replay never replays input.', prompt: 'Inspect desktop_status and query the current task. Explain its state and last failure without resuming it. Direct me to the event log and human Export button if I want a local history file.' },
]

export const comparisons = [
  { title: 'Check a running task', manual: 'Read the task card and inspect the preview.', screenshot: 'Find labels, interpret the state, and revisit the page after every change.', webmcp: 'Call desktop_status and desktop_task query for named state fields.', improvement: 'A layout change does not change the tool name or task ID.', reliability: 'The result distinguishes an agent caller from an autonomous planner.' },
  { title: 'Control a selected window', manual: 'Choose the target, focus the editor, type, and inspect the result.', screenshot: 'Guess which preview maps to which window and infer whether a click worked.', webmcp: 'Observe the native target, send desktop_action, and request observeAfter.', improvement: 'The receipt and verification image arrive together.', reliability: 'Queued and continuous actions require matching task and observation IDs. Shared-video coordinates are not native coordinates.' },
  { title: 'Recover and continue', manual: 'Notice activity stopped, choose a next step, and restart it.', screenshot: 'Poll the page and infer whether a task completed, failed, or moved to the next queue item.', webmcp: 'Wait through desktop_task, inspect the event and screenshot, then act or pause.', improvement: 'Events and adjustable checks let the agent wait between decisions.', reliability: 'Pause cancels waits. Refresh restores tasks paused. Stop revokes native access.' },
]

export const contributionSteps = [
  { title: 'Declare the tool and its schema', path: 'src/services/webmcp/tools.ts', detail: 'Add the named definition to the existing registry. Reuse or extend schemas in src/services/webmcp/schemas.ts. Keep arguments bounded and reject unsupported fields.' },
  { title: 'Use the existing state and adapters', path: 'src/stores/control.ts', detail: 'Call the shared store instead of creating a second execution path. DesktopAdapter and AgentProvider in src/types/protocol.ts are the service contracts. BridgeClient in src/services/bridge/client.ts connects the native transport.' },
  { title: 'Describe the tool', path: 'src/services/webmcp/documentation.ts', detail: 'Attach purpose, examples, affected state, and recovery guidance to the canonical tool documentation. The explorer reads the registered definitions, including their input schemas.' },
  { title: 'Add a prompt or chain', path: 'src/pages/webmcp-content.ts', detail: 'Add a feature-oriented prompt or workflow. Name real tools, record which earlier result each step uses, and spell out the human review point and partial-failure behavior.' },
  { title: 'Test the contract and visible result', path: 'tests/e2e', detail: 'Validate example arguments against the tool schema. Add a focused unit or browser test that checks both the structured result and the visible state. Keep native input mocked in automated checks.' },
]

export interface DemoSegment { time: string; title: string; action: string; narration: string; tools: string; result: string }
export const demoSegments: DemoSegment[] = [
  {
    time: '0:00–0:15', title: 'Problem and thesis',
    action: 'Show /hackathon, then move to Launch demo. Keep the browser Lab label visible.',
    narration: 'A desktop task rarely ends after one click. The screen changes, the action stops, and somebody has to notice. I built Lense to make that observe, act, and verify loop visible and controllable.',
    tools: 'None. Introduce the project before invoking tools.',
    result: 'The overview explains the goal and the browser demo entry point.',
  },
  {
    time: '0:15–0:35', title: 'Application and user goal',
    action: 'Open Control in Woodcutting lab. Ask the connected WebMCP agent for desktop_status. Show the declared tools and the returned lab mode.',
    narration: 'This is the browser lab, so there is no Windows installation or account setup. My goal is to chop wood and recover when a tree disappears. The person chooses the goal and limits. The agent discovers declared tools and reads the same task state shown here.',
    tools: 'desktop_status with {}.',
    result: 'The result reports lab mode and no paired desktop session. No task starts yet.',
  },
  {
    time: '0:35–1:45', title: 'Uninterrupted primary workflow',
    action: 'Without a cut, start the 45-second Lab task using desktop_task. Call desktop_observe and desktop_until while it runs. Keep the preview, verification result, and event log visible through tree depletion and recovery. Query the completed task and open its event history.',
    narration: 'I call desktop_task with the goal, a forty-five-second duration, a two-second verification interval, and action limits. The task card updates immediately. The built-in lab provider reads rendered pixels, locates a tree, and sends a click through the lab adapter. Now desktop_observe returns the image that supports the next decision. The annotation and event log make that decision inspectable. I can ask desktop_until to wait for the chopping condition, with a timeout, instead of guessing when the action finished. Watch the current tree deplete. The condition changes, the evaluator notices, and the task chooses another visible tree. These are local lab pixels, not a general game-playing model. The visible recovery is the point of this demonstration. Each action has a receipt, and each evaluation has evidence. When the duration expires, I query the task result and inspect the recorded events. I have kept the primary run on screen without a cut.',
    tools: 'desktop_task start → desktop_observe → desktop_until → desktop_task query.',
    result: 'The task progresses through observation, action, verification, and recovery, then reaches its timed completion. The log contains the corresponding events.',
  },
  {
    time: '1:45–2:15', title: 'Chained workflow and shared state',
    action: 'Enqueue two six-second Lab tasks. Show the two pending cards, then invoke run-queue. Observe the transition to the second task and query the queue after completion.',
    narration: 'Next I enqueue two short lab tasks, review them, and start the queue. The first finishes before the second starts. I use desktop_observe to inspect the current frame, then query the queue. The agent and this interface share one Pinia store, so there is no separate hidden task list. Pause and Stop remain visible. Refreshing the page restores history paused; it never silently resumes desktop control.',
    tools: 'desktop_task enqueue twice → desktop_task run-queue → desktop_observe → desktop_task queue.',
    result: 'Both goals appear in order, the active card advances, and the queue ends with running false.',
  },
  {
    time: '2:15–2:35', title: 'Old way and WebMCP',
    action: 'Return to the comparison section on /hackathon. Point to the task-status and verified-action rows.',
    narration: 'A screenshot agent must infer what each control means and whether an action worked. WebMCP gives it named operations, schemas, receipts, and explicit errors. Screenshots still matter for visual evidence. The tools remove the guessing around Lense itself, while task and frame identifiers reject stale actions.',
    tools: 'None. Compare the workflow just recorded.',
    result: 'The comparison separates interface automation from the visual evidence still needed for desktop work.',
  },
  {
    time: '2:35–2:50', title: 'Architecture and closing',
    action: 'Show the architecture, repository link, and bridge-release note. End on Launch demo.',
    narration: 'Vue renders shared Pinia state, IndexedDB stores history, and Netlify hosts the app. The optional Rust bridge handles native capture and input. Its release is paused. The repository documents the boundaries. Try the lab first.',
    tools: 'None. Show the implementation and current release status.',
    result: 'Viewers have a usable browser demo and a candid description of native release limits.',
  },
]

export const demoSpokenWords = demoSegments.reduce((count, segment) => count + segment.narration.trim().split(/\s+/).length, 0)

export const demoTaskArguments = {
  operation: 'start',
  config: {
    goal: 'Chop wood. If chopping stops, find another tree and keep going.', durationMs: 45000, runMode: 'timed',
    verification: { condition: 'The character is actively chopping a tree', intervalMs: 2000 },
    monitoring: { mode: 'events-and-interval', watchIntervalMs: 1000, settleMs: 350 },
    invariants: ['The selected application remains visible'],
    limits: { maxConsecutiveFailures: 5, maxActionsPerMinute: 30, confidenceThreshold: 0.8 },
  },
}

export const submissionChecklist = [
  { title: 'Publicly accessible live demo', key: 'live', detail: 'Use the configured production URL and verify the deployed routes before submitting.' },
  { title: 'Project description and WebMCP fit', key: 'page', detail: 'This overview explains the problem, workflow, shared state, and human control.' },
  { title: 'Public YouTube video under three minutes, with audio', key: 'video', detail: 'Record the 2:50 plan below, publish the video, then set videoUrl in src/site/site-config.json.' },
  { title: 'Public source repository', key: 'repository', detail: 'Visibility must be checked independently. A configured Git remote is not proof of public access.' },
  { title: 'Complete source, assets, and setup instructions', key: 'source', detail: 'The working repository includes the Vue app, Rust bridge source, original assets, and setup instructions. Publish these source changes before submitting.' },
  { title: 'OSI-approved license', key: 'license', detail: 'The MIT license is included in this build. Publish the license with the source repository changes before submitting.' },
  { title: 'README and contributor guidance', key: 'readme', detail: 'The updated README and contributor notes cover architecture, tool development, and current limitations. Publish the source changes before submitting.' },
  { title: 'Installation, development, test, build, and deploy commands', key: 'commands', detail: 'Use the existing pnpm, Cargo, and Netlify workflows documented in the repository.' },
  { title: 'Submission and eligibility review', key: 'review', detail: 'The owner must check the chosen event rules and submit the entry. This page does not assert eligibility or submission.' },
]
