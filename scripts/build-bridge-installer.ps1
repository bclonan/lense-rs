[CmdletBinding()]
param(
    [switch]$Candidate,
    [switch]$Describe,
    [string]$IsccPath,
    [string]$ExpectedSignerThumbprint,
    [string]$SignToolPath,
    [string]$TimestampUrl
)
$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $PSScriptRoot 'installer-release.psm1') -Force
$definition = Get-InstallerDefinition $repository
if ($Describe) { $definition | ConvertTo-Json; return }

# Require the normal Cargo output. Never look in deps or recover quarantined files.
$payload = Get-InstallerPayload $definition.Payload $definition.Version
$policy = Get-Content -LiteralPath (Join-Path $repository 'release/bridge-distribution.json') -Raw | ConvertFrom-Json
Assert-InstallerPolicy $policy $payload $ExpectedSignerThumbprint -Candidate:$Candidate
if (-not $IsccPath) {
    $command = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($command) { $IsccPath = $command.Source }
    else {
        foreach ($location in @("${env:ProgramFiles(x86)}/Inno Setup 6/ISCC.exe", "$env:ProgramFiles/Inno Setup 7/ISCC.exe", "$env:LOCALAPPDATA/Programs/Inno Setup 6/ISCC.exe", "$env:LOCALAPPDATA/Programs/Inno Setup 7/ISCC.exe")) {
            if (Test-Path -LiteralPath $location -PathType Leaf) { $IsccPath = $location; break }
        }
    }
}
if (-not $IsccPath -or -not (Test-Path -LiteralPath $IsccPath -PathType Leaf)) { throw 'Install Inno Setup 6.7.3 or newer from https://jrsoftware.org/isdl.php, then provide -IsccPath if needed. This script does not download or install build tools.' }
$IsccPath = (Resolve-Path -LiteralPath $IsccPath).Path
$compilerVersionText = (Get-Item -LiteralPath $IsccPath).VersionInfo.FileVersion
$compilerVersion = [regex]::Match($compilerVersionText, '\d+\.\d+\.\d+(?:\.\d+)?').Value
if (-not $compilerVersion -or [version]$compilerVersion -lt [version]'6.7.3') { throw 'Inno Setup 6.7.3 or newer is required.' }
$output = if ($Candidate) { $definition.CandidateDirectory } else { $definition.ReleaseDirectory }
$arguments = @('/Qp', "/DBridgeVersion=$($definition.Version)", "/DBridgePayload=$($definition.Payload)", "/DBridgeOutputDir=$output")
if (-not $Candidate) {
    if (-not $SignToolPath -or -not (Test-Path -LiteralPath $SignToolPath -PathType Leaf)) { throw 'Provide -SignToolPath for the Windows SDK signtool.exe.' }
    $SignToolPath = (Resolve-Path -LiteralPath $SignToolPath).Path
    $timestamp = $null
    if (-not [uri]::TryCreate($TimestampUrl, [UriKind]::Absolute, [ref]$timestamp) -or $timestamp.Scheme -ne 'https' -or $timestamp.UserInfo -or $TimestampUrl -match '["\r\n$]' -or $SignToolPath -match '["\r\n$]') { throw 'Provide an HTTPS RFC 3161 timestamp URL from the certificate issuer and a valid SignTool path.' }
    $thumbprint = ($ExpectedSignerThumbprint -replace '\s', '').ToUpperInvariant()
    $signingCommand = '$q{0}$q sign /fd SHA256 /sha1 {1} /s My /tr $q{2}$q /td SHA256 $f' -f $SignToolPath, $thumbprint, $TimestampUrl
    $arguments += '/DPublicRelease'
    $arguments += "/SLenseBridgePublisher=$signingCommand"
}
New-Item -ItemType Directory -Path $output -Force | Out-Null
if (-not $Candidate) { New-Item -ItemType Directory -Path (Join-Path $output 'signed-uninstallers') -Force | Out-Null }
& $IsccPath @arguments (Join-Path $repository 'installer/LenseBridge.iss')
if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed with exit code $LASTEXITCODE. No release was approved." }
$setup = Join-Path $output $definition.File
if (-not (Test-Path -LiteralPath $setup -PathType Leaf)) { throw 'Inno Setup did not create the expected versioned installer.' }
Assert-InstallerVersion $setup $definition.Version
if ((Get-FileHash -LiteralPath $definition.Payload -Algorithm SHA256).Hash.ToLowerInvariant() -ne $payload.sha256) { throw 'The bridge changed during installer compilation. Do not publish the output.' }
$signature = Get-InstallerSignature $setup
$uninstallerSigned = $false
if (-not $Candidate) {
    if ($signature.status -ne 'Valid' -or $signature.signerThumbprint -ne $thumbprint) { throw 'Installer signature verification failed.' }
    # Inno keeps signed uninstaller images as .e32/.e64 in some versions.
    $uninstallers = @(Get-ChildItem -LiteralPath (Join-Path $output 'signed-uninstallers') -File | Where-Object { $_.Extension -in @('.exe', '.e32', '.e64') })
    if (-not $uninstallers.Count) { throw 'The signed uninstaller is missing.' }
    foreach ($uninstaller in $uninstallers) {
        $uninstallSignature = Get-InstallerSignature $uninstaller.FullName
        if ($uninstallSignature.status -ne 'Valid' -or $uninstallSignature.signerThumbprint -ne $thumbprint) { throw 'Uninstaller signature verification failed.' }
    }
    $uninstallerSigned = $true
}
$manifest = [ordered]@{
    kind = 'windows-setup'; file = $definition.File; version = $definition.Version; platform = 'windows-x64'; protocolVersion = 1
    sha256 = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash.ToLowerInvariant(); bytes = (Get-Item -LiteralPath $setup).Length
    releaseStatus = if ($Candidate) { 'not-approved' } else { 'signature-verified' }
    signed = $signature.status -eq 'Valid'; signature = $signature; uninstallerSigned = $uninstallerSigned
    payload = $payload; build = $payload.build; installerCompiler = "Inno Setup $compilerVersion"; packagedAt = [DateTime]::UtcNow.ToString('o')
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $output 'setup-manifest.json') -Encoding utf8
Write-Output "Installer built in $output. Release status: $($manifest.releaseStatus). Nothing was copied to public downloads or launched."
