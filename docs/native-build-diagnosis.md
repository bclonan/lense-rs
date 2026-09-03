# Native build diagnosis

Checked September 2, 2026. The normal release build still fails when Cargo places its completed executable at `bridge/target/release/lense-bridge.exe`. Rust compilation succeeds. The final link or copy returns `Access is denied. (os error 5)`, and the destination is absent afterward.

The read-only Norton security history confirms that this exact destination was quarantined earlier that evening. This is a security-product blocker, not a compiler error or an identified application lock.

| Evidence | Result |
| --- | --- |
| Norton `History.db`, `behavior_shield`, event 209 | `IDP.Generic` for `bridge/target/release/lense-bridge.exe`; `action_performed=chest`; `chest_id=18`; detected September 2 at 20:51:38 EDT, recorded at 20:51:40 EDT |
| Norton `Log.db`, `ScanResult`, record 221 | Same exact output path, `Virus=IDP.Generic`, `ChestId=18` |
| Windows Restart Manager | No application reported holding either the final release path or `bridge/target/release/deps/lense_bridge.exe` |
| Running bridge | PID 59384 runs the separate `Downloads/LenseBridge-windows-x64.exe`. NTFS hard-link listings confirm it is not the build-output file |
| Build path permissions | The signed-in user has FullControl on the release directory and the compiled executable in `deps` |
| Current ordinary release build | `cargo build --manifest-path bridge/Cargo.toml --release --locked --offline -vv` compiled version 1.0.2, then failed at final placement |

The compiled 1.0.2 output in `deps` is 1,008,640 bytes, with SHA-256 `c485bf2c65804d7ece5a4355b3a780a3167c874e1bee90920bf753f202b41aba`. It was inspected only. It was not launched, renamed, or copied around the blocked destination. The older quarantine record does not establish that Norton scanned or quarantined this new hash.

Norton also records `IDP.Generic` against the currently running Downloads copy. `behavior_shield` event 220, with corresponding `ScanResult` record 232, detected it at 23:21:06 EDT and recorded it at 23:21:09 EDT. Its recorded action is `none`, with `chest_id=0`. That explains why a working bridge process and a security detection can coexist. It does not prove that the running process locks the build output.

The ordinary mock-input test run that was already in progress during diagnosis passed all 21 Rust tests. No test sent desktop input. No source-code defect that explains the final executable denial was found, so there is no justified code change to remove this blocker. A Norton review of the exact path and detection is required before treating a future successful release build as cleared for distribution.

No bridge process was stopped. Antivirus settings, exclusions, quarantine contents, and release policy were left unchanged. The diagnosis did not restore a flagged file or use an alternate executable name or destination to bypass the denial.
