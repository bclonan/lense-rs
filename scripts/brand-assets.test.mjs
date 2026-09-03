import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(resolve(root, path))

test('the favicon is a real ICO containing all advertised sizes', () => {
  const icon = read('public/favicon.ico')
  assert.equal(icon.readUInt16LE(0), 0)
  assert.equal(icon.readUInt16LE(2), 1)
  assert.equal(icon.readUInt16LE(4), 3)
  const sizes = []
  for (let index = 0; index < 3; index++) {
    const offset = 6 + index * 16
    sizes.push([icon[offset] || 256, icon[offset + 1] || 256])
    const bytes = icon.readUInt32LE(offset + 8)
    const imageOffset = icon.readUInt32LE(offset + 12)
    assert.ok(bytes > 0 && imageOffset >= 54 && imageOffset + bytes <= icon.length)
  }
  assert.deepEqual(sizes, [[16, 16], [32, 32], [48, 48]])
})

test('social and touch images have genuine PNG signatures and required dimensions', () => {
  const expected = {
    'og-image.png': [1200, 630],
    'apple-touch-icon.png': [180, 180],
    'icon-192.png': [192, 192],
    'icon-512.png': [512, 512],
  }
  for (const [name, dimensions] of Object.entries(expected)) {
    const png = read(`public/${name}`)
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', name)
    assert.equal(png.subarray(12, 16).toString(), 'IHDR', name)
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], dimensions, name)
    assert.ok(png.length < 200_000, `${name} should stay below 200 KB`)
  }
})

test('manifest and document icon links reference existing assets', () => {
  const manifest = JSON.parse(read('public/site.webmanifest').toString())
  assert.equal(manifest.name, 'Lense')
  assert.equal(manifest.start_url, '/')
  assert.equal(manifest.display, 'browser')
  for (const icon of manifest.icons) {
    assert.ok(existsSync(resolve(root, 'public', icon.src.slice(1))), icon.src)
  }
  const html = read('index.html').toString()
  const links = [...html.matchAll(/<link\b[^>]*href="(\/[^\"]+)"[^>]*>/g)]
  assert.equal(links.length, 4)
  for (const [, href] of links) assert.ok(existsSync(resolve(root, 'public', href.slice(1))), href)
  assert.match(read('public/favicon.svg').toString(), /<svg\b[^>]*viewBox="0 0 64 64"/)
})

test('default social metadata agrees with the route data and preserves viewport settings', () => {
  const html = read('index.html').toString()
  const routes = JSON.parse(read('src/site/page-metadata.json').toString())
  assert.ok(html.includes(`<title>${routes['/'].title}</title>`))
  assert.ok(html.includes(`<meta name="description" content="${routes['/'].description}">`))
  for (const tag of ['og:title', 'og:description', 'og:type', 'og:url', 'og:image', 'og:image:alt']) {
    assert.ok(html.includes(`property="${tag}"`), tag)
  }
  for (const tag of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image', 'theme-color', 'application-name', 'viewport']) {
    assert.ok(html.includes(`name="${tag}"`), tag)
  }
  assert.match(html, /<meta charset="UTF-8">/)
})
