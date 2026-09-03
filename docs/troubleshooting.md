# Troubleshooting

## Norton IDP.Generic or quarantine

The Windows 1.0.1 download is paused while Norton's report is reviewed. There is no approved replacement yet. Keep the file in quarantine and use the browser lab. Do not disable antivirus protection or add exclusions. [Download status](https://lense-visual-control.netlify.app/bridge-download-status.html) and [review details](antivirus-review.md).

The Windows instructions below apply to an approved bridge release. They do not override a quarantine.

## Bridge not detected

Run the current executable on the same Windows computer as the browser and keep its window open. Lense checks only `127.0.0.1` on reserved ports 17373, 17374, and 17375. Confirm the site origin matches the bridge's trusted origin. Local development requires `--dev`. The **?** button near the page heading shows setup and device-selection instructions.

## Socket address already in use, Windows error 10048

The bridge code uses another reserved local port when an older companion occupies the default. Opening it a second time reports the bridge that is already running. You do not need to stop the older companion. The 1.0.1 download containing this fix is paused pending antivirus review.

If all three reserved ports are occupied, the bridge lists them and asks you to close a bridge copy you no longer need, then launch again. It never terminates another program or selects an arbitrary network port.

## Browser connection permission

The client distinguishes denied loopback permission from other connection failures. Browser implementations expose different permission names; Lense probes `loopback-network` and older `local-network-access` support. It supplies the `targetAddressSpace: "loopback"` request option where accepted. It never retries an input request because an option might be unsupported.

Current Chromium versions may show a local network access prompt. A denied prompt must be changed by the user in the browser's site settings. Firefox, Safari, enterprise browser policy, and embedded browsers can differ. Lense does not bypass these controls. See [Chrome's Local Network Access explanation](https://developer.chrome.com/blog/local-network-access) and the [current draft](https://wicg.github.io/local-network-access/).

## Pairing does not finish

Find the native Windows confirmation. Allow or deny it yourself. Closing Lense or timing out does not mean the user approved. The bridge never treats an absent confirmation as approval.

## Desktop click has no effect

Refresh the window list. Select the target again and take a fresh observation. Keep the target visible and unobscured. Windows input affects the foreground desktop; elevated applications, secure desktops, locked sessions, protected video, or remote session restrictions may prevent capture or input. Lense reports failures; it does not elevate itself.

## Lab pauses because it cannot recognize the scene

Use the included Woodcutting Lab with its visible status indicator and trees. The built-in evaluator is deliberately limited to that scene. Unknown conditions require an external agent or another evaluator adapter. For native capture, keep the whole lab visible.

## Stop or disconnect reports a connection error

The website cancels pending work locally, but a failed unpair request cannot prove the native session was revoked. Press Ctrl+Alt+Escape or close the bridge console to revoke it locally.

## A task vanished or returned paused

History is local to this browser and origin. Clearing site data removes it. Refresh restores task metadata but requires explicit Resume. Browser sleeping or closing suspends hosted reasoning, even though native image watches run in Rust while their sessions remain valid.

## Windows build tools

Use the stable `x86_64-pc-windows-msvc` Rust toolchain and Visual Studio C++ build tools. Run `cargo test` before the release build. The GitHub Windows workflow builds the executable separately from the static Netlify frontend.
