import { openDB } from 'idb'

export interface VisualExample { id: string; entryId: string; image: string; width: number; height: number; createdAt: string }
const MAX_FILE_BYTES = 512 * 1024
const MAX_EXAMPLES = 32
const MAX_PER_ENTRY = 4
const database = () => openDB('lense-osrs-visual-examples-v1', 1, { upgrade(db) { db.createObjectStore('examples', { keyPath: 'id' }) } })

function valid(value: unknown): value is VisualExample {
  if (!value || typeof value !== 'object') return false
  const item = value as VisualExample
  return typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 128 && typeof item.entryId === 'string' && item.entryId.length > 0 && item.entryId.length <= 128
    && typeof item.image === 'string' && item.image.length <= Math.ceil(MAX_FILE_BYTES / 3) * 4 + 64 && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(item.image)
    && validImageData(item.image)
    && Number.isInteger(item.width) && item.width > 0 && item.width <= 4096 && Number.isInteger(item.height) && item.height > 0 && item.height <= 4096
    && typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt))
}

function validImageData(image: string) {
  const encoded = image.slice(image.indexOf(',') + 1)
  if (encoded.length % 4 !== 0) return false
  try {
    const bytes = atob(encoded)
    return image.startsWith('data:image/png;') ? bytes.startsWith('\x89PNG\r\n\x1a\n') : bytes.startsWith('\xff\xd8\xff')
  } catch { return false }
}

export async function loadExamples(entryId: string): Promise<VisualExample[]> {
  const db = await database()
  try {
    const items: unknown[] = await db.getAll('examples')
    return items.filter(valid).filter(item => item.entryId === entryId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_PER_ENTRY)
  } finally { db.close() }
}

export async function saveExample(entryId: string, file: File): Promise<VisualExample> {
  const { OSRS_CATALOG } = await import('./catalog')
  if (!OSRS_CATALOG.some(entry => entry.id === entryId && entry.kind === 'visual')) throw new Error('Choose a visual dictionary entry before adding an example.')
  if (!['image/png', 'image/jpeg'].includes(file.type) || file.size < 8 || file.size > MAX_FILE_BYTES) throw new Error('Choose a PNG or JPEG screenshot crop under 512 KB.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if (!(file.type === 'image/png' ? png : jpeg)) throw new Error('The file contents do not match a PNG or JPEG image.')
  const decoded = await createImageBitmap(file).catch(() => { throw new Error('This image could not be decoded. Choose another PNG or JPEG crop.') })
  const { width, height } = decoded
  decoded.close()
  if (width > 4096 || height > 4096) throw new Error('Crop the screenshot to 4,096 pixels or less on each side.')
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const example: VisualExample = { id: crypto.randomUUID(), entryId, image: `data:${file.type};base64,${btoa(binary)}`, width, height, createdAt: new Date().toISOString() }
  const db = await database()
  try {
    const tx = db.transaction('examples', 'readwrite')
    const existing: VisualExample[] = await tx.store.getAll()
    if (existing.length >= MAX_EXAMPLES || existing.filter(item => item.entryId === entryId).length >= MAX_PER_ENTRY) {
      tx.abort()
      await tx.done.catch(() => {})
      throw new Error('Keep up to four examples per entry and 32 in this browser. Remove an example before adding another.')
    }
    await tx.store.put(example)
    await tx.done
    return example
  } finally { db.close() }
}

export async function removeExample(id: string): Promise<void> {
  const db = await database()
  try { await db.delete('examples', id) } finally { db.close() }
}
