[CmdletBinding()]
param([string]$SourcePath, [switch]$SkipCandidateCopy)
$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
if (-not $SourcePath) { $SourcePath = Join-Path $repository 'bridge/target/release/lense-bridge.exe' }
$source = (Resolve-Path -LiteralPath $SourcePath).Path
if ((Get-AuthenticodeSignature -LiteralPath $source).Status -ne 'NotSigned') { throw 'These release-gate tests require the unsigned CI build.' }
$version = (Get-Item -LiteralPath $source).VersionInfo.ProductVersion
if (-not $version) { throw 'Build the Windows resource metadata before running these tests.' }
$fixture = Join-Path $repository ('artifacts/package-gate-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $fixture 'scripts'),(Join-Path $fixture 'bridge') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'package-bridge.ps1') -Destination (Join-Path $fixture 'scripts/package-bridge.ps1')
$packager = Join-Path $fixture 'scripts/package-bridge.ps1'
$manifestPath = Join-Path $fixture 'bridge/Cargo.toml'
function Assert-Rejected([string]$ExpectedMessage, [switch]$CandidateMode) {
    $rejection = $null
    try { & $packager -SourcePath $source -Candidate:$CandidateMode | Out-Null } catch { $rejection = $_.Exception.Message }
    if (-not $rejection -or $rejection -notlike "*$ExpectedMessage*") { throw "Expected rejection '$ExpectedMessage', got '$rejection'." }
    if (Test-Path -LiteralPath (Join-Path $fixture 'public/downloads')) { throw 'A rejected build wrote public downloads.' }
}
Set-Content -LiteralPath $manifestPath -Value "[package]`nversion = `"$version`""
Assert-Rejected 'requires a valid Authenticode signature'
Write-Output 'PASS: unsigned build cannot produce public downloads.'
Set-Content -LiteralPath $manifestPath -Value '[package]', 'version = "0.0.0"'
Assert-Rejected 'missing or stale Windows version metadata' -CandidateMode
Write-Output 'PASS: stale executable version cannot be packaged even as a candidate.'
if ($SkipCandidateCopy) {
    Write-Output 'Candidate copying was skipped. No executable was copied or run.'
    Write-Output "Test records: $fixture"
    return
}
Set-Content -LiteralPath $manifestPath -Value "[package]`nversion = `"$version`""
& $packager -SourcePath $source -Candidate | Out-Null
$candidate = Get-Content -LiteralPath (Join-Path $fixture 'artifacts/bridge-candidate/bridge-manifest.json') -Raw | ConvertFrom-Json
if ($candidate.releaseStatus -ne 'not-approved' -or $candidate.signed -ne $false -or $candidate.signature.status -ne 'NotSigned') { throw 'Candidate manifest claims incorrect release or signature status.' }
if ($candidate.sha256 -ne (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()) { throw 'Candidate manifest hash mismatch.' }
if (Test-Path -LiteralPath (Join-Path $fixture 'public/downloads')) { throw 'Candidate mode wrote public downloads.' }
Write-Output 'PASS: review candidate records truthful signature/hash and stays outside public downloads.'
Write-Output "Test records: $fixture"
