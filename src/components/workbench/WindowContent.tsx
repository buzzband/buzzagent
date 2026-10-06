import { useApp, type WindowId } from "../../store/app";
import { ChatTab } from "../chat/ChatTab";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { BrowserPanel } from "../browser/BrowserPanel";
import { ExplorerView } from "../files/ExplorerView";
import { ProjectsList } from "../sidebar/SessionList";
import { DiffPanel } from "../diffs/DiffPanel";
import { WorktreePanel } from "../worktrees/WorktreePanel";
import { SkillsPanel } from "../skills/SkillsPanel";
import { McpPanel } from "../mcp/McpPanel";
import { MusicPanel } from "../music/MusicPanel";
import { EditorWindow } from "../editor/EditorWindow";

/** Render the component for a given docked window. */
export function WindowContent({ window }: { window: WindowId }) {
  switch (window) {
    case "chat":
      return <ChatTab />;
    case "terminal":
      return <TerminalPanel />;
    case "browser":
      return <BrowserPanel />;
    case "files":
      return <ExplorerView />;
    case "projects":
      return <ProjectsList />;
    case "changes":
      return <DiffPanel />;
    case "worktrees":
      return <WorktreePanel />;
    case "skills":
      return <SkillsPanel />;
    case "mcp":
      return <McpPanel />;
    case "music":
      return <MusicPanel />;
    case "editor":
      return <EditorWindow />;
    default:
      return null;
  }
}

/** Shared drag payload type so list chips and area tabs interoperate. */
export const WINDOW_DND_TYPE = "application/x-buzz-window";

/** Read a window id from a drop event regardless of which type was set. */
export function windowFromDrop(e: React.DragEvent): WindowId | null {
  const raw =
    e.dataTransfer.getData(WINDOW_DND_TYPE) || e.dataTransfer.getData("text/plain");
  const id = raw as WindowId;
  return id && id in useApp.getState().layout.windows ? id : null;
}
