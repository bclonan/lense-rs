import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import HackathonPage from './HackathonPage.vue'
import { demoSegments, demoSpokenWords, demoTaskArguments } from './hackathon'
import { createLenseTools } from '../services/webmcp/tools'

// Each render receives a test-only URL. The production configuration is never edited.
const { configuredSite } = vi.hoisted(() => ({ configuredSite: {
  name: 'Lense', liveUrl: 'https://lense-visual-control.netlify.app',
  repositoryUrl: 'https://github.com/bclonan/lense-rs', repositoryPublic: true,
  videoUrl: '[YOUTUBE_URL]', license: 'MIT',
} }))
vi.mock('../site/config', () => ({ siteConfig: configuredSite }))

beforeEach(() => { configuredSite.videoUrl = '[YOUTUBE_URL]' })

const renderPage = () => renderToString(createSSRApp(HackathonPage))
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]!)

describe('Hackathon demo video rendering', () => {
  it('shows the missing-video state and recording plan without an iframe', async () => {
    const html = await renderPage()
    expect(html).toContain('class="video-frame"')
    expect(html).toContain('class="video-placeholder"')
    expect(html).toContain('The public demo video will appear here.')
    expect(html).toContain('[YOUTUBE_URL]')
    expect(html).toContain('href="#recording-script"')
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('youtube-nocookie.com')
  })

  it('renders a configured YouTube video with a privacy-enhanced embed and accessible title', async () => {
    configuredSite.videoUrl = 'https://www.youtube.com/watch?v=abcdefghijk&feature=shared'
    const html = await renderPage()
    expect(html).toMatch(/<iframe[^>]+src="https:\/\/www\.youtube-nocookie\.com\/embed\/abcdefghijk"/)
    expect(html).toContain('title="Lense public WebMCP demo video"')
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('referrerpolicy="strict-origin-when-cross-origin"')
    expect(html).toContain('Check public access and audio')
    expect(html).not.toContain('class="video-placeholder"')
    expect(html).not.toContain('autoplay')
  })

  it('keeps a misleading non-YouTube URL out of both the iframe and video link', async () => {
    configuredSite.videoUrl = 'https://youtube.com.untrusted.example/watch?v=abcdefghijk'
    const html = await renderPage()
    expect(html).toContain('class="video-placeholder"')
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('untrusted.example')
  })
})

describe('Hackathon recording contract', () => {
  it('validates primary and queued demo arguments against the registered desktop_task schema', () => {
    const tools = createLenseTools({} as never, {} as never)
    const taskTool = tools.find(tool => tool.name === 'desktop_task')
    expect(taskTool).toBeDefined()
    const ajv = new Ajv({ strict: false, allErrors: true })
    addFormats(ajv)
    const validate = ajv.compile(taskTool!.inputSchema)
    expect(validate(demoTaskArguments), ajv.errorsText(validate.errors)).toBe(true)
    const queuedArguments = { operation: 'enqueue', config: { ...demoTaskArguments.config, durationMs: 6000 } }
    expect(validate(queuedArguments), ajv.errorsText(validate.errors)).toBe(true)
    const names = new Set(tools.map(tool => tool.name))
    for (const segment of demoSegments) for (const name of segment.tools.match(/desktop_[a-z]+|osrs_reference/g) ?? []) {
      expect(names.has(name), `${segment.time} names an unregistered tool: ${name}`).toBe(true)
    }
  })

  it('renders exactly the narration saved in the Markdown script at a 2:50 speaking pace', async () => {
    const markdown = readFileSync(new URL('../../docs/demo-video-script.md', import.meta.url), 'utf8')
    const html = await renderPage()
    expect(demoSegments.map(segment => segment.time)).toEqual(['0:00–0:15', '0:15–0:35', '0:35–1:45', '1:45–2:15', '2:15–2:35', '2:35–2:50'])
    const spokenWords = demoSegments.reduce((count, segment) => count + segment.narration.trim().split(/\s+/).length, 0)
    expect(demoSpokenWords).toBe(spokenWords)
    expect(spokenWords / (170 / 60)).toBeGreaterThanOrEqual(130)
    expect(spokenWords / (170 / 60)).toBeLessThanOrEqual(150)
    for (const segment of demoSegments) {
      expect(html).toContain(escapeHtml(segment.narration))
      expect(markdown).toContain(`> ${segment.narration}`)
      expect(markdown).toContain(`Screen action: ${segment.action}`)
      expect(markdown).toContain(`WebMCP tools: ${segment.tools}`)
      expect(markdown).toContain(`Expected visible result: ${segment.result}`)
    }
    expect(markdown).toContain(JSON.stringify(demoTaskArguments, null, 2))
  })
})
