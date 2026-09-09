const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  openDirectoryDialog: () => ipcRenderer.invoke("open-directory-dialog"),
  readDirectory: (dirPath) => ipcRenderer.invoke("read-directory", dirPath),
  readFile: (filePath) => ipcRenderer.invoke("read-file", filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke("write-file", filePath, content),
  createProject: (basePath, projectName) => ipcRenderer.invoke("create-project", basePath, projectName),
  onMessage: (callback) => {
    ipcRenderer.on("message", (_event, message) => callback(message));
  },
});
