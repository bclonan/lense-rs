# Visual evaluation

Lense separates inexpensive image comparison from semantic evaluation and planning.

The local bridge captures reduced frames and compares them without a language model. `watch.tick` records a check. `watch.changed` wakes the hosted runtime. The browser lab adapter implements the same watch contract for the labeled simulation.

`VisualEvaluator.evaluate` accepts a screenshot, condition, optional prior screenshot and context. It returns a boolean result, confidence, explanation and optional normalized annotation boxes. `AgentProvider` adds `plan` and `recover`. The runtime checks confidence before executing a plan and after verifying an action. Provider keys belong in a server integration, never in this frontend.

The included `LabProvider` is deliberately narrow. It decodes the observation image, finds the visible cyan CHOPPING or amber IDLE square, and groups green canopy pixels into available-tree boxes. A click targets the center of one detected box. It never reads `WoodcuttingLab` state, inventory, timers, or tree coordinates. It finds the indicator anywhere in the captured image, so browser chrome and a window offset do not require an application-specific API. Very small, obscured or altered screenshots can fail recognition. Capture the lab window clearly and review low-confidence results.

The standalone `/lab` page contains the same mouse-operated scene. Trees deplete after 5.5 seconds and regrow after 18 seconds. A tree yields five logs. Clicking another visible tree starts another harvest. The local dashboard uses an offscreen canvas adapter as an explicitly labeled simulation. With the desktop bridge, select the real lab browser window and deliberately enable the lab evaluator to exercise native screen capture and pointer input.

The lab evaluator supports chopping conditions and a visible-lab invariant. Unrecognized conditions return low confidence. It does not claim to read arbitrary text, identify dialogs, or operate general software. Those tasks need an external visual agent or a supplied provider adapter.

Annotations use normalized screenshot coordinates. The native bridge resolves the target's physical bounds before mapping pointer coordinates. This preserves negative monitor positions and DPI scaling. Avoid changing capture target during a running task. Changing control source pauses the runtime.

`src/lab/evaluator.test.ts` scores image classification and target locations from synthetic pixel fixtures. Runtime tests use an isolated fake adapter and never issue real desktop input. Browser smoke tests run a shortened task and check click, depletion, recovery and completion through the visible lab.
