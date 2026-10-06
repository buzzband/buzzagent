import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronUp, Circle, CircleDot, ListTodo } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../../store/app";
import { t } from "../../lib/i18n";

/** Icon per todo status; unknown statuses fall back to the open circle. */
function statusIcon(status: string) {
  if (status === "completed") return Check;
  if (status === "in_progress") return CircleDot;
  return Circle;
}

const COLLAPSED_KEY = "buzzagent.todosCollapsed";

/** Collapse is remembered per session so a re-opened chat keeps its shape. */
function loadCollapsed(sessionId: string | null): boolean {
  try {
    if (!sessionId) return false;
    const all = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "{}") as Record<
      string,
      boolean
    >;
    return all[sessionId] === true;
  } catch {
    return false;
  }
}

function saveCollapsed(sessionId: string | null, collapsed: boolean): void {
  try {
    if (!sessionId) return;
    const all = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "{}") as Record<string, boolean>;
    all[sessionId] = collapsed;
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(all));
  } catch {
    // Persistence is best-effort.
  }
}

/**
 * The agent's task list for the current session, live.
 *
 * The core projects `todo.updated` into the store; this renders it. Hidden
 * entirely when the agent never produced todos. Collapsible: a long list used
 * to sit permanently between the composer and the chat, blocking the screen;
 * collapsed it stays as a one-line progress strip (done/total) that can be
 * re-expanded. The choice is remembered per session.
 */
export function TodoPanel() {
  const { todos, language, sessionId } = useApp(
    useShallow((s) => ({ todos: s.todos, language: s.language, sessionId: s.sessionId }))
  );
  const [collapsed, setCollapsed] = useState(() => loadCollapsed(sessionId));
  // Session switches reload that session's remembered state.
  useEffect(() => {
    setCollapsed(loadCollapsed(sessionId));
  }, [sessionId]);

  if (todos.length === 0) return null;

  const done = todos.filter((td) => td.status === "completed").length;
  const active = todos.find((td) => td.status === "in_progress");

  return (
    <div className="mx-auto mb-2 max-w-3xl rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
      <button
        type="button"
        onClick={() => {
          const next = !collapsed;
          setCollapsed(next);
          saveCollapsed(sessionId, next);
        }}
        aria-expanded={!collapsed}
        title={collapsed ? "Expand task list" : "Collapse task list"}
        className="flex w-full items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-[var(--fg-muted)] transition-colors hover:text-[var(--fg-secondary)]"
      >
        <ListTodo size={11} className="shrink-0" />
        {t(language, "todos.title")}
        <span className="ml-auto normal-case tracking-normal">
          {done}/{todos.length}
        </span>
        {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
      </button>

      {collapsed ? (
        active && (
          <p className="mt-1 truncate text-xs text-[var(--fg-primary)]" title={active.content}>
            {active.content}
          </p>
        )
      ) : (
        <ul className="mt-1 space-y-0.5">
          {todos.map((td, i) => {
            const Icon = statusIcon(td.status);
            const completed = td.status === "completed";
            const isActive = td.status === "in_progress";
            return (
              <li
                key={td.id ?? `todo-${i}`}
                className={`flex items-start gap-1.5 text-xs ${
                  completed
                    ? "text-[var(--fg-muted)] line-through"
                    : isActive
                      ? "text-[var(--fg-primary)]"
                      : "text-[var(--fg-secondary)]"
                }`}
              >
                <Icon
                  size={12}
                  className={`mt-0.5 shrink-0 ${
                    completed
                      ? "text-[var(--success)]"
                      : isActive
                        ? "text-[var(--accent)]"
                        : "text-[var(--fg-muted)]"
                  }`}
                />
                <span className="min-w-0 flex-1">{td.content}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
