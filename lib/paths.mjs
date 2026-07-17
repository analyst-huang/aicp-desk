import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";

export function defaultHome({ platform = process.platform, env = process.env, homedir = os.homedir() } = {}) {
  const platformPath = platform === "win32" ? path.win32 : path.posix;
  if (env.AICP_HOME) return platformPath.resolve(env.AICP_HOME);
  if (platform === "win32") {
    const base = env.LOCALAPPDATA || platformPath.join(homedir, "AppData", "Local");
    return platformPath.join(base, "aicp-cli");
  }
  if (platform === "darwin") return platformPath.join(homedir, "Library", "Application Support", "aicp-cli");
  return platformPath.join(env.XDG_STATE_HOME || platformPath.join(homedir, ".local", "state"), "aicp-cli");
}

export function appPaths() {
  const home = defaultHome();
  return {
    home,
    config: path.join(home, "config.json"),
    templates: path.join(home, "templates"),
    browserProfile: path.join(home, "edge-profile"),
    lock: path.join(home, "browser.lock"),
  };
}

export async function ensureAppDirs() {
  const paths = appPaths();
  await mkdir(paths.home, { recursive: true });
  await mkdir(paths.templates, { recursive: true });
  return paths;
}

export async function exists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(filePath, fallback = undefined) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (fallback !== undefined && error?.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tempPath, filePath);
}
