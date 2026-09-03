import { chromium, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const site = JSON.parse(await source('src/site/site-config.json'))
const metadata = JSON.parse(await source('src/site/page-metadata.json'))
const base = (process.env.LENSE_PRODUCTION_URL || site.liveUrl).replace(/\/$/, '')
const errors = [], cspViolations = [], consoleErrors = [], loopbackErrors = [], applicationFailures = [], internalLinks = new Set(), checkedAssets = []
const isLoopback = url => /^https?:\/\/127\.0\.0\.1:1737[345](?:\/|$)/.test(url)
await mkdir('artifacts', { recursive: true })
const browser = await chromium.launch({ headless: true })

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() !== 'error') return
    const error = { source: 'console', url: message.location().url, message: message.text() }
    if (isLoopback(error.url)) loopbackErrors.push(error)
    else consoleErrors.push(error)
    if (/content security policy/i.test(error.message)) cspViolations.push(error.message)
  })
  page.on('requestfailed', request => {
    const error = { source: 'request', url: request.url(), message: request.failure()?.errorText }
    if (isLoopback(error.url)) loopbackErrors.push(error)
    else applicationFailures.push(error)
  })
  await page.exposeFunction('lenseSmokeCsp', violation => cspViolations.push(violation))
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', event => {
    window.lenseSmokeCsp({ directive: event.effectiveDirective, blockedUri: event.blockedURI })
  }))
  const status = () => page.evaluate(() => window.lense.call('desktop_status'))
  const ready = async () => {
    await expect.poll(() => page.evaluate(() => window.lense?.tools.length)).toBe(7)
    await expect.poll(async () => (await status()).observationId).toBeTruthy()
  }
  const sameRegistry = async () => expect(await page.evaluate(() => !!window.__smokeTools && window.__smokeTools.every((tool, index) => tool === window.lense?.tools[index]))).toBe(true)

  for (const route of ['/webmcp', '/hackathon']) {
    const response = await page.request.get(`${base}${route}`)
    expect(response.ok(), route).toBe(true)
    const head = await page.evaluate(html => {
      const document = new DOMParser().parseFromString(html, 'text/html')
      const content = selector => document.querySelector(selector)?.getAttribute('content')
      return { title: document.title, description: content('meta[name="description"]'), canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href'), ogTitle: content('meta[property="og:title"]'), ogUrl: content('meta[property="og:url"]'), image: content('meta[property="og:image"]'), twitterCard: content('meta[name="twitter:card"]') }
    }, await response.text())
    expect(head).toEqual({ title: metadata[route].title, description: metadata[route].description, canonical: `${site.liveUrl}${route}`, ogTitle: metadata[route].title, ogUrl: `${site.liveUrl}${route}`, image: `${site.liveUrl}/og-image.png`, twitterCard: 'summary_large_image' })
  }

  await page.goto(`${base}/webmcp`)
  await ready()
  await expect(page.locator('[data-tool-name]')).toHaveCount(7)
  expect(await page.locator('[data-tool-name]').evaluateAll(cards => cards.map(card => card.getAttribute('data-tool-name')).sort())).toEqual(await page.evaluate(() => window.lense.tools.map(tool => tool.name).sort()))
  await page.evaluate(() => {
    window.__smokeTools = [...window.lense.tools]
    window.__smokeActionCalls = 0
    const action = window.lense.tools.find(tool => tool.name === 'desktop_action'), execute = action.execute
    action.execute = (...args) => { window.__smokeActionCalls++; return execute(...args) }
  })
  const statusCard = page.locator('[data-tool-name="desktop_status"]')
  await statusCard.getByRole('button', { name: 'Run read-only example', exact: true }).click()
  await expect(statusCard.locator('.tool-live-result')).toContainText('Read-only call returned')
  await expect(page.locator('#live-inspector .inspector-last-name')).toHaveText('desktop_status')
  await page.locator('[data-tool-name="desktop_action"]').getByRole('button', { name: 'Preview call', exact: true }).click()
  const preview = page.getByRole('dialog', { name: 'Review desktop_action', exact: true })
  await expect(preview).toContainText('This page will not execute it.')
  expect(await page.evaluate(() => window.__smokeActionCalls)).toBe(0)
  await page.keyboard.press('Escape')
  await expect(preview).not.toBeVisible()
  expect((await status()).task).toBeNull()

  for (const route of ['/webmcp', '/hackathon']) {
    if (route === '/hackathon') await page.getByRole('navigation', { name: 'Project resources' }).getByRole('link', { name: 'Hackathon', exact: true }).click()
    await expect(page).toHaveURL(`${base}${route}`)
    await expect(page).toHaveTitle(metadata[route].title)
    await sameRegistry()
    if (route === '/hackathon' && site.videoUrl === '[YOUTUBE_URL]') {
      await expect(page.locator('.video-frame')).toContainText('[YOUTUBE_URL]')
      await expect(page.locator('.video-frame iframe')).toHaveCount(0)
    }
    const links = await page.locator('a[href]').evaluateAll(anchors => anchors.map(anchor => ({ href: anchor.href, hash: anchor.getAttribute('href') })).filter(link => new URL(link.href).origin === location.origin))
    for (const { href, hash } of links) {
      if (hash.startsWith('#')) expect(await page.evaluate(id => !!document.getElementById(decodeURIComponent(id)), hash.slice(1)), href).toBe(true)
      internalLinks.add(href.split('#')[0])
    }
    for (const [label, width, height] of [['desktop', 1440, 1000], ['mobile', 320, 780]]) {
      await page.setViewportSize({ width, height })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${route} ${label} overflow`).toBe(true)
      await page.screenshot({ path: `artifacts/${route.slice(1)}-production-${label}.png`, fullPage: true })
    }
  }
  await page.goBack()
  await expect(page).toHaveURL(`${base}/webmcp`)
  await expect(page.locator('[data-tool-name]')).toHaveCount(7)
  await sameRegistry()
  await page.goForward()
  await expect(page).toHaveURL(`${base}/hackathon`)
  await sameRegistry()
  await page.locator('.hackathon-hero').getByRole('link', { name: 'Launch demo', exact: true }).click()
  await expect(page.getByLabel('Task goal')).toBeVisible()
  await sameRegistry()
  await page.goBack()
  await expect(page).toHaveURL(`${base}/hackathon`)
  await sameRegistry()
  await page.reload()
  await ready()
  await expect(page).toHaveTitle(metadata['/hackathon'].title)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)

  for (const href of internalLinks) expect((await page.request.get(href)).ok(), href).toBe(true)
  const pngSizes = { '/apple-touch-icon.png': [180, 180], '/og-image.png': [1200, 630], '/icon-192.png': [192, 192], '/icon-512.png': [512, 512] }
  for (const path of ['/favicon.svg', '/favicon.ico', ...Object.keys(pngSizes), '/site.webmanifest']) {
    const response = await page.request.get(`${base}${path}`)
    expect(response.ok(), path).toBe(true)
    const bytes = await response.body()
    if (pngSizes[path]) {
      expect(bytes.subarray(0, 8).toString('hex'), path).toBe('89504e470d0a1a0a')
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], path).toEqual(pngSizes[path])
    } else if (path.endsWith('.ico')) {
      expect(bytes.readUInt16LE(0)).toBe(0); expect(bytes.readUInt16LE(2)).toBe(1); expect(bytes.readUInt16LE(4)).toBe(3)
    } else if (path.endsWith('.svg')) expect(bytes.toString()).toContain('<svg')
    else expect(JSON.parse(bytes.toString()).name).toBe(site.name)
    checkedAssets.push(path)
  }
  for (const [path, original] of [['/license.txt', 'LICENSE'], ['/docs/demo-video-script.md', 'docs/demo-video-script.md']]) {
    const response = await page.request.get(`${base}${path}`)
    expect(response.ok(), path).toBe(true)
    const normalize = text => text.replace(/\r\n/g, '\n').trim()
    expect(normalize(await response.text()), path).toBe(normalize(await source(original)))
    checkedAssets.push(path)
  }
  expect(errors).toEqual([])
  expect(cspViolations).toEqual([])
  expect(consoleErrors).toEqual([])
  expect(applicationFailures).toEqual([])
  const report = { base, routes: ['/webmcp', '/hackathon'], tools: 7, safeExample: true, actionPreviewCalls: 0, navigationPreservedRegistry: true, mobileWidth: 320, overflow: false, internalLinks: internalLinks.size, checkedAssets, pageErrors: errors, consoleErrors, applicationFailures, cspViolations, optionalLoopbackErrors: loopbackErrors }
  await writeFile('artifacts/documentation-production-report.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally { await browser.close() }
