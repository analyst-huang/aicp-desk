import { spawn } from "node:child_process";
import { open, readFile, rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { findEdge } from "./browser.mjs";
import { appPaths, ensureAppDirs, exists, readJson, writeJsonAtomic } from "./paths.mjs";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const REMOTE_UI_DEFAULTS = Object.freeze({
  display: ":99",
  vncPort: 5900,
  webPort: 6080,
  width: 1440,
  height: 900,
});

async function privateInstallHint() {
  return "aicp remote-ui install --yes";
}

async function installerPath(fileName) {
  const sourceScript = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", fileName);
  if (await exists(sourceScript)) return sourceScript;
  const installedScript = path.join(appPaths().installRoot, "app", "scripts", fileName);
  if (await exists(installedScript)) return installedScript;
  throw new Error("找不到 AICP 私有远端运行时安装脚本，请重新安装 AICP Desk");
}

export async function installRemoteUiRuntime({ allowNoSandbox = false, allowRoot = false, runtimeMode = "auto", platform = process.platform } = {}) {
  if (platform !== "linux") throw new Error("私有远端运行时只能安装在 Debian/Ubuntu Linux amd64 服务器上");
  if (!["auto", "private", "system"].includes(runtimeMode)) {
    throw new Error("--runtime-mode 必须是 auto、private 或 system");
  }
  if (runtimeMode === "system" && process.getuid?.() !== 0) {
    throw new Error("--runtime-mode system 会修改系统包，只能由 root 执行");
  }
  const script = await installerPath(runtimeMode === "system"
    ? "install-remote-ui-system-debian.sh"
    : "install-remote-ui-debian.sh");
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn("sh", [script], {
      stdio: "inherit",
      env: {
        ...process.env,
        AICP_INSTALL_DIR: appPaths().installRoot,
        AICP_RUNTIME_INSTALL_MODE: runtimeMode,
        ...(allowNoSandbox ? { AICP_ALLOW_NO_SANDBOX: "1" } : {}),
        ...(allowRoot ? { AICP_ALLOW_ROOT: "1" } : {}),
      },
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`私有运行时安装进程被信号 ${signal} 终止`));
      else resolve(code ?? 1);
    });
  });
  if (exitCode !== 0) throw new Error(`私有远端运行时安装失败（退出码 ${exitCode}）`);
  const runtime = appPaths().runtime;
  const rootModel = await exists(path.join(runtime, "root-model"));
  let installedMode;
  try {
    installedMode = (await readFile(path.join(runtime, "manifest.txt"), "utf8")).match(/^mode=(.+)$/m)?.[1];
  } catch {}
  return {
    installed: true,
    runtime,
    installStrategy: runtimeMode,
    mode: installedMode || (rootModel ? "root-container" : allowNoSandbox ? "user-no-sandbox" : "user-sandbox"),
    allowNoSandbox: rootModel || allowNoSandbox,
  };
}

export async function detectContainerEnvironment({ env = process.env, existsFn = exists, readFileFn = readFile } = {}) {
  if (env.container || env.KUBERNETES_SERVICE_HOST) return true;
  for (const marker of ["/.dockerenv", "/run/.containerenv"]) {
    if (await existsFn(marker)) return true;
  }
  try {
    const cgroup = await readFileFn("/proc/1/cgroup", "utf8");
    if (/(?:docker|kubepods|containerd|libpod|podman|lxc)/i.test(cgroup)) return true;
  } catch {}
  try {
    const initCommand = await readFileFn("/proc/1/cmdline", "utf8");
    if (initCommand.replaceAll("\0", " ").includes("/kaic/webide/supervisord")) return true;
  } catch {}
  return false;
}

