use super::{NativePaneBounds, NativePaneFocusPayload, NativeTerminalAppearance};
use crate::platform;
use std::collections::HashMap;
use std::ffi::{c_char, c_void, CString};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::ptr;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, WebviewWindow};

type CFTypeRef = *const c_void;
type CFStringRef = *const c_void;
type CFArrayRef = *const c_void;
type CFBooleanRef = *const c_void;
type CFDictionaryRef = *const c_void;
type AXUIElementRef = *const c_void;
type AXValueRef = *const c_void;
type CGEventRef = *mut c_void;
type CFIndex = isize;
type AXError = i32;

const AX_SUCCESS: AXError = 0;
const K_CFSTRING_ENCODING_UTF8: u32 = 0x0800_0100;
const K_AX_VALUE_CGPOINT_TYPE: u32 = 1;
const K_AX_VALUE_CGSIZE_TYPE: u32 = 2;
const K_CG_HID_EVENT_TAP: u32 = 0;
const FIRST_NATIVE_PANE_ID: u32 = 0x8000_0000;
const WINDOW_WAIT_TIMEOUT: Duration = Duration::from_secs(8);
const WINDOW_POLL_INTERVAL: Duration = Duration::from_millis(40);
const HIDDEN_ORIGIN: f64 = -32_000.0;

const FLAG_SHIFT: u64 = 0x0002_0000;
const FLAG_COMMAND: u64 = 0x0010_0000;

const KEY_C: u16 = 8;
const KEY_V: u16 = 9;
const KEY_F: u16 = 3;
const KEY_K: u16 = 40;
const KEY_RETURN: u16 = 36;
const KEY_HOME: u16 = 115;
const KEY_END: u16 = 119;
const KEY_PAGE_UP: u16 = 116;
const KEY_PAGE_DOWN: u16 = 121;

#[repr(C)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
struct CGSize {
    width: f64,
    height: f64,
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    static kCFBooleanTrue: CFBooleanRef;
    fn CFStringCreateWithCString(
        allocator: *const c_void,
        bytes: *const c_char,
        encoding: u32,
    ) -> CFStringRef;
    fn CFRelease(value: CFTypeRef);
    fn CFRetain(value: CFTypeRef) -> CFTypeRef;
    fn CFArrayGetCount(array: CFArrayRef) -> CFIndex;
    fn CFArrayGetValueAtIndex(array: CFArrayRef, index: CFIndex) -> *const c_void;
    fn CFBooleanGetValue(value: CFBooleanRef) -> bool;
    fn CFDictionaryCreate(
        allocator: *const c_void,
        keys: *const *const c_void,
        values: *const *const c_void,
        count: CFIndex,
        key_callbacks: *const c_void,
        value_callbacks: *const c_void,
    ) -> CFDictionaryRef;
}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    static kAXTrustedCheckOptionPrompt: CFStringRef;
    fn AXIsProcessTrusted() -> bool;
    fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> bool;
    fn AXUIElementCreateApplication(pid: libc::pid_t) -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: *mut CFTypeRef,
    ) -> AXError;
    fn AXUIElementSetAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: CFTypeRef,
    ) -> AXError;
    fn AXUIElementPerformAction(element: AXUIElementRef, action: CFStringRef) -> AXError;
    fn AXValueCreate(value_type: u32, value: *const c_void) -> AXValueRef;
    fn CGEventCreateKeyboardEvent(
        source: *const c_void,
        virtual_key: u16,
        key_down: bool,
    ) -> CGEventRef;
    fn CGEventSetFlags(event: CGEventRef, flags: u64);
    fn CGEventPost(tap: u32, event: CGEventRef);
}

fn accessibility_trusted(prompt: bool) -> bool {
    if unsafe { AXIsProcessTrusted() } {
        return true;
    }
    if !prompt {
        return false;
    }
    let key = unsafe { kAXTrustedCheckOptionPrompt };
    let value = unsafe { kCFBooleanTrue };
    let options =
        unsafe { CFDictionaryCreate(ptr::null(), &key, &value, 1, ptr::null(), ptr::null()) };
    if options.is_null() {
        return false;
    }
    let trusted = unsafe { AXIsProcessTrustedWithOptions(options) };
    unsafe { CFRelease(options) };
    trusted
}

