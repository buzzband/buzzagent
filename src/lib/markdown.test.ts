import { parseInline, parseMarkdown } from "./markdown";

describe("parseMarkdown", () => {
  it("renders an unterminated fence as a code block immediately", () => {
    // The core case for streaming: the fence has not closed yet, but the
    // content must already render as code so nothing reflows later.
    const blocks = parseMarkdown("Here:\n```ts\nconst a = 1;");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ kind: "paragraph", text: "Here:" });
    expect(blocks[1]).toMatchObject({
      kind: "code",
      language: "ts",
      code: "const a = 1;",
      closed: false,
    });
  });

  it("keeps the code block key stable as content streams in", () => {
    const partial = parseMarkdown("```ts\nconst a");
    const complete = parseMarkdown("```ts\nconst a = 1;\n```");
    // Same key => React reuses the node => no flicker when the fence closes.
    expect(partial[0].key).toBe(complete[0].key);
    expect((partial[0] as { closed: boolean }).closed).toBe(false);
    expect((complete[0] as { closed: boolean }).closed).toBe(true);
  });

  it("does not close a fence with a different marker", () => {
    const blocks = parseMarkdown("```\ncode\n~~~\nstill code");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: "code", closed: false });
    expect((blocks[0] as { code: string }).code).toContain("~~~");
  });

  it("parses headings, rules and quotes", () => {
    const blocks = parseMarkdown("# Title\n\n---\n\n> note\n> more");
    expect(blocks[0]).toMatchObject({ kind: "heading", level: 1, text: "Title" });
    expect(blocks[1]).toMatchObject({ kind: "rule" });
    expect(blocks[2]).toMatchObject({ kind: "quote", text: "note\nmore" });
  });

  it("groups list items and separates ordered from unordered", () => {
    const blocks = parseMarkdown("- one\n- two\n\n1. first\n2. second");
    expect(blocks[0]).toMatchObject({ kind: "list", ordered: false, items: ["one", "two"] });
    expect(blocks[1]).toMatchObject({
      kind: "list",
      ordered: true,
      items: ["first", "second"],
    });
  });

  it("treats a blank line as a paragraph break", () => {
    const blocks = parseMarkdown("one\n\ntwo");
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "paragraph"]);
  });

  it("returns nothing for empty input", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("\n\n")).toEqual([]);
  });
});

describe("parseInline", () => {
  it("keeps markup inside inline code literal", () => {
    const tokens = parseInline("use `**not bold**` here");
    expect(tokens[1]).toEqual({ kind: "code", value: "**not bold**" });
  });

  it("parses bold, italic and links", () => {
    expect(parseInline("**b**")[0]).toEqual({ kind: "strong", value: "b" });
    expect(parseInline("*i*")[0]).toEqual({ kind: "em", value: "i" });
    expect(parseInline("_i_")[0]).toEqual({ kind: "em", value: "i" });
    expect(parseInline("[t](http://x)")[0]).toEqual({
      kind: "link",
      value: "t",
      href: "http://x",
    });
  });

  it("leaves an unterminated marker as plain text", () => {
    // Happens constantly mid-stream; it must not eat the rest of the line.
    const tokens = parseInline("half **bold");
    expect(tokens).toEqual([{ kind: "text", value: "half **bold" }]);
  });

  it("does not treat a bare asterisk as emphasis", () => {
    expect(parseInline("2 * 3 * 4")).toEqual([{ kind: "text", value: "2 * 3 * 4" }]);
  });
});
