import React, { useCallback, useEffect, useState } from "react";
import { ChatPanel } from "../Chat/ChatPanel";
import { DiffViewer } from "../Diffs/DiffViewer";
import { BrowserPanel } from "../Browser/BrowserPanel";
import { TerminalPanel } from "../Terminal/TerminalPanel";
import { MCPHub } from "../MCP/MCPHub";
import { ModelRouter } from "../Models/ModelRouter";
import { EffortControl } from "../Effort/EffortControl";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { UsageStats } from "./UsageStats";
import { useAgentStore, DiffEntry } from "../../stores/agentStore";
import { BackendDiffEntry } from "../../types";
import { invoke } from "../../services/ipc";

type Panel = "chat" | "browser" | "terminal" | "diffs" | "mcp" | "models" | "effort";

/** Convert backend `git diff` entries into store diff entries. */
function fromBackend(entries: BackendDiffEntry[]): DiffEntry[] {
  return entries.map((e) => ({
    filePath: e.file,
    originalContent: "",
    modifiedContent: e.hunks.map((h) => h.content).join("\n"),
    hunks: e.hunks.map((h) => ({ index: h.index, content: h.content })),
    status: e.status,
  }));
}

export function MainLayout() {
  const [activePanel, setActivePanel] = useState<Panel>("chat");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { diffs, isRunning, acceptDiff, rejectDiff } = useAgentStore();
  const [gitDiffs, setGitDiffs] = useState<DiffEntry[]>([]);
  const [gitError, setGitError] = useState<string | null>(null);

  const refreshGitDiffs = useCallback(async () => {
    try {
      const entries = await invoke<BackendDiffEntry[]>("git_diff");
      setGitDiffs(fromBackend(entries));
      setGitError(null);
    } catch (err) {
      setGitError(String(err));
    }
  }, []);

  // Poll the working tree while the agent runs; refresh on demand otherwise.
  useEffect(() => {
    if (activePanel !== "diffs") return;
    refreshGitDiffs();
    if (!isRunning) return;
    const timer = setInterval(refreshGitDiffs, 3000);
    return () => clearInterval(timer);
  }, [activePanel, isRunning, refreshGitDiffs]);

  const renderPanel = () => {
    switch (activePanel) {
      case "chat":
        return <ChatPanel />;
      case "browser":
        return <BrowserPanel />;
      case "terminal":
        return <TerminalPanel />;
      case "diffs":
        return renderDiffPanel();
      case "mcp":
        return <MCPHub />;
      case "models":
        return <ModelRouter />;
      case "effort":
        return <EffortControl />;
      default:
        return <ChatPanel />;
    }
  };

  const renderDiffPanel = () => {
    // Prefer live git diffs of the working tree; fall back to agent-staged diffs.
    const shown = gitDiffs.length > 0 ? gitDiffs : diffs;

    return (
      <div className="diff-panel">
        <div className="diff-panel-header">
          <button onClick={refreshGitDiffs} title="Refresh diffs">
            ↻ Refresh
          </button>
          {gitError && <span className="diff-error">{gitError}</span>}
        </div>
        {shown.length === 0 ? (
          <div className="panel-empty">
            <p>No pending diffs</p>
          </div>
        ) : (
          shown.map((diff) => (
            <DiffViewer
              key={diff.filePath}
              diff={diff}
              activeHunk={null}
              onAcceptHunk={(hunkIndex) => acceptDiff(diff.filePath, hunkIndex)}
              onReject={() => rejectDiff(diff.filePath)}
              onAcceptAll={() => acceptDiff(diff.filePath)}
            />
          ))
        )}
      </div>
    );
  };

  return (
    <div className="main-layout">
      <div className="layout-header">
        <div className="layout-title">BuzzAgent</div>
        <div className="layout-panel-toggle">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
          >
            {sidebarOpen ? "◀" : "▶"}
          </button>
        </div>
      </div>

      <div className="layout-body">
        <main className="layout-main">{renderPanel()}</main>

        {sidebarOpen && (
          <aside className="layout-sidebar">
            <Sidebar
              activePanel={activePanel}
              onPanelChange={(panel) => setActivePanel(panel)}
            />
            <UsageStats />
          </aside>
        )}
      </div>

      <StatusBar isRunning={isRunning} />
    </div>
  );
}
