import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles/index.css";

window.addEventListener("error", (e) => {
  console.error("Global error:", e.error?.message || e.message);
});

window.addEventListener("unhandledrejection", (e) => {
  console.error(
    "Unhandled rejection:",
    e.reason?.message || String(e.reason)
  );
});

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Root element not found");
}
ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
