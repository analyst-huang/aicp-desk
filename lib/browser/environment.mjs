import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, readlink, stat, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { commonEdgePaths } from '../config.mjs';
import { appPaths, exists } from '../paths.mjs';

const EDGE_SINGLETON_LINKS = Object.freeze(["SingletonCookie", "SingletonSocket", "SingletonLock"]);

async function optionalLinkTarget(filePath, fileSystem) {
  try {
    return await fileSystem.readlink(filePath);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EINVAL") return null;
    throw error;
  }
}

async function unlinkIfUnchanged(filePath, expectedTarget, fileSystem) {
  if (expectedTarget === null || await optionalLinkTarget(filePath, fileSystem) !== expectedTarget) return false;
  try {
    await fileSystem.unlink(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function pathExists(filePath, fileSystem) {
  try {
    await fileSystem.stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
    throw error;
  }
}

async function inspectProcessProfile(pid, profilePath, fileSystem) {
  try {
    const commandLine = String(await fileSystem.readFile(`/proc/${pid}/cmdline`));
    const argumentsList = commandLine.split("\0").filter(Boolean);
    return argumentsList.includes(`--user-data-dir=${profilePath}`) ? "profile-owner" : "unrelated";
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ESRCH") return "missing";
    if (error?.code === "EACCES" || error?.code === "EPERM") return "unknown";
    throw error;
  }
}

export async function cleanupStaleEdgeSingletonLinks({
  profilePath = appPaths().browserProfile,
  platform = process.platform,
  currentHostname = os.hostname(),
  fileSystem = { readFile, readlink, stat, unlink },
} = {}) {
  if (platform !== "linux") return { cleaned: false, reason: "unsupported-platform", removed: [] };

  const hostname = String(currentHostname || "").trim();
  if (!hostname) return { cleaned: false, reason: "hostname-unavailable", removed: [] };

  const targets = new Map();
  for (const name of EDGE_SINGLETON_LINKS) {
    targets.set(name, await optionalLinkTarget(path.join(profilePath, name), fileSystem));
  }

  const lockTarget = targets.get("SingletonLock");
  const lockOwner = typeof lockTarget === "string" ? /^(.*)-(\d+)$/.exec(lockTarget) : null;
  if (!lockOwner) return { cleaned: false, reason: "lock-unavailable", removed: [] };

  const previousHostname = lockOwner[1];
  const lockPid = Number(lockOwner[2]);
  if (!Number.isSafeInteger(lockPid) || lockPid <= 0) {
    return { cleaned: false, reason: "lock-unavailable", previousHostname, currentHostname: hostname, removed: [] };
  }

  let staleReason = "hostname-changed";
  if (previousHostname === hostname) {
    const [processState, socketAlive] = await Promise.all([
      inspectProcessProfile(lockPid, profilePath, fileSystem),
      pathExists(path.join(profilePath, "SingletonSocket"), fileSystem),
    ]);
    if (processState === "profile-owner" || processState === "unknown" || socketAlive) {
      return {
        cleaned: false,
        reason: "same-host-active",
        previousHostname,
        currentHostname: hostname,
        lockPid,
        processState,
        socketAlive,
        removed: [],
      };
    }
    staleReason = "same-host-stale";
  }

  // Keep the old lock in place while removing its auxiliary links so another
  // local Edge cannot acquire the profile midway through cleanup. Each link is
  // removed only if its target still matches the snapshot read above.
  if (await optionalLinkTarget(path.join(profilePath, "SingletonLock"), fileSystem) !== lockTarget) {
    return { cleaned: false, reason: "lock-changed", previousHostname, currentHostname: hostname, removed: [] };
  }

  const removed = [];
  for (const name of EDGE_SINGLETON_LINKS) {
    if (await unlinkIfUnchanged(path.join(profilePath, name), targets.get(name), fileSystem)) removed.push(name);
  }

  return {
    cleaned: removed.includes("SingletonLock"),
    reason: staleReason,
    previousHostname,
    currentHostname: hostname,
    lockPid,
    removed,
  };
}

export async function stopSpawnedChild(child, { timeout = 2000 } = {}) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    const done = () => { clearTimeout(timer); child.off("exit", done); resolve(); };
    const timer = setTimeout(done, timeout);
    child.once("exit", done);
  });
  if (child.exitCode === null) child.kill();
}

export async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout ?? 2000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout ?? 2000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function resolveExecutable(candidate) {
  if (!candidate) return null;
  if (path.isAbsolute(candidate) || candidate.includes("/") || candidate.includes("\\")) {
    return await exists(candidate) ? candidate : null;
  }
  const directories = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const extensions = process.platform === "win32" && !path.extname(candidate)
    ? String(process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];
  for (const directory of directories) {
    for (const extension of extensions) {
      const executable = path.join(directory.replace(/^"|"$/g, ""), process.platform === "win32" ? `${candidate}${extension}` : candidate);
      if (await exists(executable)) return executable;
    }
  }
  return null;
}

export async function findEdge(config = {}) {
  if (config.edgePath) {
    const configured = await resolveExecutable(config.edgePath);
    if (!configured) throw new Error(`找不到配置的 Microsoft Edge：${config.edgePath}`);
    return configured;
  }
  for (const candidate of commonEdgePaths()) {
    const executable = await resolveExecutable(candidate);
    if (executable) return executable;
  }
  throw new Error("找不到 Microsoft Edge。请安装 Edge，或运行：aicp config set edgePath <Edge 可执行文件路径>");
}

export async function openExternalUrl(config, url) {
  const edge = await findEdge(config);
  const child = spawn(edge, [url], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  await once(child, 'spawn');
  child.unref();
}
