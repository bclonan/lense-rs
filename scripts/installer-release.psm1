$ErrorActionPreference = 'Stop'

function Get-InstallerDefinition([string]$Repository) {
    $cargo = Get-Content -LiteralPath (Join-Path $Repository 'bridge/Cargo.toml') -Raw
    $match = [regex]::Match($cargo, '(?m)^version\s*=\s*"(\d+\.\d+\.\d+)"')
    if (-not $match.Success) { throw 'Installer builds require a numeric Cargo release version, such as 1.0.2.' }
    $version = $match.Groups[1].Value
    return [pscustomobject]@{
        Version = $version
        File = "LenseBridge-Setup-$version-x64.exe"
        Payload = Join-Path $Repository 'bridge/target/release/lense-bridge.exe'
        CandidateDirectory = Join-Path $Repository "artifacts/bridge-installer-candidate/$version"
        ReleaseDirectory = Join-Path $Repository "artifacts/bridge-installer-release/$version"
    }
}

function Get-InstallerSignature([string]$Path) {
    $value = Get-AuthenticodeSignature -LiteralPath $Path
    if ($value.Status.ToString() -notin @('Valid', 'NotSigned')) { throw "Authenticode verification failed for $Path`: $($value.Status)." }
    return [ordered]@{
        status = $value.Status.ToString()
        signerSubject = if ($value.SignerCertificate) { $value.SignerCertificate.Subject } else { $null }
        signerThumbprint = if ($value.SignerCertificate) { $value.SignerCertificate.Thumbprint } else { $null }
        timestamped = $null -ne $value.TimeStamperCertificate
    }
}

function Get-InstallerPayload([string]$Path, [string]$Version) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'The standard bridge release output is missing. Complete the normal Cargo release build first. Do not use a quarantined or alternate compiler output.' }
    $file = Get-Item -LiteralPath $Path
    $meta = $file.VersionInfo
    if ($meta.ProductName -ne 'LenseBridge' -or $meta.OriginalFilename -ne 'LenseBridge-windows-x64.exe' -or $meta.FileVersion -ne $Version -or $meta.ProductVersion -ne $Version) { throw 'The bridge version metadata does not match the current Cargo release.' }
    $provenance = [regex]::Match($meta.Comments, '^sourceCommit=([a-f0-9]{40}|unknown);sourceDirty=(true|false|unknown);rustc=(.+)$')
    if (-not $provenance.Success) { throw 'The bridge has no build provenance.' }
    $signature = Get-InstallerSignature $Path
    return [ordered]@{
        file = 'LenseBridge-windows-x64.exe'
        version = $Version
        sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
        bytes = $file.Length
        signed = $signature.status -eq 'Valid'
        signature = $signature
        build = [ordered]@{
            sourceCommit = $provenance.Groups[1].Value
            sourceDirty = switch ($provenance.Groups[2].Value) { 'true' { $true } 'false' { $false } default { $null } }
            toolchain = $provenance.Groups[3].Value
        }
    }
}

function Assert-InstallerPolicy($Policy, $Payload, [string]$ExpectedSignerThumbprint, [switch]$Candidate) {
    if ($null -eq $Policy.blockedSha256 -or $Policy.blockedSha256 -isnot [array]) { throw 'Release policy must contain the blocked-hash list.' }
    foreach ($blocked in $Policy.blockedSha256) { if ($blocked -notmatch '^[a-f0-9]{64}$') { throw 'Release policy contains an invalid blocked hash.' } }
    if ($Payload.sha256 -in $Policy.blockedSha256) { throw 'This bridge payload is blocked. Wrapping it in an installer is not permitted.' }
    if ($Candidate) { return }
    if ($Policy.availability -ne 'available') { throw 'Public bridge distribution is paused. Installer packaging cannot override the review.' }
    $expected = ($ExpectedSignerThumbprint -replace '\s', '').ToUpperInvariant()
    if ($expected -notmatch '^[A-F0-9]{40}$' -or $expected -ne $Policy.expectedSignerThumbprint) { throw 'The expected signer must match the approved release-policy certificate.' }
    if ($Payload.signature.status -ne 'Valid' -or $Payload.signature.signerThumbprint -ne $expected) { throw 'The bridge payload must have a valid signature from the approved publisher.' }
    if ($Payload.build.sourceDirty -ne $false -or $Payload.build.sourceCommit -notmatch '^[a-f0-9]{40}$' -or $Payload.build.toolchain -notmatch '^rustc \d+\.\d+\.\d+') { throw 'Public installer packaging requires clean source provenance and a recorded Rust toolchain.' }
}

function Assert-InstallerVersion([string]$Path, [string]$Version) {
    $expected = [version]$Version
    $metadata = (Get-Item -LiteralPath $Path).VersionInfo
    if ($metadata.ProductName -ne 'LenseBridge' -or $metadata.ProductVersion -ne $Version -or $metadata.FileMajorPart -ne $expected.Major -or $metadata.FileMinorPart -ne $expected.Minor -or $metadata.FileBuildPart -ne $expected.Build -or $metadata.FilePrivatePart -ne 0) { throw 'The setup Windows version metadata does not match the current Cargo release.' }
}

Export-ModuleMember -Function Get-InstallerDefinition, Get-InstallerSignature, Get-InstallerPayload, Assert-InstallerPolicy, Assert-InstallerVersion
