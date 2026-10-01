import { parsePatch, statsFor } from "./diff";

const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,4 +1,5 @@
 const a = 1;
-const b = 2;
+const b = 3;
 const c = 4;
+const d = 5;
`;

describe("parsePatch", () => {
  it("tracks line numbers on both sides", () => {
    const rows = parsePatch(PATCH).filter((r) => r.kind !== "meta" && r.kind !== "hunk");

    expect(rows.map((r) => [r.kind, r.oldNumber, r.newNumber])).toEqual([
      ["context", 1, 1],
      ["del", 2, null],
      ["add", null, 2],
      ["context", 3, 3],
      ["add", null, 4],
    ]);
  });

  it("keeps headers and hunk markers distinguishable", () => {
    const rows = parsePatch(PATCH);
    expect(rows.filter((r) => r.kind === "meta").length).toBeGreaterThan(0);
    expect(rows.find((r) => r.kind === "hunk")?.text).toContain("@@ -1,4 +1,5 @@");
  });

  it("marks only the changed words within an edited line", () => {
    const rows = parsePatch(PATCH);
    const del = rows.find((r) => r.kind === "del");
    const add = rows.find((r) => r.kind === "add");

    // "const b = " is unchanged; only the value differs.
    expect(del?.segments?.filter((s) => s.changed).map((s) => s.text)).toEqual(["2"]);
    expect(add?.segments?.filter((s) => s.changed).map((s) => s.text)).toEqual(["3"]);
    expect(del?.segments?.map((s) => s.text).join("")).toBe("const b = 2;");
  });

  it("does not word-diff wholly different lines", () => {
    const patch = `@@ -1 +1 @@
-completely unrelated content here
+something entirely other instead
`;
    const rows = parsePatch(patch);
    // Below the similarity floor: a word diff would be noise.
    expect(rows.find((r) => r.kind === "del")?.segments).toBeUndefined();
  });

  it("does not pair unbalanced del/add blocks", () => {
    const patch = `@@ -1,2 +1,1 @@
-one
-two
+three
`;
    const rows = parsePatch(patch);
    expect(rows.filter((r) => r.kind === "del").every((r) => !r.segments)).toBe(true);
  });

  it("preserves blank context lines", () => {
    const patch = "@@ -1,3 +1,3 @@\n a\n\n b\n";
    const rows = parsePatch(patch).filter((r) => r.kind === "context");
    expect(rows).toHaveLength(3);
    expect(rows[1].text).toBe("");
  });

  it("ignores the no-newline marker", () => {
    const patch = "@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n";
    const rows = parsePatch(patch);
    expect(rows.some((r) => r.text.includes("No newline"))).toBe(false);
  });

  it("handles a new file with no old side", () => {
    const patch = "@@ -0,0 +1,2 @@\n+first\n+second\n";
    const rows = parsePatch(patch).filter((r) => r.kind === "add");
    expect(rows.map((r) => r.newNumber)).toEqual([1, 2]);
    expect(rows.every((r) => r.oldNumber === null)).toBe(true);
  });
});

describe("statsFor", () => {
  it("counts added and removed content lines only", () => {
    expect(statsFor(parsePatch(PATCH))).toEqual({ added: 2, removed: 1 });
  });

  it("returns zeroes for an empty patch", () => {
    expect(statsFor(parsePatch(""))).toEqual({ added: 0, removed: 0 });
  });
});
