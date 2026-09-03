use crate::error::{BridgeError, Result};
use serde::{Deserialize, Serialize};

pub fn timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
pub fn id() -> String {
    ulid::Ulid::new().to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}
impl Point {
    pub fn validate(&self) -> Result<()> {
        if self.x.is_finite()
            && self.y.is_finite()
            && (0.0..=1.0).contains(&self.x)
            && (0.0..=1.0).contains(&self.y)
        {
            Ok(())
        } else {
            Err(invalid(
                "Coordinates must be normalized values between 0 and 1",
            ))
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Region {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
impl Region {
    pub fn validate(&self) -> Result<()> {
        Point {
            x: self.x,
            y: self.y,
        }
        .validate()?;
        if !self.width.is_finite()
            || !self.height.is_finite()
            || self.width <= 0.0
            || self.height <= 0.0
            || self.x + self.width > 1.0
            || self.y + self.height > 1.0
        {
            return Err(invalid("Region must fit inside the selected capture"));
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum Target {
    #[serde(rename = "monitor")]
    Monitor { id: String },
    #[serde(rename = "window")]
    Window { id: String },
}
impl Default for Target {
    fn default() -> Self {
        Self::Monitor {
            id: "primary".into(),
        }
    }
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Button {
    #[default]
    Left,
    Right,
    Middle,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum Action {
    #[serde(rename = "pointer.move")]
    Move {
        x: f64,
        y: f64,
        #[serde(default)]
        target: Target,
    },
    #[serde(rename = "pointer.click")]
    Click {
        x: f64,
        y: f64,
        #[serde(default)]
        button: Button,
        #[serde(default)]
        target: Target,
    },
    #[serde(rename = "pointer.doubleClick")]
    DoubleClick {
        x: f64,
        y: f64,
        #[serde(default)]
        button: Button,
        #[serde(default)]
        target: Target,
    },
    #[serde(rename = "pointer.drag")]
    Drag {
        from: Point,
        to: Point,
        #[serde(rename = "durationMs")]
        duration_ms: u64,
        #[serde(default)]
        target: Target,
    },
    #[serde(rename = "keyboard.type")]
    Type { text: String },
    #[serde(rename = "keyboard.key")]
    Key { key: String },
    #[serde(rename = "keyboard.hotkey")]
    Hotkey { keys: Vec<String> },
    #[serde(rename = "scroll")]
    Scroll {
        #[serde(rename = "deltaX")]
        delta_x: i32,
        #[serde(rename = "deltaY")]
        delta_y: i32,
    },
    #[serde(rename = "window.focus")]
    Focus {
        #[serde(rename = "windowId")]
        window_id: String,
    },
}
impl Action {
    pub fn scope(&self) -> &'static str {
        match self {
            Self::Type { .. } | Self::Key { .. } | Self::Hotkey { .. } => "keyboard",
            _ => "pointer",
        }
    }
    pub fn validate(&self) -> Result<()> {
        match self {
            Self::Move { x, y, .. } | Self::Click { x, y, .. } | Self::DoubleClick { x, y, .. } => {
                Point { x: *x, y: *y }.validate()
            }
            Self::Drag {
                from,
                to,
                duration_ms,
                ..
            } => {
                from.validate()?;
                to.validate()?;
                if !(50..=5000).contains(duration_ms) {
                    return Err(invalid("Drag duration must be between 50 and 5000 ms"));
                }
                Ok(())
            }
            Self::Type { text } => {
                if text.is_empty() || text.encode_utf16().count() > 10000 || text.contains('\0') {
                    Err(invalid(
                        "Text must contain 1 to 10000 UTF-16 units without NUL characters",
                    ))
                } else {
                    Ok(())
                }
            }
            Self::Key { key } => crate::input::virtual_key(key).map(|_| ()),
            Self::Hotkey { keys } => {
                if keys.is_empty() || keys.len() > 5 {
                    return Err(invalid("Hotkeys require 1 to 5 supported keys"));
                }
                let mut seen = std::collections::HashSet::new();
                for key in keys {
                    let vk = crate::input::virtual_key(key)?;
                    if !seen.insert(vk) {
                        return Err(invalid("Hotkeys cannot repeat keys"));
                    }
                }
                Ok(())
            }
            Self::Scroll { delta_x, delta_y } => {
                if delta_x.unsigned_abs() > 10000 || delta_y.unsigned_abs() > 10000 {
                    Err(invalid("Scroll deltas must be between -10000 and 10000"))
                } else {
                    Ok(())
                }
            }
            Self::Focus { window_id } => {
                if window_id.is_empty() || window_id.len() > 128 {
                    Err(invalid("A current window id is required"))
                } else {
                    Ok(())
                }
            }
        }
    }
}
pub fn invalid(message: &str) -> BridgeError {
    BridgeError::new("INVALID_ACTION", message)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Monitor {
    pub id: String,
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    pub primary: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopWindow {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub minimized: bool,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaptureOptions {
    #[serde(default)]
    pub target: Target,
    pub region: Option<Region>,
    pub max_dimension: Option<u32>,
    pub quality: Option<f32>,
}
impl CaptureOptions {
    pub fn validate(&self) -> Result<()> {
        if let Some(region) = &self.region {
            region.validate()?;
        }
        if self
            .max_dimension
            .is_some_and(|v| !(160..=2560).contains(&v))
        {
            return Err(invalid("maxDimension must be between 160 and 2560"));
        }
        if self
            .quality
            .is_some_and(|v| !v.is_finite() || !(0.1..=1.0).contains(&v))
        {
            return Err(invalid("quality must be between 0.1 and 1"));
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Observation {
    pub id: String,
    pub timestamp: String,
    pub target: Target,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub region: Option<Region>,
    pub native_width: u32,
    pub native_height: u32,
    pub width: u32,
    pub height: u32,
    pub mime_type: String,
    pub image: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub foreground_window: Option<DesktopWindow>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<Point>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WatchSpec {
    pub id: String,
    #[serde(default)]
    pub target: Target,
    pub region: Option<Region>,
    pub interval_ms: u64,
    pub mode: String,
    pub threshold: f64,
}
impl WatchSpec {
    pub fn validate(&self) -> Result<()> {
        if self.id.is_empty()
            || self.id.len() > 64
            || !self
                .id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "_-".contains(c))
        {
            return Err(invalid(
                "Watch id must be 1 to 64 letters, digits, hyphens or underscores",
            ));
        }
        if self.mode != "visual-change"
            || !(500..=3_600_000).contains(&self.interval_ms)
            || !self.threshold.is_finite()
            || !(0.0..=1.0).contains(&self.threshold)
        {
            return Err(invalid("Use visual-change mode, a 500 to 3600000 ms interval, and a threshold between 0 and 1"));
        }
        if let Some(region) = &self.region {
            region.validate()?;
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: String,
    pub timestamp: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub data: serde_json::Value,
}
impl Event {
    pub fn new(kind: &str, data: serde_json::Value) -> Self {
        Self {
            id: id(),
            timestamp: timestamp(),
            kind: kind.into(),
            data,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}
impl Bounds {
    pub fn normalize(&self, point: &Point) -> Option<Point> {
        let x = point.x - self.x as f64;
        let y = point.y - self.y as f64;
        if !x.is_finite()
            || !y.is_finite()
            || x < 0.0
            || y < 0.0
            || x >= self.width as f64
            || y >= self.height as f64
        {
            return None;
        }
        Some(Point {
            x: x / self.width.saturating_sub(1).max(1) as f64,
            y: y / self.height.saturating_sub(1).max(1) as f64,
        })
    }
    pub fn map(&self, point: &Point) -> Result<(i32, i32)> {
        point.validate()?;
        if self.width == 0 || self.height == 0 {
            return Err(invalid("Target has no visible area"));
        }
        Ok((
            self.x + (point.x * (self.width - 1) as f64).round() as i32,
            self.y + (point.y * (self.height - 1) as f64).round() as i32,
        ))
    }
    pub fn region(&self, region: &Region) -> Result<Self> {
        region.validate()?;
        let x = (region.x * self.width as f64).floor() as u32;
        let y = (region.y * self.height as f64).floor() as u32;
        Ok(Self {
            x: self.x + x as i32,
            y: self.y + y as i32,
            width: ((region.width * self.width as f64).round() as u32)
                .max(1)
                .min(self.width - x),
            height: ((region.height * self.height as f64).round() as u32)
                .max(1)
                .min(self.height - y),
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn coordinates_support_negative_monitors_and_edges() {
        let b = Bounds {
            x: -1920,
            y: -300,
            width: 1920,
            height: 1080,
        };
        assert_eq!(b.map(&Point { x: 0.0, y: 0.0 }).unwrap(), (-1920, -300));
        assert_eq!(b.map(&Point { x: 1.0, y: 1.0 }).unwrap(), (-1, 779));
        assert!(b
            .map(&Point {
                x: f64::NAN,
                y: 0.0
            })
            .is_err());
        assert_eq!(
            b.normalize(&Point { x: -1.0, y: 779.0 }),
            Some(Point { x: 1.0, y: 1.0 })
        );
        assert!(b.normalize(&Point { x: 0.0, y: 779.0 }).is_none());
        assert!(b
            .normalize(&Point {
                x: -1.0,
                y: f64::NAN
            })
            .is_none());
    }
    #[test]
    fn strict_union_and_validation() {
        assert!(serde_json::from_str::<Action>(r#"{"type":"shell","command":"calc"}"#).is_err());
        assert!(serde_json::from_str::<Action>(
            r#"{"type":"keyboard.type","text":"ok","command":"calc"}"#
        )
        .is_err());
        assert!(
            serde_json::from_str::<Action>(r#"{"type":"pointer.click","x":2,"y":0}"#)
                .unwrap()
                .validate()
                .is_err()
        );
        assert!(serde_json::from_str::<Action>(
            r#"{"type":"keyboard.type","text":"Hello 😀 世界"}"#
        )
        .unwrap()
        .validate()
        .is_ok());
    }
    #[test]
    fn watch_rejects_excessive_frequency() {
        let w: WatchSpec = serde_json::from_str(
            r#"{"id":"w","intervalMs":1,"mode":"visual-change","threshold":0.1}"#,
        )
        .unwrap();
        assert!(w.validate().is_err());
    }
}
