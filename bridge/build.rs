use std::{env, process::Command};

fn output(program: &str, args: &[&str]) -> Option<String> {
    let result = Command::new(program).args(args).output().ok()?;
    result
        .status
        .success()
        .then(|| String::from_utf8_lossy(&result.stdout).trim().to_owned())
}

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=Cargo.toml");
    println!("cargo:rerun-if-changed=Cargo.lock");
    println!("cargo:rerun-if-changed=src");
    if let Some(head) = output("git", &["rev-parse", "--git-path", "HEAD"]) {
        println!("cargo:rerun-if-changed={head}");
    }
    if let Some(index) = output("git", &["rev-parse", "--git-path", "index"]) {
        println!("cargo:rerun-if-changed={index}");
    }
    if let Some(branch) = output("git", &["symbolic-ref", "-q", "HEAD"]) {
        if let Some(reference) = output("git", &["rev-parse", "--git-path", &branch]) {
            println!("cargo:rerun-if-changed={reference}");
        }
    }
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let commit = output("git", &["rev-parse", "HEAD"]).unwrap_or_else(|| "unknown".into());
    let dirty = output(
        "git",
        &["status", "--porcelain", "--untracked-files=normal"],
    )
    .map(|status| (!status.is_empty()).to_string())
    .unwrap_or_else(|| "unknown".into());
    let rustc = output(
        &env::var("RUSTC").unwrap_or_else(|_| "rustc".into()),
        &["--version"],
    )
    .unwrap_or_else(|| "unknown".into());
    let mut resource = winresource::WindowsResource::new();
    resource
        .set("ProductName", "LenseBridge")
        .set(
            "FileDescription",
            "Local desktop screenshots and user-approved keyboard and mouse control",
        )
        .set("InternalName", "lense-bridge")
        .set("OriginalFilename", "LenseBridge-windows-x64.exe")
        .set(
            "Comments",
            &format!("sourceCommit={commit};sourceDirty={dirty};rustc={rustc}"),
        );
    // FileVersion, ProductVersion and numeric versions come from Cargo.toml.
    // Do not invent a publisher or alter the process DPI/privilege manifest.
    resource
        .compile()
        .expect("Windows version resource compilation failed");
}
