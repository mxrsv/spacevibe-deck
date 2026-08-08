use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePaneBounds {
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTerminalAppearance {
    pub font_family: String,
    pub font_size: f64,
    pub background: String,
    pub foreground: String,
    pub cursor: String,
    pub selection_background: String,
    pub normal: Vec<String>,
    pub bright: Vec<String>,
    pub opacity: f64,
    pub scrollback: u32,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativePaneFocusPayload {
    id: u32,
}

#[cfg(target_os = "windows")]
mod imp {
    use super::{NativePaneBounds, NativePaneFocusPayload, NativeTerminalAppearance};
    use crate::platform;
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};
    use std::process::{Child, Command};
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Mutex;
    use std::time::{Duration, Instant};
    use tauri::{AppHandle, Emitter, WebviewWindow};
    use windows_sys::core::BOOL;
    use windows_sys::Win32::Foundation::{HWND, LPARAM, POINT};
    use windows_sys::Win32::Graphics::Gdi::ClientToScreen;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        keybd_event, SetFocus, KEYEVENTF_KEYUP, VK_CONTROL, VK_END, VK_HOME, VK_NEXT, VK_PRIOR,
        VK_RETURN, VK_SHIFT,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetGUIThreadInfo, GetParent, GetWindow, GetWindowLongPtrW,
        GetWindowThreadProcessId, IsChild, IsWindow, IsWindowVisible, SetForegroundWindow,
        SetWindowLongPtrW, SetWindowPos, ShowWindow, GUITHREADINFO, GWLP_HWNDPARENT, GWL_EXSTYLE,
        GWL_STYLE, GW_OWNER, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOZORDER, SW_HIDE, SW_SHOW,
        WS_CAPTION, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_POPUP,
        WS_SYSMENU, WS_THICKFRAME,
    };

    const FIRST_NATIVE_PANE_ID: u32 = 0x8000_0000;
    const WINDOW_WAIT_TIMEOUT: Duration = Duration::from_secs(8);
    const WINDOW_POLL_INTERVAL: Duration = Duration::from_millis(25);

    struct NativePane {
        child: Child,
        hwnd: isize,
        config_path: PathBuf,
        config_contents: String,
    }

    pub struct NativeTerminalState {
        next_id: AtomicU32,
        panes: Mutex<HashMap<u32, NativePane>>,
    }

    impl Default for NativeTerminalState {
        fn default() -> Self {
            Self {
                next_id: AtomicU32::new(FIRST_NATIVE_PANE_ID),
                panes: Mutex::new(HashMap::new()),
            }
        }
    }

    impl NativeTerminalState {
        fn allocate_id(&self) -> Result<u32, String> {
            let id = self.next_id.fetch_add(1, Ordering::Relaxed);
            if id < FIRST_NATIVE_PANE_ID {
                return Err("Native pane id space is exhausted".to_string());
            }
            Ok(id)
        }

        pub fn terminate_all(&self) {
            let mut panes = match self.panes.lock() {
                Ok(panes) => panes,
                Err(poisoned) => poisoned.into_inner(),
            };
            for (_, pane) in panes.drain() {
                terminate(pane);
            }
        }
    }

    impl Drop for NativeTerminalState {
        fn drop(&mut self) {
            self.terminate_all();
        }
    }

    struct FindWindowContext {
        pid: u32,
        hwnd: HWND,
    }

    unsafe extern "system" fn find_process_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let context = &mut *(lparam as *mut FindWindowContext);
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        // Alacritty owns several OpenGL/winit helper windows. The real terminal
        // surface consistently uses `Window Class`; the earlier visible
        // `Winit Thread Event Target` is only a message/event helper.
        let mut class_name = [0u16; 64];
        let class_len = GetClassNameW(hwnd, class_name.as_mut_ptr(), class_name.len() as i32);
        let is_terminal = class_len > 0
            && String::from_utf16_lossy(&class_name[..class_len as usize]) == "Window Class";
        if pid == context.pid
            && GetParent(hwnd).is_null()
            && IsWindowVisible(hwnd) != 0
            && is_terminal
        {
            context.hwnd = hwnd;
            return 0;
        }
        1
    }

    fn top_level_window(pid: u32) -> Option<HWND> {
        let mut context = FindWindowContext {
            pid,
            hwnd: std::ptr::null_mut(),
        };
        unsafe {
            EnumWindows(
                Some(find_process_window),
                &mut context as *mut FindWindowContext as LPARAM,
            );
        }
        (!context.hwnd.is_null()).then_some(context.hwnd)
    }

    fn wait_for_window(child: &mut Child) -> Result<HWND, String> {
        let deadline = Instant::now() + WINDOW_WAIT_TIMEOUT;
        loop {
            if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
                return Err(format!(
                    "Alacritty exited before its window was ready ({status})"
                ));
            }
            if let Some(hwnd) = top_level_window(child.id()) {
                return Ok(hwnd);
            }
            if Instant::now() >= deadline {
                return Err("Timed out waiting for the Alacritty window".to_string());
            }
            std::thread::sleep(WINDOW_POLL_INTERVAL);
        }
    }

    fn attach_overlay(hwnd: HWND, owner: HWND) -> Result<(), String> {
        unsafe {
            ShowWindow(hwnd, SW_HIDE);
            let old_style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
            let remove = WS_POPUP
                | WS_CAPTION
                | WS_THICKFRAME
                | WS_SYSMENU
                | WS_MINIMIZEBOX
                | WS_MAXIMIZEBOX;
            // Alacritty's OpenGL surface renders black after WS_CHILD
            // reparenting. Keep it as a borderless popup owned by SpaceVibe:
            // owned windows stay above/minimize with their owner, while the
            // frontend explicitly hides them for tabs and WebView overlays.
            let style = (old_style & !remove) | WS_POPUP;
            SetWindowLongPtrW(hwnd, GWL_STYLE, style as isize);
            let old_ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
            let ex_style = (old_ex_style & !WS_EX_APPWINDOW) | WS_EX_TOOLWINDOW;
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex_style as isize);
            SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, owner as isize);
            if GetWindow(hwnd, GW_OWNER) != owner {
                return Err("Windows refused to attach Alacritty to the app".to_string());
            }
            if SetWindowPos(
                hwnd,
                std::ptr::null_mut(),
                0,
                0,
                1,
                1,
                SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOZORDER,
            ) == 0
            {
                return Err("Failed to initialize the embedded Alacritty window".to_string());
            }
        }
        Ok(())
    }

    fn terminate(mut pane: NativePane) {
        unsafe {
            if IsWindow(pane.hwnd as HWND) != 0 {
                ShowWindow(pane.hwnd as HWND, SW_HIDE);
            }
        }
        let _ = pane.child.kill();
        let _ = pane.child.wait();
        let _ = std::fs::remove_file(pane.config_path);
    }

    fn valid_color(value: &str) -> bool {
        value.len() == 7
            && value.starts_with('#')
            && value[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
    }

    fn validate_appearance(value: &NativeTerminalAppearance) -> Result<(), String> {
        if value.font_family.trim().is_empty()
            || !value.font_size.is_finite()
            || !(6.0..=72.0).contains(&value.font_size)
            || !value.opacity.is_finite()
            || !(0.4..=1.0).contains(&value.opacity)
            || value.normal.len() != 8
            || value.bright.len() != 8
            || ![
                &value.background,
                &value.foreground,
                &value.cursor,
                &value.selection_background,
            ]
            .into_iter()
            .all(|color| valid_color(color))
            || !value.normal.iter().all(|color| valid_color(color))
            || !value.bright.iter().all(|color| valid_color(color))
        {
            return Err("Invalid Alacritty appearance settings".to_string());
        }
        Ok(())
    }

    fn config_contents(value: &NativeTerminalAppearance) -> Result<String, String> {
        validate_appearance(value)?;
        let family =
            serde_json::to_string(value.font_family.trim()).map_err(|error| error.to_string())?;
        let names = [
            "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
        ];
        let colors = |values: &[String]| {
            names
                .iter()
                .zip(values)
                .map(|(name, color)| format!("{name} = \"{color}\""))
                .collect::<Vec<_>>()
                .join("\n")
        };
        Ok(format!(
            "live_config_reload = true\n\n[window]\nopacity = {:.3}\ndecorations = \"None\"\n\n[scrolling]\nhistory = {}\n\n[font]\nsize = {:.2}\n\n[font.normal]\nfamily = {}\nstyle = \"Regular\"\n\n[colors.primary]\nbackground = \"{}\"\nforeground = \"{}\"\n\n[colors.cursor]\ntext = \"{}\"\ncursor = \"{}\"\n\n[colors.selection]\ntext = \"CellForeground\"\nbackground = \"{}\"\n\n[colors.normal]\n{}\n\n[colors.bright]\n{}\n",
            value.opacity,
            value.scrollback,
            value.font_size,
            family,
            value.background,
            value.foreground,
            value.background,
            value.cursor,
            value.selection_background,
            colors(&value.normal),
            colors(&value.bright),
        ))
    }

    fn runtime_config_path(id: u32) -> Result<PathBuf, String> {
        let executable = std::env::current_exe().map_err(|error| error.to_string())?;
        let root = executable
            .parent()
            .ok_or("Couldn't locate the SpaceVibe installation directory")?
            .join(".spacevibe-runtime")
            .join("alacritty");
        std::fs::create_dir_all(&root)
            .map_err(|error| format!("Couldn't create Alacritty runtime directory: {error}"))?;
        Ok(root.join(format!("pane-{id}.toml")))
    }

    fn write_config(path: &Path, contents: &str) -> Result<(), String> {
        let pending = path.with_extension("toml.pending");
        if let Err(error) = std::fs::write(&pending, contents) {
            let _ = std::fs::remove_file(&pending);
            return Err(format!("Couldn't write Alacritty configuration: {error}"));
        }
        if path.exists() {
            if let Err(error) = std::fs::remove_file(path) {
                let _ = std::fs::remove_file(&pending);
                return Err(format!("Couldn't replace Alacritty configuration: {error}"));
            }
        }
        if let Err(error) = std::fs::rename(&pending, path) {
            let _ = std::fs::remove_file(&pending);
            return Err(format!(
                "Couldn't activate Alacritty configuration: {error}"
            ));
        }
        Ok(())
    }

    fn monitor_focus(app: AppHandle, id: u32, hwnd: HWND) {
        let hwnd = hwnd as isize;
        std::thread::spawn(move || {
            let hwnd = hwnd as HWND;
            let thread_id = unsafe { GetWindowThreadProcessId(hwnd, std::ptr::null_mut()) };
            let mut had_focus = false;
            while unsafe { IsWindow(hwnd) } != 0 {
                let mut info = GUITHREADINFO {
                    cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
                    flags: 0,
                    hwndActive: std::ptr::null_mut(),
                    hwndFocus: std::ptr::null_mut(),
                    hwndCapture: std::ptr::null_mut(),
                    hwndMenuOwner: std::ptr::null_mut(),
                    hwndMoveSize: std::ptr::null_mut(),
                    hwndCaret: std::ptr::null_mut(),
                    rcCaret: Default::default(),
                };
                let focused = unsafe { GetGUIThreadInfo(thread_id, &mut info) } != 0
                    && (info.hwndFocus == hwnd
                        || (!info.hwndFocus.is_null()
                            && unsafe { IsChild(hwnd, info.hwndFocus) } != 0));
                if focused && !had_focus {
                    let _ = app.emit("native-terminal:focus", NativePaneFocusPayload { id });
                }
                had_focus = focused;
                std::thread::sleep(Duration::from_millis(100));
            }
        });
    }

    fn validate_bounds(bounds: NativePaneBounds) -> Result<(), String> {
        if !bounds.left.is_finite()
            || !bounds.top.is_finite()
            || !bounds.width.is_finite()
            || !bounds.height.is_finite()
            || bounds.width < 0.0
            || bounds.height < 0.0
        {
            return Err("Invalid native pane bounds".to_string());
        }
        Ok(())
    }

    pub async fn spawn(
        app: AppHandle,
        window: WebviewWindow,
        state: tauri::State<'_, NativeTerminalState>,
        cwd: Option<String>,
        appearance: NativeTerminalAppearance,
    ) -> Result<u32, String> {
        let id = state.allocate_id()?;
        let parent = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
        let executable = platform::windows::find_alacritty_executable()?;
        let cwd = cwd
            .map(std::path::PathBuf::from)
            .filter(|path| path.is_dir())
            .unwrap_or(platform::user_home()?);
        let config_path = runtime_config_path(id)?;
        let config = config_contents(&appearance)?;
        write_config(&config_path, &config)?;

        let pane = tauri::async_runtime::spawn_blocking(move || {
            let mut child = match Command::new(executable)
                .arg("--config-file")
                .arg(&config_path)
                .arg("--working-directory")
                .arg(&cwd)
                .current_dir(&cwd)
                .spawn()
            {
                Ok(child) => child,
                Err(error) => {
                    let _ = std::fs::remove_file(&config_path);
                    return Err(format!("Failed to launch Alacritty: {error}"));
                }
            };
            let hwnd = match wait_for_window(&mut child) {
                Ok(hwnd) => hwnd,
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = std::fs::remove_file(&config_path);
                    return Err(error);
                }
            };
            if let Err(error) = attach_overlay(hwnd, parent as HWND) {
                let _ = child.kill();
                let _ = child.wait();
                let _ = std::fs::remove_file(&config_path);
                return Err(error);
            }
            Ok(NativePane {
                child,
                hwnd: hwnd as isize,
                config_path,
                config_contents: config,
            })
        })
        .await
        .map_err(|error| format!("Alacritty launch task failed: {error}"))??;

        let hwnd = pane.hwnd;
        match state.panes.lock() {
            Ok(mut panes) => {
                panes.insert(id, pane);
            }
            Err(_) => {
                terminate(pane);
                return Err("Native terminal state is unavailable".to_string());
            }
        }
        monitor_focus(app, id, hwnd as HWND);
        Ok(id)
    }

    pub fn apply_appearance(
        state: tauri::State<'_, NativeTerminalState>,
        id: u32,
        appearance: NativeTerminalAppearance,
    ) -> Result<(), String> {
        let contents = config_contents(&appearance)?;
        let mut panes = state
            .panes
            .lock()
            .map_err(|_| "Native terminal state is unavailable".to_string())?;
        let pane = panes
            .get_mut(&id)
            .ok_or_else(|| format!("Unknown native pane {id}"))?;
        if pane.config_contents == contents {
            return Ok(());
        }
        write_config(&pane.config_path, &contents)?;
        pane.config_contents = contents;
        Ok(())
    }

    fn send_chord(hwnd: HWND, modifiers: &[u16], key: u16) {
        unsafe {
            SetForegroundWindow(hwnd);
            SetFocus(hwnd);
            for modifier in modifiers {
                keybd_event(*modifier as u8, 0, 0, 0);
            }
            keybd_event(key as u8, 0, 0, 0);
            keybd_event(key as u8, 0, KEYEVENTF_KEYUP, 0);
            for modifier in modifiers.iter().rev() {
                keybd_event(*modifier as u8, 0, KEYEVENTF_KEYUP, 0);
            }
        }
    }

    pub fn perform_action(
        state: tauri::State<'_, NativeTerminalState>,
        id: u32,
        action: String,
    ) -> Result<(), String> {
        let panes = state
            .panes
            .lock()
            .map_err(|_| "Native terminal state is unavailable".to_string())?;
        let pane = panes
            .get(&id)
            .ok_or_else(|| format!("Unknown native pane {id}"))?;
        let hwnd = pane.hwnd as HWND;
        match action.as_str() {
            "copy" => send_chord(hwnd, &[VK_CONTROL, VK_SHIFT], b'C' as u16),
            "paste" => send_chord(hwnd, &[VK_CONTROL, VK_SHIFT], b'V' as u16),
            "search" => send_chord(hwnd, &[VK_CONTROL, VK_SHIFT], b'F' as u16),
            "search-next" => send_chord(hwnd, &[], VK_RETURN),
            "search-previous" => send_chord(hwnd, &[VK_SHIFT], VK_RETURN),
            "clear" => send_chord(hwnd, &[VK_CONTROL], b'L' as u16),
            "page-up" => send_chord(hwnd, &[VK_SHIFT], VK_PRIOR),
            "page-down" => send_chord(hwnd, &[VK_SHIFT], VK_NEXT),
            "scroll-top" => send_chord(hwnd, &[VK_CONTROL, VK_SHIFT], VK_HOME),
            "scroll-bottom" => send_chord(hwnd, &[VK_CONTROL, VK_SHIFT], VK_END),
            _ => return Err(format!("Unknown Alacritty action {action}")),
        }
        Ok(())
    }

    pub fn update(
        window: WebviewWindow,
        state: tauri::State<'_, NativeTerminalState>,
        id: u32,
        bounds: NativePaneBounds,
        visible: bool,
    ) -> Result<(), String> {
        validate_bounds(bounds)?;
        let scale = window.scale_factor().map_err(|error| error.to_string())?;
        let mut panes = state
            .panes
            .lock()
            .map_err(|_| "Native terminal state is unavailable".to_string())?;
        let pane = panes
            .get_mut(&id)
            .ok_or_else(|| format!("Unknown native pane {id}"))?;
        if pane
            .child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_some()
        {
            let pane = panes.remove(&id);
            drop(panes);
            if let Some(pane) = pane {
                let _ = std::fs::remove_file(pane.config_path);
            }
            return Err("Alacritty exited".to_string());
        }
        let hwnd = pane.hwnd as HWND;
        if unsafe { IsWindow(hwnd) } == 0 {
            panes.remove(&id);
            return Err("The embedded Alacritty window is no longer available".to_string());
        }
        if !visible || bounds.width < 1.0 || bounds.height < 1.0 {
            unsafe { ShowWindow(hwnd, SW_HIDE) };
            return Ok(());
        }
        let x = (bounds.left * scale).round() as i32;
        let y = (bounds.top * scale).round() as i32;
        let width = (bounds.width * scale).round().max(1.0) as i32;
        let height = (bounds.height * scale).round().max(1.0) as i32;
        unsafe {
            let parent = window.hwnd().map_err(|error| error.to_string())?.0;
            let mut origin = POINT { x: 0, y: 0 };
            if ClientToScreen(parent, &mut origin) == 0 {
                return Err("Failed to locate the SpaceVibe client area".to_string());
            }
            if SetWindowPos(
                hwnd,
                std::ptr::null_mut(),
                origin.x + x,
                origin.y + y,
                width,
                height,
                SWP_NOACTIVATE | SWP_NOZORDER,
            ) == 0
            {
                return Err("Failed to resize the embedded Alacritty window".to_string());
            }
            ShowWindow(hwnd, SW_SHOW);
        }
        Ok(())
    }

    pub fn focus(state: tauri::State<'_, NativeTerminalState>, id: u32) -> Result<(), String> {
        let panes = state
            .panes
            .lock()
            .map_err(|_| "Native terminal state is unavailable".to_string())?;
        let pane = panes
            .get(&id)
            .ok_or_else(|| format!("Unknown native pane {id}"))?;
        let hwnd = pane.hwnd as HWND;
        unsafe {
            ShowWindow(hwnd, SW_SHOW);
            SetForegroundWindow(hwnd);
            SetFocus(hwnd);
        }
        Ok(())
    }

    pub fn kill(state: tauri::State<'_, NativeTerminalState>, id: u32) -> Result<(), String> {
        let pane = state
            .panes
            .lock()
            .map_err(|_| "Native terminal state is unavailable".to_string())?
            .remove(&id);
        if let Some(pane) = pane {
            terminate(pane);
        }
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn appearance() -> NativeTerminalAppearance {
            NativeTerminalAppearance {
                font_family: "Cascadia Mono".to_string(),
                font_size: 10.5,
                background: "#16161e".to_string(),
                foreground: "#c0caf5".to_string(),
                cursor: "#c0caf5".to_string(),
                selection_background: "#33467c".to_string(),
                normal: vec!["#111111".to_string(); 8],
                bright: vec!["#eeeeee".to_string(); 8],
                opacity: 0.9,
                scrollback: 10_000,
            }
        }

        #[test]
        fn generated_config_contains_spacevibe_appearance() {
            let config = config_contents(&appearance()).unwrap();
            assert!(config.contains("family = \"Cascadia Mono\""));
            assert!(config.contains("opacity = 0.900"));
            assert!(config.contains("history = 10000"));
            assert!(config.contains("background = \"#16161e\""));
        }

        #[test]
        fn invalid_colors_and_palette_lengths_are_rejected() {
            let mut value = appearance();
            value.background = "red".to_string();
            assert!(config_contents(&value).is_err());
            value = appearance();
            value.normal.pop();
            assert!(config_contents(&value).is_err());
        }

        #[test]
        fn font_family_is_escaped_as_a_toml_string() {
            let mut value = appearance();
            value.font_family = "A \"quoted\" font".to_string();
            let config = config_contents(&value).unwrap();
            assert!(config.contains("family = \"A \\\"quoted\\\" font\""));
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod imp {
    use super::{NativePaneBounds, NativeTerminalAppearance};
    use tauri::WebviewWindow;

    #[derive(Default)]
    pub struct NativeTerminalState;

    impl NativeTerminalState {
        pub fn terminate_all(&self) {}
    }

    pub async fn spawn(
        _app: tauri::AppHandle,
        _window: WebviewWindow,
        _state: tauri::State<'_, NativeTerminalState>,
        _cwd: Option<String>,
        _appearance: NativeTerminalAppearance,
    ) -> Result<u32, String> {
        Err("Native Alacritty panes are only supported on Windows".to_string())
    }

    pub fn apply_appearance(
        _state: tauri::State<'_, NativeTerminalState>,
        _id: u32,
        _appearance: NativeTerminalAppearance,
    ) -> Result<(), String> {
        Err("Native Alacritty panes are only supported on Windows".to_string())
    }

    pub fn perform_action(
        _state: tauri::State<'_, NativeTerminalState>,
        _id: u32,
        _action: String,
    ) -> Result<(), String> {
        Err("Native Alacritty panes are only supported on Windows".to_string())
    }

    pub fn update(
        _window: WebviewWindow,
        _state: tauri::State<'_, NativeTerminalState>,
        _id: u32,
        _bounds: NativePaneBounds,
        _visible: bool,
    ) -> Result<(), String> {
        Err("Native Alacritty panes are only supported on Windows".to_string())
    }

    pub fn focus(_state: tauri::State<'_, NativeTerminalState>, _id: u32) -> Result<(), String> {
        Err("Native Alacritty panes are only supported on Windows".to_string())
    }

    pub fn kill(_state: tauri::State<'_, NativeTerminalState>, _id: u32) -> Result<(), String> {
        Ok(())
    }
}

pub use imp::NativeTerminalState;

#[tauri::command]
pub async fn spawn_alacritty(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, NativeTerminalState>,
    cwd: Option<String>,
    appearance: NativeTerminalAppearance,
) -> Result<u32, String> {
    imp::spawn(app, window, state, cwd, appearance).await
}

#[tauri::command]
pub fn apply_alacritty_appearance(
    state: tauri::State<'_, NativeTerminalState>,
    id: u32,
    appearance: NativeTerminalAppearance,
) -> Result<(), String> {
    imp::apply_appearance(state, id, appearance)
}

#[tauri::command]
pub fn perform_alacritty_action(
    state: tauri::State<'_, NativeTerminalState>,
    id: u32,
    action: String,
) -> Result<(), String> {
    imp::perform_action(state, id, action)
}

#[tauri::command]
pub fn update_alacritty(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, NativeTerminalState>,
    id: u32,
    bounds: NativePaneBounds,
    visible: bool,
) -> Result<(), String> {
    imp::update(window, state, id, bounds, visible)
}

#[tauri::command]
pub fn focus_alacritty(
    state: tauri::State<'_, NativeTerminalState>,
    id: u32,
) -> Result<(), String> {
    imp::focus(state, id)
}

#[tauri::command]
pub fn kill_alacritty(state: tauri::State<'_, NativeTerminalState>, id: u32) -> Result<(), String> {
    imp::kill(state, id)
}
