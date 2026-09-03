# Windows antivirus report

Norton reported IDP.Generic and quarantined a downloaded LenseBridge 1.0.1 copy. The local Norton log confirms the filename and alert ID. This report is unresolved. Source review and passing application tests do not establish that the quarantined executable is safe.

The public Windows download is paused. The browser lab remains available. Keep quarantined copies in quarantine. Do not disable protection or add an exception to run them.

## Evidence

The packaged 1.0.1 file and previously downloaded production copy both have SHA-256 `f568eeec970fbf3280e01bebfc5bc302d3e07f4061467d3040c32a6c5d78df32` and length 1,007,104 bytes. Both are unsigned. Their Windows file-version fields are empty. The quarantined file itself was not extracted for comparison.

Norton 360 for Gamers is installed. The Norton alert names IDP.Generic and alert ID `05346a6a9f11`. The original built executable is now absent. Norton logs also reference that build path, but this investigation has not inspected the quarantined contents.

A read-only source audit found the intended GDI screenshots, SendInput actions, window-title enumeration, and emergency RegisterHotKey. Network operations in the application are confined to fixed loopback ports. No unexpected runtime process execution, persistence, keylogging, remote network endpoint, or obfuscator was found. All 120 locally cached dependency archives matched the Cargo.lock hashes; all 5,673 extracted files matched those archives. Seventeen locked packages had no local archive and were not checked. This audit preceded the version-resource build changes.

## Changes

The site no longer offers the reported binary. Its old download URL directs visitors to a status page. The site build excludes executable downloads while `release/bridge-distribution.json` is paused and blocks the reported SHA-256. The public copy was removed after an exact-hash review archive was prepared outside the published directory.

Release packaging now verifies embedded Windows version information and a real publisher signature, records build provenance, and separates unsigned candidates from public releases. Public packages require clean committed source, the expected signer, and an approved distribution policy. A signature identifies the publisher; it does not prove that antivirus detection is incorrect. No trusted code-signing certificate was found in the current-user or local-machine personal certificate stores.

Rust checking, formatting, and unsigned-build and stale-version rejection tests passed. Windows denied the final executable copy during the release build. That failure was not bypassed. No new executable was packaged, run, or published, and the full candidate-copy test remains unrun locally.

The website's 34 unit tests, production build, and seven browser checks passed. Eleven distribution tests passed using synthetic text fixtures. The deployed site has no EXE link, the old download URLs open the status page, and the manifest reports paused. Live browser checks found no page errors or mobile overflow.

The site build checks the Windows packager's manifest against the download hash, size, signature record, expected signer, and clean source provenance. It does not independently verify Authenticode on non-Windows hosts. Build provenance describes the last build-script run and is not a complete reproducible-build recipe.

## Norton review

The local review packet is in `artifacts/norton-review`. It includes the exact previously distributed executable in an unencrypted ZIP and a ready-to-review report. It has not been sent to Norton. No quarantined file was restored, and no flagged executable was run during this investigation.

The archive's single entry was read without extracting it. Its size and SHA-256 match the reported release above.

[Norton's current instructions](https://support.norton.com/sp/en/us/home/current/solutions/kb20090410134005EN) require a contact email, detection details, and a file or URL. The [submission portal](https://submissions.norton.com/submitsample) also requires its CAPTCHA. The owner must authorize the external submission and provide the contact email. Norton must review the sample before this detection can be called resolved.

Public distribution must remain paused until an approved replacement is available. Do not rename, repackage, or change compiler settings merely to obtain a new hash that evades the alert.

## Version 1.0.2 installer work

The user requested a standard Windows installer. Installer source, per-user shortcuts and uninstall, signed publication checks, and versioned website download support have been added. The Cargo package is now 1.0.2. Its ordinary release build again failed the final EXE write with Windows error 5. Read-only metadata inspection found the linked 1.0.2 compiler output is unsigned. It was not copied to another location or packaged to work around the failure.

`cargo check`, Rust formatting, 34 frontend tests, the website build, 17 download-policy tests, and installer source/parser/policy checks passed. The policy tests use synthetic data, not executable samples. Inno Setup compilation, installation, uninstall, and signed release checks still require the missing build output and tools. See [Windows setup release](windows-setup.md).
