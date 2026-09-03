# Implementation plan

The checkout began with only a README. Build a portable Rust bridge and a Vue control center around the shared v1 protocol in src/types/protocol.ts.

1. Implement loopback-only native capture, input, deliberate pairing, scoped sessions, visual watches, and revocation.
2. Implement a cancellable task runtime, screenshot-based lab evaluator, local persistence, and replay.
3. Build the control center, bridge client, browser screen sharing, and six shared WebMCP tools.
4. Verify Rust and frontend tests, production builds, lab recovery, browser pairing, and export. Deploy the site with a downloadable Windows binary.

Arbitrary desktop actions use an external WebMCP agent. The built-in autopilot recognizes only the included visual lab. It must never claim to understand another application's screenshot.
