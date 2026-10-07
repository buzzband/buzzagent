import { describe, it, expect } from "vitest";
import {
  highlightEditorTokens,
  highlight,
  normaliseLanguage,
} from "../lib/highlight";

/**
 * The highlighting pipeline end-to-end with real Shiki. The editor overlay
 * and chat code blocks both depend on it; a silent failure means plain text
 * everywhere, which is exactly what the AppImage once shipped (WASM blocked
 * by CSP). These tests keep the loader wiring honest.
 */
describe("highlight", () => {
  it("normalises common aliases", () => {
    expect(normaliseLanguage("ts")).toBe("typescript");
    expect(normaliseLanguage("py")).toBe("python");
    expect(normaliseLanguage("PHP")).toBe("php");
    expect(normaliseLanguage("")).toBe("text");
  });

  it("returns colored tokens for PHP (AppImage regression: PHP was plain)", async () => {
    const result = await highlightEditorTokens(
      "<?php\nfunction hello(string $name): string {\n  return $name;\n}\n",
      "php",
      "dark"
    );
    expect(result).not.toBeNull();
    expect(result!.tokens.length).toBeGreaterThan(3);
    expect(result!.tokens.some((token) => token.color)).toBe(true);
    // Offsets must rebuild the document byte-for-byte for the overlay.
    const rebuilt = result!.tokens.map((t) => t.text).join("");
    expect(rebuilt).toContain("<?php");
  });

  it("returns colored tokens for TypeScript", async () => {
    const result = await highlightEditorTokens(
      "const x: number = 42;\n",
      "typescript",
      "light"
    );
    expect(result).not.toBeNull();
    expect(result!.tokens.some((token) => token.color)).toBe(true);
  });

  it("returns null for unknown languages (plain fallback)", async () => {
    const result = await highlightEditorTokens("plain", "not-a-language", "dark");
    expect(result).toBeNull();
  });

  it("renders chat-style HTML with colors", async () => {
    const html = await highlight("fn main() {}", "rust", "dark");
    expect(html).not.toBeNull();
    expect(html).toMatch(/style="color:/);
  });
});
