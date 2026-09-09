import React, { useEffect, useState } from "react";
import { MainLayout } from "./components/Layout/MainLayout";
import { loadInitialConfig } from "./services/appSetup";
import { useAgentStore } from "./stores/agentStore";
import "./styles/index.css";

export function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      try {
        const setup = await loadInitialConfig();
        if (setup.projectPath) {
          useAgentStore.getState().setProjectPath(setup.projectPath);
        }
        setReady(true);
      } catch (err) {
        setError(String(err));
      }
    };
    init();
  }, []);

  if (error) {
    return (
      <div className="app-error">
        <h2>BuzzAgent — Initialization Error</h2>
        <p>{error}</p>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="app-loading">
        <div className="spinner"></div>
        <p>Initializing BuzzAgent…</p>
      </div>
    );
  }

  return (
    <div className="app">
      <MainLayout />
    </div>
  );
}
