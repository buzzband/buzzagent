import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * IPC layer.
 *
 * In Tauri the `invoke` command set is the single transport. In Electron or
 * plain-web mode the Tauri API is unavailable; the electron preload exposes
 * a subset of methods on `window.electron`, which we map 1:1 by command name.
 * Everything degrades to a rejected promise with a descriptive error so the
 * UI can show a meaningful message instead of a blank screen.
 */

interface ElectronBridge {
  [cmd: string]: (args?: unknown) => Promise<unknown>;
}

function electronApi(): ElectronBridge | null {
  return (window as unknown as { electron?: ElectronBridge }).electron ?? null;
}

export function hasBackend(): boolean {
  return electronApi() !== null;
}

export async function invoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T> {
  const bridge = electronApi();
  if (bridge) {
    const method = bridge[cmd];
    if (typeof method === "function") {
      return method(args) as Promise<T>;
    }
    return Promise.reject(
      new Error(`Command '${cmd}' is not available in this environment`)
    );
  }
  return tauriInvoke(cmd, args) as Promise<T>;
}

export async function listenEvent<T = unknown>(
  event: string,
  callback: (data: T) => void
): Promise<() => void> {
  const unlisten = await listen<T>(event, (e) => callback(e.payload));
  return unlisten;
}

export { listen } from "@tauri-apps/api/event";
