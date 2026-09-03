use crate::{
    auth::{Auth, Session},
    error::{BridgeError, Result},
    input::{
        capture_dimensions, virtual_key, with_input_release, Captured, InputExecutor, PairApprover,
    },
    protocol::*,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    mem::{size_of, zeroed},
    ptr::{null, null_mut},
    sync::{Arc, OnceLock},
    thread,
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::*,
    Graphics::Gdi::*,
    System::Console::*,
    UI::{HiDpi::*, Input::KeyboardAndMouse::*, WindowsAndMessaging::*},
};

fn failure(code: &'static str, operation: &str) -> BridgeError {
    BridgeError::new(
        code,
        format!("{operation}. Windows error {}", unsafe { GetLastError() }),
    )
}
fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}
static AUTH: OnceLock<Arc<Auth>> = OnceLock::new();
unsafe extern "system" fn console_stop(_: u32) -> BOOL {
    if let Some(auth) = AUTH.get() {
        auth.revoke_all();
    }
    0
}
pub fn initialize(auth: Arc<Auth>) -> Result<()> {
    unsafe {
        if SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) == 0 {
            return Err(failure(
                "INPUT_FAILED",
                "Could not enable per-monitor V2 DPI awareness",
            ));
        }
    }
    let _ = AUTH.set(auth.clone());
    unsafe {
        if SetConsoleCtrlHandler(Some(console_stop), 1) == 0 {
            return Err(failure(
                "INPUT_FAILED",
                "Could not install the console stop handler",
            ));
        }
    }
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    thread::spawn(move || unsafe {
        if RegisterHotKey(
            null_mut(),
            1,
            MOD_CONTROL | MOD_ALT | MOD_NOREPEAT,
            VK_ESCAPE as u32,
        ) == 0
        {
            let _ = tx.send(Err(failure(
                "INPUT_FAILED",
                "Ctrl+Alt+Escape is unavailable. Close another LenseBridge instance",
            )));
            return;
        }
        let _ = tx.send(Ok(()));
        let mut message: MSG = zeroed();
        while GetMessageW(&mut message, null_mut(), 0, 0) > 0 {
            if message.message == WM_HOTKEY {
                auth.revoke_all();
                println!("STOP: all website sessions revoked by Ctrl+Alt+Escape.");
            }
        }
        UnregisterHotKey(null_mut(), 1);
    });
    rx.recv()
        .map_err(|_| BridgeError::new("INPUT_FAILED", "Emergency-stop initialization failed"))?
}
pub struct NativeApprover;
impl PairApprover for NativeApprover {
    fn approve(&self, origin: &str) -> bool {
        let text=wide(&format!("Allow {origin} to see and control this Windows desktop?\n\nThis allows screenshots, window titles, mouse movement, clicks and keyboard input. It can type into any app you select.\n\nPress Ctrl+Alt+Escape at any time to stop control. Closing the LenseBridge console also stops it.\n\nOnly allow a website you trust."));
        unsafe {
            MessageBoxW(
                null_mut(),
                text.as_ptr(),
                wide("LenseBridge: allow desktop control?").as_ptr(),
                MB_YESNO | MB_ICONWARNING | MB_DEFBUTTON2 | MB_TOPMOST | MB_SETFOREGROUND,
            ) == IDYES
        }
    }
}

