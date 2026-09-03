# Capture feedback release verification

Production deploy `6a98fe5c2524cf20d5932b1b` publishes the web capture and input-routing changes to https://lense-visual-control.netlify.app. The final bundle is `index-BweH9ISY.js`.

The release build and Vue typecheck passed. All 100 unit tests, 17 distribution tests, and 12 browser tests passed on the final build. The browser suite covers ordered focus and keyboard input, click and drag coordinates, automatic preview capture, stale task guards, target changes during action feedback, successful input followed by failed capture, continuous queues, shared video, and the existing lab/reference flows.

Two additional tests against the production page passed. They fed a real browser MediaStream from a synthetic canvas into the shared video and verified changed pixels through `desktop_observe`. They also verified recovery after picker cancellation and cleanup when a shared track ended. These tests replace the browser picker with a controlled stream; they do not automate native user approval.

The production smoke script passed contextual help, continuous lab queue, and mobile checks with no JavaScript page errors or horizontal overflow. Deployment contains zero Windows executables.

Native source passed Cargo formatting, `cargo check --locked --all-targets`, and 24 library/mock tests. No new release executable was launched, and no test in this run sent actual Windows input. Native minimized-window restoration, held taps, and GDI scaling remain unpublished while the Norton release review is unresolved. Frontend target focus and serialized input use the existing bridge protocol.

Local screenshots are in `artifacts/input-feedback-desktop.png` and `artifacts/input-feedback-mobile.png`. The captured scene and native transport are test fixtures.
