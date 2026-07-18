import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { commonEdgePaths } from "./config.mjs";
import { appPaths, ensureAppDirs, exists, writeJsonAtomic } from "./paths.mjs";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function stopSpawnedChild(child) {
  if (!child || child.exitCode !== null) return;
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(2000),
  ]);
  if (child.exitCode === null) child.kill();
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout ?? 2000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
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

class CdpConnection {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject, timer } = this.pending.get(message.id);
      clearTimeout(timer);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("连接 Edge 调试端口超时")), 5000);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener("error", (error) => {
        clearTimeout(timer);
        reject(error);
      }, { once: true });
    });
    return new CdpConnection(socket);
  }

  send(method, params = {}, timeout = 20000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 执行超时`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

export class BrowserSession {
  constructor(config) {
    this.config = config;
    this.paths = appPaths();
    this.baseUrl = `http://127.0.0.1:${config.debugPort}`;
    this.browserUsers = 0;
    this.browserStart = null;
    this.browserClose = null;
  }

  async version() {
    try {
      return await fetchJson(`${this.baseUrl}/json/version`, { timeout: 1000 });
    } catch {
      return null;
    }
  }

  async targets() {
    try {
      return await fetchJson(`${this.baseUrl}/json`, { timeout: 2000 });
    } catch {
      return [];
    }
  }

  async waitForVersion(timeout = 20000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      const version = await this.version();
      if (version) {
        if (!String(version.Browser ?? "").toLowerCase().includes("edg")) {
          throw new Error(`端口 ${this.config.debugPort} 已被其他程序占用`);
        }
        return version;
      }
      await delay(200);
    }
    throw new Error("Edge 启动超时");
  }

  async waitForAicpTarget(timeout = 25000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      const targets = await this.targets();
      const passport = targets.find((item) => item.type === "page" && item.url.includes("passport.ksyun.com"));
      if (passport) throw new Error("登录状态已过期，请先运行 aicp login");
      const target = targets.find((item) => item.type === "page" && item.url.startsWith("https://aicp.console.ksyun.com/"));
      if (target) return target;
      await delay(250);
    }
    throw new Error("未找到星流平台页面；请先运行 aicp login");
  }

  browserArgs({ headless = false, url = this.config.consoleUrl, passwordStore, noSandbox = false } = {}) {
    const args = [
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${this.config.debugPort}`,
      `--user-data-dir=${this.paths.browserProfile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
    ];
    if (headless) args.push("--headless=new", "--disable-gpu");
    if (passwordStore) args.push(`--password-store=${passwordStore}`);
    if (noSandbox) args.push("--no-sandbox");
    args.push(url);
    return args;
  }

  async launchLogin({ display, passwordStore } = {}) {
    await ensureAppDirs();
    const running = await this.version();
    if (running) return { alreadyRunning: true, port: this.config.debugPort };
    const edge = await findEdge(this.config);
    const effectivePasswordStore = passwordStore || (await exists(this.paths.remoteUiProfile) ? "basic" : undefined);
    const noSandbox = await exists(path.join(this.paths.runtime, "allow-no-sandbox"));
    const loginUrl = `https://passport.ksyun.com/login.html?callback=${encodeURIComponent(this.config.consoleUrl)}`;
    const browserEnvironment = {
      ...process.env,
      ...(process.platform === "linux" ? { XDG_CONFIG_HOME: this.paths.edgeConfig } : {}),
      ...(display ? { DISPLAY: display } : {}),
    };
    if (display) delete browserEnvironment.WAYLAND_DISPLAY;
    const child = spawn(edge, this.browserArgs({ headless: false, url: loginUrl, passwordStore: effectivePasswordStore, noSandbox }), {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
      env: browserEnvironment,
    });
    child.unref();
    await this.waitForVersion();
    if (effectivePasswordStore === "basic") {
      await writeJsonAtomic(this.paths.remoteUiProfile, { passwordStore: "basic", createdAt: new Date().toISOString() });
    }
    return { alreadyRunning: false, port: this.config.debugPort };
  }

  async launchHeadless() {
    await ensureAppDirs();
    if (await this.version()) return { spawned: false, child: null };
    if (!(await exists(this.paths.browserProfile))) {
      throw new Error("尚未建立登录会话，请先运行 aicp login");
    }
    const edge = await findEdge(this.config);
    const passwordStore = await exists(this.paths.remoteUiProfile) ? "basic" : undefined;
    const noSandbox = await exists(path.join(this.paths.runtime, "allow-no-sandbox"));
    const browserEnvironment = process.platform === "linux"
      ? { ...process.env, XDG_CONFIG_HOME: this.paths.edgeConfig }
      : process.env;
    const child = spawn(edge, this.browserArgs({ headless: true, passwordStore, noSandbox }), {
      detached: false,
      stdio: "ignore",
      windowsHide: true,
      env: browserEnvironment,
    });
    child.on("error", () => {});
    try {
      await this.waitForVersion(30000);
    } catch (error) {
      child.kill();
      throw error;
    }
    return { spawned: true, child };
  }

  async withBrowser(callback) {
    if (this.browserClose) await this.browserClose;
    this.browserStart ??= this.launchHeadless().catch((error) => {
      this.browserStart = null;
      throw error;
    });
    const session = await this.browserStart;
    this.browserUsers += 1;
    try {
      return await callback();
    } finally {
      this.browserUsers -= 1;
      if (this.browserUsers === 0) {
        if (session.spawned) {
          this.browserClose = this.closeActiveBrowser().finally(async () => {
            await stopSpawnedChild(session.child);
            this.browserClose = null;
            this.browserStart = null;
          });
          await this.browserClose;
        } else {
          this.browserStart = null;
        }
      }
    }
  }

  async evaluate(target, expression, timeout = 30000) {
    const connection = await CdpConnection.connect(target.webSocketDebuggerUrl);
    try {
      const result = await connection.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: false,
      }, timeout);
      if (result.exceptionDetails) {
        const description = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
        throw new Error(description || "页面内执行失败");
      }
      return result.result?.value;
    } finally {
      connection.close();
    }
  }

  async graphql(operationName, query, variables) {
    return this.withBrowser(async () => {
      const target = await this.waitForAicpTarget();
      const request = {
        endpoint: this.config.apiEndpoint,
        operationName,
        query,
        variables,
      };
      const expression = `
        (async () => {
          const request = ${JSON.stringify(request)};
          const response = await fetch(request.endpoint + "?action=" + encodeURIComponent(request.operationName), {
            method: "POST",
            credentials: "include",
            headers: {
              "content-type": "application/json",
              "x-trace-id": crypto.randomUUID()
            },
            body: JSON.stringify({
              operationName: request.operationName,
              query: request.query,
              variables: request.variables
            })
          });
          return {
            status: response.status,
            text: await response.text()
          };
        })()
      `;
      const response = await this.evaluate(target, expression, 60000);
      if (!response || response.status === 401 || response.status === 403) {
        throw new Error("登录状态已过期，请先运行 aicp login");
      }
      let payload;
      try {
        payload = JSON.parse(response.text);
      } catch {
        throw new Error(`平台返回了无法解析的响应（HTTP ${response.status}）`);
      }
      if (payload.errors?.length) {
        const message = payload.errors.map((item) => item.message).join("；");
        if (/登录|login|expired|未认证|unauth|UserTokenEmpty|token.?empty/i.test(message)) {
          throw new Error("登录状态已过期，请先运行 aicp login");
        }
        throw new Error(message);
      }
      if (!payload.data) throw new Error("平台响应中没有 data 字段");
      return payload.data;
    });
  }

  async closeActiveBrowser() {
    const version = await this.version();
    if (!version?.webSocketDebuggerUrl) return false;
    const connection = await CdpConnection.connect(version.webSocketDebuggerUrl);
    try {
      await connection.send("Browser.close", {}, 5000).catch(() => {});
    } finally {
      connection.close();
    }
    for (let index = 0; index < 20; index += 1) {
      if (!(await this.version())) return true;
      await delay(100);
    }
    return true;
  }

  async status() {
    return {
      browserRunning: Boolean(await this.version()),
      profileExists: await exists(this.paths.browserProfile),
      debugPort: this.config.debugPort,
      profilePath: this.paths.browserProfile,
    };
  }

  async clearSession() {
    if (!(await exists(this.paths.browserProfile))) {
      return { sessionCleared: true, profileKept: false, savedPasswordsKept: false };
    }

    await this.withBrowser(async () => {
      let target;
      for (let index = 0; index < 40; index += 1) {
        target = (await this.targets()).find((item) => item.type === "page" && item.webSocketDebuggerUrl);
        if (target) break;
        await delay(125);
      }
      if (!target) throw new Error("未找到可用于清除会话的 Edge 页面");

      const connection = await CdpConnection.connect(target.webSocketDebuggerUrl);
      try {
        await connection.send("Network.clearBrowserCookies");
        for (const origin of ["https://aicp.console.ksyun.com", "https://passport.ksyun.com"]) {
          await connection.send("Storage.clearDataForOrigin", {
            origin,
            storageTypes: "local_storage,indexeddb,cache_storage,service_workers",
          }).catch(() => {});
        }
      } finally {
        connection.close();
      }
    });
    return { sessionCleared: true, profileKept: true, savedPasswordsKept: true };
  }

  async forgetLogin() {
    await this.closeActiveBrowser();
    await rm(this.paths.browserProfile, { recursive: true, force: true });
    await rm(this.paths.edgeConfig, { recursive: true, force: true });
    await rm(this.paths.remoteUiProfile, { force: true });
    return { sessionCleared: true, profileKept: false, savedPasswordsKept: false, forgotten: true };
  }

  async logout({ forget = false } = {}) {
    return forget ? this.forgetLogin() : this.clearSession();
  }
}

export async function openExternalUrl(config, url) {
  const edge = await findEdge(config);
  const child = spawn(edge, [url], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
}
