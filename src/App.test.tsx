import { createRoot } from "react-dom/client";
import { act } from "react";
import { App } from "./App";
import { useApp } from "./store/app";

/**
 * Shell-level smoke tests. The Tauri bridge is absent under jsdom, so `boot()`
 * lands in onboarding — which is exactly the path a browser build takes, and
 * worth asserting rather than mocking away.
 */
function render() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  return { container, root };
}

describe("App", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("falls back to onboarding when no desktop runtime is present", async () => {
    const { container, root } = render();

    await act(async () => {
      root.render(<App />);
    });

    expect(container.textContent).toContain("BuzzAgent");
    // No Tauri bridge: the user is told, not left on a spinner.
    expect(container.textContent).toContain("Desktop runtime required");

    await act(async () => root.unmount());
  });

  it("states the privacy position on first run", async () => {
    const { container, root } = render();

    await act(async () => {
      root.render(<App />);
    });

    expect(container.textContent).toContain("No analytics");
    // The catalogue fetch is disclosed rather than hidden.
    expect(container.textContent).toContain("model catalogue");

    await act(async () => root.unmount());
  });

  it("renders the workbench once the core is ready", async () => {
    const { container, root } = render();

    await act(async () => {
      root.render(<App />);
    });

    // Promote to ready after boot() has settled, otherwise it would reset us
    // back to onboarding.
    await act(async () => {
      useApp.setState({ phase: "ready", projectDir: "/tmp/demo", messages: [] });
    });

    expect(container.textContent).toContain("What are we building?");
    // Status bar keeps the core state visible at all times.
    expect(container.textContent).toContain("core stopped");
    expect(container.textContent).toContain("no telemetry");

    await act(async () => root.unmount());
    useApp.setState({ phase: "boot", projectDir: null });
  });
});
