import path from "node:path";
import os from "node:os";
import { defaultInstallRoot, ensureAppDirs, readJson, writeJsonAtomic } from "./paths.mjs";

export const DEFAULT_CONFIG = Object.freeze({
  region: "cn-northwest-3",
  username: "",
  debugPort: 9337,
  guiPort: 17863,
  edgePath: "",
  apiEndpoint: "https://overlord-api.ksyun.com/console-v2",
  consoleUrl: "https://aicp.console.ksyun.com/#/taskDev",
});

export async function loadConfig() {
  const paths = await ensureAppDirs();
  const saved = await readJson(paths.config, {});
  return { ...DEFAULT_CONFIG, ...saved };
}

export async function saveConfig(config) {
  const paths = await ensureAppDirs();
  const normalized = {
    ...DEFAULT_CONFIG,
    ...config,
    debugPort: Number(config.debugPort ?? DEFAULT_CONFIG.debugPort),
    guiPort: Number(config.guiPort ?? DEFAULT_CONFIG.guiPort),
  };
  for (const key of ["debugPort", "guiPort"]) {
    if (!Number.isInteger(normalized[key]) || normalized[key] < 1024 || normalized[key] > 65535) {
      throw new Error(`${key} 必须是 1024 到 65535 之间的端口号`);
    }
  }
  if (!String(normalized.region || "").trim()) throw new Error("region 不能为空");
  await writeJsonAtomic(paths.config, normalized);
  return normalized;
}

export async function setConfigValue(key, rawValue) {
  if (!(key in DEFAULT_CONFIG)) {
    throw new Error(`未知配置项：${key}。可用项：${Object.keys(DEFAULT_CONFIG).join(", ")}`);
  }
  const config = await loadConfig();
  let value = rawValue;
  if (["debugPort", "guiPort"].includes(key)) {
    value = Number(rawValue);
    if (!Number.isInteger(value) || value < 1024 || value > 65535) {
      throw new Error(`${key} 必须是 1024 到 65535 之间的端口号`);
    }
  }
  config[key] = value;
  return saveConfig(config);
}

export function commonEdgePaths({ platform = process.platform, env = process.env, homedir = os.homedir() } = {}) {
  const platformPath = platform === "win32" ? path.win32 : path.posix;
  if (platform === "darwin") {
    return [
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      platformPath.join(homedir, "Applications", "Microsoft Edge.app", "Contents", "MacOS", "Microsoft Edge"),
      "/Applications/Microsoft Edge Beta.app/Contents/MacOS/Microsoft Edge Beta",
    ];
  }
  if (platform === "linux") {
    const privateEdge = platformPath.join(defaultInstallRoot({ platform, env, homedir }), "runtime", "bin", "microsoft-edge-stable");
    return [
      privateEdge,
      "/usr/bin/microsoft-edge",
      "/usr/bin/microsoft-edge-stable",
      "/opt/microsoft/msedge/msedge",
      "microsoft-edge",
      "microsoft-edge-stable",
      "msedge",
    ];
  }
  if (platform !== "win32") return ["microsoft-edge", "msedge"];
  const programFilesX86 = env["ProgramFiles(x86)"];
  const programFiles = env.ProgramFiles;
  const localAppData = env.LOCALAPPDATA;
  return [
    programFilesX86 && platformPath.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
    programFiles && platformPath.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    localAppData && platformPath.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
  ].filter(Boolean);
}
