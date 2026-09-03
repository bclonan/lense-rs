use crate::{
    auth::Session,
    error::{BridgeError, Result},
    protocol::*,
};

pub struct Captured {
    pub observation: Observation,
    pub pixels: image::RgbImage,
}
pub trait InputExecutor: Send + Sync + 'static {
    fn execute(&self, action: &Action, session: &Session) -> Result<serde_json::Value>;
    fn capture(&self, options: &CaptureOptions) -> Result<Captured>;
    fn monitors(&self) -> Result<Vec<Monitor>>;
    fn windows(&self) -> Result<Vec<DesktopWindow>>;
    fn cursor(&self) -> Result<Point>;
}
pub trait PairApprover: Send + Sync + 'static {
    fn approve(&self, origin: &str) -> bool;
}

pub fn with_input_release(
    press: impl FnOnce() -> Result<()>,
    release: impl FnOnce() -> Result<()>,
) -> Result<()> {
    let pressed = press();
    let released = release();
    pressed.and(released)
}

pub fn capture_dimensions(bounds: Bounds, maximum: u32) -> (u32, u32) {
    let scale = (maximum as f64 / bounds.width.max(bounds.height).max(1) as f64).min(1.0);
    (
        (bounds.width as f64 * scale).round().max(1.0) as u32,
        (bounds.height as f64 * scale).round().max(1.0) as u32,
    )
}

pub fn virtual_key(key: &str) -> Result<u16> {
    let name = key.to_ascii_uppercase();
    let code = match name.as_str() {
        "BACKSPACE" => 0x08, "TAB" => 0x09, "ENTER" | "RETURN" => 0x0D, "SHIFT" => 0x10, "CTRL" | "CONTROL" => 0x11, "ALT" => 0x12, "ESC" | "ESCAPE" => 0x1B, "SPACE" => 0x20,
        "PAGEUP" => 0x21, "PAGEDOWN" => 0x22, "END" => 0x23, "HOME" => 0x24, "LEFT" | "ARROWLEFT" => 0x25, "UP" | "ARROWUP" => 0x26, "RIGHT" | "ARROWRIGHT" => 0x27, "DOWN" | "ARROWDOWN" => 0x28, "INSERT" => 0x2D, "DELETE" => 0x2E, "WIN" | "META" => 0x5B,
        _ if name.len() == 1 && name.as_bytes()[0].is_ascii_alphanumeric() => name.as_bytes()[0] as u16,
        _ if name.starts_with('F') => { let number=name[1..].parse::<u16>().unwrap_or(0); if !(1..=24).contains(&number) { return Err(BridgeError::new("INVALID_ACTION", "Unsupported keyboard key")); } 0x6F + number },
        _ => return Err(BridgeError::new("INVALID_ACTION", "Unsupported keyboard key. Use letters, digits, F1-F24 or named navigation/modifier keys")),
    };
    Ok(code)
}

#[cfg(test)]
pub struct MockInputExecutor {
    pub actions: std::sync::Mutex<Vec<Action>>,
}
#[cfg(test)]
impl MockInputExecutor {
    pub fn new() -> Self {
        Self {
            actions: std::sync::Mutex::new(Vec::new()),
        }
    }
}
#[cfg(test)]
impl InputExecutor for MockInputExecutor {
    fn execute(&self, action: &Action, session: &Session) -> Result<serde_json::Value> {
        let _guard = session.input_gate.lock().unwrap();
        session.check()?;
        self.actions.lock().unwrap().push(action.clone());
        Ok(serde_json::json!({"mock":true}))
    }
    fn capture(&self, options: &CaptureOptions) -> Result<Captured> {
        Ok(Captured {
            observation: Observation {
                id: id(),
                timestamp: timestamp(),
                target: options.target.clone(),
                region: options.region.clone(),
                native_width: 16,
                native_height: 16,
                width: 16,
                height: 16,
                mime_type: "image/jpeg".into(),
                image: "data:image/jpeg;base64,".into(),
                foreground_window: None,
                cursor: None,
            },
            pixels: image::RgbImage::new(16, 16),
        })
    }
    fn monitors(&self) -> Result<Vec<Monitor>> {
        Ok(vec![Monitor {
            id: "primary".into(),
            name: "Mock display".into(),
            x: -1920,
            y: 0,
            width: 1920,
            height: 1080,
            scale_factor: 1.0,
            primary: true,
        }])
    }
    fn windows(&self) -> Result<Vec<DesktopWindow>> {
        Ok(vec![])
    }
    fn cursor(&self) -> Result<Point> {
        Ok(Point {
            x: -100.0,
            y: 200.0,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn stop_during_a_held_input_still_releases_it() {
        let released = Cell::new(false);
        let result = with_input_release(
            || Err(BridgeError::new("CONTROL_DISABLED", "Stopped during input")),
            || {
                released.set(true);
                Ok(())
            },
        );
        assert!(released.get());
        assert_eq!(result.unwrap_err().code, "CONTROL_DISABLED");
    }

    #[test]
    fn release_errors_are_reported_after_a_successful_press() {
        let result = with_input_release(
            || Ok(()),
            || Err(BridgeError::new("INPUT_FAILED", "Release failed")),
        );
        assert_eq!(result.unwrap_err().code, "INPUT_FAILED");
    }

    #[test]
    fn captures_scale_before_allocating_the_bitmap() {
        let bounds = Bounds {
            x: -3840,
            y: -2160,
            width: 3840,
            height: 2160,
        };
        assert_eq!(capture_dimensions(bounds, 160), (160, 90));
        assert_eq!(capture_dimensions(bounds, 1280), (1280, 720));
        assert_eq!(capture_dimensions(bounds, 5000), (3840, 2160));
        assert_eq!(
            capture_dimensions(Bounds { width: 1, ..bounds }, 160),
            (1, 160)
        );
    }
}