pub struct WindowsInputExecutor {
    pub dry_run: bool,
}
unsafe extern "system" fn monitor_callback(
    handle: HMONITOR,
    _: HDC,
    _: *mut RECT,
    data: LPARAM,
) -> BOOL {
    let list = &mut *(data as *mut Vec<Monitor>);
    let mut info: MONITORINFOEXW = zeroed();
    info.monitorInfo.cbSize = size_of::<MONITORINFOEXW>() as u32;
    if GetMonitorInfoW(handle, &mut info as *mut _ as *mut MONITORINFO) != 0 {
        let rect = info.monitorInfo.rcMonitor;
        let mut dpi_x = 96;
        let mut dpi_y = 96;
        let _ = GetDpiForMonitor(handle, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y);
        let name = String::from_utf16_lossy(
            &info.szDevice[..info
                .szDevice
                .iter()
                .position(|v| *v == 0)
                .unwrap_or(info.szDevice.len())],
        );
        list.push(Monitor {
            id: name.clone(),
            name,
            x: rect.left,
            y: rect.top,
            width: (rect.right - rect.left).max(0) as u32,
            height: (rect.bottom - rect.top).max(0) as u32,
            scale_factor: dpi_x as f64 / 96.0,
            primary: info.monitorInfo.dwFlags & MONITORINFOF_PRIMARY != 0,
        });
    }
    1
}
fn monitor_list() -> Result<Vec<Monitor>> {
    let mut list = Vec::new();
    unsafe {
        if EnumDisplayMonitors(
            null_mut(),
            null(),
            Some(monitor_callback),
            &mut list as *mut _ as LPARAM,
        ) == 0
        {
            return Err(failure("CAPTURE_FAILED", "Could not enumerate monitors"));
        }
    }
    Ok(list)
}
unsafe fn window_info(handle: HWND) -> Option<DesktopWindow> {
    if IsWindowVisible(handle) == 0 {
        return None;
    }
    let length = GetWindowTextLengthW(handle);
    if length <= 0 {
        return None;
    }
    let mut title = vec![0u16; (length as usize + 1).min(4096)];
    let written = GetWindowTextW(handle, title.as_mut_ptr(), title.len() as i32);
    if written <= 0 {
        return None;
    }
    let mut rect: RECT = zeroed();
    if GetWindowRect(handle, &mut rect) == 0 || rect.right <= rect.left || rect.bottom <= rect.top {
        return None;
    }
    Some(DesktopWindow {
        id: format!("{:X}", handle as usize),
        title: String::from_utf16_lossy(&title[..written as usize]),
        minimized: IsIconic(handle) != 0,
        x: rect.left,
        y: rect.top,
        width: (rect.right - rect.left) as u32,
        height: (rect.bottom - rect.top) as u32,
    })
}
unsafe extern "system" fn window_callback(handle: HWND, data: LPARAM) -> BOOL {
    if let Some(info) = window_info(handle) {
        (&mut *(data as *mut Vec<DesktopWindow>)).push(info);
    }
    1
}
fn window_list() -> Result<Vec<DesktopWindow>> {
    let mut list = Vec::new();
    unsafe {
        if EnumWindows(Some(window_callback), &mut list as *mut _ as LPARAM) == 0 {
            return Err(failure("CAPTURE_FAILED", "Could not enumerate windows"));
        }
    }
    Ok(list)
}
fn window_handle(id: &str) -> Result<HWND> {
    let handle = usize::from_str_radix(id, 16)
        .map_err(|_| BridgeError::new("WINDOW_NOT_FOUND", "Select a current visible window"))?
        as HWND;
    unsafe {
        if IsWindow(handle) == 0 || window_info(handle).is_none() {
            return Err(BridgeError::new(
                "WINDOW_NOT_FOUND",
                "The selected window is closed or hidden",
            ));
        }
    }
    Ok(handle)
}
fn virtual_bounds() -> Bounds {
    unsafe {
        Bounds {
            x: GetSystemMetrics(SM_XVIRTUALSCREEN),
            y: GetSystemMetrics(SM_YVIRTUALSCREEN),
            width: GetSystemMetrics(SM_CXVIRTUALSCREEN).max(1) as u32,
            height: GetSystemMetrics(SM_CYVIRTUALSCREEN).max(1) as u32,
        }
    }
}
fn target_bounds(target: &Target) -> Result<Bounds> {
    match target {
        Target::Monitor { id } => {
            let monitor = monitor_list()?
                .into_iter()
                .find(|m| m.id == *id || (id == "primary" && m.primary))
                .ok_or_else(|| {
                    BridgeError::new("MONITOR_NOT_FOUND", "Select a connected monitor")
                })?;
            Ok(Bounds {
                x: monitor.x,
                y: monitor.y,
                width: monitor.width,
                height: monitor.height,
            })
        }
        Target::Window { id } => {
            let handle = window_handle(id)?;
            let w = unsafe { window_info(handle) }.ok_or_else(|| {
                BridgeError::new("WINDOW_NOT_FOUND", "Window is no longer visible")
            })?;
            if w.minimized {
                return Err(BridgeError::new(
                    "WINDOW_NOT_FOUND",
                    "The selected window is minimized. Focus it to restore it before observing",
                ));
            }
            let desktop = virtual_bounds();
            let left = w.x.max(desktop.x);
            let top = w.y.max(desktop.y);
            let right = (w.x + w.width as i32).min(desktop.x + desktop.width as i32);
            let bottom = (w.y + w.height as i32).min(desktop.y + desktop.height as i32);
            if right <= left || bottom <= top {
                return Err(BridgeError::new(
                    "WINDOW_NOT_FOUND",
                    "Window is outside the visible desktop",
                ));
            }
            Ok(Bounds {
                x: left,
                y: top,
                width: (right - left) as u32,
                height: (bottom - top) as u32,
            })
        }
    }
}
fn focus_window(id: &str, session: &Session) -> Result<()> {
    let handle = window_handle(id)?;
    if unsafe { IsIconic(handle) } != 0 {
        {
            let _guard = session.input_gate.lock().unwrap();
            session.check()?;
            if unsafe { ShowWindowAsync(handle, SW_RESTORE) } == 0 {
                return Err(BridgeError::new(
                    "INPUT_FAILED",
                    "Windows could not restore the selected window. Restore it manually and retry",
                ));
            }
        }
        let started = Instant::now();
        while unsafe { IsIconic(handle) } != 0 {
            if started.elapsed() >= Duration::from_millis(500) {
                return Err(BridgeError::new(
                    "INPUT_FAILED",
                    "The selected window is still minimized. Restore it manually and retry",
                ));
            }
            sleep_checked(Duration::from_millis(8), session)?;
        }
    }
    {
        let _guard = session.input_gate.lock().unwrap();
        session.check()?;
        unsafe {
            if GetForegroundWindow() == handle {
                return Ok(());
            }
            if SetForegroundWindow(handle) == 0 {
                return Err(BridgeError::new(
                    "INPUT_FAILED",
                    "Windows prevented the selected window from taking focus. Select it manually and retry",
                ));
            }
        }
    }
    let started = Instant::now();
    while unsafe { GetForegroundWindow() } != handle {
        if started.elapsed() >= Duration::from_millis(200) {
            return Err(BridgeError::new(
                "INPUT_FAILED",
                "The selected window did not take focus. Select it manually and retry",
            ));
        }
        sleep_checked(Duration::from_millis(8), session)?;
    }
    session.check()
}
fn input_bounds(target: &Target, session: &Session) -> Result<Bounds> {
    if let Target::Window { id } = target {
        focus_window(id, session)?;
    }
    target_bounds(target)
}
fn cursor_point() -> Result<Point> {
    unsafe {
        let mut p: POINT = zeroed();
        if GetCursorPos(&mut p) == 0 {
            return Err(failure("INPUT_FAILED", "Could not read cursor"));
        }
        Ok(Point {
            x: p.x as f64,
            y: p.y as f64,
        })
    }
}

