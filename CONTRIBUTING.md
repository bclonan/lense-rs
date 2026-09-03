# Contributing to Lense

Start with the [README](README.md) and the browser lab. Keep changes within the existing Vue, Pinia, service, and adapter structure. Use the same actions for interface controls and WebMCP handlers so their state cannot diverge.

## Add or change a tool

1. Add the definition to `createLenseTools` in `src/services/webmcp/tools.ts`. Keep imperative registration in `src/services/webmcp/register.ts`. Do not register another catalog in a page component.
2. Define bounded JSON Schema properties in `src/services/webmcp/schemas.ts`, or beside a small tool. Use existing names and operation patterns, reject unsupported fields, and validate the input in the handler or shared service. `readOnlyHint` describes behavior; it does not grant permission.
3. Call the existing store actions in `src/stores/control.ts` and `src/stores/bridge.ts`. New desktop backends implement `DesktopAdapter`; evaluator integrations implement `AgentProvider` in `src/types/protocol.ts`. Put transport code in a service module. Keep credentials out of tools, logs, and the browser bundle.
4. Return serializable structured data or the existing image/text content format. Preserve typed error codes and explain how callers recover. Respect cancellation and current task/frame guards. A failed follow-up capture must never invite repeating successful input.
5. Add optional editorial details to `documentationOverrides` in `src/services/webmcp/documentation.ts`. The catalog automatically reads the tool name, description, schema, and annotations and generates a prompt. Curated arguments, result examples, state notes, and recovery guidance make a new tool useful. Do not add a separate list of tool definitions.
6. Add feature prompts and chained examples in `src/pages/webmcp-content.ts`. Every step must use a real tool. Record the earlier result it needs, expected state change, human approval point, and partial-failure behavior. Example task, window, and frame IDs are placeholders to replace with current results.
7. Run `pnpm verify`. Add focused behavior checks for new state changes, input validation, error recovery, and visible results. `documentation.test.ts` validates every schema and example; the browser suite compares the live registry with every documentation card.

The docs runner is an explicit allowlist of read-only operations. A new tool gets preview-only behavior by default, even if it has a read-only annotation. Do not make an input or task-changing example execute just to demonstrate it.

## Test and review

Install dependencies with `pnpm install --frozen-lockfile`. Install the test browser once with `pnpm exec playwright install chromium`. `pnpm verify` runs unit tests, distribution checks, asset checks, type-check/build, and browser acceptance tests. The repository has no separate lint command.

Use `/input-lab` for disposable typing and pointer tests. Use the browser lab for reproducible capture, evaluation, recovery, and queue behavior. Mock input in automated tests. Keep any real desktop-input evidence separate from simulated checks.

Check direct page loads, browser Back, keyboard access, reduced motion, and 320px layout after navigation changes. An active task must survive navigation between Control, `/webmcp`, and `/hackathon`. Refresh restores work paused.

Include the problem, resulting behavior, and checks in a pull request. Do not claim a deployment, native release, video, or external integration works without verifying it.

## Public content and releases

Edit public URLs in `src/site/site-config.json`. Missing URLs stay labeled placeholders. The demo plan is in `src/pages/hackathon.ts` and `docs/demo-video-script.md`; update both narration copies together. Tests compare their text. Route metadata belongs in `src/site/page-metadata.json`.

The checked-in original icons and social image need no generation step to build the site. `scripts/generate-brand-assets.py` can regenerate them with Python, Pillow, and fontTools using the bundled fonts. Preserve their licenses.

Deploy through the existing Netlify site as described in the README. Follow `docs/windows-setup.md`, `docs/antivirus-review.md`, and `release/bridge-distribution.json` for native releases. An unsigned local build is not a reviewed public installer.
