import { useEffect } from "react";
import { Command } from "cmdk";
import {
  FileDiff,
  Folder,
  MessageSquarePlus,
  Monitor,
  Palette,
  Settings,
  Wrench,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { THEME_OPTIONS, useApp } from "../store/app";
import type { WindowId } from "../lib/layout";

/**
 * Command palette (Cmd/Ctrl+K).
 *
 * Every action reachable by keyboard, in one discoverable place. Registered
 * globally so it works regardless of which panel has focus.
 */
export function CommandPalette() {
  const {
    paletteOpen,
    setPaletteOpen,
    openWindow,
    setTheme,
    newSession,
    sessions,
    openSession,
    setSettingsOpen,
  } = useApp(
    useShallow((s) => ({
      paletteOpen: s.paletteOpen,
      setPaletteOpen: s.setPaletteOpen,
      openWindow: s.openWindow,
      setTheme: s.setTheme,
      newSession: s.newSession,
      sessions: s.sessions,
      openSession: s.openSession,
      setSettingsOpen: s.setSettingsOpen,
    }))
  );

  // Registered before the early return below, so the shortcuts work whether or
  // not the palette itself is currently visible.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "k") {
        event.preventDefault();
        setPaletteOpen(!paletteOpen);
      } else if (event.key === ",") {
        event.preventDefault();
        setPaletteOpen(false);
        setSettingsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, setPaletteOpen, setSettingsOpen]);

  if (!paletteOpen) return null;

  const run = (action: () => void | Promise<void>) => {
    setPaletteOpen(false);
    void action();
  };

  const panels: { id: WindowId; label: string; icon: typeof FileDiff }[] = [
    { id: "chat", label: "Chat", icon: MessageSquarePlus },
    { id: "terminal", label: "Terminal", icon: Monitor },
    { id: "browser", label: "Browser", icon: Monitor },
    { id: "files", label: "Explorer", icon: Folder },
    { id: "changes", label: "Changes", icon: FileDiff },
    { id: "worktrees", label: "Worktrees", icon: Folder },
    { id: "skills", label: "Skills", icon: Wrench },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]"
      onClick={() => setPaletteOpen(false)}
    >
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg px-4">
        <Command
          label="Command palette"
          className="overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-overlay)] shadow-[var(--shadow-panel)]"
        >
          <Command.Input
            autoFocus
            placeholder="Search commands and sessions…"
            className="w-full border-b border-[var(--border-subtle)] bg-transparent px-4 py-3 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none"
          />

          <Command.List className="max-h-80 overflow-y-auto p-1.5">
            <Command.Empty className="px-3 py-6 text-center text-xs text-[var(--fg-muted)]">
              Nothing found.
            </Command.Empty>

            <Command.Group heading={<GroupLabel>Go to</GroupLabel>}>
              {panels.map((panel) => (
                <Item key={panel.id} onSelect={() => run(() => openWindow(panel.id))}>
                  <panel.icon size={13} />
                  {panel.label}
                </Item>
              ))}
            </Command.Group>

            <Command.Group heading={<GroupLabel>Session</GroupLabel>}>
              <Item onSelect={() => run(newSession)}>
                <MessageSquarePlus size={13} />
                New session
              </Item>
              {sessions.slice(0, 6).map((session) => (
                <Item
                  key={session.id}
                  onSelect={() => run(() => openSession(session.id))}
                >
                  <MessageSquarePlus size={13} className="opacity-0" />
                  {session.title || "Untitled"}
                </Item>
              ))}
            </Command.Group>

            <Command.Group heading={<GroupLabel>Application</GroupLabel>}>
              <Item onSelect={() => run(() => setSettingsOpen(true))}>
                <Settings size={13} />
                <span>Open settings</span>
                <span className="ml-auto text-2xs text-[var(--fg-muted)]">⌘,</span>
              </Item>
            </Command.Group>

            <Command.Group heading={<GroupLabel>Themes</GroupLabel>}>
              {THEME_OPTIONS.map((theme) => (
                <Item key={theme.id} onSelect={() => run(() => setTheme(theme.id))}>
                  <Palette size={13} />
                  <span>{theme.label}</span>
                  <span className="ml-auto text-2xs text-[var(--fg-muted)]">{theme.description}</span>
                </Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 py-1 text-2xs font-medium uppercase tracking-wide text-[var(--fg-muted)]">
      {children}
    </div>
  );
}

function Item({
  children,
  onSelect,
}: {
  children: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-[var(--fg-secondary)] data-[selected=true]:bg-[var(--accent-subtle)] data-[selected=true]:text-[var(--fg-primary)]"
    >
      {children}
    </Command.Item>
  );
}