fn send(inputs: &[INPUT], session: &Session, release: bool) -> Result<()> {
    let _guard = session.input_gate.lock().unwrap();
    if !release {
        session.check()?;
    }
    unsafe {
        if SendInput(
            inputs.len() as u32,
            inputs.as_ptr(),
            size_of::<INPUT>() as i32,
        ) != inputs.len() as u32
        {
            return Err(failure("INPUT_FAILED","Windows rejected input. Elevated apps and secure desktops cannot be controlled by a normal bridge"));
        }
    }
    Ok(())
}
fn mouse(flags: u32, x: i32, y: i32, data: u32) -> INPUT {
    INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx: x,
                dy: y,
                mouseData: data,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}
fn key(code: u16, scan: u16, flags: u32) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: code,
                wScan: scan,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}
fn key_flags(code: u16) -> u32 {
    if [
        0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E, 0x5B,
    ]
    .contains(&code)
    {
        KEYEVENTF_EXTENDEDKEY
    } else {
        0
    }
}
fn move_to(point: &Point, bounds: &Bounds, session: &Session) -> Result<()> {
    let (x, y) = bounds.map(point)?;
    let desktop = virtual_bounds();
    if x < desktop.x
        || y < desktop.y
        || x >= desktop.x + desktop.width as i32
        || y >= desktop.y + desktop.height as i32
    {
        return Err(BridgeError::new(
            "INVALID_ACTION",
            "Point is outside the virtual desktop",
        ));
    }
    let dx = ((x - desktop.x) as f64 * 65535.0 / desktop.width.saturating_sub(1).max(1) as f64)
        .round() as i32;
    let dy = ((y - desktop.y) as f64 * 65535.0 / desktop.height.saturating_sub(1).max(1) as f64)
        .round() as i32;
    send(
        &[mouse(
            MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
            dx,
            dy,
            0,
        )],
        session,
        false,
    )
}
fn click(button: Button, session: &Session) -> Result<()> {
    let (down, up) = match button {
        Button::Left => (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
        Button::Right => (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
        Button::Middle => (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP),
    };
    held_tap(mouse(down, 0, 0, 0), mouse(up, 0, 0, 0), session)
}
fn tap(down: INPUT, up: INPUT, session: &Session) -> Result<()> {
    let result = send(&[down, up], session, false);
    if result.is_err() {
        let _ = send(&[up], session, true);
    }
    result
}
fn held_tap(down: INPUT, up: INPUT, session: &Session) -> Result<()> {
    with_input_release(
        || {
            send(&[down], session, false)?;
            sleep_checked(Duration::from_millis(32), session)
        },
        || send(&[up], session, true),
    )
}
fn sleep_checked(duration: Duration, session: &Session) -> Result<()> {
    let start = Instant::now();
    while start.elapsed() < duration {
        session.check()?;
        thread::sleep(Duration::from_millis(8).min(duration.saturating_sub(start.elapsed())));
    }
    session.check()
}

impl InputExecutor for WindowsInputExecutor {
    fn execute(&self, action: &Action, session: &Session) -> Result<serde_json::Value> {
        action.validate()?;
        session.require(action.scope())?;
        if self.dry_run {
            return Ok(serde_json::json!({"dryRun":true,"executed":false}));
        }
        match action {
            Action::Move { x, y, target } => {
                move_to(&Point { x: *x, y: *y }, &target_bounds(target)?, session)?
            }
            Action::Click {
                x,
                y,
                button,
                target,
            } => {
                move_to(
                    &Point { x: *x, y: *y },
                    &input_bounds(target, session)?,
                    session,
                )?;
                click(*button, session)?;
            }
            Action::DoubleClick {
                x,
                y,
                button,
                target,
            } => {
                move_to(
                    &Point { x: *x, y: *y },
                    &input_bounds(target, session)?,
                    session,
                )?;
                click(*button, session)?;
                sleep_checked(Duration::from_millis(70), session)?;
                click(*button, session)?;
            }
            Action::Drag {
                from,
                to,
                duration_ms,
                target,
            } => {
                let bounds = input_bounds(target, session)?;
                move_to(from, &bounds, session)?;
                with_input_release(
                    || {
                        send(&[mouse(MOUSEEVENTF_LEFTDOWN, 0, 0, 0)], session, false)?;
                        let start = Instant::now();
                        loop {
                            session.check()?;
                            let t = (start.elapsed().as_secs_f64()
                                / (*duration_ms as f64 / 1000.0))
                                .min(1.0);
                            move_to(
                                &Point {
                                    x: from.x + (to.x - from.x) * t,
                                    y: from.y + (to.y - from.y) * t,
                                },
                                &bounds,
                                session,
                            )?;
                            if t >= 1.0 {
                                break;
                            }
                            sleep_checked(Duration::from_millis(8), session)?;
                        }
                        Ok(())
                    },
                    || send(&[mouse(MOUSEEVENTF_LEFTUP, 0, 0, 0)], session, true),
                )?;
            }
            Action::Type { text } => {
                let text = text.replace("\r\n", "\n").replace('\r', "\n");
                for unit in text.encode_utf16() {
                    if unit == 10 {
                        tap(
                            key(VK_RETURN, 0, 0),
                            key(VK_RETURN, 0, KEYEVENTF_KEYUP),
                            session,
                        )?;
                        continue;
                    }
                    tap(
                        key(0, unit, KEYEVENTF_UNICODE),
                        key(0, unit, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP),
                        session,
                    )?;
                }
            }
            Action::Key { key: name } => {
                let code = virtual_key(name)?;
                held_tap(
                    key(code, 0, key_flags(code)),
                    key(code, 0, key_flags(code) | KEYEVENTF_KEYUP),
                    session,
                )?;
            }
            Action::Hotkey { keys } => {
                let mut pressed = Vec::new();
                let result = (|| {
                    for name in keys {
                        let code = virtual_key(name)?;
                        send(&[key(code, 0, key_flags(code))], session, false)?;
                        pressed.push(code);
                    }
                    sleep_checked(Duration::from_millis(32), session)
                })();
                let mut released = Ok(());
                for code in pressed.iter().rev() {
                    if let Err(error) = send(
                        &[key(*code, 0, key_flags(*code) | KEYEVENTF_KEYUP)],
                        session,
                        true,
                    ) {
                        released = Err(error);
                    }
                }
                result?;
                released?;
            }
            Action::Scroll { delta_x, delta_y } => {
                let mut inputs = Vec::new();
                if *delta_y != 0 {
                    inputs.push(mouse(MOUSEEVENTF_WHEEL, 0, 0, (-*delta_y) as u32));
                }
                if *delta_x != 0 {
                    inputs.push(mouse(MOUSEEVENTF_HWHEEL, 0, 0, *delta_x as u32));
                }
                if !inputs.is_empty() {
                    send(&inputs, session, false)?;
                }
            }
            Action::Focus { window_id } => {
                focus_window(window_id, session)?;
            }
        }
        Ok(serde_json::json!({"executed":true}))
    }
    fn capture(&self, options: &CaptureOptions) -> Result<Captured> {
        options.validate()?;
        let mut bounds = target_bounds(&options.target)?;
        if let Some(region) = &options.region {
            bounds = bounds.region(region)?;
        }
        if bounds.width == 0
            || bounds.height == 0
            || bounds.width as u64 * bounds.height as u64 > 80_000_000
        {
            return Err(BridgeError::new(
                "CAPTURE_FAILED",
                "Capture dimensions are outside supported limits",
            ));
        }
        let (width, height) = capture_dimensions(bounds, options.max_dimension.unwrap_or(1280));
        let pixels = capture_pixels(bounds, width, height)?;
        let mut bytes = Vec::new();
        let quality = (options.quality.unwrap_or(0.8) * 100.0).round() as u8;
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, quality)
            .encode_image(&pixels)
            .map_err(|e| BridgeError::new("CAPTURE_FAILED", e.to_string()))?;
        let cursor = cursor_point()
            .ok()
            .and_then(|point| bounds.normalize(&point));
        Ok(Captured {
            observation: Observation {
                id: id(),
                timestamp: timestamp(),
                target: options.target.clone(),
                region: options.region.clone(),
                native_width: bounds.width,
                native_height: bounds.height,
                width: pixels.width(),
                height: pixels.height(),
                mime_type: "image/jpeg".into(),
                image: format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)),
                foreground_window: unsafe { window_info(GetForegroundWindow()) },
                cursor,
            },
            pixels,
        })
    }
    fn monitors(&self) -> Result<Vec<Monitor>> {
        monitor_list()
    }
    fn windows(&self) -> Result<Vec<DesktopWindow>> {
        window_list()
    }
    fn cursor(&self) -> Result<Point> {
        cursor_point()
    }
}

