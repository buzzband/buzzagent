//! System tray.
//!
//! A tray icon with quick actions: reveal the window, start a new session,
//! quit (fully stopping the core). Built on `TrayIconBuilder` — the menu is
//! rendered natively by the OS, so there is no plugin and no JS side.
//!
//! On Linux the icon is rendered into the menu bar via the StatusNotifier
//! protocol (KDE/Unity spec), which GNOME 43+ also implements through its
//! AppIndicator extension. Plain GNOME without the extension shows nothing —
//! that is an OS limitation, not a bug, and the setting stays harmless.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Menu ids emitted to [`handle_tray_event`].
const ID_SHOW: &str = "buzzagent_show";
const ID_NEW_SESSION: &str = "buzzagent_new_session";
const ID_QUIT: &str = "buzzagent_quit";

/// Build (or rebuild) the tray icon. `on_new_session` is forwarded to the
/// frontend, which owns sessions — the Rust side never talks to the core.
pub fn set_enabled<R: Runtime>(app: &AppHandle<R>, enabled: bool) -> Result<(), String> {
    if !enabled {
        if let Some(tray) = app.tray_by_id("buzzagent-tray") {
            let _ = tray.set_visible(false);
        }
        return Ok(());
    }
    if app.tray_by_id("buzzagent-tray").is_some() {
        return Ok(());
    }

    let show = MenuItem::with_id(app, ID_SHOW, "Show BuzzAgent", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let new_session = MenuItem::with_id(app, ID_NEW_SESSION, "New session", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let quit =
        MenuItem::with_id(app, ID_QUIT, "Quit", true, None::<&str>).map_err(|e| e.to_string())?;
    let menu = Menu::with_items(app, &[&show, &new_session, &quit]).map_err(|e| e.to_string())?;

    TrayIconBuilder::with_id("buzzagent-tray")
        .icon(app.default_window_icon().cloned().ok_or("No app icon")?)
        .tooltip("BuzzAgent")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(handle_tray_event)
        .build(app)
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn handle_tray_event<R: Runtime>(app: &AppHandle<R>, event: tauri::menu::MenuEvent) {
    match event.id().as_ref() {
        ID_SHOW => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }
        ID_NEW_SESSION => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            let _ = app.emit("tray://new-session", ());
        }
        ID_QUIT => {
            // RunEvent::Exit stops the core, so a plain exit is enough.
            app.exit(0);
        }
        _ => {}
    }
}
