import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { expect, it, vi } from 'vitest'
import type { DesktopAction, TaskConfig } from '../types/protocol'

vi.mock('../lab/adapter', () => ({
  LabAdapter: class {
    async observe() { return { id: 'fixture-frame', timestamp: new Date().toISOString(), target: { type: 'monitor', id: 'lab' }, width: 100, height: 100, nativeWidth: 100, nativeHeight: 100, image: 'fixture', mimeType: 'image/png' } }
    async action(action: DesktopAction) { return { id: 'fixture-action', ok: true, action, startedAt: '', completedAt: '', result: {} } }
    dispose() {}
  },
}))
vi.mock('../lab/evaluator', () => ({
  LabProvider: class {
    async evaluate({ condition }: { condition: string }) { return { condition, result: true, confidence: .99, explanation: 'Fixture condition holds.' } }
    async plan() { return { actions: [], confidence: .99, explanation: 'No action required.' } }
    async recover() { return this.plan() }
  },
}))

import { useControlStore } from './control'
import { HistoryRepository } from '../services/persistence/history'

const config: TaskConfig = { goal: 'Chop wood', durationMs: 30000, verification: { condition: 'chopping', intervalMs: 500 }, invariants: [], limits: { maxConsecutiveFailures: 3, maxActionsPerMinute: 30, confidenceThreshold: .8 } }

it('acknowledges Pause only after the paused task and event commit to IndexedDB', async () => {
  setActivePinia(createPinia())
  const control = useControlStore()
  const repository = new HistoryRepository()
  await control.initialize()
  await control.start(config)
  await control.pause()
  const saved = await repository.load()
  expect(saved?.task?.state).toBe('PAUSED')
  expect(saved?.task?.id).toBe(control.task?.id)
  expect(saved?.events.some(event => event.type === 'task.paused')).toBe(true)
  await control.resume()
  await control.stop()
  expect((await repository.load())?.task?.state).toBe('STOPPED')
  control.dispose()
  await control.flushHistory()
})

it('restores desktop history without presenting a saved lab frame as a current desktop capture', async () => {
  const repository = new HistoryRepository()
  const frame = { id:'past-lab',timestamp:new Date().toISOString(),target:{type:'monitor' as const,id:'lab'},width:100,height:100,nativeWidth:100,nativeHeight:100,image:'fixture',mimeType:'image/png' }
  await repository.save({version:1,task:null,mode:'desktop',savedAt:new Date().toISOString(),events:[
    {id:'old-frame',timestamp:frame.timestamp,type:'observation.captured',data:{},observation:frame},
    {id:'old-evaluation',timestamp:frame.timestamp,type:'evaluation.completed',data:{condition:'chopping',result:true,confidence:.99,explanation:'An old lab result.'}},
  ]})
  setActivePinia(createPinia())
  const control = useControlStore()
  await control.initialize()
  expect(control.mode).toBe('desktop')
  expect(control.observation).toBeNull()
  expect(control.evaluation).toBeNull()
  expect(control.selectedEvent).toBe(-1)
  expect(control.events[0]?.observation?.id).toBe('past-lab')
  control.dispose()
  await control.flushHistory()
})
