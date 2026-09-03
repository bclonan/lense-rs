import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test.use({ actionTimeout: 10000 })

const toolCall = (page: Page, name: string, input: Record<string, unknown> = {}) =>
  page.evaluate(({ name, input }) => (window as any).lense.call(name, input), { name, input })

async function inspectNativeRegistration(page: Page) {
  await page.addInitScript(() => {
    const audit = { registered: [] as any[], unregistered: [] as string[], calls: [] as { name: string; input: unknown }[], copied: '' }
    ;(window as any).__documentationAudit = audit
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: {
        registerTool(tool: any) {
          const execute = tool.execute
          tool.execute = async (input: unknown, context: unknown) => {
            audit.calls.push({ name: tool.name, input })
            return execute(input, context)
          }
          audit.registered.push(tool)
        },
        unregisterTool(name: string) { audit.unregistered.push(name) },
      },
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => { audit.copied = text } },
    })
  })
}

async function ready(page: Page, path: string) {
  await page.goto(path)
  await expect.poll(() => page.evaluate(() => (window as any).lense?.tools.length)).toBe(7)
  await expect.poll(async () => (await toolCall(page, 'desktop_status')).observationId).toBeTruthy()
}

test('navigation preserves the active task and the same native registry', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await inspectNativeRegistration(page)
  await ready(page, '/')
  await expect.poll(async () => (await toolCall(page, 'desktop_status')).webMcp).toBe('native')
  const started = await toolCall(page, 'desktop_task', {
    operation: 'start',
    config: {
      goal: 'Keep chopping in the included Lab while I inspect the documentation.',
      durationMs: 30000,
      runMode: 'continuous',
      verification: { condition: 'The character is actively chopping a tree', intervalMs: 1000 },
      monitoring: { mode: 'events-and-interval', watchIntervalMs: 500, settleMs: 0 },
      invariants: [],
      limits: { maxConsecutiveFailures: 10, maxActionsPerMinute: 60, confidenceThreshold: .8 },
    },
  })
  expect(started.isError).not.toBe(true)
  const initialTask = (await toolCall(page, 'desktop_status')).task
  expect(initialTask.id).toBeTruthy()
  await page.evaluate(() => { (window as any).__initialTools = [...(window as any).lense.tools] })
  const resources = page.getByRole('navigation', { name: 'Project resources' })
  await resources.getByRole('link', { name: 'WebMCP', exact: true }).click()
  await expect(page).toHaveURL(/\/webmcp$/)
  await expect(page.locator('[data-tool-name]')).toHaveCount(7)
  const documented = await page.locator('[data-tool-name]').evaluateAll(cards => cards.map(card => card.getAttribute('data-tool-name')).sort())
  const registered = await page.evaluate(() => (window as any).lense.tools.map((tool: any) => tool.name).sort())
  expect(documented).toEqual(registered)
  await resources.getByRole('link', { name: 'Hackathon', exact: true }).click()
  await expect(page).toHaveURL(/\/hackathon$/)
  await expect(page.locator('.hackathon-page').getByRole('heading', { name: 'Lense', exact: true })).toBeVisible()
  await expect(page.locator('.architecture-flow > li')).toHaveCount(7)
  await page.locator('.hackathon-hero').getByRole('link', { name: 'Launch demo', exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByLabel('Task goal')).toBeVisible()
  const state = await toolCall(page, 'desktop_status')
  expect(state.task.id).toBe(initialTask.id)
  expect(['PAUSED', 'STOPPED', 'FAILED', 'COMPLETED']).not.toContain(state.task.state)
  expect(await page.evaluate(() => {
    const audit = (window as any).__documentationAudit
    const initial = (window as any).__initialTools
    return {
      registrations: audit.registered.length,
      unregistrations: audit.unregistered,
      sameObjects: !!initial && initial.every((tool: unknown, index: number) => tool === (window as any).lense.tools[index]),
    }
  })).toEqual({ registrations: 7, unregistrations: [], sameObjects: true })
  await toolCall(page, 'desktop_task', { operation: 'stop' })
  expect(errors).toEqual([])
})

