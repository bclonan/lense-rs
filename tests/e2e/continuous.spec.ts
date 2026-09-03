import { expect, test, type Page } from '@playwright/test'

const call = (page: Page, name: string, input: Record<string, unknown> = {}) => page.evaluate(({ name, input }) => (window as any).lense.call(name, input), { name, input })
const status = (page: Page) => call(page, 'desktop_status')

test('queued external tasks receive events, verify handoffs, change cadence and restore paused', async ({ page }) => {
  let image = '', paired = false
  let socket: { send(data: string): void } | undefined
  const watches = new Map<string, any>()
  const actions: any[] = []
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const headers = { 'Access-Control-Allow-Origin': 'http://127.0.0.1:4174', 'Access-Control-Allow-Headers': 'authorization,content-type', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Private-Network': 'true' }
  await page.route('http://127.0.0.1:17373/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return }
    let body: unknown
    if (path === '/v1/status') body = { name: 'LenseBridge', version: '1.0.2', protocolVersion: 1, platform: 'windows', capabilities: ['screen', 'pointer', 'keyboard', 'watches'] }
    else if (path === '/v1/pair') { paired = true; body = { id: 'queue-session', token: 'queue-token', origin: 'http://127.0.0.1:4174', createdAt: new Date().toISOString(), scopes: ['screen.read', 'pointer', 'keyboard', 'windows.read'] } }
    else {
      if (!paired || request.headers().authorization !== 'Bearer queue-token') { await route.fulfill({ status: 401, headers, json: { error: { code: 'INVALID_TOKEN', message: 'Pair first' } } }); return }
      if (path === '/v1/monitors') body = []
      else if (path === '/v1/windows') body = [{ id: '123', title: 'Test game window', x: 0, y: 0, width: 960, height: 600 }]
      else if (path === '/v1/screen') body = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), target: { type: 'window', id: '123' }, nativeWidth: 960, nativeHeight: 600, width: 960, height: 600, mimeType: 'image/png', image }
      else if (path === '/v1/action') { const action = request.postDataJSON(); actions.push(action); body = { id: crypto.randomUUID(), ok: true, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), action } }
      else if (path === '/v1/watches' && request.method() === 'POST') { body = request.postDataJSON(); watches.set((body as any).id, body) }
      else if (path.startsWith('/v1/watches/') && request.method() === 'DELETE') { watches.delete(decodeURIComponent(path.split('/').at(-1)!)); body = { ok: true } }
      else body = []
    }
    await route.fulfill({ status: 200, headers, json: body })
  })
  await page.routeWebSocket('ws://127.0.0.1:17373/v1/events', connection => { socket = connection; connection.onMessage(() => {}) })
  await page.goto('/')
  await expect.poll(() => page.evaluate(() => !!(window as any).lense)).toBe(true)
  const labFrame = await call(page, 'desktop_observe')
  image = 'data:image/png;base64,' + labFrame.content.find((part: any) => part.type === 'image').data
  await page.getByRole('button', { name: 'Windows desktop', exact: true }).click()
  await page.getByRole('button', { name: /Pair desktop/ }).click()
  await page.getByLabel('Capture & input target').selectOption('window:123')
  await expect(page.getByRole('button',{name:'Type on desktop'})).toBeEnabled()
  actions.length=0
  await page.getByLabel('Start with a prompt').selectOption('bank-logs')
  await expect(page.getByLabel('Until complete', { exact: true })).toBeChecked()
  await page.getByLabel('Application or game').selectOption('osrs')
  await page.getByLabel('Character name').fill('Test character')
  await page.getByRole('button', { name: 'Add to queue', exact: true }).click()
  await expect.poll(async () => (await status(page)).queue.items.length).toBe(1)
  await page.getByLabel('Start with a prompt').selectOption('lumbridge')
  await expect(page.getByLabel('Until stopped', { exact: true })).toBeChecked()
  await page.getByRole('button', { name: 'Add to queue', exact: true }).click()
  await expect.poll(async () => (await status(page)).queue.items.length).toBe(2)
  await page.getByRole('button', { name: 'Run queue', exact: true }).click()
  await expect.poll(async () => (await status(page)).task?.state).toBe('WAITING')
  const first = (await status(page)).task
  expect(first.context.characterName).toBe('Test character')
  await expect.poll(() => watches.size).toBe(1)
  expect([...watches.values()][0].intervalMs).toBe(500)
  socket!.send(JSON.stringify({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), type: 'watch.changed', data: { watchId: [...watches.keys()][0], changed: true } }))
  const wake = await call(page, 'desktop_task', { operation: 'wait', taskId: first.id, afterSequence: 0, timeoutMs: 1000 })
  expect(wake.events.some((event: any) => event.type === 'watch.changed')).toBe(true)
  const unguarded = await call(page, 'desktop_action', { type: 'pointer.click', x: .5, y: .5 })
  expect(unguarded.isError).toBe(true)
  expect(actions).toHaveLength(0)
  const observed = await call(page, 'desktop_observe')
  const frameId = JSON.parse(observed.content.find((part: any) => part.type === 'text').text).id
  const acted = await call(page, 'desktop_action', { type: 'pointer.click', x: .5, y: .5, expectedTaskId: first.id, observationId: frameId })
  expect(acted.isError).not.toBe(true)
  expect(actions.filter(action=>action.type!=='window.focus')).toHaveLength(1)
  await call(page, 'desktop_observe')
  const completionFrame = (await status(page)).observationId
  const updated = await call(page, 'desktop_task', { operation: 'context', taskId: first.id, observationId: completionFrame, context: { game: 'osrs', characterName: 'Test character', inventory: 'Test screenshot reviewed', notes: 'Mock transport evidence only.' } })
  expect(updated.isError).not.toBe(true)
  const completed = await call(page, 'desktop_task', { operation: 'complete', taskId: first.id, observationId: completionFrame, reason: 'Test agent reviewed the mock screenshot and confirmed this test step.' })
  expect(completed.isError).not.toBe(true)
  await expect.poll(async () => (await status(page)).task?.runMode).toBe('continuous')
  const second = (await status(page)).task
  expect(second.id).not.toBe(first.id)
  expect((await status(page)).queue.items).toHaveLength(0)
  const stale = await call(page, 'desktop_action', { type: 'pointer.click', x: .5, y: .5, expectedTaskId: first.id, observationId: completionFrame })
  expect(stale.isError).toBe(true)
  expect(actions.filter(action=>action.type!=='window.focus')).toHaveLength(1)
  await page.getByRole('button', { name: 'Checks & manual events' }).click()
  await page.getByLabel('Tell the agent what changed').fill('Inventory is full. Recheck the visible screen.')
  await page.getByRole('button', { name: 'Request a check', exact: true }).click()
  const manual = await call(page, 'desktop_task', { operation: 'wait', taskId: second.id, afterSequence: 0, timeoutMs: 1000 })
  expect(manual.events.some((event: any) => event.type === 'user.event')).toBe(true)
  await page.locator('#queue-check-seconds').fill('0.5')
  await page.getByRole('button', { name: 'Apply cadence', exact: true }).click()
  await expect.poll(async () => (await status(page)).task?.verification.intervalMs).toBe(500)
  const cursor = (await status(page)).task.wakeSequence
  const audit = await call(page, 'desktop_task', { operation: 'wait', taskId: second.id, afterSequence: cursor, timeoutMs: 1500 })
  expect(audit.events.some((event: any) => event.type === 'audit.due')).toBe(true)
  await page.getByRole('button', { name: 'Pause queue', exact: true }).click()
  await expect.poll(async () => (await status(page)).task?.state).toBe('PAUSED')
  await expect(page.getByRole('button', { name: 'Type on desktop', exact: true })).toBeDisabled()
  await expect(page.getByText('The task is paused. Resume it before sending input, or stop it and start a new task.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run queue', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Run queue', exact: true }).click()
  await expect.poll(async () => (await status(page)).task?.state).toBe('WAITING')
  await page.reload()
  await expect.poll(async () => (await status(page)).task?.state).toBe('PAUSED')
  expect((await status(page)).queue.running).toBe(false)
  expect((await status(page)).paired).toBe(false)
  expect(errors).toEqual([])
})
