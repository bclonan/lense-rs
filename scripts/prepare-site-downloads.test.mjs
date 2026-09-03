import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareSiteDownloads } from './prepare-site-downloads.mjs'

const root = fileURLToPath(new URL('../artifacts/download-guard-tests/', import.meta.url))
const name = 'LenseBridge-windows-x64.exe'
// These bytes are plain text, not a PE program or a copied bridge executable.
const bytes = Buffer.from('Synthetic download guard fixture. Not executable.\n')
const hash = createHash('sha256').update(bytes).digest('hex')
const signer = '1234567890ABCDEF1234567890ABCDEF12345678'

async function fixture({ installer = false } = {}) {
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'case-'))
  const filename = installer ? 'LenseBridge-Setup-1.0.2-x64.exe' : name
  const policy = { availability: 'available', blockedSha256: [], expectedSignerThumbprint: signer, downloadPath: `/downloads/${filename}` }
  const manifest = {
    file: filename, version: '1.0.2', protocolVersion: 1, platform: 'windows-x64',
    sha256: hash, bytes: bytes.byteLength, releaseStatus: 'signature-verified', signed: true,
    signature: { status: 'Valid', signerThumbprint: signer },
    build: { sourceCommit: 'a'.repeat(40), sourceDirty: false, toolchain: 'rustc 1.96.0 (test fixture)' },
  }
  if (installer) {
    manifest.kind = 'windows-setup'
    manifest.uninstallerSigned = true
    manifest.payload = { file: name, version: manifest.version, sha256: '1'.repeat(64), bytes: 1234, signed: true, signature: { status: 'Valid', signerThumbprint: signer } }
  }
  await writeFile(join(directory, filename), bytes)
  const save = () => writeFile(join(directory, installer ? 'setup-manifest.json' : 'bridge-manifest.json'), JSON.stringify(manifest))
  await save()
  return { directory, policy, manifest, save, filename }
}

test('a versioned setup requires the signed setup and payload attestation', async () => {
  const context = await fixture({ installer: true })
  // Windows PowerShell 5.1 writes a UTF-8 BOM in its JSON output.
  await writeFile(join(context.directory, 'setup-manifest.json'), '\uFEFF' + JSON.stringify(context.manifest))
  const result = await prepareSiteDownloads({ ...context, log: quiet })
  assert.equal(result.hash, hash)
  await access(join(context.directory, context.filename))
})

const rejectedInstallers = [
  ['an unsigned payload', context => { context.manifest.payload.signed = false }],
  ['a different payload signer', context => { context.manifest.payload.signature.signerThumbprint = 'F'.repeat(40) }],
  ['a blocked payload', context => { context.policy.blockedSha256 = [context.manifest.payload.sha256] }],
  ['an unsigned uninstaller', context => { context.manifest.uninstallerSigned = false }],
  ['a stale setup version', context => { context.manifest.version = '1.0.3' }],
]
for (const [reason, change] of rejectedInstallers) {
  test(`setup rejects ${reason}`, async () => {
    const context = await fixture({ installer: true })
    change(context)
    await context.save()
    await assert.rejects(prepareSiteDownloads({ ...context, log: quiet }), /Windows download excluded/)
    await assert.rejects(access(join(context.directory, context.filename)), { code: 'ENOENT' })
  })
}
const quiet = () => {}

test('paused distribution excludes root and nested Windows downloads', async () => {
  const context = await fixture()
  context.policy.availability = 'paused'
  await mkdir(join(context.directory, 'old'))
  await writeFile(join(context.directory, 'old', 'previous.EXE'), bytes)
  const result = await prepareSiteDownloads({ ...context, log: quiet })
  assert.equal(result.excluded, 2)
  await assert.rejects(access(join(context.directory, name)), { code: 'ENOENT' })
  await assert.rejects(access(join(context.directory, 'old', 'previous.EXE')), { code: 'ENOENT' })
  assert.equal(JSON.parse(await readFile(join(context.directory, 'bridge-manifest.json'), 'utf8')).availability, 'paused')
})

test('available distribution accepts matching Windows packager attestation', async () => {
  const context = await fixture()
  const result = await prepareSiteDownloads({ ...context, log: quiet })
  assert.equal(result.hash, hash)
  await access(join(context.directory, name))
})

const rejected = [
  ['unsigned CI candidate', context => { context.manifest.releaseStatus = 'not-approved'; context.manifest.signed = false; context.manifest.signature.status = 'NotSigned' }],
  ['invalid signature attestation', context => { context.manifest.signature.status = 'HashMismatch' }],
  ['unexpected signer', context => { context.manifest.signature.signerThumbprint = 'F'.repeat(40) }],
  ['missing policy signer', context => { delete context.policy.expectedSignerThumbprint }],
  ['dirty build', context => { context.manifest.build.sourceDirty = true }],
  ['missing commit provenance', context => { context.manifest.build.sourceCommit = 'unknown' }],
  ['hash mismatch', context => { context.manifest.sha256 = '0'.repeat(64) }],
  ['size mismatch', context => { context.manifest.bytes += 1 }],
  ['blocked hash', context => { context.policy.blockedSha256 = [hash.toUpperCase()] }],
]
for (const [reason, change] of rejected) {
  test(`available distribution rejects ${reason} and removes download`, async () => {
    const context = await fixture()
    change(context)
    await context.save()
    await assert.rejects(prepareSiteDownloads({ ...context, log: quiet }), /Windows download excluded/)
    await assert.rejects(access(join(context.directory, name)), { code: 'ENOENT' })
  })
}
