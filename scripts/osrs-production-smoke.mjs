import { chromium, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

const base = process.env.LENSE_PRODUCTION_URL || 'https://lense-visual-control.netlify.app'
await mkdir('artifacts', { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = [], bridgeRequests = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (/127\.0\.0\.1:1737[345]/.test(request.url())) bridgeRequests.push(request.url()) })
  await page.goto(`${base}/osrs?entry=place-lumbridge-bank`)
  await expect(page.getByRole('heading', { name: 'Lumbridge Castle bank', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.lense?.tools.map(tool => tool.name))).toEqual(['osrs_reference'])
  const results = await page.evaluate(() => window.lense.call('osrs_reference', { operation: 'search', kind: 'visual', query: 'bank', limit: 3 }))
  expect(results.items.length).toBeGreaterThan(0)
  expect(results.items.length).toBeLessThanOrEqual(3)
  await page.screenshot({ path: 'artifacts/osrs-production-map.png', fullPage: true })
  await page.goto(`${base}/osrs?entry=visual-banker`)
  await expect(page.locator('#osrs-entry-detail').getByRole('heading', { name: 'Banker or bank booth', exact: true })).toBeVisible()
  await page.screenshot({ path: 'artifacts/osrs-production-dictionary.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.screenshot({ path: 'artifacts/osrs-production-mobile.png', fullPage: true })
  expect(bridgeRequests).toEqual([])
  await page.goto(base)
  await expect(page.getByRole('link', { name: /OSRS field guide/ }).first()).toHaveAttribute('href', '/osrs')
  await expect.poll(() => page.evaluate(() => window.lense?.tools.length)).toBe(7)
  expect((await page.evaluate(() => window.lense.call('osrs_reference', { operation: 'get', id: 'prompt-lumbridge-trees' }))).kind).toBe('prompt')
  expect(errors).toEqual([])
  console.log(JSON.stringify({ url: `${base}/osrs`, readOnlyReference: true, boundedSearch: true, desktopTools: 7, mobileOverflow: false, pageErrors: errors }))
} finally { await browser.close() }
