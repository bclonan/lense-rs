[CmdletBinding()]
param([Parameter(Mandatory)][string]$SetupPath, [Parameter(Mandatory)][string]$ExpectedSignerThumbprint)
$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $PSScriptRoot 'installer-release.psm1') -Force
$definition = Get-InstallerDefinition $repository
$setup = (Resolve-Path -LiteralPath $SetupPath).Path
if ((Split-Path -Leaf $setup) -ne $definition.File) { throw 'The setup filename does not match the current Cargo release.' }
Assert-InstallerVersion $setup $definition.Version
$manifestPath = Join-Path (Split-Path -Parent $setup) 'setup-manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$payload = Get-InstallerPayload $definition.Payload $definition.Version
$policy = Get-Content -LiteralPath (Join-Path $repository 'release/bridge-distribution.json') -Raw | ConvertFrom-Json
if ($policy.downloadPath -cne "/downloads/$($definition.File)") { throw 'The versioned setup URL does not match the approved release policy.' }
Assert-InstallerPolicy $policy $payload $ExpectedSignerThumbprint
$signature = Get-InstallerSignature $setup
$expected = ($ExpectedSignerThumbprint -replace '\s', '').ToUpperInvariant()
$hash = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash.ToLowerInvariant()
$bytes = (Get-Item -LiteralPath $setup).Length
if ($hash -in $policy.blockedSha256) { throw 'This installer hash is blocked from distribution.' }
if ($signature.status -ne 'Valid' -or $signature.signerThumbprint -ne $expected) { throw 'The installer must have a valid signature from the approved publisher.' }
if ($manifest.kind -ne 'windows-setup' -or $manifest.file -ne $definition.File -or $manifest.version -ne $definition.Version -or $manifest.platform -ne 'windows-x64' -or $manifest.protocolVersion -ne 1 -or $manifest.sha256 -ne $hash -or $manifest.bytes -ne $bytes -or $manifest.releaseStatus -ne 'signature-verified' -or $manifest.signed -ne $true -or $manifest.uninstallerSigned -ne $true -or $manifest.signature.status -ne 'Valid' -or $manifest.signature.signerThumbprint -ne $expected) { throw 'The setup manifest does not describe an approved, signed installer.' }
if ($manifest.payload.file -ne $payload.file -or $manifest.payload.sha256 -ne $payload.sha256 -or $manifest.payload.bytes -ne $payload.bytes -or $manifest.payload.version -ne $payload.version -or $manifest.payload.signed -ne $true -or $manifest.payload.signature.status -ne 'Valid' -or $manifest.payload.signature.signerThumbprint -ne $expected -or $manifest.build.sourceDirty -ne $false -or $manifest.build.sourceCommit -ne $payload.build.sourceCommit -or $manifest.build.toolchain -ne $payload.build.toolchain) { throw 'The installer payload or build provenance does not match the inspected bridge.' }
$downloads = Join-Path $repository 'public/downloads'
New-Item -ItemType Directory -Path $downloads -Force | Out-Null
$destination = Join-Path $downloads $definition.File
Copy-Item -LiteralPath $setup -Destination $destination
if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) { throw 'The copied installer failed its hash check. The site build guard must reject it.' }
Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $downloads 'setup-manifest.json')
Write-Output "Prepared approved setup download: $destination"
