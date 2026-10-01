import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Unique per-build identifier so support and users can tell apart downloads
// that share one version string (every rebuild of 0.1.13 shipped under the
// same name — "which build do you run" was unanswerable). ui = ui+asset
// fingerprint; core = bundled opencode binary. Shown in the status bar and
// included in crash reports.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const uiBuildId = createHash("sha256")
  .update(readFileSync("package.json"))
  .update(readFileSync("src/App.tsx"))
  .update(Date.now().toString())
  .digest("hex")
  .slice(0, 8);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __BUILD_ID__: JSON.stringify(uiBuildId),
  },
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "esnext",
    sourcemap: true,
  },
});
