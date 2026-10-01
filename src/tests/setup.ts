/**
 * Test environment setup.
 *
 * jsdom does not implement `matchMedia`, which theme resolution relies on.
 * Providing a minimal stand-in is closer to reality than making production code
 * defensive about an API every real browser has.
 */

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// Some components measure DOM boxes; jsdom lacks the observer API.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Used by the code-block copy button.
if (!navigator.clipboard) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: async () => undefined },
    configurable: true,
  });
}
