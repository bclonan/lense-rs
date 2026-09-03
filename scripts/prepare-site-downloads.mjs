import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const portableName = 'LenseBridge-windows-x64.exe'
const sha256Pattern = /^[a-f0-9]{64}$/i
const thumbprintPattern = /^[a-f0-9]{40}$/i

async function executableFiles(directory, relative = '') {
  const entries = await readdir(join(directory, relative), { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  const files = []
  for (const entry of entries) {
    const name = join(relative, entry.name)
    if (entry.isDirectory()) files.push(...await executableFiles(directory, name))
    else if (entry.name.toLowerCase().endsWith('.exe')) files.push({ name, symbolicLink: entry.isSymbolicLink() })
  }
  return files
}

export async function prepareSiteDownloads({ directory, policy, log = console.log }) {
  const files = await executableFiles(directory)
  const exclude = async () => {
    for (const { name } of files) {
      await unlink(join(directory, name))
      log(`Excluded an unapproved Windows download: ${name}`)
    }
  }
  if (policy.availability !== 'available') {
    await exclude()
    await mkdir(directory, { recursive: true })
    const pausedManifest = JSON.stringify({ availability:'paused', reportedVersion:policy.reportedVersion, notice:policy.notice, statusPage:policy.statusPage }, null, 2) + '\n'
    await writeFile(join(directory, 'bridge-manifest.json'), pausedManifest)
    await writeFile(join(directory, 'setup-manifest.json'), pausedManifest)
    return { availability: 'paused', excluded: files.length }
  }

  try {
    const downloadPath = policy.downloadPath ?? `/downloads/${portableName}`
    if (!/^\/downloads\/(?:LenseBridge-windows-x64|LenseBridge-Setup-\d+\.\d+\.\d+-x64)\.exe$/.test(downloadPath)) throw new Error('Release policy must name a supported Windows download path.')
    const downloadName = downloadPath.slice('/downloads/'.length)
    const installer = downloadName !== portableName
    if (!thumbprintPattern.test(policy.expectedSignerThumbprint ?? '')) throw new Error('Release policy must name the expected code-signing certificate thumbprint.')
    if (!Array.isArray(policy.blockedSha256) || !policy.blockedSha256.every(hash => typeof hash === 'string' && sha256Pattern.test(hash))) throw new Error('Release policy has an invalid blocked-hash list.')
    if (files.length !== 1 || files[0].name !== downloadName || files[0].symbolicLink) throw new Error('An available release must contain exactly the approved bridge executable.')
    const manifest = JSON.parse((await readFile(join(directory, installer ? 'setup-manifest.json' : 'bridge-manifest.json'), 'utf8')).replace(/^\uFEFF/, ''))
    // Windows package-bridge.ps1 verifies Authenticode before creating this
    // attestation. JSON checks here do not verify Authenticode cross-platform.
    if (manifest.file !== downloadName || manifest.platform !== 'windows-x64' || manifest.protocolVersion !== 1 || typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(manifest.version)) throw new Error('The bridge manifest has invalid identity or version metadata.')
    if (manifest.releaseStatus !== 'signature-verified' || manifest.signed !== true || manifest.signature?.status !== 'Valid') throw new Error('The bridge manifest is not an approved Windows signature attestation.')
    const signer = manifest.signature?.signerThumbprint
    if (typeof signer !== 'string' || signer.toUpperCase() !== policy.expectedSignerThumbprint.toUpperCase()) throw new Error('The bridge manifest signer does not match release policy.')
    if (manifest.build?.sourceDirty !== false || !thumbprintPattern.test(manifest.build?.sourceCommit ?? '') || typeof manifest.build?.toolchain !== 'string' || !/^rustc \d+\.\d+\.\d+\b/.test(manifest.build.toolchain)) throw new Error('The bridge manifest must record a clean source commit and the Rust toolchain.')
    if (installer) {
      const payload = manifest.payload
      if (manifest.kind !== 'windows-setup' || downloadName !== `LenseBridge-Setup-${manifest.version}-x64.exe`) throw new Error('Setup filename and version do not match the manifest.')
      if (manifest.uninstallerSigned !== true) throw new Error('The setup must include a signed uninstaller.')
      if (payload?.file !== portableName || payload.version !== manifest.version || payload.signed !== true || payload.signature?.status !== 'Valid' || typeof payload.signature?.signerThumbprint !== 'string' || payload.signature.signerThumbprint.toUpperCase() !== policy.expectedSignerThumbprint.toUpperCase()) throw new Error('The setup payload has no matching Windows signature attestation.')
      if (typeof payload.sha256 !== 'string' || !sha256Pattern.test(payload.sha256) || !Number.isSafeInteger(payload.bytes) || payload.bytes <= 0) throw new Error('The setup payload has invalid hash or size metadata.')
      if (policy.blockedSha256.some(blocked => blocked.toLowerCase() === payload.sha256.toLowerCase())) throw new Error('The setup contains a blocked bridge hash.')
    }
    if (typeof manifest.sha256 !== 'string' || !sha256Pattern.test(manifest.sha256) || !Number.isSafeInteger(manifest.bytes) || manifest.bytes <= 0) throw new Error('The bridge manifest has invalid hash or size metadata.')
    const bytes = await readFile(join(directory, downloadName))
    const hash = createHash('sha256').update(bytes).digest('hex')
    if (hash !== manifest.sha256.toLowerCase() || bytes.byteLength !== manifest.bytes) throw new Error('The bridge download does not match the Windows packager manifest.')
    if (policy.blockedSha256.some(blocked => blocked.toLowerCase() === hash)) throw new Error('This bridge hash is blocked from distribution.')
    return { availability: 'available', hash, bytes: bytes.byteLength }
  } catch (error) {
    await exclude()
    throw new Error(`Windows download excluded: ${error.message}`, { cause: error })
  }
}

// CLI builds always use repository paths and the checked-in release policy.
// Only direct function imports in tests can supply a temporary directory.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const policy = JSON.parse(await readFile(new URL('../release/bridge-distribution.json', import.meta.url), 'utf8'))
  await prepareSiteDownloads({ directory: fileURLToPath(new URL('../dist/downloads/', import.meta.url)), policy })
}
