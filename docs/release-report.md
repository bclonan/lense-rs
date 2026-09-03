# Release verification

## Current distribution status

The Windows download is paused following Norton's IDP.Generic quarantine. The previous release checks below are historical results, not antivirus clearance. The reported binary has been removed from public downloads. Its old URL now points to a status page. See [antivirus review](antivirus-review.md) for evidence, release changes, and remaining review requirements.

The new release checks passed `cargo check`, formatting, and unsigned-build and stale-version rejection tests. Windows denied the final executable copy during the release build. No replacement executable was packaged, run, or published. Candidate-copy verification remains unrun locally.

The pause is live in Netlify deployment `6a98cdd0448c0733627babf4`. The current app passed 34 unit tests, seven browser tests, and eleven download-policy tests. The final wording change passed another production build and live browser check. The download URL and its versioned query redirect to the HTML status page. The published manifest reports paused, and the build contains no Windows executable.

## Prior 1.0.1 verification

September 2, 2026. Version 1.0.1.

Live site: https://lense-visual-control.netlify.app

Deployment: https://app.netlify.com/projects/lense-visual-control/deploys/6a98c6e5cb3dc407db941edd

## Version 1.0.1 changes

The bridge now chooses among reserved localhost ports 17373, 17374, and 17375. A second launch detects the current bridge. Another application's occupied port no longer causes raw Windows error 10048. Discovery checks identity before pairing, and authenticated requests stay on the selected endpoint.

Each page has a question-mark button that toggles its own guide. Bridge setup shows four steps with progress, browser and Windows permissions, and monitor or window selection. The guide covers manual typing, the input lab, native woodcutting, external-agent tasks, history, and stopping. Moving from Bridge to desktop controls preserves the selected target. Refresh keeps saved frames in History instead of showing an old demo frame as a current Windows screenshot.

The [user guide](getting-started.md) gives the complete setup and first-task procedure.

## Delivered

The checkout originally contained only README.md. This release adds a Vue 3, Vite, TypeScript, and Pinia control center; provider-independent task engine; IndexedDB history and replay; six WebMCP tools; deterministic screenshot-driven Woodcutting Lab; browser screen sharing; and a portable Rust Windows bridge. The bridge contains real Windows input and capture code, scoped pairing, exact origin checks, multi-monitor coordinate conversion, native visual watches, and authenticated WebSocket events.

Main entry points are `src/App.vue`, `src/stores/control.ts`, `src/services/tasks/engine.ts`, `src/services/bridge/client.ts`, `src/services/webmcp/register.ts`, `src/lab/evaluator.ts`, and `bridge/src/api.rs`. The native Windows implementation is `bridge/src/native/platform.rs`.

## Passed

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm test` | 34 tests passed |
| `pnpm build` | Passed, typecheck and Vite production bundle |
| `pnpm test:e2e` | 7 tests passed against the production build |
| `cargo test --manifest-path bridge/Cargo.toml --locked` | 21 tests passed |
| `cargo build --manifest-path bridge/Cargo.toml --release --locked` | Passed |
| Static CRT dependency inspection | No VCRUNTIME140.dll dependency |
| Real read-only Windows smoke | 3 monitors, negative x coordinate, real JPEG capture, 15 visible windows |
| Browser-native WebMCP | Six registered tools; live status and task calls succeeded |
| Production HTTP | Site and EXE returned 200; security headers present |
| Download integrity | Hosted binary SHA-256 matches the local release |
| Actual Windows startup | New bridge used 17374 while the older companion stayed on 17373 |
| Duplicate launch | Reported the running bridge and exited successfully |
| Fallback endpoint security | Trusted origin returned 200; wrong Host and untrusted Origin returned 403 |
| Live contextual guide | Setup help opened on the deployed site; refreshed desktop preview stayed empty until capture |
| `git diff --check` | Passed |

The 30-second browser test verifies screenshot-based target selection, tree clicks, depletion, recovery to a different tree, continued chopping, completion, replay frames, and JSONL export. Other browser tests cover mock bridge pairing, Unicode typing, focus before keyboard input, hotkeys, stop/revocation, pause/resume, immediate refresh persistence, registration, and mobile layout. The fallback test proves the incompatible companion receives only unauthenticated status reads, while pairing, tokens, input, watches, and WebSocket events stay on the selected port. The setup test covers target preservation between pages; the guide test covers each page, toggle, Escape, focus return, and mobile overflow.

## Download

File: `public/downloads/LenseBridge-windows-x64.exe`

Built executable: `bridge/target/release/lense-bridge.exe`

Size: 1007104 bytes. Bridge version 1.0.1.

SHA-256: `f568eeec970fbf3280e01bebfc5bc302d3e07f4061467d3040c32a6c5d78df32`.

The downloadable file includes the static C runtime and requires no installer. It is unsigned.

## Historical run and pair procedure

Do not use this procedure to restore or run the quarantined release. New Windows setup remains paused.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

```powershell
cargo build --manifest-path bridge/Cargo.toml --release --locked
./bridge/target/release/lense-bridge.exe --dev
```

For the deployed website, run the EXE without `--dev`. Open Windows desktop in Lense, detect the bridge, click Pair desktop, and approve the Windows prompt. Choose a monitor or window. For native woodcutting, open `/lab` in a separate visible window, select it as the capture target, choose Woodcutting Lab autopilot, and run the task.

The former release used the commands below. Current packaging also requires an approved distribution policy, clean build provenance, and a valid signature from the expected signer. See README.md for the current release gates.

```powershell
./scripts/package-bridge.ps1
pnpm build
npx netlify-cli deploy --prod --dir dist --no-build
```

## Remaining physical verification

The existing `lense-companion` from the separate `lense-desktop-control-poc` repository still owns 127.0.0.1:17373. Version 1.0.1 successfully started on 17374 alongside it. The earlier request to close that companion is no longer necessary. The temporary new test process was stopped after verification, leaving fallback ports free for the user to run the download.

Real native pairing, pointer/click/drag/scroll, Unicode typing, hotkeys, and the physical emergency shortcut have not been verified end to end. Their protocol and executor paths have mock-based tests. Native screenshot capture has been verified separately. Follow `docs/native-smoke.md` after starting the current download and approving pairing.

The in-app browser reported local network permission as granted during this update. A hosted detection check could not complete after the managed test process became suspended between command sessions. The same executable passed actual HTTP status, origin, Host, and duplicate-launch checks while its launching command remained active. This report does not claim complete hosted-to-native pairing. The website's fallback connection and input flow passed browser tests with a mock bridge.

Production navigation to Bridge and Demos passed with no page errors. A 14-second task through the deployed site's native WebMCP tools completed with three actions, two recoveries, nine observations, nine evaluations, and fourteen cheap watch checks.

## Limits

Arbitrary natural-language desktop automation needs an external WebMCP agent or an AgentProvider adapter. The included autopilot recognizes only the visual lab. No paid provider credentials are configured.

Native capture reads visible desktop pixels. Keep selected windows visible and unobscured. Elevated applications, protected content, locked sessions, and secure desktops may reject capture or input. Mixed-DPI physical clicking still needs the manual check.

Native watches run outside browser timers, but hosted reasoning still needs an open, connected browser. The state machine checks wall-clock duration and deadlines immediately before input. History retains the latest 10,000 events and 32 screenshots, with a 12 MiB image budget. API tokens stay in memory and are never restored after refresh.
