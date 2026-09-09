import "@testing-library/jest-dom";
import { vi } from "vitest";

// Simulate a plain-browser environment where the Tauri backend is NOT available.
// The ipc layer must degrade gracefully (web-only mode) when invoke is unavailable.
interface TauriInternalsWindow extends Window {
  __TAURI_INTERNALS__?: unknown;
}
(window as TauriInternalsWindow).__TAURI_INTERNALS__ = undefined;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() =>
    Promise.reject(new TypeError("Backend not available in test environment"))
  ),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

window.HTMLElement.prototype.scrollIntoView = vi.fn();
