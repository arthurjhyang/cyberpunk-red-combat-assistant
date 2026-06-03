const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronFiles", {
  openWorkbook: () => ipcRenderer.invoke("card:openWorkbook"),
  saveWorkbook: payload => ipcRenderer.invoke("card:saveWorkbook", payload)
});

contextBridge.exposeInMainWorld("electronWindow", {
  minimize: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximize: () => ipcRenderer.invoke("window:toggleMaximize"),
  isMaximized: () => ipcRenderer.invoke("window:isMaximized"),
  close: () => ipcRenderer.invoke("window:close")
});
