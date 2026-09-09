const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    autoHideMenuBar: true,
  });

  const isDev = !app.isPackaged;
  const distPath = path.join(__dirname, "../dist/index.html");
  const distExists = fs.existsSync(distPath);
  
  if (isDev) {
    mainWindow.loadURL("http://localhost:1420").catch(err => {
      console.error("Failed to load dev server:", err.message);
      mainWindow.loadFile(distPath).catch(err2 => console.error("Failed to load dist:", err2.message));
    });
  } else if (distExists) {
    mainWindow.loadFile(distPath).catch(err => {
      console.error("Failed to load file:", err.message);
      mainWindow.loadURL("http://localhost:1420").catch(err2 => console.error("Failed to load URL:", err2.message));
    });
  } else {
    mainWindow.loadURL("http://localhost:1420");
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("open-directory-dialog", async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
  return result;
});

ipcMain.handle("read-directory", async (_, dirPath) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries.map((entry) => ({ name: entry.name, path: path.join(dirPath, entry.name), type: entry.isDirectory() ? "directory" : "file" }));
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle("read-file", async (_, filePath) => {
  try { return fs.readFileSync(filePath, "utf-8"); } catch (err) { return { error: err.message }; }
});

ipcMain.handle("write-file", async (_, filePath, content) => {
  try { fs.writeFileSync(filePath, content, "utf-8"); return { success: true }; } catch (err) { return { error: err.message }; }
});

ipcMain.handle("create-project", async (_, basePath, projectName) => {
  try {
    const projectPath = path.join(basePath, projectName);
    fs.mkdirSync(projectPath, { recursive: true });
    fs.writeFileSync(path.join(projectPath, "index.html"), "<!DOCTYPE html><html><head><title>" + projectName + "</title></head><body></body></html>", "utf-8");
    return { success: true, projectPath };
  } catch (err) { return { error: err.message }; }
});
