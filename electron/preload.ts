import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electron", {
  openDirectoryDialog: () => ipcRenderer.invoke("open-directory-dialog"),
  readDirectory: (dirPath: string) => ipcRenderer.invoke("read-directory", dirPath),
  readFile: (filePath: string) => ipcRenderer.invoke("read-file", filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke("write-file", filePath, content),
  createProject: (basePath: string, projectName: string) => ipcRenderer.invoke("create-project", basePath, projectName),
  onMessage: (callback: (message: string) => void) => {
    ipcRenderer.on("message", (_event, message) => callback(message));
  },
});
