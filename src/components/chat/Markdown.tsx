import { Fragment, memo } from "react";
import { parseInline, parseMarkdown, type InlineToken } from "../../lib/markdown";
import { CodeBlock } from "./CodeBlock";

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((token: InlineToken, i) => {
        switch (token.kind) {
          case "code":
            return (
              <code
                key={i}
                className="rounded-xs bg-[var(--bg-overlay)] px-1 py-0.5 font-mono text-[0.9em] text-[var(--fg-primary)]"
              >
                {token.value}
              </code>
            );
          case "strong":
            return (
              <strong key={i} className="font-semibold text-[var(--fg-primary)]">
                {token.value}
              </strong>
            );
          case "em":
            return (
              <em key={i} className="italic">
                {token.value}
              </em>
            );
          case "link":
            return (
              <a
                key={i}
                href={token.href}
                target="_blank"
                rel="noreferrer noopener"
                className="text-[var(--accent)] underline decoration-[var(--accent)]/40 underline-offset-2 hover:decoration-[var(--accent)]"
              >
                {token.value}
              </a>
            );
          default:
            return <Fragment key={i}>{token.value}</Fragment>;
        }
      })}
    </>
  );
}

const HEADING_SIZE: Record<number, string> = {
  1: "text-xl font-semibold mt-4 mb-2",
  2: "text-lg font-semibold mt-4 mb-2",
  3: "text-base font-semibold mt-3 mb-1.5",
  4: "text-base font-medium mt-3 mb-1.5",
  5: "text-sm font-medium mt-2 mb-1",
  6: "text-sm font-medium mt-2 mb-1 text-[var(--fg-secondary)]",
};

/**
 * Renders assistant/user markdown.
 *
 * Memoised on the raw text: during streaming the same component re-renders on
 * every token, and re-parsing unchanged prose is wasted work.
 */
export const Markdown = memo(function Markdown({
  text,
  streaming,
}: {
  text: string;
  streaming?: boolean;
}) {
  const blocks = parseMarkdown(text);

  return (
    <div className="selectable text-[var(--fg-secondary)]">
      {blocks.map((block) => {
        switch (block.kind) {
          case "heading":
            return (
              <div
                key={block.key}
                className={`text-[var(--fg-primary)] ${HEADING_SIZE[block.level] ?? HEADING_SIZE[6]}`}
              >
                <Inline text={block.text} />
              </div>
            );

          case "code":
            return (
              <CodeBlock
                key={block.key}
                code={block.code}
                language={block.language}
                streaming={streaming && !block.closed}
              />
            );

          case "list": {
            const Tag = block.ordered ? "ol" : "ul";
            return (
              <Tag
                key={block.key}
                className={`my-1.5 space-y-0.5 pl-5 ${
                  block.ordered ? "list-decimal" : "list-disc"
                } marker:text-[var(--fg-muted)]`}
              >
                {block.items.map((item, i) => (
                  <li key={i}>
                    <Inline text={item} />
                  </li>
                ))}
              </Tag>
            );
          }

          case "quote":
            return (
              <blockquote
                key={block.key}
                className="my-2 border-l-2 border-[var(--border-strong)] pl-3 text-[var(--fg-muted)]"
              >
                <Inline text={block.text} />
              </blockquote>
            );

          case "rule":
            return (
              <hr key={block.key} className="my-3 border-t border-[var(--border-subtle)]" />
            );

          default:
            return (
              <p key={block.key} className="my-1.5 whitespace-pre-wrap break-words">
                <Inline text={block.text} />
              </p>
            );
        }
      })}
    </div>
  );
});
