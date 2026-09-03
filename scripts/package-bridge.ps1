[CmdletBinding()]
param(
    [switch]$Candidate,
    [string]$ExpectedSignerThumbprint,
    [string]$SourcePath
)

$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
if (-not $SourcePath) { $SourcePath = Join-Path $repository 'bridge/target/release/lense-bridge.exe' }
if (-not (Test-Path -LiteralPath $SourcePath -PathType Leaf)) {
    throw 'Build the bridge with cargo build --manifest-path bridge/Cargo.toml --release --locked first. Do not restore a quarantined executable.'
}
$source = (Resolve-Path -LiteralPath $SourcePath).Path
$cargoManifest = Get-Content -LiteralPath (Join-Path $repository 'bridge/Cargo.toml') -Raw
$versionMatch = [regex]::Match($cargoManifest, '(?m)^version\s*=\s*"([^"]+)"')
if (-not $versionMatch.Success) { throw 'The bridge package version is missing.' }
$version = $versionMatch.Groups[1].Value
$metadata = (Get-Item -LiteralPath $source).VersionInfo
if ($metadata.ProductName -ne 'LenseBridge' -or
    $metadata.OriginalFilename -ne 'LenseBridge-windows-x64.exe' -or
    $metadata.FileVersion -ne $version -or $metadata.ProductVersion -ne $version) {
    throw "The executable has missing or stale Windows version metadata. Expected LenseBridge $version. Rebuild from the current source."
}
$provenance = [regex]::Match($metadata.Comments, '^sourceCommit=([a-f0-9]{40}|unknown);sourceDirty=(true|false|unknown);rustc=(.+)$')
if (-not $provenance.Success) { throw 'The executable has no valid build provenance. Rebuild with the current build script.' }
$signature = Get-AuthenticodeSignature -LiteralPath $source
$signatureStatus = $signature.Status.ToString()
if ($signatureStatus -notin @('Valid', 'NotSigned')) { throw "Authenticode verification failed: $signatureStatus. No package was written." }
if (-not $Candidate) {
    if ($signatureStatus -ne 'Valid') { throw 'Public packaging requires a valid Authenticode signature. Use -Candidate only for local review.' }
    $expected = ($ExpectedSignerThumbprint -replace '\s', '').ToUpperInvariant()
    if ($expected -notmatch '^[A-F0-9]{40}$') { throw 'Public packaging requires -ExpectedSignerThumbprint for the approved code-signing certificate.' }
    if ($signature.SignerCertificate.Thumbprint.ToUpperInvariant() -ne $expected) { throw 'The Authenticode signer does not match the approved certificate. No package was written.' }
    if ($provenance.Groups[1].Value -eq 'unknown' -or $provenance.Groups[2].Value -ne 'false') {
        throw 'Public packaging requires a build from a clean, committed source tree.'
    }
}
$hash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
if (-not $Candidate) {
    $distributionPolicy = Get-Content -LiteralPath (Join-Path $repository 'release/bridge-distribution.json') -Raw | ConvertFrom-Json
    if ($distributionPolicy.availability -ne 'available') { throw 'Public bridge distribution is paused. A signature does not override the release review.' }
    if ($hash -in $distributionPolicy.blockedSha256) { throw 'This executable hash is blocked from public distribution.' }
}
$outputDirectory = if ($Candidate) { Join-Path $repository 'artifacts/bridge-candidate' } else { Join-Path $repository 'public/downloads' }
$fileName = 'LenseBridge-windows-x64.exe'
$manifest = [ordered]@{
    file = $fileName
    version = $version
    protocolVersion = 1
    sha256 = $hash
    bytes = (Get-Item -LiteralPath $source).Length
    platform = 'windows-x64'
    releaseStatus = if ($Candidate) { 'not-approved' } else { 'signature-verified' }
    signed = $signatureStatus -eq 'Valid'
    signature = [ordered]@{
        status = $signatureStatus
        signerSubject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }
        signerThumbprint = if ($signature.SignerCertificate) { $signature.SignerCertificate.Thumbprint } else { $null }
        timestamped = $null -ne $signature.TimeStamperCertificate
    }
    build = [ordered]@{
        sourceCommit = $provenance.Groups[1].Value
        sourceDirty = switch ($provenance.Groups[2].Value) { 'true' { $true } 'false' { $false } default { $null } }
        toolchain = $provenance.Groups[3].Value
    }
    packagedAt = [DateTime]::UtcNow.ToString('o')
}
# All metadata, signature and release checks happen before writing a download.
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$destination = Join-Path $outputDirectory $fileName
Copy-Item -LiteralPath $source -Destination $destination
if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) {
    throw 'The copied executable does not match the inspected source. Do not publish the output.'
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $outputDirectory 'bridge-manifest.json') -Encoding utf8
if ($Candidate) {
    Write-Output "Local review candidate only. Not approved for release. Output: $outputDirectory"
} else {
    Write-Output "Packaged signature-verified bridge. Output: $outputDirectory"
}
Write-Output "SHA256 $hash"
