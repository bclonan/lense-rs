import { OSRS_CATALOG, OSRS_CHECKED_AT, type OsrsEntry } from './catalog'
import { ControlError } from '../services/tasks/helpers'

const kinds = ['place', 'visual', 'prompt', 'skill'] as const
export interface ReferenceQuery { query?: string; kind?: OsrsEntry['kind']; limit?: number; offset?: number }
const normalize = (value: string) => value.normalize('NFKC').toLowerCase().trim()

export function searchReferences(input: ReferenceQuery = {}) {
  if (input.query !== undefined && (typeof input.query !== 'string' || input.query.length > 160)) throw new ControlError('INVALID_REFERENCE_QUERY', 'Use a search phrase of up to 160 characters.')
  if (input.kind !== undefined && !kinds.includes(input.kind)) throw new ControlError('INVALID_REFERENCE_QUERY', 'Choose place, visual, prompt, or skill.')
  const limit = input.limit ?? 8, offset = input.offset ?? 0
  if (!Number.isInteger(limit) || limit < 1 || limit > 20 || !Number.isInteger(offset) || offset < 0 || offset > 1000) throw new ControlError('INVALID_REFERENCE_QUERY', 'Use a limit of 1 to 20 and an offset of 0 to 1,000.')
  const words = normalize(input.query ?? '').split(/\s+/).filter(Boolean)
  const matches = OSRS_CATALOG.filter(entry => {
    if (input.kind && entry.kind !== input.kind) return false
    const text = normalize([entry.id, entry.title, entry.summary, ...entry.tags, ...entry.details,
      entry.visual?.cue ?? '', entry.visual?.verify ?? '', ...(entry.visual?.confusions ?? []),
      entry.prompt?.goal ?? '', entry.prompt?.completionCondition ?? '', entry.prompt?.notes ?? '',
      ...(entry.skill?.requirements ?? []), ...(entry.skill?.steps ?? []),
    ].join(' '))
    return words.every(word => text.includes(word))
  })
  return {
    checkedAt: OSRS_CHECKED_AT, total: matches.length, offset, nextOffset: offset + limit < matches.length ? offset + limit : null,
    items: matches.slice(offset, offset + limit).map(entry => ({ id: entry.id, kind: entry.kind, title: entry.title, summary: entry.summary, tags: entry.tags, url: `/osrs?entry=${encodeURIComponent(entry.id)}` })),
  }
}

export function getReference(id: string) {
  if (typeof id !== 'string' || !id || id.length > 128) throw new ControlError('INVALID_REFERENCE_QUERY', 'Use an entry ID returned by search.')
  const entry = OSRS_CATALOG.find(item => item.id === id)
  if (!entry) throw new ControlError('REFERENCE_NOT_FOUND', 'No reference has that ID. Search the catalog first.')
  return { ...entry, checkedAt: OSRS_CHECKED_AT, url: `/osrs?entry=${encodeURIComponent(id)}`, usage: 'Reference notes and symbols are not live game state. Verify names and actions from a fresh game screenshot. Map positions are schematic, not game coordinates or a route.' }
}
