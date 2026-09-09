import { app, BrowserWindow, ipcMain, dialog } from "electron";
import * as path from "path";
import * as fs from "fs";

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
    autoHideMenuBar: true,
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL("http://localhost:1420");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle("open-directory-dialog", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ["openDirectory"],
  });
  return result;
});

ipcMain.handle("read-directory", async (_, dirPath: string) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      path: path.join(dirPath, entry.name),
      type: entry.isDirectory() ? "directory" : "file",
    }));
  } catch (err) {
    return { error: (err as Error).message };
  }
});

ipcMain.handle("read-file", async (_, filePath: string) => {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    return { error: (err as Error).message };
  }
});

ipcMain.handle("write-file", async (_, filePath: string, content: string) => {
  try {
    fs.writeFileSync(filePath, content, "utf-8");
    return { success: true };
  } catch (err) {
    return { error: (err as Error).message };
  }
});

ipcMain.handle("create-project", async (_, basePath: string, projectName: string) => {
  try {
    const projectPath = path.join(basePath, projectName);
    fs.mkdirSync(projectPath, { recursive: true });
    fs.writeFileSync(
      path.join(projectPath, "index.html"),
      "<!DOCTYPE html>\n<html>\n<head><title>" + projectName + "</title></head>\n<body></body>\n</html>",
      "utf-8"
    );
    return { success: true, projectPath };
  } catch (err) {
    return { error: (err as Error).message };
  }
});