struct NativePane {
    child: Child,
    ax_window: usize,
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

fn with_cf_string<T>(value: &str, use_value: impl FnOnce(CFStringRef) -> T) -> Result<T, String> {
    let bytes = CString::new(value).map_err(|_| "Invalid Accessibility attribute".to_string())?;
    let string =
        unsafe { CFStringCreateWithCString(ptr::null(), bytes.as_ptr(), K_CFSTRING_ENCODING_UTF8) };
    if string.is_null() {
        return Err("Couldn't create an Accessibility attribute".to_string());
    }
    let result = use_value(string);
    unsafe { CFRelease(string) };
    Ok(result)
}

fn ax_copy(element: AXUIElementRef, attribute: &str) -> Result<CFTypeRef, AXError> {
    let mut value: CFTypeRef = ptr::null();
    let error = with_cf_string(attribute, |name| unsafe {
        AXUIElementCopyAttributeValue(element, name, &mut value)
    })
    .map_err(|_| -1)?;
    if error == AX_SUCCESS && !value.is_null() {
        Ok(value)
    } else {
        Err(error)
    }
}

fn ax_set(element: AXUIElementRef, attribute: &str, value: CFTypeRef) -> Result<(), String> {
    let error = with_cf_string(attribute, |name| unsafe {
        AXUIElementSetAttributeValue(element, name, value)
    })?;
    if error == AX_SUCCESS {
        Ok(())
    } else {
        Err(format!(
            "macOS Accessibility rejected {attribute} ({error})"
        ))
    }
}

fn ax_action(element: AXUIElementRef, action: &str) -> Result<(), String> {
    let error = with_cf_string(action, |name| unsafe {
        AXUIElementPerformAction(element, name)
    })?;
    if error == AX_SUCCESS {
        Ok(())
    } else {
        Err(format!("macOS Accessibility rejected {action} ({error})"))
    }
}

fn first_process_window(pid: u32) -> Result<Option<usize>, String> {
    let app = unsafe { AXUIElementCreateApplication(pid as libc::pid_t) };
    if app.is_null() {
        return Err("Couldn't inspect the Alacritty application".to_string());
    }
    let windows = match ax_copy(app, "AXWindows") {
        Ok(windows) => windows as CFArrayRef,
        Err(_) => {
            unsafe { CFRelease(app) };
            return Ok(None);
        }
    };
    let window = if unsafe { CFArrayGetCount(windows) } > 0 {
        let value = unsafe { CFArrayGetValueAtIndex(windows, 0) };
        (!value.is_null()).then(|| unsafe { CFRetain(value) } as usize)
    } else {
        None
    };
    unsafe {
        CFRelease(windows);
        CFRelease(app);
    }
    Ok(window)
}

fn wait_for_window(child: &mut Child) -> Result<usize, String> {
    if !accessibility_trusted(true) {
        return Err(
            "SpaceVibe needs Accessibility access in System Settings to embed Alacritty"
                .to_string(),
        );
    }
    let deadline = Instant::now() + WINDOW_WAIT_TIMEOUT;
    loop {
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            return Err(format!(
                "Alacritty exited before its window was ready ({status})"
            ));
        }
        if let Some(window) = first_process_window(child.id())? {
            return Ok(window);
        }
        if Instant::now() >= deadline {
            return Err("Timed out waiting for the Alacritty window".to_string());
        }
        std::thread::sleep(WINDOW_POLL_INTERVAL);
    }
}

fn set_frame(window: usize, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    let point = CGPoint { x, y };
    let size = CGSize { width, height };
    let point_value = unsafe {
        AXValueCreate(
            K_AX_VALUE_CGPOINT_TYPE,
            &point as *const CGPoint as *const c_void,
        )
    };
    let size_value = unsafe {
        AXValueCreate(
            K_AX_VALUE_CGSIZE_TYPE,
            &size as *const CGSize as *const c_void,
        )
    };
    if point_value.is_null() || size_value.is_null() {
        if !point_value.is_null() {
            unsafe { CFRelease(point_value) };
        }
        if !size_value.is_null() {
            unsafe { CFRelease(size_value) };
        }
        return Err("Couldn't create Alacritty window geometry".to_string());
    }
    let element = window as AXUIElementRef;
    let position_result = ax_set(element, "AXPosition", point_value);
    let size_result = ax_set(element, "AXSize", size_value);
    unsafe {
        CFRelease(point_value);
        CFRelease(size_value);
    }
    position_result?;
    size_result
}

