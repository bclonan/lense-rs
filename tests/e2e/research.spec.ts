import { expect, test } from '@playwright/test'

test('research page presents the object-time model and interactive context routing', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))

  await page.goto('/research')

  await expect(page).toHaveTitle(/Lense-AOT/)
  await expect(page.getByRole('heading', { name: /A visual agent that learns in object time/i })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'One scene. Several useful clocks.' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Load the world the task needs.' })).toBeVisible()

  const pause = page.getByRole('button', { name: 'Pause simulation' })
  if (await pause.isVisible()) await pause.click()
  await page.getByRole('button', { name: 'Reset simulation' }).click()
  await expect(page.locator('.aot-event-heading small')).toHaveText('frame 00')
  await page.getByRole('button', { name: 'Advance one frame' }).click()
  await expect(page.locator('.aot-event-heading small')).toHaveText('frame 01')

  await page.getByRole('tab', { name: 'AR rock' }).click()
  await expect(page.getByRole('tab', { name: 'AR rock' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.aot-context-copy')).toContainText('Identify the rock in the center of view')
  await expect(page.locator('.aot-packet pre')).toContainText('identify-and-collect-rock')
  await expect(page.locator('.aot-packet-result')).toContainText('without frame-by-frame LLM calls')

  await expect(page.locator('.aot-architecture-flow > li')).toHaveCount(7)
  await expect(page.locator('.aot-storage-funnel > article')).toHaveCount(5)
  await expect(page.locator('.aot-roadmap > li')).toHaveCount(7)
  expect(errors).toEqual([])
})

test('the control workspace exposes the research route', async ({ page }) => {
  await page.goto('/')
  const resources = page.getByRole('navigation', { name: 'Project resources' })
  const research = resources.getByRole('link', { name: 'Lense-AOT research direction' })
  await expect(research).toBeVisible()
  await research.click()
  await expect(page).toHaveURL(/\/research$/)
  await expect(page.getByRole('heading', { name: /A visual agent that learns in object time/i })).toBeVisible()
})
