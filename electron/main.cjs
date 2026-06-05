const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const APP_ID = "com.cyberpunk.red.combat.assistant";

if (process.platform === "win32") {
  app.setAppUserModelId(APP_ID);
}

function iconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "build", "icon.ico")
    : path.join(__dirname, "..", "build", "icon.ico");
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 720,
    minHeight: 560,
    title: "赛博朋克 RED 多人战斗结算台",
    frame: false,
    icon: iconPath(),
    backgroundColor: "#07090f",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
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

ipcMain.handle("card:openWorkbook", async () => {
  const result = await dialog.showOpenDialog({
    title: "选择赛博朋克自动卡",
    properties: ["openFile"],
    filters: [{ name: "Excel 自动卡", extensions: ["xlsx"] }]
  });

  if (result.canceled || !result.filePaths[0]) return null;

  const filePath = result.filePaths[0];
  const buffer = await fs.readFile(filePath);
  return {
    fileName: path.basename(filePath),
    filePath,
    base64: buffer.toString("base64")
  };
});

ipcMain.handle("card:saveWorkbook", async (_event, payload) => {
  if (!payload?.filePath || !payload?.base64) {
    throw new Error("缺少保存路径或工作簿内容。");
  }
  await fs.writeFile(payload.filePath, Buffer.from(payload.base64, "base64"));
  return { ok: true };
});

ipcMain.handle("window:minimize", event => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.handle("window:toggleMaximize", event => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return false;
  if (window.isMaximized()) {
    window.unmaximize();
  } else {
    window.maximize();
  }
  return window.isMaximized();
});

ipcMain.handle("window:isMaximized", event => {
  return Boolean(BrowserWindow.fromWebContents(event.sender)?.isMaximized());
});

ipcMain.handle("window:close", event => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});
