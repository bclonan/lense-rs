use lense_bridge::{
    auth::Auth,
    input::InputExecutor,
    native::{self, WindowsInputExecutor},
    protocol::CaptureOptions,
};
use std::sync::Arc;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    native::initialize(Arc::new(Auth::default()))?;
    let desktop = WindowsInputExecutor { dry_run: false };
    let monitors = desktop.monitors()?;
    let frame = desktop.capture(&CaptureOptions::default())?;
    let minimum = frame.pixels.as_raw().iter().min().copied().unwrap_or(0);
    let maximum = frame.pixels.as_raw().iter().max().copied().unwrap_or(0);
    println!(
        "{}",
        serde_json::json!({
            "monitorCount": monitors.len(),
            "monitors": monitors,
            "visibleWindowCount": desktop.windows()?.len(),
            "nativeWidth": frame.observation.native_width,
            "nativeHeight": frame.observation.native_height,
            "transmittedWidth": frame.observation.width,
            "transmittedHeight": frame.observation.height,
            "encodedJpegBytes": frame.observation.image.len(),
            "pixelRange": [minimum, maximum],
            "inputSent": false
        })
    );
    Ok(())
}
