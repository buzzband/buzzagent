import { defineConfig } from "vite";

export default defineConfig(async () => {
  const { default: react } = await import("@vitejs/plugin-react");
  return {
    plugins: [react()],
    server: { port: 1420 },
    clearScreen: false,
  };
});
