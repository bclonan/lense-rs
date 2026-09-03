# Windows setup release

Version 1.0.2 adds installer source and release tooling. A usable setup executable has not been built or uploaded.

The normal release build compiled the bridge but Windows denied the final write to `bridge/target/release/lense-bridge.exe` with `Access is denied. (os error 5)`. The linked compiler output reports version 1.0.2 and is unsigned. It was inspected without being copied or run. The error alone does not establish which Windows component denied the write.

Norton's earlier IDP.Generic report remains unresolved. No code-signing certificate is configured for this release, and no Inno Setup compiler was found in the checked tool locations. Public distribution remains paused.

## What setup installs

The installer is defined in `installer/LenseBridge.iss`. It installs LenseBridge and its instructions under `%LOCALAPPDATA%\Programs\LenseBridge`. It creates Start menu shortcuts and a standard uninstall entry. It requests no administrator access, creates no startup task or service, and does not launch the bridge during installation.

After an approved release is available, users run Windows setup, open LenseBridge from the Start menu, and keep its console open. They then open the website, detect the bridge, approve pairing, and select a monitor or app window. `installer/START-HERE.txt` contains that complete flow.

Before updating or uninstalling, users stop desktop control and close the bridge console. Uninstall does not erase browser history.

## Build and inspect

The bridge requires the Rust Windows MSVC toolchain. Installer compilation requires [Inno Setup 6.7.3 or newer](https://jrsoftware.org/isdl.php). Follow its [download verification instructions](https://jrsoftware.org/isdl-verify.php) and license terms when acquiring the build tool.

Inspect the expected version and output paths without compiling or copying an executable:

```powershell
./scripts/build-bridge-installer.ps1 -Describe
./scripts/test-installer-source.ps1
```

The description, installer source checks, PowerShell parser checks, and synthetic policy checks passed. These checks do not compile or install the setup program.

After the normal build-output problem is resolved:

```powershell
cargo build --manifest-path bridge/Cargo.toml --release --locked
./scripts/build-bridge-installer.ps1 -Candidate
```

Candidate output belongs in `artifacts/bridge-installer-candidate/1.0.2/`. Its expected name is `LenseBridge-Setup-1.0.2-x64.exe`, with `setup-manifest.json`. A candidate is marked `not-approved` and cannot be published by the release script. These files do not exist yet.

## Signed publication

Resolve the antivirus report before resuming distribution. Build and sign the normal bridge output with the real publisher certificate. Configure that certificate's thumbprint as `expectedSignerThumbprint` in `release/bridge-distribution.json`, approve availability, and keep `downloadPath` aligned with the Cargo version. Do not remove the blocked 1.0.1 hash.

The installer builder accepts `-ExpectedSignerThumbprint`, `-SignToolPath`, and `-TimestampUrl` for a signed release. Use the certificate issuer's actual HTTPS RFC 3161 timestamp service. The builder signs setup and the uninstaller and checks their signatures. It requires the bridge payload to be signed already and to record clean source provenance.

`scripts/publish-bridge-installer.ps1` rechecks the setup and payload before copying the approved setup and manifest into `public/downloads`. `pnpm build` then verifies their manifest, hash, size, signer, version, and blocked-hash status. The cross-platform site check validates the Windows packager's attestation; it cannot independently verify Authenticode.

There is no signing credential in this repository. No installer was run, no antivirus setting was changed, and no quarantined file was restored.
