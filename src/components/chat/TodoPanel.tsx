import { Check, Circle, CircleDot, ListTodo } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../../store/app";
import { t } from "../../lib/i18n";

/** Icon per todo status; unknown statuses fall back to the open circle. */
function statusIcon(status: string) {
  if (status === "completed") return Check;
  if (status === "in_progress") return CircleDot;
  return Circle;
}

/**
 * The agent's task list for the current session, live.
 *
 * The core projects `todo.updated` into the store; this renders it. Hidden
 * entirely when the agent never produced todos — it must not fight the chat
 * for vertical space when irrelevant.
 */
export function TodoPanel() {
  const { todos, language } = useApp(
    useShallow((s) => ({ todos: s.todos, language: s.language }))
  );
  if (todos.length === 0) return null;

  const done = todos.filter((td) => td.status === "completed").length;

  return (
    <div className="mx-auto mb-2 max-w-3xl rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
      <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-[var(--fg-muted)]">
        <ListTodo size={11} />
        {t(language, "todos.title")}
        <span className="ml-auto normal-case tracking-normal">
          {done}/{todos.length}
        </span>
      </div>
      <ul className="mt-1 space-y-0.5">
        {todos.map((td, i) => {
          const Icon = statusIcon(td.status);
          const completed = td.status === "completed";
          const active = td.status === "in_progress";
          return (
            <li
              key={td.id ?? `todo-${i}`}
              className={`flex items-start gap-1.5 text-xs ${
                completed
                  ? "text-[var(--fg-muted)] line-through"
                  : active
                    ? "text-[var(--fg-primary)]"
                    : "text-[var(--fg-secondary)]"
              }`}
            >
              <Icon
                size={12}
                className={`mt-0.5 shrink-0 ${
                  completed
                    ? "text-[var(--success)]"
                    : active
                      ? "text-[var(--accent)]"
                      : "text-[var(--fg-muted)]"
                }`}
              />
              <span className="min-w-0 flex-1">{td.content}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