test('tool examples copy with keyboard feedback and consequential examples only preview', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await inspectNativeRegistration(page)
  await ready(page, '/webmcp')
  const statusCard = page.locator('[data-tool-name="desktop_status"]')
  await expect(statusCard).toBeVisible()
  const copyName = statusCard.getByRole('button', { name: 'Copy tool name', exact: true })
  await copyName.focus()
  await page.keyboard.press('Enter')
  await expect(statusCard.getByRole('status').filter({ hasText: 'Copy tool name: copied' })).toBeVisible()
  expect(await page.evaluate(() => (window as any).__documentationAudit.copied)).toBe('desktop_status')
  await statusCard.getByRole('button', { name: 'Copy arguments', exact: true }).click()
  expect(await page.evaluate(() => (window as any).__documentationAudit.copied)).toBe('{}')
  await statusCard.getByRole('button', { name: 'Copy prompt', exact: true }).click()
  expect(await page.evaluate(() => (window as any).__documentationAudit.copied)).toContain('Lense status')
  const callsBefore = await page.evaluate(() => (window as any).__documentationAudit.calls.length)
  await statusCard.getByRole('button', { name: 'Run read-only example', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__documentationAudit.calls.length)).toBe(callsBefore + 1)
  expect(await page.evaluate(() => (window as any).__documentationAudit.calls.at(-1).name)).toBe('desktop_status')
  await expect(statusCard.locator('.tool-live-result')).toContainText('Read-only call returned')
  await expect(page.locator('#live-inspector')).toContainText('desktop_status')
  const actionCard = page.locator('[data-tool-name="desktop_action"]')
  const mutationCallsBefore = await page.evaluate(() => (window as any).__documentationAudit.calls.length)
  await actionCard.getByRole('button', { name: 'Preview call', exact: true }).click()
  const preview = page.getByRole('dialog', { name: 'Review desktop_action', exact: true })
  await expect(preview).toBeVisible()
  await expect(preview).toContainText('This page will not execute it.')
  expect(await page.evaluate(() => (window as any).__documentationAudit.calls.length)).toBe(mutationCallsBefore)
  expect(await page.evaluate(() => (window as any).__documentationAudit.calls.filter((call: any) => call.name === 'desktop_action'))).toEqual([])
  await page.keyboard.press('Escape')
  await expect(preview).not.toBeVisible()
  await expect(actionCard.getByRole('button', { name: 'Preview call', exact: true })).toBeFocused()
  const comparison = page.locator('#workflow-comparison')
  await comparison.getByRole('button', { name: 'Walk through the example', exact: true }).click()
  await comparison.getByRole('button', { name: 'Show next step', exact: true }).click()
  await expect(comparison.locator('.walkthrough-steps > li.current')).toContainText('Find task and queue controls')
  await comparison.getByRole('button', { name: 'Run live status check', exact: true }).click()
  await expect(comparison.getByRole('status')).toContainText('Current state returned')
  await expect(comparison.locator('.comparison-live .comparison-metrics > div').last()).toContainText(/Tool calls\s*1/)
  const workflowOptions = page.locator('.workflow-picker > button')
  expect(await workflowOptions.count()).toBeGreaterThanOrEqual(5)
  await workflowOptions.last().click()
  await expect(workflowOptions.last()).toHaveAttribute('aria-pressed', 'true')
  await page.locator('.workflow-card').getByRole('button', { name: 'Next step', exact: true }).click()
  await expect(page.locator('.workflow-step-label')).toContainText('Step 2 of')
  await page.getByLabel('Search tools', { exact: true }).fill('desktop_action')
  await expect(page.locator('[data-tool-name]')).toHaveCount(1)
  await page.getByLabel('Search tools', { exact: true }).clear()
  await expect(page.locator('[data-tool-name]')).toHaveCount(7)
  await page.locator('.prompt-filter').getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.locator('.prompt-card')).toHaveCount(1)
  await expect(page.locator('.prompt-card')).toContainText('Prepare one bounded Lab task')
  expect((await toolCall(page, 'desktop_status')).task).toBeNull()
  expect(errors).toEqual([])
})

