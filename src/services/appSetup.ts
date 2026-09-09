import * as ipc from "./ipc";

/**
 * One-time startup bootstrap: probes for the Tauri backend and pulls the
 * last-used project path. The app intentionally runs in "web-only" mode when
 * no backend is present (browser dev server / plain web build).
 */

export interface AppSetup {
  backendAvailable: boolean;
  projectPath: string | null;
}

export async function loadInitialConfig(): Promise<AppSetup> {
  const setup: AppSetup = { backendAvailable: false, projectPath: null };
  try {
    await ipc.invoke<string>("greet", { name: "setup" });
    setup.backendAvailable = true;
  } catch (err) {
    console.warn("Backend not available, running in web-only mode:", err);
    return setup;
  }
  try {
    const projectPath = await ipc.invoke<string | null>("get_project_path");
    setup.projectPath = projectPath ?? null;
  } catch {
    // Non-fatal: project path just stays unset until the user picks one.
  }
  return setup;
}

export async function getProjectPath(): Promise<string | null> {
  return ipc.invoke<string | null>("get_project_path");
}

export async function setApiKey(provider: string, apiKey: string): Promise<void> {
  await ipc.invoke("set_api_key", { provider, apiKey });
}
