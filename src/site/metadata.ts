import routeMetadata from './page-metadata.json'
import { siteConfig } from './config'

export const pageMetadata = routeMetadata
export const themeColor = '#173d2f'

export function resolvePageMetadata(path: string) {
  const cleanPath = path.split(/[?#]/)[0]?.replace(/(?:\/index)?\.html$/, '').replace(/\/+$/, '') || '/'
  const route = Object.hasOwn(pageMetadata, cleanPath) ? cleanPath as keyof typeof pageMetadata : '/'
  const data = pageMetadata[route]
  const canonicalUrl = new URL(route, siteConfig.liveUrl).href
  return {
    ...data,
    path: route,
    canonicalUrl,
    imageUrl: new URL('/og-image.png', siteConfig.liveUrl).href,
    imageAlt: 'Lense. Your screen. Structured control. Observe, act, and verify in one shared workspace.',
    applicationName: siteConfig.name,
    themeColor,
  }
}

/** Update only Lense's metadata fields; preserve unrelated tags in the document. */
export function applyPageMetadata(path: string): void {
  const metadata = resolvePageMetadata(path)
  document.title = metadata.title
  const setMeta = (attribute: 'name' | 'property', key: string, content: string) => {
    let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`)
    if (!element) {
      element = document.createElement('meta')
      element.setAttribute(attribute, key)
      document.head.append(element)
    }
    element.content = content
  }
  setMeta('name', 'description', metadata.description)
  setMeta('name', 'theme-color', metadata.themeColor)
  setMeta('name', 'application-name', metadata.applicationName)
  setMeta('property', 'og:site_name', metadata.applicationName)
  setMeta('property', 'og:title', metadata.title)
  setMeta('property', 'og:description', metadata.description)
  setMeta('property', 'og:type', 'website')
  setMeta('property', 'og:url', metadata.canonicalUrl)
  setMeta('property', 'og:image', metadata.imageUrl)
  setMeta('property', 'og:image:width', '1200')
  setMeta('property', 'og:image:height', '630')
  setMeta('property', 'og:image:alt', metadata.imageAlt)
  setMeta('name', 'twitter:card', 'summary_large_image')
  setMeta('name', 'twitter:title', metadata.title)
  setMeta('name', 'twitter:description', metadata.description)
  setMeta('name', 'twitter:image', metadata.imageUrl)
  setMeta('name', 'twitter:image:alt', metadata.imageAlt)
  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!canonical) {
    canonical = document.createElement('link')
    canonical.rel = 'canonical'
    document.head.append(canonical)
  }
  canonical.href = metadata.canonicalUrl
}
