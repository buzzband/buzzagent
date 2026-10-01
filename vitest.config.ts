import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const { default: react } = await import("@vitejs/plugin-react");
  return {
    plugins: [react()],
    define: {
      // Silences React's "environment is not configured to support act(...)"
      // warning and makes act() flush effects synchronously in tests.
      "globalThis.IS_REACT_ACT_ENVIRONMENT": "true",
    },
    test: {
      environment: "jsdom",
      globals: true,
      css: true,
      setupFiles: ["./src/tests/setup.ts"],
      include: ["src/**/*.test.{ts,tsx}"],
    },
  };
});