fn hide_window(window: usize) {
    let _ = set_frame(window, HIDDEN_ORIGIN, HIDDEN_ORIGIN, 1.0, 1.0);
}

fn process_alive(pid: u32) -> bool {
    (unsafe { libc::kill(pid as libc::pid_t, 0) }) == 0
}

fn focused(window: usize) -> bool {
    let Ok(value) = ax_copy(window as AXUIElementRef, "AXFocused") else {
        return false;
    };
    let result = unsafe { CFBooleanGetValue(value as CFBooleanRef) };
    unsafe { CFRelease(value) };
    result
}

fn monitor_focus(app: AppHandle, id: u32, pid: u32, window: usize) {
    unsafe { CFRetain(window as CFTypeRef) };
    std::thread::spawn(move || {
        let mut had_focus = false;
        while process_alive(pid) {
            let has_focus = focused(window);
            if has_focus && !had_focus {
                let _ = app.emit("native-terminal:focus", NativePaneFocusPayload { id });
            }
            had_focus = has_focus;
            std::thread::sleep(Duration::from_millis(100));
        }
        unsafe { CFRelease(window as CFTypeRef) };
    });
}

fn focus_window(pane: &NativePane) -> Result<(), String> {
    let app = unsafe { AXUIElementCreateApplication(pane.child.id() as libc::pid_t) };
    if app.is_null() {
        return Err("Couldn't focus the Alacritty application".to_string());
    }
    let frontmost = unsafe { kCFBooleanTrue };
    let front_result = ax_set(app, "AXFrontmost", frontmost);
    unsafe { CFRelease(app) };
    front_result?;
    let window = pane.ax_window as AXUIElementRef;
    ax_set(window, "AXMain", frontmost)?;
    ax_set(window, "AXFocused", frontmost)?;
    ax_action(window, "AXRaise")
}

fn send_key(key: u16, flags: u64) -> Result<(), String> {
    let down = unsafe { CGEventCreateKeyboardEvent(ptr::null(), key, true) };
    let up = unsafe { CGEventCreateKeyboardEvent(ptr::null(), key, false) };
    if down.is_null() || up.is_null() {
        if !down.is_null() {
            unsafe { CFRelease(down) };
        }
        if !up.is_null() {
            unsafe { CFRelease(up) };
        }
        return Err("Couldn't create a native Alacritty shortcut".to_string());
    }
    unsafe {
        CGEventSetFlags(down, flags);
        CGEventSetFlags(up, flags);
        CGEventPost(K_CG_HID_EVENT_TAP, down);
        CGEventPost(K_CG_HID_EVENT_TAP, up);
        CFRelease(down);
        CFRelease(up);
    }
    Ok(())
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
        "live_config_reload = true\n\n[window]\nopacity = {:.3}\ndecorations = \"None\"\n\n[scrolling]\nhistory = {}\n\n[font]\nsize = {:.2}\n\n[font.normal]\nfamily = {}\nstyle = \"Regular\"\n\n[colors.primary]\nbackground = \"{}\"\nforeground = \"{}\"\n\n[colors.cursor]\ntext = \"{}\"\ncursor = \"{}\"\n\n[colors.selection]\ntext = \"CellForeground\"\nbackground = \"{}\"\n\n[colors.normal]\n{}\n\n[colors.bright]\n{}\n\n[keyboard]\nbindings = [\n  {{ key = \"C\", mods = \"Command\", action = \"Copy\" }},\n  {{ key = \"V\", mods = \"Command\", action = \"Paste\" }},\n  {{ key = \"F\", mods = \"Command\", action = \"SearchForward\" }},\n  {{ key = \"K\", mods = \"Command\", action = \"ClearHistory\" }},\n  {{ key = \"PageUp\", mods = \"Shift\", action = \"ScrollPageUp\" }},\n  {{ key = \"PageDown\", mods = \"Shift\", action = \"ScrollPageDown\" }},\n  {{ key = \"Home\", mods = \"Command|Shift\", action = \"ScrollToTop\" }},\n  {{ key = \"End\", mods = \"Command|Shift\", action = \"ScrollToBottom\" }},\n]\n",
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
    let root = std::env::temp_dir()
        .join("spacevibe-deck")
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

fn terminate(mut pane: NativePane) {
    hide_window(pane.ax_window);
    let _ = pane.child.kill();
    let _ = pane.child.wait();
    unsafe { CFRelease(pane.ax_window as CFTypeRef) };
    let _ = std::fs::remove_file(pane.config_path);
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
    _window: WebviewWindow,
    state: tauri::State<'_, NativeTerminalState>,
    cwd: Option<String>,
    appearance: NativeTerminalAppearance,
) -> Result<u32, String> {
    let id = state.allocate_id()?;
    let executable = platform::macos::find_alacritty_executable()?;
    let cwd = cwd
        .map(PathBuf::from)
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
        let ax_window = match wait_for_window(&mut child) {
            Ok(window) => window,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = std::fs::remove_file(&config_path);
                return Err(error);
            }
        };
        hide_window(ax_window);
        Ok(NativePane {
            child,
            ax_window,
            config_path,
            config_contents: config,
        })
    })
    .await
    .map_err(|error| format!("Alacritty launch task failed: {error}"))??;

    let pid = pane.child.id();
    let ax_window = pane.ax_window;
    match state.panes.lock() {
        Ok(mut panes) => {
            panes.insert(id, pane);
        }
        Err(_) => {
            terminate(pane);
            return Err("Native terminal state is unavailable".to_string());
        }
    }
    monitor_focus(app, id, pid, ax_window);
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
    focus_window(pane)?;
    match action.as_str() {
        "copy" => send_key(KEY_C, FLAG_COMMAND),
        "paste" => send_key(KEY_V, FLAG_COMMAND),
        "search" => send_key(KEY_F, FLAG_COMMAND),
        "search-next" => send_key(KEY_RETURN, 0),
        "search-previous" => send_key(KEY_RETURN, FLAG_SHIFT),
        "clear" => send_key(KEY_K, FLAG_COMMAND),
        "page-up" => send_key(KEY_PAGE_UP, FLAG_SHIFT),
        "page-down" => send_key(KEY_PAGE_DOWN, FLAG_SHIFT),
        "scroll-top" => send_key(KEY_HOME, FLAG_COMMAND | FLAG_SHIFT),
        "scroll-bottom" => send_key(KEY_END, FLAG_COMMAND | FLAG_SHIFT),
        _ => Err(format!("Unknown Alacritty action {action}")),
    }
}

