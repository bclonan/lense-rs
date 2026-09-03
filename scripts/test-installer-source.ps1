$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $PSScriptRoot 'installer-release.psm1') -Force
$fixture = Join-Path $repository ('artifacts/installer-source-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $fixture 'bridge') -Force | Out-Null
Set-Content -LiteralPath (Join-Path $fixture 'bridge/Cargo.toml') -Value '[package]', 'version = "4.5.6"'
$definition = Get-InstallerDefinition $fixture
if ($definition.Version -ne '4.5.6' -or $definition.File -ne 'LenseBridge-Setup-4.5.6-x64.exe' -or -not $definition.CandidateDirectory.StartsWith((Join-Path $fixture 'artifacts'))) { throw 'Installer version or candidate output does not derive from Cargo.' }
Write-Output 'PASS: installer naming follows Cargo and candidate output stays under artifacts.'

$source = Get-Content -LiteralPath (Join-Path $repository 'installer/LenseBridge.iss') -Raw
foreach ($required in @('PrivilegesRequired=lowest', 'DefaultDirName={localappdata}\Programs\LenseBridge', 'CloseApplications=no', 'RestartApplications=no', 'Uninstallable=yes', 'AppVersion={#BridgeVersion}', 'VersionInfoProductVersion={#BridgeVersion}', 'Name: "{group}\LenseBridge"; Filename: "{app}\LenseBridge-windows-x64.exe"')) {
    if (-not $source.Contains($required)) { throw "Missing installer requirement: $required" }
}
if ($source -match '(?im)^\s*\[(Run|UninstallRun|Registry)\]' -or $source -match '(?im)^\s*PrivilegesRequiredOverridesAllowed\s*=' -or $source -match '\{(?:common|user)startup\}') { throw 'Installer source adds execution, startup registration, or an elevation override.' }
Write-Output 'PASS: per-user setup has explicit shortcuts and uninstall, without startup or execution hooks.'

function New-PolicyFixture {
    $signer = 'A' * 40
    return @{
        Policy = [pscustomobject]@{ availability = 'available'; blockedSha256 = @(); expectedSignerThumbprint = $signer }
        Payload = @{ sha256 = 'b' * 64; signature = @{ status = 'Valid'; signerThumbprint = $signer }; build = @{ sourceCommit = 'c' * 40; sourceDirty = $false; toolchain = 'rustc 1.96.0 (synthetic metadata)' } }
        Signer = $signer
    }
}
function Assert-PolicyRejected($Fixture, [switch]$Candidate) {
    $rejected = $false
    try { Assert-InstallerPolicy $Fixture.Policy $Fixture.Payload $Fixture.Signer -Candidate:$Candidate } catch { $rejected = $true }
    if (-not $rejected) { throw 'Release policy unexpectedly accepted rejected installer metadata.' }
}
$valid = New-PolicyFixture
Assert-InstallerPolicy $valid.Policy $valid.Payload $valid.Signer
$paused = New-PolicyFixture; $paused.Policy.availability = 'paused'; Assert-PolicyRejected $paused
$blocked = New-PolicyFixture; $blocked.Policy.blockedSha256 = @($blocked.Payload.sha256); Assert-PolicyRejected $blocked -Candidate
$unsigned = New-PolicyFixture; $unsigned.Payload.signature.status = 'NotSigned'; Assert-PolicyRejected $unsigned
$wrongSigner = New-PolicyFixture; $wrongSigner.Payload.signature.signerThumbprint = 'D' * 40; Assert-PolicyRejected $wrongSigner
$dirty = New-PolicyFixture; $dirty.Payload.build.sourceDirty = $true; Assert-PolicyRejected $dirty
$unknown = New-PolicyFixture; $unknown.Payload.build.sourceCommit = 'unknown'; Assert-PolicyRejected $unknown
$local = New-PolicyFixture; $local.Policy.availability = 'paused'; $local.Payload.signature.status = 'NotSigned'; Assert-InstallerPolicy $local.Policy $local.Payload $local.Signer -Candidate
Write-Output 'PASS: public release rejects paused policy, blocked payloads, unsigned files, wrong signer, and dirty or unknown source. Candidate policy stays separate.'

foreach ($script in @('installer-release.psm1', 'build-bridge-installer.ps1', 'publish-bridge-installer.ps1')) {
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $script), [ref]$null, [ref]$errors) | Out-Null
    if ($errors) { throw "PowerShell syntax errors in $script`: $errors" }
}
Write-Output 'PASS: installer PowerShell source parses. No executable was read, copied, built, or run by these tests.'
