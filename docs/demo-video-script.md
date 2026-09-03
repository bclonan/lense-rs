# Lense demo video script

Target runtime: 2:50. 376 spoken words, approximately 133 words per minute. This plan demonstrates the browser Woodcutting Lab. It does not depend on the Windows bridge, whose release is paused pending Norton review.

## Before recording

- Open the hosted Control page in Woodcutting lab. Prepare a fresh session with no active task or pending queue items. Do not clear a user session to make the recording.
- Use a browser with WebMCP and a connected agent that can discover the declared tools. If using window.lense.call in a developer console instead, clearly label the recording as a local registry demonstration.
- Keep the Lab preview, task card, verification result, and event log visible. Record actual tool calls and their results.
- Capture narration with audio. Keep the primary workflow from 0:35 through 1:45 uninterrupted. Do not claim this browser demonstration proves native Windows input.
- The public video URL is still [YOUTUBE_URL]. Configure it once in src/site/site-config.json after uploading a public YouTube video. Check public access, audio, and total duration before submitting.

## 0:00–0:15 | Problem and thesis

Screen action: Show /hackathon, then move to Launch demo. Keep the browser Lab label visible.

Exact narration:

> A desktop task rarely ends after one click. The screen changes, the action stops, and somebody has to notice. I built Lense to make that observe, act, and verify loop visible and controllable.

WebMCP tools: None. Introduce the project before invoking tools.

Expected visible result: The overview explains the goal and the browser demo entry point.

## 0:15–0:35 | Application and user goal

Screen action: Open Control in Woodcutting lab. Ask the connected WebMCP agent for desktop_status. Show the declared tools and the returned lab mode.

Exact narration:

> This is the browser lab, so there is no Windows installation or account setup. My goal is to chop wood and recover when a tree disappears. The person chooses the goal and limits. The agent discovers declared tools and reads the same task state shown here.

WebMCP tools: desktop_status with {}.

Expected visible result: The result reports lab mode and no paired desktop session. No task starts yet.

## 0:35–1:45 | Uninterrupted primary workflow

Screen action: Without a cut, start the 45-second Lab task using desktop_task. Call desktop_observe and desktop_until while it runs. Keep the preview, verification result, and event log visible through tree depletion and recovery. Query the completed task and open its event history.

Exact narration:

> I call desktop_task with the goal, a forty-five-second duration, a two-second verification interval, and action limits. The task card updates immediately. The built-in lab provider reads rendered pixels, locates a tree, and sends a click through the lab adapter. Now desktop_observe returns the image that supports the next decision. The annotation and event log make that decision inspectable. I can ask desktop_until to wait for the chopping condition, with a timeout, instead of guessing when the action finished. Watch the current tree deplete. The condition changes, the evaluator notices, and the task chooses another visible tree. These are local lab pixels, not a general game-playing model. The visible recovery is the point of this demonstration. Each action has a receipt, and each evaluation has evidence. When the duration expires, I query the task result and inspect the recorded events. I have kept the primary run on screen without a cut.

WebMCP tools: desktop_task start → desktop_observe → desktop_until → desktop_task query.

Expected visible result: The task progresses through observation, action, verification, and recovery, then reaches its timed completion. The log contains the corresponding events.

## 1:45–2:15 | Chained workflow and shared state

Screen action: Enqueue two six-second Lab tasks. Show the two pending cards, then invoke run-queue. Observe the transition to the second task and query the queue after completion.

Exact narration:

> Next I enqueue two short lab tasks, review them, and start the queue. The first finishes before the second starts. I use desktop_observe to inspect the current frame, then query the queue. The agent and this interface share one Pinia store, so there is no separate hidden task list. Pause and Stop remain visible. Refreshing the page restores history paused; it never silently resumes desktop control.

WebMCP tools: desktop_task enqueue twice → desktop_task run-queue → desktop_observe → desktop_task queue.

Expected visible result: Both goals appear in order, the active card advances, and the queue ends with running false.

## 2:15–2:35 | Old way and WebMCP