function integerInRange(value, name, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${name} 必须是 ${minimum} 到 ${maximum} 之间的整数`);
  }
  return number;
}

export function normalizeRemoteUiOptions(options = {}) {
  const display = String(options.display ?? REMOTE_UI_DEFAULTS.display);
  if (!/^:[1-9][0-9]*$/.test(display)) throw new Error("--display 必须采用 :99 这样的格式，且不能使用 :0");
  const rawWebRoot = options.webRoot ?? options["web-root"];
  if (rawWebRoot === true || rawWebRoot === "") throw new Error("--web-root 后必须提供 noVNC 网页目录");
  const vncPort = integerInRange(options.vncPort ?? options["vnc-port"] ?? REMOTE_UI_DEFAULTS.vncPort, "--vnc-port", 1024, 65535);
  const webPort = integerInRange(options.webPort ?? options["web-port"] ?? REMOTE_UI_DEFAULTS.webPort, "--web-port", 1024, 65535);
  if (vncPort === webPort) throw new Error("--vnc-port 与 --web-port 不能相同");
  return {
    display,
    vncPort,
    webPort,
    width: integerInRange(options.width ?? REMOTE_UI_DEFAULTS.width, "--width", 800, 7680),
    height: integerInRange(options.height ?? REMOTE_UI_DEFAULTS.height, "--height", 600, 4320),
    webRoot: rawWebRoot === undefined ? undefined : String(rawWebRoot),
  };
}

async function resolveExecutable(candidate, env = process.env) {
  if (!candidate) return null;
  if (path.isAbsolute(candidate) || candidate.includes("/")) return await exists(candidate) ? candidate : null;
  const directories = [...String(env.PATH || "").split(path.delimiter).filter(Boolean), appPaths().runtimeBin];
  for (const directory of directories) {
    const executable = path.join(directory, candidate);
    if (await exists(executable)) return executable;
  }
  return null;
}

async function firstExecutable(candidates, env) {
  for (const candidate of candidates) {
    const executable = await resolveExecutable(candidate, env);
    if (executable) return executable;
  }
  return null;
}

async function findNoVnc(options = {}, env = process.env) {
  const paths = appPaths();
  const candidates = [
    options.webRoot,
    env.NOVNC_WEB,
    "/usr/share/novnc",
    "/usr/share/noVNC",
    "/opt/novnc",
    "/opt/noVNC",
    path.join(paths.runtime, "rootfs", "usr", "share", "novnc"),
    path.join(paths.runtime, "rootfs", "usr", "share", "noVNC"),
  ].filter(Boolean);
  for (const root of candidates) {
    for (const entrypoint of ["vnc.html", "vnc_lite.html"]) {
      if (await exists(path.join(root, entrypoint))) return { root, entrypoint };
    }
  }
  return null;
}

export function remoteUiProcessSpecs(options, dependencies) {
  const geometry = `${options.width}x${options.height}x24`;
  const displayEnv = { ...process.env, DISPLAY: options.display };
  const windowManagerArgs = path.basename(dependencies.windowManager).startsWith("openbox") ? ["--sm-disable"] : [];
  return [
    {
      name: "xvfb",
      command: dependencies.xvfb,
      args: [options.display, "-screen", "0", geometry, "-nolisten", "tcp"],
      env: process.env,
      wait: 700,
    },
    {
      name: "windowManager",
      command: dependencies.windowManager,
      args: windowManagerArgs,
      env: displayEnv,
      wait: 300,
    },
    {
      name: "x11vnc",
      command: dependencies.x11vnc,
      args: [
        "-display", options.display,
        "-localhost",
        "-forever",
        "-shared",
        "-rfbport", String(options.vncPort),
        "-nopw",
        "-noxdamage",
      ],
      env: displayEnv,
      wait: 500,
    },
    {
      name: "websockify",
      command: dependencies.websockify,
      args: ["--web", dependencies.noVnc.root, `127.0.0.1:${options.webPort}`, `127.0.0.1:${options.vncPort}`],
      env: process.env,
      wait: 500,
    },
  ];
}

export async function remoteUiDoctor(config, rawOptions = {}, overrides = {}) {
  const platform = overrides.platform ?? process.platform;
  const env = overrides.env ?? process.env;
  const getuid = overrides.getuid ?? (() => process.getuid?.());
  const options = normalizeRemoteUiOptions(rawOptions);
  const paths = overrides.paths ?? appPaths();
  const runtimePath = paths.runtime;
  const userId = getuid();
  const containerDetected = overrides.containerDetected ?? await detectContainerEnvironment({
    env,
    existsFn: overrides.existsFn ?? exists,
    readFileFn: overrides.readFileFn ?? readFile,
  });
  const rootModel = overrides.rootModel ?? await exists(path.join(runtimePath, "root-model"));
  const noSandbox = overrides.noSandbox ?? await exists(path.join(runtimePath, "allow-no-sandbox"));
  let runtimeManifest = overrides.runtimeManifest ?? {};
  if (!overrides.runtimeManifest) {
    try {
      runtimeManifest = Object.fromEntries((await readFile(path.join(runtimePath, "manifest.txt"), "utf8"))
        .split(/\r?\n/)
        .filter((line) => line.includes("="))
        .map((line) => {
          const separator = line.indexOf("=");
          return [line.slice(0, separator), line.slice(separator + 1)];
        }));
    } catch {}
  }
  let runtimeMode = overrides.runtimeMode;
  runtimeMode ||= runtimeManifest.mode;
  runtimeMode ||= rootModel ? "root-container" : noSandbox ? "user-no-sandbox" : "user-sandbox";
  const problems = [];
  const warnings = [];
  if (platform !== "linux") problems.push("远端 UI 模式只用于 Linux 无显示器服务器");
  if (platform === "linux" && userId === 0 && !rootModel) {
    problems.push(containerDetected
      ? "检测到容器 root，但私有运行时尚未以 root-container 模式安装；请运行 aicp remote-ui install --yes"
      : "检测到裸机 root；默认拒绝启动浏览器。确认隔离边界后可用 remote-ui install --allow-root --yes");
  }
  if (platform === "linux" && userId === 0 && rootModel) {
    warnings.push(`正在使用 ${runtimeMode} 模式：Edge 以 root 且不启用 Chromium sandbox`);
  }

  const locate = overrides.resolveExecutable ?? ((candidate) => resolveExecutable(candidate, env));
  const locateFirst = async (candidates) => {
    for (const candidate of candidates) {
      const found = await locate(candidate);
      if (found) return found;
    }
    return null;
  };
  const dependencies = {
    xvfb: await locateFirst(["Xvfb"]),
    x11vnc: await locateFirst(["x11vnc"]),
    websockify: await locateFirst(["websockify"]),
    windowManager: await locateFirst(["openbox", "openbox-session", "fluxbox"]),
  };
  const dependencyLabels = {
    xvfb: "Xvfb (xvfb)",
    x11vnc: "x11vnc",
    websockify: "websockify",
    windowManager: "openbox 或 fluxbox",
  };
  for (const [key, value] of Object.entries(dependencies)) {
    if (!value) problems.push(`缺少 ${dependencyLabels[key]}`);
  }

  const noVnc = overrides.findNoVnc
    ? await overrides.findNoVnc(options, env)
    : await findNoVnc(options, env);
  if (!noVnc) problems.push("找不到 noVNC 网页文件（可用 --web-root 指定）");

  let edge = null;
  try {
    edge = overrides.findEdge ? await overrides.findEdge(config) : await findEdge(config);
  } catch (error) {
    problems.push(error.message);
  }

  return {
    ready: problems.length === 0,
    platform,
    runningAsRoot: platform === "linux" && userId === 0,
    containerDetected,
    rootModel,
    noSandbox,
    options,
    privateRuntime: {
      path: runtimePath,
      installed: await exists(path.join(runtimePath, "manifest.txt")),
      mode: runtimeMode,
      strategy: runtimeManifest.install_strategy
        ?? (runtimeManifest.scope === "aicp-hybrid-runtime" ? "auto" : "private"),
      sources: {
        edge: runtimeManifest.edge_source ?? null,
        xvfb: runtimeManifest.xvfb_source ?? null,
        x11vnc: runtimeManifest.x11vnc_source ?? null,
        windowManager: runtimeManifest.window_manager_source ?? null,
        websockify: runtimeManifest.websockify_source ?? null,
        noVnc: runtimeManifest.novnc_source ?? null,
        xkbCompiler: runtimeManifest.xkbcomp_source ?? null,
      },
    },
    edge,
    dependencies: { ...dependencies, noVnc },
    problems,
    warnings,
    installHint: await privateInstallHint(),
  };
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function managedProcessAlive(record, platform = process.platform) {
  if (!record || !pidAlive(record.pid)) return false;
  if (platform !== "linux") return true;
  try {
    const commandLine = (await readFile(`/proc/${record.pid}/cmdline`, "utf8")).replaceAll("\0", " ");
    if (!commandLine.includes(path.basename(record.command))) return false;
    if (!(record.args ?? []).every((argument) => commandLine.includes(String(argument)))) return false;
    if (record.display) {
      const environment = await readFile(`/proc/${record.pid}/environ`, "utf8");
      if (!environment.split("\0").includes(`DISPLAY=${record.display}`)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function portIsAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function assertPortAvailable(port, label) {
  try {
    await portIsAvailable(port);
  } catch (error) {
    if (error?.code === "EADDRINUSE") throw new Error(`${label} ${port} 已被占用；请改用其他端口`);
    throw error;
  }
}

async function spawnManaged(spec) {
  let spawnError;
  const logHandle = spec.logPath ? await open(spec.logPath, "w", 0o600) : null;
  let child;
  try {
    child = spawn(spec.command, spec.args, {
      detached: true,
      stdio: logHandle ? ["ignore", logHandle.fd, logHandle.fd] : "ignore",
      env: spec.env,
    });
  } catch (error) {
    await logHandle?.close();
    throw error;
  }
  child.once("error", (error) => { spawnError = error; });
  await logHandle?.close();
  child.unref();
  await delay(spec.wait);
  if (spawnError) throw spawnError;
  if (!child.pid || child.exitCode !== null) {
    let details = "";
    if (spec.logPath) {
      try {
        details = (await readFile(spec.logPath, "utf8")).trim().split(/\r?\n/).slice(-20).join("\n");
      } catch {}
    }
    throw new Error(`${spec.name} 启动失败${details ? `\n${details}` : ""}`);
  }
  return { name: spec.name, pid: child.pid, command: spec.command, args: spec.args, display: spec.env?.DISPLAY, logPath: spec.logPath };
}

async function terminateRecord(record, { platform = process.platform, force = false } = {}) {
  if (!(await managedProcessAlive(record, platform))) return false;
  try {
    process.kill(record.pid, force ? "SIGKILL" : "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

export async function remoteUiStatus({ paths = appPaths(), platform = process.platform } = {}) {
  const state = await readJson(paths.remoteUiState, null);
  if (!state) return { configured: false, running: false, statePath: paths.remoteUiState };
  const processStatus = {};
  for (const record of state.processes ?? []) processStatus[record.name] = await managedProcessAlive(record, platform);
  const required = ["xvfb", "windowManager", "x11vnc", "websockify"];
  const running = required.every((name) => processStatus[name]);
  return {
    configured: true,
    running,
    display: state.display,
    vncPort: state.vncPort,
    webPort: state.webPort,
    url: state.url,
    startedAt: state.startedAt,
    processStatus,
    statePath: paths.remoteUiState,
  };
}

export async function stopRemoteUi({ paths = appPaths(), platform = process.platform } = {}) {
  const state = await readJson(paths.remoteUiState, null);
  if (!state) return { stopped: true, wasRunning: false, statePath: paths.remoteUiState };
  let stopped = false;
  for (const record of [...(state.processes ?? [])].reverse()) {
    stopped = (await terminateRecord(record, { platform })) || stopped;
  }
  await delay(500);
  for (const record of [...(state.processes ?? [])].reverse()) {
    await terminateRecord(record, { platform, force: true });
  }
  await rm(paths.remoteUiState, { force: true });
  return { stopped: true, wasRunning: stopped, statePath: paths.remoteUiState };
}

export async function startRemoteUi(config, rawOptions = {}, overrides = {}) {
  const paths = overrides.paths ?? appPaths();
  const platform = overrides.platform ?? process.platform;
  if (platform !== "linux") throw new Error("--remote-ui 只能在 Linux 无显示器服务器上使用");
  await ensureAppDirs();
  const options = normalizeRemoteUiOptions(rawOptions);
  const existing = await remoteUiStatus({ paths, platform });
  if (existing.running) {
    if (existing.display === options.display && existing.vncPort === options.vncPort && existing.webPort === options.webPort) {
      return { ...existing, alreadyRunning: true };
    }
    throw new Error(`远端 UI 已在端口 ${existing.webPort} 运行；请先执行 aicp remote-ui stop`);
  }
  if (existing.configured) await stopRemoteUi({ paths, platform });

  const doctor = await remoteUiDoctor(config, options, overrides);
  if (!doctor.ready) {
    throw new Error(`远端 UI 环境未就绪：${doctor.problems.join("；")}\nDebian/Ubuntu 私有安装：${doctor.installHint}`);
  }
  await assertPortAvailable(options.vncPort, "VNC 端口");
  await assertPortAvailable(options.webPort, "网页端口");

  const specs = remoteUiProcessSpecs(options, {
    ...doctor.dependencies,
    noVnc: doctor.dependencies.noVnc,
  }).map((spec) => ({ ...spec, logPath: path.join(paths.home, `remote-ui-${spec.name}.log`) }));
  const processes = [];
  try {
    for (const spec of specs) processes.push(await spawnManaged(spec));
    const url = `http://127.0.0.1:${options.webPort}/${doctor.dependencies.noVnc.entrypoint}?autoconnect=1&resize=scale`;
    const state = {
      version: 1,
      startedAt: new Date().toISOString(),
      display: options.display,
      vncPort: options.vncPort,
      webPort: options.webPort,
      url,
      processes,
    };
    await writeJsonAtomic(paths.remoteUiState, state);
    return {
      configured: true,
      running: true,
      alreadyRunning: false,
      display: options.display,
      vncPort: options.vncPort,
      webPort: options.webPort,
      url,
      startedAt: state.startedAt,
      statePath: paths.remoteUiState,
    };
  } catch (error) {
    for (const record of processes.reverse()) await terminateRecord(record, { platform });
    throw error;
  }
}
