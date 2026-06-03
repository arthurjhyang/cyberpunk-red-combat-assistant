const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronFiles", {
  openWorkbook: () => ipcRenderer.invoke("card:openWorkbook"),
  saveWorkbook: payload => ipcRenderer.invoke("card:saveWorkbook", payload)
});
