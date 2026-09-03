import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route(/^http:\/\/127\.0\.0\.1:1737[345]\//, route => route.abort('connectionrefused'))
  await page.addInitScript(() => {
    const fixture = {
      color: '#ee2222', rejectNext: false, stream: null as MediaStream | null, timer: 0,
      paint(color: string) { this.color = color },
      end() {
        clearInterval(this.timer)
        for (const track of this.stream?.getTracks() || []) {
          track.stop()
          // The picker Stop sharing control sends ended; track.stop() alone does not.
          track.dispatchEvent(new Event('ended'))
        }
      },
    }
    ;(window as any).__shareFixture = fixture
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
      configurable: true,
      value: async () => {
        if (fixture.rejectNext) { fixture.rejectNext = false; throw new DOMException('Screen sharing was cancelled.', 'NotAllowedError') }
        const canvas = document.createElement('canvas')
        canvas.width = 640; canvas.height = 360
        const context = canvas.getContext('2d')!
        const paint = () => { context.fillStyle = fixture.color; context.fillRect(0, 0, canvas.width, canvas.height) }
        paint()
        const stream = canvas.captureStream(12)
        fixture.stream = stream
        fixture.timer = window.setInterval(paint, 50)
        return stream
      },
    })
  })
  await page.goto('/')
  await expect.poll(() => page.evaluate(() => !!(window as any).lense)).toBe(true)
  await page.getByRole('button', { name: 'Windows desktop', exact: true }).click()
})

test('browser sharing streams live pixels to observations without granting native input coordinates', async ({ page }) => {
  await page.getByRole('button', { name: 'Share a screen', exact: true }).click()
  const video = page.getByLabel('Live browser screen share', { exact: true })
  await expect(video).toBeVisible()
  await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).videoWidth)).toBe(640)
  await expect(page.getByRole('button', { name: 'Type on desktop', exact: true })).toBeDisabled()

  const first = await page.evaluate(async () => {
    const result = await (window as any).lense.call('desktop_observe', {})
    return { metadata: JSON.parse(result.content.find((item: any) => item.type === 'text').text), image: result.content.find((item: any) => item.type === 'image').data }
  })
  expect(first.metadata).toMatchObject({ source: 'browser', inputCoordinates: false, target: { type: 'monitor', id: 'browser-share' }, width: 640, height: 360 })

  await page.evaluate(() => (window as any).__shareFixture.paint('#2222ee'))
  await expect.poll(() => page.evaluate(async () => {
    const result = await (window as any).lense.call('desktop_observe', { source: 'browser' })
    const content = result.content.find((item: any) => item.type === 'image')
    const image = new Image()
    image.src = `data:${content.mimeType};base64,${content.data}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0, 1, 1)
    const [red, , blue] = context.getImageData(0, 0, 1, 1).data
    return blue > 200 && red < 80
  })).toBe(true)
  const second = await page.evaluate(() => (window as any).lense.call('desktop_observe', { source: 'browser', maxDimension: 320 }))
  expect(second.content.find((item: any) => item.type === 'image').data).not.toBe(first.image)
  expect(JSON.parse(second.content.find((item: any) => item.type === 'text').text)).toMatchObject({ source: 'browser', inputCoordinates: false, width: 320, height: 180 })

  const native = await page.evaluate(() => (window as any).lense.call('desktop_observe', { source: 'native' }))
  expect(native.isError).toBe(true)
  expect(JSON.parse(native.content[0].text).error.code).toBe('NOT_PAIRED')
  const status = await page.evaluate(() => (window as any).lense.call('desktop_status', {}))
  expect(status).toMatchObject({ mode: 'desktop', paired: false, capture: { source: 'browser' } })

  await page.evaluate(() => (window as any).__shareFixture.end())
  await expect(page.getByRole('button', { name: 'Share a screen', exact: true })).toBeEnabled()
  await expect(video).toHaveCount(0)
  const ended = await page.evaluate(() => (window as any).lense.call('desktop_observe', { source: 'browser' }))
  expect(ended.isError).toBe(true)
  expect(JSON.parse(ended.content[0].text).error.message).toContain('Start screen sharing')
})

test('a cancelled browser picker leaves sharing usable on the next attempt', async ({ page }) => {
  await page.evaluate(() => { (window as any).__shareFixture.rejectNext = true })
  await page.getByRole('button', { name: 'Share a screen', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Screen sharing was cancelled.')
  await expect(page.getByRole('button', { name: 'Share a screen', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Share a screen', exact: true }).click()
  await expect(page.getByLabel('Live browser screen share', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Stop sharing', exact: true }).click()
  await expect(page.getByLabel('Live browser screen share', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Share a screen', exact: true })).toBeEnabled()
  expect(await page.evaluate(() => (window as any).__shareFixture.stream.getVideoTracks()[0].readyState)).toBe('ended')
})
