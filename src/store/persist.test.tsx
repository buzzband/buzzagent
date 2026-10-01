/**
 * Regression tests for the "white screen on project open" bug.
 *
 * A persisted-array value loaded through `loadJson` was spread into the
 * object-shaped fallback, turning `hiddenProjects` into `{0:…,1:…}`; the
 * ProjectsList then crashed on `.includes` during render and — with no
 * boundary — the whole app white-screened. The user had hidden a project in
 * an earlier release, so the poison sat in their localStorage.
 */

import { loadLayout } from "../lib/layout";

describe("loadJson array persistence (white screen regression)", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("hiddenProjects stays an array when storage holds an array", () => {
    localStorage.setItem("buzzagent.hidden_projects", JSON.stringify(["/a", "/b"]));
    // Fresh module evaluation: clear the module from the registry first.
    vi.resetModules();
    return import("./app").then(({ useApp: fresh }) => {
      expect(Array.isArray(fresh.getState().hiddenProjects)).toBe(true);
      expect(fresh.getState().hiddenProjects).toEqual(["/a", "/b"]);
    });
  });

  it("hiddenProjects degrades to [] when storage holds garbage", () => {
    localStorage.setItem("buzzagent.hidden_projects", '"not-an-array"');
    vi.resetModules();
    return import("./app").then(({ useApp: fresh }) => {
      expect(fresh.getState().hiddenProjects).toEqual([]);
    });
  });

  it("object-shaped values still merge over defaults (notify/voice)", () => {
    localStorage.setItem("buzzagent.notify", JSON.stringify({ sound: false }));
    vi.resetModules();
    return import("./app").then(({ useApp: fresh }) => {
      const notify = fresh.getState().notify;
      expect(notify.sound).toBe(false);
      expect(typeof notify.enabled).toBe("boolean");
    });
  });

  it("layout loader tolerates a poisoned value alongside the fix", () => {
    localStorage.setItem("buzzagent.layout.v2", "not-json-at-all");
    expect(() => loadLayout()).not.toThrow();
    expect(loadLayout().windows.chat).toBe("center");
  });
});

describe("ProjectsList renders with poisoned hiddenProjects", () => {
  it("does not crash when hiddenProjects is not an array", async () => {
    const { ProjectsList } = await import("../components/sidebar/SessionList");
    // Same module instance the component binds to (earlier resetModules calls
    // forked the registry, so the static import is a different store).
    const { useApp: store } = await import("./app");
    store.setState({
      hiddenProjects: { 0: "/leaked" } as unknown as string[],
      sessions: [
        {
          id: "ses_1",
          title: "probe",
          directory: "/probe",
          version: "1.0",
        } as never,
      ],
      recentProjects: [],
      projectDir: "/probe",
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const root = createRoot(container);
    let renderError: unknown = null;
    try {
      await act(async () => {
        root.render(<ProjectsList />);
      });
    } catch (error) {
      renderError = error;
    }
    expect(renderError).toBeNull();
    expect(container.textContent).toContain("probe");
    await act(async () => root.unmount());
    document.body.innerHTML = "";
  });
});
