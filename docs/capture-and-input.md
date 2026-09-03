# Capture and input

The target selector is above the screen. Send an action is directly below it. Pair the bridge, refresh the target list if an app just opened, and choose a window or monitor.

Choose a window for text, named keys, shortcuts, and scrolling. The client focuses it before input. It also focuses window-target clicks and drags, so the Lense browser does not receive a click intended for a covered app. If Windows refuses focus, the client reports the failure and sends no subsequent input. Focus does not choose an editor field. Click that field before typing.

Choose a monitor for screen-wide coordinates. Keyboard and scroll input require a window instead of relying on whichever app happens to be in front. Pointer coordinates include monitor offsets and use the selected target's full dimensions.

## Watch the result

Native preview starts at a 0.5-second interval. The selector supports 0.25, 0.5, 1, and 2 seconds, plus Manual. Captures run one at a time and the next interval starts after the preceding request ends. Slow captures therefore reduce the achieved frame rate. The footer shows the last capture duration. Hidden pages stop requesting display previews.

Preview frames do not replace an agent's guarded observation ID or fill the event log. Explicit observations, task observations, and post-action captures remain recorded. Selecting another target clears the old frame and pending points and pauses active work for review.

Text and pointer controls capture again 100 ms after a successful input. A receipt means Windows accepted the input. The screenshot is what lets a person or agent check whether the application responded.

For dragging, choose Mouse, then Drag. Pick the start and end on the preview, set 50 to 5000 ms, then Send drag. The bridge holds the left button along that path.

## Browser sharing

Share a screen opens the browser's own screen, window, or tab picker. The stream requests 12 fps and plays as video. An agent snapshot waits briefly for a new decoded frame, with a bounded fallback for static screens. The service reuses a canvas for JPEG encoding and stops discarded or ended streams.

The Native target and Browser share buttons choose the displayed observation source. Shared video is available without native pairing. It has no native coordinate mapping, since a browser tab or window share may omit borders or show a different screen. Coordinate picking is disabled for shared video. Native tasks continue to use their native target.

`desktop_observe` follows the selected preview source by default. Request `source: "browser"` for the shared video, or `source: "native"` for a native target frame. Shared metadata explicitly says `inputCoordinates: false`. Use a fresh native frame before clicking or sending guarded task input.

## Fewer agent calls

`desktop_action` supports `observeAfter: true`. It returns the action receipt and native result screenshot together. Optional `settleMs` ranges from 0 to 2000 and defaults to 100. If the capture fails after input succeeds, the result retains `ok: true` and includes `observationError`. Request another observation instead of repeating the action.

The Full check interval controls scheduled task verification. Preview interval controls what the person sees. External agent response time remains separate from both. New external drafts use a 2-second full check, a 0.5-second change watch, and 150 ms to settle; all remain adjustable.

## Windows release status

The frontend focus ordering works with the existing protocol. Native source also restores minimized windows, verifies focus before pointer input, holds named keys and mouse taps for 32 ms, and scales small watch captures before pixel conversion. Those native changes are not in the running bridge until a replacement is built and installed.

The existing Norton release blocker still prevents an approved installer. Native checks and mock tests do not prove real Windows typing, game key handling, or drag acceptance. The included input lab provides visible text, shortcut, and drawing checks once an approved native release is available.