pub fn update(
    window: WebviewWindow,
    state: tauri::State<'_, NativeTerminalState>,
    id: u32,
    bounds: NativePaneBounds,
    visible: bool,
) -> Result<(), String> {
    validate_bounds(bounds)?;
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
            unsafe { CFRelease(pane.ax_window as CFTypeRef) };
            let _ = std::fs::remove_file(pane.config_path);
        }
        return Err("Alacritty exited".to_string());
    }
    let covered = !visible
        || bounds.width < 1.0
        || bounds.height < 1.0
        || window.is_minimized().unwrap_or(false)
        || !window.is_visible().unwrap_or(true);
    if covered {
        hide_window(pane.ax_window);
        return Ok(());
    }
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let origin = window
        .inner_position()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale);
    set_frame(
        pane.ax_window,
        origin.x + bounds.left,
        origin.y + bounds.top,
        bounds.width.max(1.0),
        bounds.height.max(1.0),
    )?;
    ax_action(pane.ax_window as AXUIElementRef, "AXRaise")
}

pub fn focus(state: tauri::State<'_, NativeTerminalState>, id: u32) -> Result<(), String> {
    let panes = state
        .panes
        .lock()
        .map_err(|_| "Native terminal state is unavailable".to_string())?;
    let pane = panes
        .get(&id)
        .ok_or_else(|| format!("Unknown native pane {id}"))?;
    focus_window(pane)
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
            font_family: "SF Mono".to_string(),
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
    fn generated_config_has_macos_bindings_and_appearance() {
        let config = config_contents(&appearance()).unwrap();
        assert!(config.contains("family = \"SF Mono\""));
        assert!(config.contains("mods = \"Command\""));
        assert!(config.contains("action = \"ScrollToTop\""));
        assert!(config.contains("decorations = \"None\""));
    }

    #[test]
    fn invalid_appearance_is_rejected() {
        let mut value = appearance();
        value.opacity = 0.1;
        assert!(config_contents(&value).is_err());
    }
}
