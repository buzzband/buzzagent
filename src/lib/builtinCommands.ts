/**
 * Built-in slash commands — the GUI layer of what Claude Code and the
 * opencode TUI offer out of the box (see PLAN.md, 2026-09 research).
 *
 * Each command maps to an action the pinned core already supports; the store's
 * `runBuiltin` resolves and executes it. Project commands (GET /command) are
 * matched first in `send`, so a project command may shadow a built-in with the
 * same name — that is intentional: user config wins.
 */

export interface BuiltinCommand {
  name: string;
  aliases?: string[];
  description: string;
  /** Minimal hint shown next to the description, e.g. "[file]". */
  argHint?: string;
  run: (ctx: BuiltinContext, args: string) => Promise<void>;
}

/** Everything a command may touch, provided by the store. */
export interface BuiltinContext {
  sessionId: string | null;
  language: string;
  /** Extract the text of message parts; kept here so tests can stub messages. */
  messageText: (part: unknown) => string;
  messages: unknown[];
  model: { providerID: string; modelID: string } | null;
  api: {
    summarize: (sessionId: string, model: { providerID: string; modelID: string }) => Promise<boolean>;
    revert: (sessionId: string, messageID: string) => Promise<unknown>;
    unrevert: (sessionId: string) => Promise<unknown>;
    initSession: (sessionId: string) => Promise<unknown>;
  };
  fs: {
    pickMarkdownPath: () => Promise<string | null>;
    writeProjectFile: (path: string, content: string) => Promise<void>;
    copyToClipboard: (text: string) => Promise<void>;
    bumpFsVersion: () => void;
  };
  /** Show a transient toast-like message in the UI. */
  notify: (message: string) => void;
  /** Report a failure through the standard error path. */
  fail: (error: unknown) => void;
}

/** Markdown transcript: role-labelled turns, assistant text in full. */
export function transcriptToMarkdown(messages: unknown[], messageText: (p: unknown) => string): string {
  return messages
    .map((m) => {
      const info = (m as { info?: { role?: string; time?: { created?: number } } }).info ?? {};
      const role = info.role === "user" ? "User" : "Assistant";
      const time = info.time?.created ? new Date(info.time.created).toISOString() : "";
      const text = messageText(m);
      return `## ${role}${time ? ` — ${time}` : ""}\n\n${text}\n`;
    })
    .join("\n");
}

/** Message wrapper considered a user turn (has `info.role === "user"`). */
export function isUserMessage(m: unknown): boolean {
  return (m as { info?: { role?: string } })?.info?.role === "user";
}

/** Message wrapper considered an assistant turn. */
export function isAssistantMessage(m: unknown): boolean {
  return (m as { info?: { role?: string } })?.info?.role === "assistant";
}

/**
 * Resolve a slash token to a built-in. Tries exact name, then aliases.
 * Returns undefined when the token is not a built-in (project commands and
 * unknown tokens keep their existing behaviour).
 */
export function resolveBuiltin(token: string): BuiltinCommand | undefined {
  const t = token.toLowerCase();
  return BUILTINS.find(
    (c) => c.name === t || (c.aliases ?? []).some((a) => a === t)
  );
}

export const BUILTINS: BuiltinCommand[] = [
  {
    name: "init",
    description: "Write or update the project's AGENTS.md",
    async run(ctx) {
      if (!ctx.sessionId) throw new Error("No active session");
      await ctx.api.initSession(ctx.sessionId);
      ctx.notify("AGENTS.md update requested");
    },
  },
  {
    name: "compact",
    aliases: ["summarize"],
    description: "Summarize this session to free context",
    async run(ctx) {
      if (!ctx.sessionId) throw new Error("No active session");
      if (!ctx.model) throw new Error("Choose a model first");
      await ctx.api.summarize(ctx.sessionId, ctx.model);
      ctx.notify("Session compacted");
    },
  },
  {
    name: "export",
    description: "Save the conversation as a Markdown file",
    argHint: "[file]",
    async run(ctx, args) {
      const markdown = transcriptToMarkdown(ctx.messages, ctx.messageText);
      let target = args.trim();
      if (!target) {
        target = (await ctx.fs.pickMarkdownPath()) ?? "";
      }
      if (!target) return; // user cancelled the save dialog
      if (!/\.md$/i.test(target)) target = `${target}.md`;
      await ctx.fs.writeProjectFile(target, markdown);
      ctx.fs.bumpFsVersion();
      ctx.notify(`Conversation exported to ${target}`);
    },
  },
  {
    name: "copy",
    description: "Copy the last assistant reply to the clipboard",
    argHint: "[n]",
    async run(ctx, args) {
      const replies = ctx.messages.filter(isAssistantMessage);
      if (replies.length === 0) {
        ctx.notify("Nothing to copy yet");
        return;
      }
      const n = Math.max(1, parseInt(args.trim(), 10) || 1);
      const pick = replies[replies.length - n];
      if (!pick) {
        ctx.notify(`Only ${replies.length} reply(ies) in this session`);
        return;
      }
      await ctx.fs.copyToClipboard(ctx.messageText(pick));
      ctx.notify("Copied");
    },
  },
  {
    name: "undo",
    description: "Revert the last user turn (and its file changes)",
    async run(ctx) {
      if (!ctx.sessionId) throw new Error("No active session");
      const lastUser = [...ctx.messages].reverse().find(isUserMessage);
      if (!lastUser) {
        ctx.notify("Nothing to undo");
        return;
      }
      const messageID = (lastUser as { info?: { id?: string } }).info?.id;
      if (!messageID) throw new Error("Message is not revertable");
      await ctx.api.revert(ctx.sessionId, messageID);
      ctx.notify("Last turn reverted");
    },
  },
  {
    name: "redo",
    description: "Restore the previously undone turn",
    async run(ctx) {
      if (!ctx.sessionId) throw new Error("No active session");
      await ctx.api.unrevert(ctx.sessionId);
      ctx.notify("Redone");
    },
  },
  {
    name: "help",
    aliases: ["commands"],
    description: "List available commands",
    async run(ctx) {
      ctx.notify("__open_help__");
    },
  },
];
