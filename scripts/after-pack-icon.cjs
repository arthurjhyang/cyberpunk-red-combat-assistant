const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

module.exports = async function afterPackIcon(context) {
  if (context.electronPlatformName !== "win32") return;

  const root = context.packager.projectDir;
  const exePath = path.join(context.appOutDir, "Cyberpunk RED Combat Assistant.exe");
  const iconPath = path.join(root, "build", "icon.ico");
  const rceditPath = path.join(root, "node_modules", "rcedit", "bin", "rcedit-x64.exe");

  for (const filePath of [exePath, iconPath, rceditPath]) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing required file: ${filePath}`);
    }
  }

  const result = spawnSync(rceditPath, [exePath, "--set-icon", iconPath], {
    encoding: "utf8",
    stdio: "pipe"
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || "rcedit failed");
    process.exit(result.status || 1);
  }

  console.log(`Applied app icon to ${exePath}`);
};
