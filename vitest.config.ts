import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const { default: react } = await import("@vitejs/plugin-react");
  return {
    plugins: [react()],
    test: {
      environment: "jsdom",
      setupFiles: ["./src/tests/setup.ts"],
      globals: true,
      css: true,
      include: ["src/**/*.test.{ts,tsx}"],
    },
  };
});
