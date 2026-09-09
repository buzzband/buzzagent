import { invoke } from "./ipc";

/**
 * Browser service — typed wrappers around the backend's headless-Chrome
 * commands. All heavy lifting (launch, navigate, capture) happens in Rust.
 */

export interface ConsoleLog {
  level: "log" | "warn" | "error" | "info";
  message: string;
  timestamp: number;
}

export async function navigate(url: string): Promise<string> {
  return invoke<string>("browser_navigate", { url });
}

export async function screenshot(): Promise<string> {
  return invoke<string>("browser_screenshot");
}

export async function click(selector: string): Promise<void> {
  await invoke("browser_click", { selector });
}

export async function type(selector: string, text: string): Promise<void> {
  await invoke("browser_type", { selector, text });
}

export async function consoleLogs(): Promise<
  Array<{ level: string; message: string; timestamp: number }>
> {
  return invoke("browser_console_logs");
}
