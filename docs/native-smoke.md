# Manual Windows smoke check

Normal Rust tests use mock input. They never move your pointer, type into apps, or approve a native prompt. Run this separate procedure on your own desktop when you want to verify actual Windows input.

First build the portable executable.

```powershell
cargo test --manifest-path bridge/Cargo.toml --locked
cargo build --manifest-path bridge/Cargo.toml --release --locked
```

The binary is `bridge/target/release/lense-bridge.exe`. Double-click it for the production website. For the local development website, run it with `--dev`.

1. Open the hosted Lense website, or start `pnpm dev` and visit localhost:5173.
2. Grant the browser's loopback network permission if prompted. Click Pair Desktop. Read the requesting origin in the native Windows prompt, then choose Allow yourself.
3. Select a monitor. Confirm that the screenshot matches that monitor, then select each additional display. Check a display left of the primary display if one exists.
4. Open a new empty Notepad document and keep it visible. Select its window in Lense. Use the screenshot to place a click inside the editor. Type `Hello from Lense. 世界 😀` and inspect the next screenshot.
5. Send the hotkey CTRL+S. Observe the Save As dialog. Cancel it with ESCAPE. This step does not need to save a file.
6. Enter enough lines to scroll. Send a positive deltaY of 600 and confirm that the editor scrolls down. Send a negative deltaY to scroll up.
7. Open an empty drawing canvas. Select its window, choose a pencil tool through a screenshot click, drag between two normalized points, and observe the line. Do not draw over an existing document.
8. Start a visual watch with a 1000 ms interval and threshold 0.02. Change the selected app's visible contents and confirm watch.changed appears in the event log. A static screen should produce watch.tick.
9. Start an action, then click STOP CONTROL. Confirm that the session disconnects, watches stop, and subsequent actions require pairing again.
10. Pair again and press Ctrl+Alt+Escape on the physical keyboard. Confirm that the website loses control. Close the bridge console and confirm that detection reports the bridge unavailable.

The bridge cannot type into elevated apps or the secure desktop from an ordinary user process. Window capture shows the visible desktop rectangle, so keep the target unminimized and unobscured. Mixed-DPI monitor layouts require this physical verification even though coordinate conversion has unit tests.

A separate read-only smoke command checks real monitor metadata and screenshot encoding. It outputs dimensions and pixel statistics. It does not save the screenshot or send input.

```powershell
cargo run --manifest-path bridge/Cargo.toml --example read_only_smoke --locked
```

Verified on September 2, 2026, outside the restricted test sandbox: three 1920 by 1080 displays at physical x positions -1920, 0, and 1920; primary capture 1920 by 1080 downscaled to 1280 by 720; JPEG data URL length 180831; pixel values spanning 0 through 255; 15 visible windows; no input sent. A sandboxed capture failed with Windows error 5 because that process could not read the interactive desktop. The approved read-only run succeeded.

This record confirms real screenshot capture and a monitor with negative coordinates. It does not claim physical pointer, Unicode typing, hotkey, drag, scroll, pairing, or emergency-key verification. Complete the manual steps above to verify those on your machine.