Screen action: Return to the comparison section on /hackathon. Point to the task-status and verified-action rows.

Exact narration:

> A screenshot agent must infer what each control means and whether an action worked. WebMCP gives it named operations, schemas, receipts, and explicit errors. Screenshots still matter for visual evidence. The tools remove the guessing around Lense itself, while task and frame identifiers reject stale actions.

WebMCP tools: None. Compare the workflow just recorded.

Expected visible result: The comparison separates interface automation from the visual evidence still needed for desktop work.

## 2:35–2:50 | Architecture and closing

Screen action: Show the architecture, repository link, and bridge-release note. End on Launch demo.

Exact narration:

> Vue renders shared Pinia state, IndexedDB stores history, and Netlify hosts the app. The optional Rust bridge handles native capture and input. Its release is paused. The repository documents the boundaries. Try the lab first.

WebMCP tools: None. Show the implementation and current release status.

Expected visible result: Viewers have a usable browser demo and a candid description of native release limits.

## Exact call sequence

Invoke each step deliberately from the connected agent. Do not run the entire sequence on page load. Keep the browser in Lab mode for this recording.

Read the session with desktop_status:

```json
{}
```

Start the primary task with desktop_task:

```json
{
  "operation": "start",
  "config": {
    "goal": "Chop wood. If chopping stops, find another tree and keep going.",
    "durationMs": 45000,
    "runMode": "timed",
    "verification": {
      "condition": "The character is actively chopping a tree",
      "intervalMs": 2000
    },
    "monitoring": {
      "mode": "events-and-interval",
      "watchIntervalMs": 1000,
      "settleMs": 350
    },
    "invariants": [
      "The selected application remains visible"
    ],
    "limits": {
      "maxConsecutiveFailures": 5,
      "maxActionsPerMinute": 30,
      "confidenceThreshold": 0.8
    }
  }
}
```

Observe the current Lab frame with desktop_observe:

```json
{"source":"native"}
```

Here, source native means the selected application adapter. In Lab mode it reads the Lab canvas and does not contact Windows. A browser-shared frame is a separate observation source.

Wait for the Lab condition with desktop_until:

```json
{
  "condition": "The character is actively chopping a tree",
  "intervalMs": 1000,
  "timeoutMs": 10000
}
```

Read the completed task with desktop_task:

```json
{"operation":"query"}
```

For the queued demonstration, enqueue the following twice with desktop_task. Change the goal text of the second task to identify it in the queue, but keep its Lab condition:

```json
{
  "operation": "enqueue",
  "config": {
    "goal": "Chop wood. If chopping stops, find another tree and keep going.",
    "durationMs": 6000,
    "runMode": "timed",
    "verification": {
      "condition": "The character is actively chopping a tree",
      "intervalMs": 2000
    },
    "monitoring": {
      "mode": "events-and-interval",
      "watchIntervalMs": 1000,
      "settleMs": 350
    },
    "invariants": [
      "The selected application remains visible"
    ],
    "limits": {
      "maxConsecutiveFailures": 5,
      "maxActionsPerMinute": 30,
      "confidenceThreshold": 0.8
    }
  }
}
```

Show both pending cards and review them. Then start the queue:

```json
{"operation":"run-queue"}
```

Read the current frame with desktop_observe, then inspect queue completion with desktop_task:

```json
{"operation":"queue"}
```

Expected end state: both tasks have run in order, no pending queue items remain, and running is false. If any task fails, show the error and stop the recording; fix the cause and record a fresh complete run. Do not narrate success over a failure.

## Recording and submission boundaries

The script is a plan, not evidence that a public video exists or that a hackathon entry was submitted. The browser Lab evaluator recognizes its rendered pixels only. Other applications require a provider or external screenshot-reading agent. Native input requires a supported bridge and visible pairing approval. The updated native build and real Windows input are not verified by this browser recording.

The page and this file share narration from src/pages/hackathon.ts. Update that model when the recording plan changes, then regenerate this document and recheck the word count.
