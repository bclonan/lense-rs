# Desktop bridge protocol

LenseBridge listens on `127.0.0.1`, preferring port 17373, with reserved fallback ports 17374 and 17375. Startup first checks these three ports for an existing compatible bridge. A duplicate launch reports that endpoint and exits without initializing another native input service. An unrelated listener stays running; Lense uses the next available reserved port. If all three are occupied, the console explains how to retry without stopping other applications.

Protocol major version 1 uses JSON and physical desktop pixels. The bridge does not bind to a network adapter. Every HTTP request and WebSocket upgrade must contain an exact trusted `Origin`, and Host must match the bound loopback endpoint. The default production origin is `https://lense-visual-control.netlify.app`.

The website makes read-only status requests to the same three ports. It checks the LenseBridge name, Windows platform, protocol version, and required capabilities before offering pairing. It rechecks identity before pairing and keeps all authenticated requests and WebSocket events on the selected endpoint. It never retries a mutation on a different port. The site's Content Security Policy lists only these reserved loopback HTTP and WebSocket endpoints.

The repository's `.cargo/config.toml` statically links the MSVC runtime for x64 Windows. The portable executable needs Windows 10 version 1703 or later and does not require the Visual C++ redistributable installer.

Set `LENSE_PRODUCTION_ORIGIN` while building to replace the compiled origin. The same environment variable can override it at launch. Use an HTTPS origin without a trailing slash. `--dev` adds `http://localhost` and `http://127.0.0.1` on ports 5173, 4173, and 4174. Development origins are otherwise absent.

| Request | Authentication | Result |
| --- | --- | --- |
| `GET /v1/status` | Trusted origin | Name, version, protocolVersion, platform, capabilities, dryRun, port, endpoint |
| `POST /v1/pair` with `{}` | Trusted origin and native approval | Session with id, token, origin, scopes, createdAt |
| `POST /v1/unpair` | Bearer token | Revokes session and clears native watches |
| `POST /v1/action` | Bearer token and action scope | ActionResult with id, action, timestamps and result |
| `POST /v1/screen` | screen.read | Observation with JPEG data URL |
| `GET /v1/screen` | screen.read | Observation of primary monitor |
| `GET /v1/monitors` | screen.read | Monitor array |
| `GET /v1/windows` | windows.read | Visible, titled, nonminimized window array |
| `GET /v1/cursor` | pointer | Physical cursor x and y, possibly negative |
| `POST /v1/watches` | screen.read | Created or replaced WatchSpec |
| `GET /v1/watches` | screen.read | Current session's WatchSpec array |
| `DELETE /v1/watches/{id}` | screen.read | Removes the watch |
| `GET /v1/events` | WebSocket upgrade | Events after first-message authentication |

Privileged HTTP requests use `Authorization: Bearer <token>`. All errors have the form `{"error":{"code":"INVALID_TOKEN","message":"..."}}`. HTTP status codes distinguish bad input, denied origins, missing sessions, limits, and native failures.

WebSocket clients connect to `/v1/events` at the selected loopback endpoint using `ws:`, then send `{"token":"<paired token>"}` within five seconds. Tokens never appear in the URL. Events have `id`, `timestamp`, `type`, and `data`. The server sends only events owned by the authenticated session. Revocation closes the socket with code 1008. A slow subscriber receives `bridge.eventsDropped` if its queue overflows and must observe again.

The canonical frontend definitions are in `src/types/protocol.ts`; Rust equivalents are in `bridge/src/protocol.rs`. Rust rejects unknown input fields. Supported input actions are pointer.move, pointer.click, pointer.doubleClick, pointer.drag, keyboard.type, keyboard.key, keyboard.hotkey, scroll, and window.focus. There are no process, shell, file, network proxy, or clipboard endpoints.

```json
{"type":"pointer.click","x":0.61,"y":0.44,"button":"left","target":{"type":"monitor","id":"primary"}}
```

```json
{"type":"keyboard.type","text":"Hello from Lense. 世界 😀"}
```

```json
{"type":"keyboard.hotkey","keys":["CTRL","S"]}
```

Typing sends Unicode UTF-16 input through SendInput. Line breaks send Enter, and a CRLF pair becomes one Enter. Named keys include modifiers, arrows, HOME, END, PAGEUP, PAGEDOWN, INSERT, DELETE, BACKSPACE, TAB, ENTER, ESCAPE, SPACE, WIN, letters, digits, and F1 through F24. Scroll uses Windows wheel units. Positive deltaY scrolls down; negative scrolls up. Positive deltaX scrolls right. A normal wheel notch is 120 units.

Input points are normalized to the selected monitor or visible window bounds. The bridge maps 0 to the first physical pixel and 1 to the last physical pixel. `primary` resolves at request time. Monitor IDs otherwise match the Windows display device name. Window IDs are current HWND values encoded in hexadecimal, not permanent application identities.

The process enables per-monitor V2 DPI awareness before any display operation. Absolute pointer input uses the complete virtual desktop, including monitors with negative coordinates. Cropped observations include their original normalized `region`. Their image and cursor coordinates are relative to that crop. Before sending a pointer action from a crop, map it back with `targetX = region.x + imageX * region.width`, and the corresponding formula for y. Actions always use full target coordinates.

Capture options accept a target, optional normalized region, maxDimension from 160 through 2560, and JPEG quality from 0.1 through 1. Defaults are primary monitor, maxDimension 1280, and quality 0.8. Native dimensions describe the captured region before scaling. Capture reads the visible desktop composition. It does not reveal content obscured by another window, minimized windows, protected video, or the Windows secure desktop.

Only one native action and one screenshot encode run at a time. An overlapping action returns BUSY. Drag duration is 50 through 5000 ms, text is at most 10000 UTF-16 units, hotkeys contain at most five distinct keys, and scroll deltas are limited to 10000 units per axis. The native action limit is 120 per minute. The request limit is 600 per trusted origin per minute; unpair bypasses it so STOP remains available.

Watches accept `mode: "visual-change"`, a 500 through 3600000 ms interval, and a threshold from 0 through 1. At most 16 watches run. They compare downscaled RGB frames with a mean absolute difference normalized to 0 through 1. They emit watch.tick or watch.changed with watchId, changed, difference, frameId, foregroundChanged, and unchangedIntervals. The first frame establishes a baseline. A foreground-window change also wakes the client. The native process does not interpret images or call an LLM. Watch failures emit watch.failed.

Every action response includes `result.executed`. Explicit `--dry-run` returns `executed: false` and `dryRun: true`; status also identifies dry-run mode. Production input has no simulation fallback.
