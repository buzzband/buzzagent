/**
 * The runtime-error overlay must never leave the user speechless again: the
 * message is selectable text and "Copy details" is a real button wired to the
 * clipboard helper (web API here; the Tauri command is preferred in-app).
 */

import {
  formatCrash,
  saveCrashReport,
  showWindowErrorOverlay,
  surfacePreviousCrash,
} from "../components/ErrorBoundary";

describe("window error overlay", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renders a selectable message with a Copy details button", () => {
    showWindowErrorOverlay({
      message: "d.includes is not a function (probe)",
      kind: "window",
      at: Date.now(),
    });

    const host = document.querySelector('[role="alert"]');
    expect(host).not.toBeNull();

    const message = host!.querySelector("div > div:nth-child(2)") as HTMLElement;
    expect(message.textContent).toContain("d.includes is not a function");
    expect(getComputedStyle(message).userSelect).toBe("text");

    const buttons = [...host!.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons).toContain("Copy details");
    expect(buttons).toContain("Dismiss");

    // The exact build must be identifiable at a glance — rebuilds share one
    // version string, so "I still see the bug" reports need this.
    expect(host!.textContent).toContain("build ");
  });

  it("copies the full formatted crash report via the clipboard helper", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    showWindowErrorOverlay({
      message: "boom",
      stack: "at somewhere",
      kind: "unhandledrejection",
      at: 1_700_000_000_000,
    });

    const copy = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Copy details"
    ) as HTMLButtonElement;
    copy.click();
    await vi.waitFor(() => expect(copy.textContent).toBe("Copied ✓"));

    expect(writeText).toHaveBeenCalledTimes(1);
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toContain("BuzzAgent crash (unhandledrejection)");
    expect(text).toContain("Message: boom");
    expect(text).toContain("at somewhere");
  });

  it("surfaces the previous run's report exactly once", () => {
    saveCrashReport({ message: "stale boom", kind: "render", at: Date.now() });

    surfacePreviousCrash();
    expect(document.body.textContent).toContain("Last run ended with: stale boom");

    // Second launch: the report was cleared — no nagging every start.
    document.body.innerHTML = "";
    surfacePreviousCrash();
    expect(document.body.textContent).not.toContain("stale boom");
  });

  it("formats a crash report with message, stack and timestamp", () => {
    const text = formatCrash({
      message: "boom",
      stack: "stack-line",
      kind: "render",
      at: 1_700_000_000_000,
    });
    expect(text).toContain("BuzzAgent crash (render)");
    expect(text).toContain("Build: ");
    expect(text).toContain("Message: boom");
    expect(text).toContain("stack-line");
  });
});
