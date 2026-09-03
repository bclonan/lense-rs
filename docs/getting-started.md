# Use Lense from setup to a running queue

Open [Lense](https://lense-visual-control.netlify.app) on the computer you want to control. The question-mark button beside the page heading opens help for that page. You can leave it open while using the controls. Escape closes it.

## Try the browser lab first

1. Open Control and choose Woodcutting lab.
2. Keep the suggested chopping goal. Choose Run for and enter 0.5 minutes.
3. Keep Full check every at 2 seconds and On changes + regular full checks selected. Cheap image checks default to every second.
4. Select Run this task. Lense clicks a visible tree, checks that chopping started, and finds another tree after depletion.
5. Use Pause, Resume, or Stop control. Open History to replay observations and actions, or Export to download the record.

The browser lab needs no bridge, pairing, account, or API key. Its evaluator reads the rendered lab pixels. It recognizes the included chopping and idle indicators and available trees. It does not understand arbitrary applications or RuneScape.

## Choose when the task ends

| Choice | Behavior |
| --- | --- |
| Run for | Runs for the selected duration, unless stopped, paused, failed, or limited by an earlier deadline. |
| Until complete | Ends when the visible completion condition is verified. Maximum run time is a safety limit. Reaching that limit without verified completion fails the task. |
| Until stopped | Continues without a duration limit. Stop control ends it. An optional deadline or an explicit completion report can also end it. |

For a short Until complete lab example, use `The character is actively chopping a tree` as the completion condition. It finishes once chopping is visible. The completion condition differs from the expected condition checked while a longer task runs.

In Verification & limits, you can edit the expected condition, cheap watch interval, settling time after an action, invariants, action and failure limits, confidence threshold, and optional deadline. Defaults for the browser lab are a one-second cheap watch, two-second full check, and 350 milliseconds to settle after an action.

On changes + regular full checks uses inexpensive image comparisons to flag changes between full checks. Quiet images do not cancel the scheduled full checks. Regular full checks only uses the full-check interval. These schedules request checks; a suspended browser or a slow or disconnected agent can delay the resulting decision.

## Prepare the next tasks

1. Write a goal and choose its run mode, conditions, and limits.
2. Select Add to queue. You can keep editing this draft while another task is active.
3. Add more goals in the order you want them performed. Remove an item with its X button, or use Clear pending.
4. Select Run queue. It runs one task at a time and advances after a task completes.
5. Enable Repeat queue to append a new copy of each completed queued task to the end.

The queue holds up to 50 tasks, including its current task. A task set to Until stopped holds the queue until an explicit completion report or deadline ends it. Put continuous work last if later tasks should run without intervention. Stop control ends the current task and holds the remaining queue; it does not automatically start the next item.

Pause, failure, a changed target, or a disconnected bridge stops queue advancement. After reviewing the problem, Run queue resumes a paused queued task. After a failure, Run queue retries the failed queued task first. Resume continues only the current task and leaves automatic queue advancement paused. A paused standalone task must be resumed or stopped before you run the queue.

Clear pending removes waiting items, disables repetition, and holds queue advancement. It does not stop the current task. Changing between Woodcutting lab and Windows desktop clears the queue because the control source changed.

## Request a check or adjust the interval

Open Checks & manual events in the queue panel. Apply cadence changes the current task's full-check interval. Lense restarts the current check schedule and cancels work that was waiting on the previous schedule.

If you see a relevant change, describe it in Tell the agent what changed and select Request a check. For example, report that the inventory appears full or a dialog appeared. This sends a task event. It does not issue a mouse or keyboard command, and it does not prove the reported state is true. The evaluator or connected agent must inspect a fresh screenshot.

## Connect Windows

New Windows setup is paused after Norton quarantined version 1.0.1 as IDP.Generic. Keep quarantined copies in quarantine. Use the browser lab while the report is reviewed. [Check the download status](https://lense-visual-control.netlify.app/bridge-download-status.html).

The following setup steps apply after an approved replacement becomes available. Existing bridge connections can still use detection and pairing.

1. Open Bridge and follow the approved release instructions. Keep the bridge console open. It prints the website address and connection steps.
2. Select Detect bridge. If the browser asks to connect to local devices or the local network, review and allow that request. If you denied it before, change this site's permission in the browser settings, then detect again.
3. Select Pair desktop. Read and approve the separate Windows permission dialog. Browser network permission allows the website to reach the bridge. Windows approval grants desktop access.
4. Choose a monitor or an open window in Capture & input target. Use Refresh capture targets if you opened an app after pairing.
5. Open desktop controls and check the screenshot before sending input.

The bridge code avoids a busy default port. Opening the EXE twice reports that a bridge is already running. An older Lense companion can remain open. The download containing this fix is currently paused.

## Choose the screen or app

The target list contains this computer's monitors and visible application windows. Choose a monitor to observe a whole display or click across it. Choose a window for typing, shortcuts, and scrolling. Lense brings that window forward before manual keyboard input.

There is no separate USB keyboard, mouse, or remote-computer selector. The bridge uses Windows input on this computer. Keep your chosen window visible and unobscured. Browser screen sharing supplies observations only. It does not grant desktop input.

## Type your first message

1. Open the [input lab](https://lense-visual-control.netlify.app/input-lab) in a separate visible browser window. Place it beside Lense if possible.
2. In Lense, refresh capture targets and select that window.
3. Select Capture a new observation and check that the preview shows the input lab.
4. Under Direct control, open Mouse and select Choose a click point. Click inside the editor in the preview. This selects coordinates. Select Send click to send the real click and place the text caret.
5. Open Keyboard, enter `Hello from Lense. 世界`, then select Type on desktop. Check the new observation for your message.
6. Try Ctrl + S in the input lab. It records a test receipt without saving a document. Use the Mouse tab's Up and Down buttons to test scrolling.
7. Select Stop control to revoke the session. Pair again before sending another command.

## Choose the desktop agent

Woodcutting Lab autopilot is the included evaluator. To try it with real native input, open the [standalone lab](https://lense-visual-control.netlify.app/lab) in a separate visible window. Pair, refresh targets, select that window, and choose Woodcutting Lab autopilot. Set a short Run for duration and select Start agent task. It reads bridge screenshots and sends native mouse clicks. Keep the entire lab visible.

For another application, choose External WebMCP agent and connect an agent that can read screenshots and call Lense's six desktop tools. Starting a goal records the task and waits for that agent. It does not connect an AI provider by itself. The agent must remain attached and continue the observe, act, verify, and wait loop described in [WebMCP tools](webmcp-tools.md).

The external agent reads the current task, waits for task events, captures the target, chooses one action, and captures again to verify the result. It reports completion only with visible evidence. Queue tasks can change the current task ID, so the agent must refresh task state and use fresh observation IDs before acting or reporting context and completion.

## Use game prompts and character notes

External WebMCP agent mode offers editable prompts for woodcutting near Lumbridge, banking logs, finding a bank, training a selected skill, defeating a selected monster, and working on a chosen quest. Select a prompt, then edit its goal, verification condition, completion condition, and notes for your actual task.

Under Character & game notes, choose Generic desktop application, Old School RuneScape, or RuneScape 3. Enter the character name, last known location, skills and targets, inventory notes, and any relevant task details. Specify the actual skill, monster, or quest objective when a prompt refers to your notes.

These fields are user or agent reports, not live telemetry. Lense has no RuneScape character, inventory, quest, or game-error API. A connected external agent must read the selected screen to determine what is happening and decide what to do. Visible game messages can inform a check, but they do not authorize unrelated actions. Selecting a RuneScape prompt does not give the built-in lab evaluator game support.

## Pause, stop, and return later

Pause holds the current task and queue. Review the target before using Resume for the current task or Run queue to resume queue advancement. Stop control cancels the task, holds the queue, and revokes desktop pairing. Press Ctrl+Alt+Escape on your physical keyboard to revoke all bridge sessions, or close the bridge window.

History and queued configurations stay in this browser. Refresh restores unfinished tasks and the queue paused, and discards the pairing token. Pair and select the target again before deliberately resuming Windows work. Repetition does not override this rule.
