# Task engine

`src/services/tasks/engine.ts` owns the task state machine and check schedule. `src/stores/control.ts` connects it to Pinia, persistence, the selected adapter, and the queue. The UI and WebMCP tools use these same services.

## Task configuration

A task records its goal, run mode, visual conditions, optional deadline, monitoring settings, context notes, and limits. This configuration runs the included lab continuously:

```json
{
  "goal": "Chop wood. If chopping stops, find another tree and keep going.",
  "runMode": "continuous",
  "durationMs": 600000,
  "verification": {
    "condition": "The character is actively chopping a tree",
    "intervalMs": 2000
  },
  "monitoring": {
    "mode": "events-and-interval",
    "watchIntervalMs": 1000,
    "settleMs": 350
  },
  "invariants": ["The selected application remains visible"],
  "limits": {
    "maxConsecutiveFailures": 5,
    "maxActionsPerMinute": 30,
    "confidenceThreshold": 0.8
  }
}
```

| Run mode | End behavior |
| --- | --- |
| `timed`, also the default when omitted | Duration or an earlier deadline marks the task completed. Pause, failure, and Stop can interrupt it. |
| `until-complete` | Requires `completionCondition`. A provider must verify that condition, or an external agent must report completion with a fresh frame and visible evidence. Expiry before completion marks the task failed. |
| `continuous` | Ignores `durationMs` when scheduling expiry. Runs until Stop, explicit completion, failure, or an optional deadline. |

`durationMs` remains a required integer from 1,000 to 86,400,000 for every mode, including continuous configurations. Verification intervals range from 500 to 3,600,000 milliseconds. A supplied deadline must be a future date when the task configuration is validated.

The expected condition describes the state to maintain. The completion condition describes when to finish. In the included lab, `The character is actively chopping a tree` works as a short completion condition. The built-in evaluator cannot confirm arbitrary inventory counts, bank state, or RuneScape progress.

## Observe, act, and verify

With a provider, each cycle captures the selected target, checks invariants and completion, then evaluates the expected condition. If recovery is needed, the provider returns a bounded plan. The engine executes its actions, waits `monitoring.settleMs`, captures again, and checks the result before waiting for another cycle.

The states are `IDLE`, `OBSERVING`, `PLANNING`, `LOCATING_TARGET`, `EXECUTING`, `SETTLING`, `VERIFYING`, `WAITING`, `RECOVERING`, `PAUSED`, `COMPLETED`, `FAILED`, and `STOPPED`. `PAIRING` is reserved for connection orchestration. `cycles` counts provider cycles; `wakeSequence` identifies task wake events.

Provider evaluations and plans must meet the confidence threshold before they authorize input. An invariant that fails or has low confidence pauses the task. Repeated uncertainty or recovery failure reaches the configured failure limit. The engine enforces action limits for provider, manual, and external-agent input. The bridge validates each native action independently.

The supplied `LabProvider` recognizes only documented pixels in Woodcutting Lab. Other applications need an external screenshot-reading agent or an installed `AgentProvider` implementation. Context fields do not add visual capabilities to a provider.

## Events and full checks

`monitoring.mode` chooses the schedule:

- `events-and-interval` creates a cheap image watch when the adapter supports it. Its interval is `watchIntervalMs`, from 500 to 60,000 milliseconds. Meaningful changes emit `watch.changed` task events and wake a waiting provider cycle.
- `interval` omits that automatic image watch. Full checks still become due at `verification.intervalMs`.

In both modes, each due full check emits `audit.due`. Quiet watch ticks do not extend the full-check interval. This replaces the earlier six-interval audit delay. The lab UI defaults to one-second cheap checks, two-second full checks, and 350 milliseconds of settling.

A check that becomes due during an observation, plan, or action stays pending. Cycles do not overlap; the next opportunity processes pending work. Browser suspension, capture latency, or a slow provider can delay execution beyond the configured interval. Native watch timing continues in the bridge while the page is backgrounded, but the bridge does not perform semantic reasoning or choose actions.

Manual events use bounded `{ type, message }` payloads. They are recorded as `task.signal`, increment the sequence, and wake waiters. Context changes emit `context.changed`. Event text describes a reported change, not an instruction to execute an unrelated action.

`waitForEvents` returns events after a supplied sequence, the latest sequence, and a timeout flag. It holds up to 100 wake events in memory and accepts a timeout from zero to 60 seconds. A zero timeout reads available events immediately. Pause, Stop, or caller cancellation interrupts a pending wait.

## External agent mode

Without a provider, a desktop task enters `WAITING`. Its native watch and full-check schedule still produce events. An external agent must keep calling the task event wait operation, read fresh screenshots, choose actions, and verify their results. Lense does not start an autonomous model merely because a goal was entered or a tool caller was seen.

External agents must inspect invariants and completion conditions themselves. The task engine cannot apply a semantic confidence judgment to an external action without the agent's visual reasoning. `desktop_until` requires a provider for its semantic evaluation; external mode returns `PROVIDER_UNAVAILABLE` for arbitrary semantic waits.

For queued, continuous, and until-complete tasks, agent actions require `expectedTaskId` and `observationId`. Context updates and completion reports always require the current `taskId` and `observationId`. The observation must be the latest retained capture, match the current target, have been captured since the task was created, and be no more than 60 seconds old. Take a new screenshot after each action rather than relying on that maximum age. A stale task or frame report is rejected.

Context contains `game`, optional character name, location, skills, inventory, and notes. These are user or agent reports. There is no live character feed or game-error API. The `context` operation replaces the context object and records the observation used as evidence. The `complete` operation records the agent's visible evidence before ending the current task. See [WebMCP tools](webmcp-tools.md) for the exact operation names and fields.

## Queue behavior

`src/services/tasks/queue.ts` validates queue entries. The control store holds at most 50 tasks, including the active queued task. Enqueue saves a copy of the configuration without starting it. Run queue is a deliberate operation.

The queue removes its first pending entry when it starts that task. Only `COMPLETED` advances to the next entry. With Repeat queue enabled, completion adds a new copy of the original queued configuration to the tail with new IDs. A continuous task therefore holds the queue until explicit completion or a deadline; Stop halts the queue instead of advancing it.

Pause, failure, Stop, target changes, and bridge disconnection halt advancement. Run queue resumes an active queued task that was paused. After failure, Run queue retries the failed queued entry before later items. Resume alone continues the current task and leaves queue advancement paused. A paused standalone task must be resumed or stopped before a queue can start.

Clear pending removes waiting items and disables repetition without stopping the current task. Changing control source clears the queue. Queue starts are tied to the selected source and target so a delayed start cannot operate a newly selected target.

## Cancellation and persistence

Pause and Stop cancel pending observations, provider requests, waits, actions, and task watches. Deadlines are checked again before input. Input already accepted by Windows may finish; cancellation prevents later task actions. The visible Stop control and WebMCP stop operation revoke desktop pairing while history saves.

Changing the full-check cadence pauses the current engine schedule, updates the interval, and resumes it only if it was running. In-flight work and event waits on the old schedule are canceled. A paused task remains paused.

IndexedDB keeps the latest 10,000 events and up to 32 distinct screenshots within a 12 MiB image budget. Older events retain metadata until the event limit. Queue configurations, repeat preference, and the active queued entry are saved. Loading restores unfinished tasks and the queue paused. It never restores a session token or resumes input.

Start, Pause, Resume, Stop, manual action, and queue mutations commit their snapshots before resolving. Elapsed-time updates save at most once every two seconds. JSON export includes the task, queue snapshot, and ordered events. JSONL exports the ordered event stream.