test('documentation routes refresh, fit 320px, and serve complete metadata and branded assets', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const routes = JSON.parse(await readFile('src/site/page-metadata.json', 'utf8'))
  for (const route of ['/webmcp', '/hackathon']) {
    const response = await page.request.get(route)
    expect(response.ok(), route).toBe(true)
    const html = await response.text()
    expect(html).toContain(`<title>${routes[route].title}</title>`)
    expect(html).toContain(`property="og:title" content="${routes[route].title}"`)
    await ready(page, route)
    await expect(page).toHaveTitle(routes[route].title)
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://lense-visual-control.netlify.app${route}`)
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', routes[route].description)
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://lense-visual-control.netlify.app/og-image.png')
    if (route === '/hackathon') {
      await expect(page.getByRole('heading', { name: 'The public demo video will appear here.', exact: true })).toBeVisible()
      await expect(page.locator('.video-frame')).toContainText('[YOUTUBE_URL]')
      await expect(page.locator('.video-frame iframe')).toHaveCount(0)
    } else {
      await expect(page.locator('[data-tool-name]')).toHaveCount(7)
      if ((await toolCall(page, 'desktop_status')).webMcp === 'local') {
        await expect(page.locator('#live-inspector')).toContainText('does not currently expose native WebMCP registration')
      }
    }
    const missingAnchors = await page.locator('a[href^="#"]').evaluateAll(links => links.map(link => link.getAttribute('href')!).filter(href => href !== '#' && !document.getElementById(decodeURIComponent(href.slice(1)))))
    expect(missingAnchors, `${route} anchor targets`).toEqual([])
    const internalLinks = await page.locator('a[href^="/"]').evaluateAll(links => [...new Set(links.map(link => link.getAttribute('href')!.split('#')[0]!))])
    for (const href of internalLinks) expect((await page.request.get(href)).ok(), `${route} -> ${href}`).toBe(true)
    await page.emulateMedia({ media: 'print' })
    const hiddenPrintSections = await page.locator('.hackathon-page details, .webmcp-page details').evaluateAll(sections => sections.filter(section => [...section.children].some(child => child.tagName !== 'SUMMARY' && !child.classList.contains('copy-control') && !child.checkVisibility())).map(section => section.querySelector('summary')?.textContent))
    expect(hiddenPrintSections, `${route} collapsed details must print`).toEqual([])
    await page.emulateMedia({ media: 'screen' })
    const collapsedContent = route === '/hackathon' ? '.recording-script .script-segments' : '.tool-disclosure .tool-disclosure-body'
    expect(await page.locator(collapsedContent).first().evaluate(element => element.checkVisibility()), `${route} print styles must not expand screen content`).toBe(false)
    await page.setViewportSize({ width: 1440, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${route} desktop width`).toBe(true)
    await page.screenshot({ path: `artifacts/${route.slice(1)}-desktop.png`, fullPage: true })
    await page.setViewportSize({ width: 320, height: 780 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${route} mobile width`).toBe(true)
    await page.screenshot({ path: `artifacts/${route.slice(1)}-mobile.png`, fullPage: true })
    await page.reload()
    await expect(page).toHaveTitle(routes[route].title)
    await expect.poll(() => page.evaluate(() => (window as any).lense?.tools.length)).toBe(7)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${route} after reload`).toBe(true)
  }
  for (const asset of ['/favicon.svg', '/favicon.ico', '/apple-touch-icon.png', '/og-image.png', '/icon-192.png', '/icon-512.png', '/site.webmanifest']) {
    const response = await page.request.get(asset)
    expect(response.ok(), asset).toBe(true)
    const bytes = await response.body()
    if (asset.endsWith('.png')) {
      expect(bytes.subarray(0, 8).toString('hex'), asset).toBe('89504e470d0a1a0a')
      if (asset === '/og-image.png') expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1200, 630])
      if (asset === '/apple-touch-icon.png') expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([180, 180])
    } else if (asset.endsWith('.ico')) {
      expect(bytes.readUInt16LE(2)).toBe(1)
    } else if (asset.endsWith('.svg')) {
      expect(bytes.toString()).toContain('<svg')
    } else {
      expect(JSON.parse(bytes.toString()).name).toBe('Lense')
    }
  }
  expect(errors).toEqual([])
})
