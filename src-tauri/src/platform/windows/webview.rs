//! WebView2 hardening applied after the window exists.
//!
//! Tauri 2.11.5 exposes no builder flag for this: wry declares
//! `with_browser_accelerator_keys` but `tauri-runtime-wry` does not forward it,
//! so wry's `true` default stands and Ctrl+R / F5 (Reload), Ctrl+F / F3 (Find)
//! and Ctrl+P (Print) stay live. A reload destroys every tab and pane — the app
//! has no session restore (removed deliberately, see tab-manager.ts) and no
//! `beforeunload` guard — while `PtyState` survives as Tauri managed state with
//! no listener draining it, so every pre-reload PTY leaks until process exit.
//!
//! This module is Windows-only (see the `#[cfg(target_os = "windows")]` on its
//! declaration in `mod.rs`): `PlatformWebview::controller()` only exists on
//! Windows (it returns a raw pointer on macOS instead), and `webview2-com` /
//! `windows-core` are Windows-only target dependencies, so there is nothing to
//! abstract for cross-platform test compilation the way the sibling modules do.

use tauri::WebviewWindow;

/// # Must be called on the main thread
///
/// `with_webview` returns `Ok(())` in two different senses. Called on the main
/// thread it runs the closure inline and `Ok(())` means "ran"; called from any
/// other thread it posts to tao's event-loop channel and `Ok(())` means only
/// "enqueued" — the closure, and every `eprintln!` below, may never execute
/// (window destroyed first, loop already stopping). See
/// `tauri-runtime-wry`'s `send_user_message`, which branches on thread identity.
///
/// The single call site is `lib.rs`'s `setup()`, which Tauri dispatches on the
/// thread that owns the event loop, so today the inline branch is the one that
/// runs. A second call site off the main thread would silently reopen exactly
/// the bug this function exists to close.
pub fn harden_webview(window: &WebviewWindow) -> Result<(), String> {
    window
        .with_webview(|webview| {
            use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
            use windows_core::Interface;

            let controller = webview.controller();
            // SAFETY: `controller` is a live ICoreWebView2Controller owned by wry
            // for the lifetime of this webview, and `with_webview` runs this
            // closure on the thread that created it — the affinity WebView2
            // requires. Every call is a vtable call on that interface; failures
            // are returned as HRESULTs, not unwinds.
            unsafe {
                let Ok(core) = controller.CoreWebView2() else {
                    eprintln!("Deck: WebView2 core unavailable; browser accelerator keys stay enabled (F5 will discard the session)");
                    return;
                };
                let Ok(settings) = core.Settings() else {
                    eprintln!("Deck: WebView2 settings unavailable; browser accelerator keys stay enabled (F5 will discard the session)");
                    return;
                };
                let Ok(settings3) = settings.cast::<ICoreWebView2Settings3>() else {
                    eprintln!("Deck: WebView2 runtime lacks ICoreWebView2Settings3; browser accelerator keys stay enabled (F5 will discard the session)");
                    return;
                };
                if let Err(error) = settings3.SetAreBrowserAcceleratorKeysEnabled(false) {
                    eprintln!("Deck: could not disable WebView2 browser accelerator keys: {error}");
                }
            }
        })
        .map_err(|error| error.to_string())
}