fn capture_pixels(bounds: Bounds, width: u32, height: u32) -> Result<image::RgbImage> {
    unsafe {
        let screen = GetDC(null_mut());
        if screen.is_null() {
            return Err(failure(
                "CAPTURE_FAILED",
                "Could not access the interactive desktop",
            ));
        }
        let memory = CreateCompatibleDC(screen);
        if memory.is_null() {
            ReleaseDC(null_mut(), screen);
            return Err(failure(
                "CAPTURE_FAILED",
                "Could not create capture context",
            ));
        }
        let bitmap = CreateCompatibleBitmap(screen, width as i32, height as i32);
        if bitmap.is_null() {
            DeleteDC(memory);
            ReleaseDC(null_mut(), screen);
            return Err(failure(
                "CAPTURE_FAILED",
                "Could not allocate capture bitmap",
            ));
        }
        let old = SelectObject(memory, bitmap);
        let result = (|| {
            let copied = if width == bounds.width && height == bounds.height {
                BitBlt(
                    memory,
                    0,
                    0,
                    width as i32,
                    height as i32,
                    screen,
                    bounds.x,
                    bounds.y,
                    SRCCOPY | CAPTUREBLT,
                )
            } else {
                // Watches need small images. Scale in GDI before copying pixels to Rust.
                SetStretchBltMode(memory, HALFTONE as i32);
                SetBrushOrgEx(memory, 0, 0, null_mut());
                StretchBlt(
                    memory,
                    0,
                    0,
                    width as i32,
                    height as i32,
                    screen,
                    bounds.x,
                    bounds.y,
                    bounds.width as i32,
                    bounds.height as i32,
                    SRCCOPY | CAPTUREBLT,
                )
            };
            if copied == 0 {
                return Err(failure("CAPTURE_FAILED", "Desktop screenshot failed"));
            }
            SelectObject(memory, old);
            let mut info: BITMAPINFO = zeroed();
            info.bmiHeader.biSize = size_of::<BITMAPINFOHEADER>() as u32;
            info.bmiHeader.biWidth = width as i32;
            info.bmiHeader.biHeight = -(height as i32);
            info.bmiHeader.biPlanes = 1;
            info.bmiHeader.biBitCount = 32;
            info.bmiHeader.biCompression = BI_RGB;
            let mut bgra = vec![0u8; width as usize * height as usize * 4];
            if GetDIBits(
                memory,
                bitmap,
                0,
                height,
                bgra.as_mut_ptr() as *mut _,
                &mut info,
                DIB_RGB_COLORS,
            ) != height as i32
            {
                return Err(failure(
                    "CAPTURE_FAILED",
                    "Could not read screenshot pixels",
                ));
            }
            let mut rgb = Vec::with_capacity(width as usize * height as usize * 3);
            for pixel in bgra.chunks_exact(4) {
                rgb.extend_from_slice(&[pixel[2], pixel[1], pixel[0]]);
            }
            image::RgbImage::from_raw(width, height, rgb).ok_or_else(|| {
                BridgeError::new(
                    "CAPTURE_FAILED",
                    "Screenshot dimensions did not match pixel data",
                )
            })
        })();
        SelectObject(memory, old);
        DeleteObject(bitmap);
        DeleteDC(memory);
        ReleaseDC(null_mut(), screen);
        result
    }
}
