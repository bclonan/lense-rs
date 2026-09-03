# WebMCP and hackathon release

Deployed to the existing Netlify project on 2026-09-03 UTC. Deploy ID: `6a9912448fe1871ea03be90f`. Main app bundle: `index-3t50-sqt.js`.

- [Control](https://lense-visual-control.netlify.app/)
- [WebMCP documentation](https://lense-visual-control.netlify.app/webmcp)
- [Hackathon overview](https://lense-visual-control.netlify.app/hackathon)
- [Published recording script](https://lense-visual-control.netlify.app/docs/demo-video-script.md)
- [Published MIT license](https://lense-visual-control.netlify.app/license.txt)
- [Immutable deploy](https://6a9912448fe1871ea03be90f--lense-visual-control.netlify.app)

## What changed

The documentation page derives its seven cards from the active canonical registry. It includes schemas, validated example arguments, illustrative results, recovery guidance, copy controls, a read-only runner, a live inspector, 14 prompts across ten intent groups, and six chained workflows. Input and task-changing examples open a preview.

The hackathon overview explains the real Vue, Pinia, IndexedDB, service-adapter, Rust, and Netlify implementation. It includes a submission checklist and a 376-word, 2:50 narration plan. The public video remains `[YOUTUBE_URL]` in `src/site/site-config.json`.

The existing application shell owns navigation and tool registration. Page changes preserve the current task and registry. Both new routes have static HTML metadata as well as client-side metadata. Original icons and a 1200 by 630 social image use the existing brand colors and fonts.

## Verification

`pnpm verify` passed after correcting the extensionless route metadata:

| Check | Result |
| --- | --- |
| Unit tests | 116 passed across 14 files |
| Native distribution policy | 17 passed |
| Icon and metadata checks | 4 passed |
| TypeScript and production build | Passed |
| Browser acceptance tests | 15 passed |
| Whitespace check | `git diff --check` passed |

The browser tests cover runtime/documentation parity, example schemas, task preservation across navigation, copy feedback, input previews, direct refresh, internal links, 320px layouts, and printing. Render tests cover both placeholder and configured YouTube states and compare every script segment with the Markdown version.

After deployment, `node scripts/production-smoke.mjs` passed the existing help, bridge-navigation, continuous Lab queue, pause, and mobile checks. `node scripts/documentation-production-smoke.mjs` verified both public pages, registry preservation through Back and Forward, six internal URLs, all seven icon/manifest assets, and exact published license and script content.

The production documentation check found no JavaScript errors, application console errors, failed app assets, or Content Security Policy violations. Optional bridge detection received connection-refused responses from `127.0.0.1:17373`, where no bridge was running. This is separate from the hosted application checks.

Production screenshots and the machine-readable report are in the ignored `artifacts` directory. The new browser API lifecycle test uses a registration stub. Production Chromium exercised the local WebMCP fallback. Physical Windows input and an external native WebMCP agent were not retested by this release.

## Files created

```text
CONTRIBUTING.md
LICENSE
docs/demo-video-script.md
docs/third-party-notices.md
docs/webmcp-hackathon-release.md
public/apple-touch-icon.png
public/favicon.ico
public/favicon.svg
public/icon-192.png
public/icon-512.png
public/og-image.png
public/site.webmanifest
scripts/brand-assets.test.mjs
scripts/documentation-production-smoke.mjs
scripts/generate-brand-assets.py
scripts/prepare-documentation.mjs
src/pages/HackathonPage.vue
src/pages/WebMcpPage.vue
src/pages/components/CopyButton.vue
src/pages/hackathon.test.ts
src/pages/hackathon.ts
src/pages/webmcp-content.ts
src/services/webmcp/documentation.test.ts
src/services/webmcp/documentation.ts
src/services/webmcp/inspector.ts
src/services/webmcp/tools.ts
src/site/config.ts
src/site/metadata.test.ts
src/site/metadata.ts
src/site/page-metadata.json
src/site/site-config.json
tests/e2e/documentation.spec.ts
```

## Files modified

```text
README.md
index.html
netlify.toml
package.json
pnpm-lock.yaml
src/App.vue
src/main.ts
src/services/webmcp/register.ts
src/styles.css
vitest.config.ts
```

The Netlify change permits the configured YouTube player host in `frame-src`. Existing hosting, SPA fallback, and native distribution policy remain in place.

## Still required

- Record and publish the public YouTube video with audio, then replace `[YOUTUBE_URL]` and redeploy.
- Commit and publish the source changes and license. The existing GitHub repository was verified public; this release did not push a commit.
- Review event eligibility and submit the entry. No submission was made.
- Windows installer distribution remains paused pending the existing Norton review and approved build process. This release contains no replacement installer.
