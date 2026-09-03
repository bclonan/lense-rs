#[cfg(windows)]
mod platform;
#[cfg(windows)]
pub use platform::*;

#[cfg(not(windows))]
compile_error!("LenseBridge is a Windows desktop bridge. Build it on Windows.");
