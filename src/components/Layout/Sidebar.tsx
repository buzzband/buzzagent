import React from "react";
import { Panel } from "./types";

export function Sidebar({
  activePanel,
  onPanelChange,
}: {
  activePanel: Panel;
  onPanelChange: (panel: Panel) => void;
}) {
  const items: { key: Panel; label: string; icon: string }[] = [
    { key: "chat", label: "Chat", icon: "💬" },
    { key: "diffs", label: "Diffs", icon: "🔍" },
    { key: "browser", label: "Browser", icon: "🌐" },
    { key: "terminal", label: "Terminal", icon: "⌨" },
    { key: "mcp", label: "MCP Hub", icon: "🔌" },
    { key: "models", label: "Models", icon: "🤖" },
    { key: "effort", label: "Effort", icon: "⚙" },
  ];

  return (
    <nav className="sidebar">
      <ul className="sidebar-nav">
        {items.map((item) => (
          <li key={item.key}>
            <button
              className={activePanel === item.key ? "active" : ""}
              onClick={() => onPanelChange(item.key)}
            >
              <span className="sidebar-icon">{item.icon}</span>
              <span className="sidebar-label">{item.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
