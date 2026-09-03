import { describe, expect, it } from 'vitest'
import { pageMetadata, resolvePageMetadata } from './metadata'
import { siteConfig } from './config'

describe('page metadata', () => {
  it('resolves each public route to a distinct title and canonical URL', () => {
    for (const [path, page] of Object.entries(pageMetadata)) {
      const result = resolvePageMetadata(path)
      expect(result.title).toBe(page.title)
      expect(result.description).toBe(page.description)
      expect(result.canonicalUrl).toBe(new URL(path, siteConfig.liveUrl).href)
      expect(result.imageUrl).toBe(new URL('/og-image.png', siteConfig.liveUrl).href)
    }
    expect(new Set(Object.values(pageMetadata).map(page => page.title)).size).toBe(Object.keys(pageMetadata).length)
  })

  it('keeps query strings, anchors, and trailing slashes out of canonical URLs', () => {
    expect(resolvePageMetadata('/webmcp/?tool=desktop_status#tools')).toEqual(resolvePageMetadata('/webmcp'))
    expect(resolvePageMetadata('/hackathon#video')).toEqual(resolvePageMetadata('/hackathon'))
    expect(resolvePageMetadata('/?osrsPrompt=bank')).toEqual(resolvePageMetadata('/'))
  })

  it('uses the home metadata for an unknown pathname', () => {
    expect(resolvePageMetadata('/not-a-route')).toEqual(resolvePageMetadata('/'))
  })
})
