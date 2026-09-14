import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, readlink, rm, stat, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { commonEdgePaths } from "./config.mjs";
import { appPaths, ensureAppDirs, exists, readJson, writeJsonAtomic } from "./paths.mjs";

import { LoginError, expiredSession, isPassportUrl, loginPageStep } from "./login.mjs";
import { withRecoveryLock, reclaimRecoveryLock } from "./recovery-lock.mjs";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
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

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout ?? 2000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
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
    this.loginRecovery = null;
    this.authGeneration = 0;
    this.authStatePath = path.join(this.paths.home, "login-state.json");
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

  async createTarget(url) {
    return fetchJson(`${this.baseUrl}/json/new?${encodeURIComponent(url)}`, {
      method: "PUT",
      timeout: 5000,
    });
  }

  async activateTarget(targetId) {
    await fetchText(`${this.baseUrl}/json/activate/${encodeURIComponent(targetId)}`, { timeout: 5000 });
  }

  async closeTarget(targetId) {
    await fetchText(`${this.baseUrl}/json/close/${encodeURIComponent(targetId)}`, { timeout: 5000 });
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
      const passport = targets.find((item) => item.type === "page" && isPassportUrl(item.url));
      const target = targets.find((item) => item.type === "page" && item.url.startsWith("https://aicp.console.ksyun.com/"));
      if (passport && target) {
        await this.fetchCurrentUser(target);
        return target;
      }
      if (passport) throw expiredSession();
      if (target) return target;
      await delay(250);
    }
    throw new LoginError("CONSOLE_NOT_FOUND", "未找到星流平台页面，可运行 aicp login --auto 恢复页面");
  }

  async waitForConsoleTarget(timeout = 25000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      const targets = await this.targets();
      const target = targets.find((item) => item.type === "page" && item.url.startsWith("https://aicp.console.ksyun.com/"));
      if (target) return target;
      if (targets.some((item) => item.type === "page" && isPassportUrl(item.url))) {
        throw expiredSession();
      }
      await delay(250);
    }
    throw new LoginError("CONSOLE_NOT_FOUND", "未找到星流平台页面，可运行 aicp login --auto 恢复页面");
  }

  browserArgs({ headless = false, url = this.config.consoleUrl, passwordStore, noSandbox = false } = {}) {
    const args = [
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${this.config.debugPort}`,
      `--user-data-dir=${this.paths.browserProfile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--lang=zh-CN",
    ];
    if (headless) args.push("--headless=new", "--disable-gpu");
    if (passwordStore) args.push(`--password-store=${passwordStore}`);
    if (noSandbox) args.push("--no-sandbox");
    args.push(url);
    return args;
  }

  async browserEnvironment({ display } = {}) {
    if (process.platform !== "linux") return process.env;
    const locale = !process.env.LANG || /^(?:C|POSIX)$/i.test(process.env.LANG) ? "C.UTF-8" : process.env.LANG;
    const fontConfig = path.join(this.paths.runtime, "fonts.conf");
    const environment = {
      ...process.env,
      LANG: locale,
      LC_CTYPE: locale,
      XDG_CONFIG_HOME: this.paths.edgeConfig,
      ...(await exists(fontConfig) ? { FONTCONFIG_FILE: fontConfig } : {}),
      ...(display ? { DISPLAY: display } : {}),
    };
    if (display) delete environment.WAYLAND_DISPLAY;
    return environment;
  }

  async launchLogin({ display, passwordStore } = {}) {
    await ensureAppDirs();
    const running = await this.version();
    await this.enableAutoLogin();
    if (running) return { alreadyRunning: true, port: this.config.debugPort, ...(await this.status()) };
    const staleSingletons = await cleanupStaleEdgeSingletonLinks({ profilePath: this.paths.browserProfile });
    const edge = await findEdge(this.config);
    const effectivePasswordStore = passwordStore || (await exists(this.paths.remoteUiProfile) ? "basic" : undefined);
    const noSandbox = await exists(path.join(this.paths.runtime, "allow-no-sandbox"));
    const loginUrl = await this.loginUrl();
    const browserEnvironment = await this.browserEnvironment({ display });
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
    return {
      alreadyRunning: false,
      port: this.config.debugPort,
      ...(await this.status()),
      ...(staleSingletons.cleaned ? { staleSingletons } : {}),
    };
  }

  async launchHeadless() {
    await ensureAppDirs();
    if (await this.version()) return { spawned: false, child: null };
    if (!(await exists(this.paths.browserProfile))) {
      throw new LoginError("LOGIN_REQUIRED", "尚未保存登录资料，请运行 aicp login，在专用 Edge 中完成首次登录", true);
    }
    const staleSingletons = await cleanupStaleEdgeSingletonLinks({ profilePath: this.paths.browserProfile });
    const edge = await findEdge(this.config);
    const passwordStore = await exists(this.paths.remoteUiProfile) ? "basic" : undefined;
    const noSandbox = await exists(path.join(this.paths.runtime, "allow-no-sandbox"));
    const browserEnvironment = await this.browserEnvironment();
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
    return {
      spawned: true,
      child,
      ...(staleSingletons.cleaned ? { staleSingletons } : {}),
    };
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

  async evaluate(target, expression, timeout = 30000, userGesture = false) {
    const connection = await CdpConnection.connect(target.webSocketDebuggerUrl);
    try {
      const result = await connection.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture,
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

  async fetchCurrentUser(target) {
    const result = await this.evaluate(target, `
      (async () => {
        const response = await fetch("https://console.ksyun.com/i/console/framework/get_user_brief", {
          credentials: "include"
        });
        let payload = null;
        try {
          payload = await response.json();
        } catch {}
        const iam = payload?.data?.iam_user;
        const accountType = payload?.data?.type ?? null;
        const username = accountType === "iam"
          ? iam?.username
          : (iam?.user?.username ?? iam?.username);
        const userId = accountType === "iam"
          ? iam?.id
          : (iam?.user?.id ?? iam?.id);
        return {
          status: response.status,
          ok: response.ok,
          authenticated: response.ok && payload?.errno === 10000 && Boolean(iam) && Boolean(username) && userId !== null && userId !== undefined,
          accountType,
          username: username ?? null,
          userId: userId === null || userId === undefined ? null : String(userId)
        };
      })()
    `, 15000);
    if (!result) throw new Error("无法读取平台用户接口响应");
    if (result.status >= 500) throw new Error(`平台用户接口暂不可用（HTTP ${result.status}）`);
    if (result.status === 403) throw new Error("平台用户接口拒绝访问（HTTP 403），请检查权限或网络策略");
    if (!result.authenticated) throw expiredSession();
    return {
      accountType: result.accountType,
      username: result.username,
      userId: result.userId,
    };
  }

  async currentUser({ autoLogin = true } = {}) {
    return this.withBrowser(async () => {
      const identity = await this.withAuthentication(
        async () => this.fetchCurrentUser(await this.waitForConsoleTarget()), { autoLogin });
      await this.rememberIdentity(identity);
      return identity;
    });
  }

  async graphql(operationName, query, variables) {
    return this.withBrowser(async () => {
      // Resolve expiry before sending any cloud operation, especially mutations.
      const generation = this.authGeneration;
      const target = await this.withAuthentication(async () => {
        const page = await this.waitForAicpTarget();
        await this.rememberIdentity(await this.fetchCurrentUser(page));
        return page;
      });
      const request = {
        endpoint: this.config.apiEndpoint,
        operationName,
        query,
        variables,
        traceId: randomUUID(),
      };
      const expression = `
        (async () => {
          const request = ${JSON.stringify(request)};
          const response = await fetch(request.endpoint + "?action=" + encodeURIComponent(request.operationName), {
            method: "POST",
            credentials: "include",
            headers: {
              "content-type": "application/json",
              "x-trace-id": request.traceId
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
      try {
        return await this.graphqlResponse(target, expression);
      } catch (error) {
        if (error.code !== "AUTH_EXPIRED") throw error;
        // The server may have partly executed a mutation. Recover the login but
        // never replay writes or a GraphQL document we cannot classify as a query.
        const readOnly = /^\s*(?:#[^\n]*\n\s*)*query\b/.test(query) && !/\b(?:mutation|subscription)\b/.test(query);
        try { await this.recoverLogin(generation, { force: true }); }
        catch (recoveryError) {
          if (readOnly) throw recoveryError;
          throw new LoginError("OPERATION_NOT_RETRIED", `原写操作未自动重试，请先查询资源状态。会话恢复失败：${recoveryError.message}`, Boolean(recoveryError.requiresUserAction));
        }
        if (!readOnly) {
          throw new LoginError("OPERATION_NOT_RETRIED", "会话已恢复；原写操作未自动重试。请先查询资源状态，确认结果后再决定是否重试");
        }
        return this.graphqlResponse(await this.waitForAicpTarget(), expression);
      }
    });
  }

  async grafanaGpuMetrics(monitorUrl, { timeout = 60000 } = {}) {
    const parsedUrl = new URL(monitorUrl);
    if (
      parsedUrl.protocol !== "https:"
      || parsedUrl.hostname !== "ksp.console.ksyun.com"
      || !parsedUrl.pathname.includes("/webide-proxy/grafana/")
      || !parsedUrl.pathname.endsWith("/kaic-dashboard")
    ) {
      throw new Error("无效的训练任务 Grafana 监控地址");
    }

    return this.withBrowser(async () => {
      await this.waitForAicpTarget();
      const created = await this.createTarget(parsedUrl.href);
      if (!created?.id) throw new Error("无法打开训练任务 Grafana 监控页面");
      try {
        await this.activateTarget(created.id);
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeout) {
          const target = (await this.targets()).find((item) => item.id === created.id);
          if (!target) throw new Error("训练任务 Grafana 监控页面已关闭");
          if (target.url.includes("passport.ksyun.com")) {
            throw new Error("登录状态已过期，请先运行 aicp login");
          }
          const snapshot = await this.evaluate(target, `
            (() => {
              const wantedTitles = new Set([
                "GPU 利用率",
                "GPU 平均温度",
                "GPU 总功率",
                "GPU 显存",
                "Tensor Core 利用率"
              ]);
              const panels = Array.from(document.querySelectorAll('[data-testid^="data-testid Panel header "]'))
                .map((panel) => {
                  const title = panel.querySelector('h6[title]')?.getAttribute("title")
                    || panel.getAttribute("data-testid")?.replace(/^data-testid Panel header /, "")
                    || "";
                  if (!wantedTitles.has(title)) return null;
                  const headers = Array.from(panel.querySelectorAll("thead th"))
                    .map((cell) => cell.innerText.trim())
                    .filter(Boolean);
                  const rows = Array.from(panel.querySelectorAll("tbody tr"))
                    .map((row) => Array.from(row.querySelectorAll("td"))
                      .map((cell) => cell.innerText.trim())
                      .filter(Boolean))
                    .filter((row) => row.length);
                  const lines = panel.innerText.split("\\n").map((line) => line.trim()).filter(Boolean);
                  const value = rows.length
                    ? null
                    : lines.find((line) => line !== title && /^[-+]?\\d/.test(line)) || null;
                  return { title, headers, rows, value, text: lines.join("\\n") };
                })
                .filter(Boolean);
              const utilization = panels.find((panel) => panel.title === "GPU 利用率");
              return {
                url: location.href,
                title: document.title,
                ready: Boolean(utilization && (utilization.rows.length || /No data|暂无数据/i.test(utilization.text))),
                panels
              };
            })()
          `, 20000);
          if (snapshot?.url?.includes("passport.ksyun.com")) {
            throw new Error("登录状态已过期，请先运行 aicp login");
          }
          if (snapshot?.ready) return snapshot;
          await delay(500);
        }
        throw new Error("读取训练任务 GPU 监控超时，请稍后重试");
      } finally {
        await this.closeTarget(created.id).catch(() => {});
      }
    });
  }

  async graphqlResponse(target, expression) {
    const response = await this.evaluate(target, expression, 60000);
    if (!response) throw new Error("平台未返回响应；操作结果未知，请先查询资源状态");
    if (response.status === 401) throw expiredSession();
    if (response.status === 403) throw new Error("平台拒绝访问（HTTP 403），请检查操作权限");
    let payload;
    try { payload = JSON.parse(response.text); }
    catch { throw new Error(`平台返回了无法解析的响应（HTTP ${response.status}）`); }
    if (payload.errors?.length) {
      const message = payload.errors.map((item) => item.message).join("；");
      const authError = /UserTokenEmpty|token[ _.-]?(?:empty|expired|invalid)|unauthenticated|未认证|未登录|登录(?:状态)?(?:已)?过期/i;
      // Partial data means some fields may already have executed.
      if (!payload.data && payload.errors.every((item) => authError.test(item.message || ""))) throw expiredSession();
      throw new Error(message);
    }
    if (!payload.data) throw new Error("平台响应中没有 data 字段");
    return payload.data;
  }

  async loginState() {
    return readJson(this.authStatePath, {});
  }

  async updateLoginState(patch) {
    await writeJsonAtomic(this.authStatePath, { ...(await this.loginState()), ...patch });
  }

  async rememberIdentity(identity) {
    const state = await this.loginState();
    if (JSON.stringify(state.identity) !== JSON.stringify(identity) || state.failure) {
      await this.updateLoginState({ identity, failure: null, ...(state.identity && state.identity.userId !== identity.userId ? { accountId: null } : {}) });
    }
  }

  async enableAutoLogin() {
    await this.updateLoginState({ disabled: false, failure: null });
  }

  async loginUrl() {
    const state = await this.loginState();
    const url = new URL(state.identity?.accountType === "iam"
      ? "https://passport.ksyun.com/iam-login.html" : "https://passport.ksyun.com/login.html");
    url.searchParams.set("callback", this.config.consoleUrl);
    if (state.accountId) url.searchParams.set("account_id", state.accountId);
    return url.href;
  }

  async withAuthentication(callback, { autoLogin = true } = {}) {
    const generation = this.authGeneration;
    try { return await callback(); }
    catch (error) {
      if (!autoLogin || !["AUTH_EXPIRED", "CONSOLE_NOT_FOUND"].includes(error.code)) throw error;
      await this.recoverLogin(generation);
      return callback();
    }
  }

  async recoverLogin(generation = this.authGeneration, { force = false } = {}) {
    if (generation !== this.authGeneration) return;
    this.loginRecovery ??= this.withLoginLock(async () => {
      // Another process or the user may have restored the shared Edge meanwhile.
      const target = (await this.targets()).find((item) => item.type === "page" && item.url.startsWith("https://aicp.console.ksyun.com/"));
      if (target && !force) {
        try {
          const identity = await this.fetchCurrentUser(target);
          await this.verifyRecoveredIdentity(identity);
          return identity;
        } catch (error) {
          if (error.code !== "AUTH_EXPIRED") throw error;
        }
      }
      const state = await this.loginState();
      if (state.disabled) throw new LoginError("AUTO_LOGIN_DISABLED", "会话已主动清除；运行 aicp login --auto 可重新启用自动登录", true);
      if (state.failure && Date.now() - state.failure.at < 60000) {
        throw new LoginError(state.failure.code, state.failure.message, state.failure.requiresUserAction);
      }
      await this.recoveryProgress({ startedAt: new Date().toISOString(), outcome: "running", stage: "opening_login", code: null });
      try {
        const identity = await this.performLoginRecovery(state, { force });
        await this.recoveryProgress({ outcome: "succeeded", stage: "identity_verified", code: null });
        return identity;
      }
      catch (error) {
        await this.recoveryProgress({ outcome: "failed", code: error.code || "BROWSER_OR_NETWORK_ERROR" });
        if (error instanceof LoginError) {
          await this.updateLoginState({ failure: { at: Date.now(), code: error.code, message: error.message, requiresUserAction: error.requiresUserAction } });
        }
        throw error;
      }
    }).then((identity) => { this.authGeneration += 1; return identity; }).finally(() => { this.loginRecovery = null; });
    return this.loginRecovery;
  }

  async withLoginLock(callback) {
    return withRecoveryLock(`${this.authStatePath}.lock`, callback);
  }

  async recoveryProgress(patch) {
    const file = `${this.authStatePath}.recovery.json`;
    await writeJsonAtomic(file, { ...(await readJson(file, {})), ...patch, updatedAt: new Date().toISOString() });
  }

  async verifyRecoveredIdentity(identity) {
    const previous = (await this.loginState()).identity;
    if (previous && (previous.userId !== identity.userId || previous.accountType !== identity.accountType)) {
      throw new LoginError("LOGIN_ACCOUNT_CHANGED", "恢复登录后的账号与之前不同，已停止原操作；请确认账号后重新执行任务", true);
    }
    await this.rememberIdentity(identity);
    return identity;
  }

  async createPage(url) {
    const version = await this.version();
    if (!version?.webSocketDebuggerUrl) throw new Error("无法连接专用 Edge；请检查本机调试端口或执行环境的沙箱限制");
    const connection = await CdpConnection.connect(version.webSocketDebuggerUrl);
    try { return (await connection.send("Target.createTarget", { url })).targetId; }
    finally { connection.close(); }
  }

  async focusLoginField(target, point) {
    const connection = await CdpConnection.connect(target.webSocketDebuggerUrl);
    try {
      await connection.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
      await connection.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
    } finally { connection.close(); }
  }

  async performLoginRecovery(state, { timeout = 35000, interval = 350, force = false } = {}) {
    const url = await this.loginUrl();
    let target = (await this.targets()).find((item) => item.type === "page" && isPassportUrl(item.url) &&
      (state.identity?.accountType !== "iam" || new URL(item.url).pathname === "/iam-login.html"));
    const targetId = target?.id || await this.createPage(url);
    let submitted = false;
    let skipped = false;
    let focused = false;
    let consoleOpened = false;
    let lastState = "loading";
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const targets = await this.targets();
      const consoleTarget = targets.find((item) => item.type === "page" && item.url.startsWith("https://aicp.console.ksyun.com/"));
      if (consoleTarget && (!force || (submitted || skipped) && !targets.some((page) => page.id === targetId && isPassportUrl(page.url)))) {
        try { return await this.verifyRecoveredIdentity(await this.fetchCurrentUser(consoleTarget)); }
        catch (error) { if (error.code !== "AUTH_EXPIRED" && !/execution context|context.*destroyed/i.test(error.message)) throw error; }
      }
      target = targets.find((item) => item.id === targetId);
      if (target && !isPassportUrl(target.url)) {
        // Existing login tabs may have a generic console callback.
        if (!consoleOpened && target.url.startsWith("https://console.ksyun.com/")) {
          await this.createPage(this.config.consoleUrl);
          consoleOpened = true;
        }
      } else if (target?.webSocketDebuggerUrl) {
        let result;
        try {
          result = await this.evaluate(target, `(${loginPageStep.toString()})(${JSON.stringify({ submitted, skipped, accountId: state.accountId || "", expectedUsername: state.identity?.username || "" })})`, 5000, true);
        } catch (error) {
          if (!/execution context|context.*destroyed|Cannot find context/i.test(error.message)) throw error;
        }
        if (result) {
          if (lastState !== result.state) await this.recoveryProgress({ stage: result.state });
          lastState = result.state;
          if (result.state === "submitted") {
            submitted = true;
            if (result.accountId) await this.updateLoginState({ accountId: result.accountId });
          }
          if (result.state === "skipped") skipped = true;
          if (result.state === "credentials_missing" && !focused && result.focus) {
            await this.focusLoginField(target, result.focus);
            focused = true;
          }
          if (result.state === "account_selection_required") throw new LoginError("LOGIN_ACCOUNT_SELECTION_REQUIRED", "Edge 自动填充的账号与之前使用的账号不同，请在专用 Edge 中选择正确的登录资料", true);
          if (result.state === "verification_required") throw new LoginError("LOGIN_VERIFICATION_REQUIRED", "金山云当前要求验证码或身份验证，且未提供可用的跳过入口；请在专用 Edge 中完成此步骤", true);
          if (result.state === "login_failed") throw new LoginError("LOGIN_FAILED", "金山云登录表单报告错误，已停止自动提交；请检查专用 Edge 中的提示", true);
          if (result.state === "credentials_missing" && Date.now() - started > 8000) throw new LoginError("LOGIN_CREDENTIALS_REQUIRED", "Edge 未自动填充完整账号密码（IAM 还需要主账号）；请在专用 Edge 中选择保存的登录资料或完成首次登录", true);
        }
      }
      await delay(interval);
    }
    throw new LoginError("LOGIN_INTERACTION_REQUIRED", `自动登录未完成（${lastState}）；请检查专用 Edge 是否需要选择账号、验证码或其他交互`, true);
  }

  async autoLogin() {
    await this.enableAutoLogin();
    return this.status();
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

  async status({ autoLogin = true } = {}) {
    const lockStatus = await reclaimRecoveryLock(`${this.authStatePath}.lock`);
    if (lockStatus.reclaimed) {
      const previous = await readJson(`${this.authStatePath}.recovery.json`, {});
      if (previous.outcome === "running") await this.recoveryProgress({ outcome: "interrupted", code: "RECOVERY_PROCESS_EXITED" });
    }
    const browserRunning = Boolean(await this.version());
    const profileExists = await exists(this.paths.browserProfile);
    let identity = null;
    let authenticationError = null;
    let authenticationCode = profileExists ? null : "LOGIN_REQUIRED";
    let requiresUserAction = !profileExists;
    if (profileExists) {
      try {
        identity = await this.currentUser({ autoLogin });
      } catch (error) {
        authenticationError = error.message;
        authenticationCode = error.code || "BROWSER_OR_NETWORK_ERROR";
        requiresUserAction = Boolean(error.requiresUserAction);
      }
    }
    return {
      browserRunning,
      profileExists,
      authenticated: Boolean(identity),
      authenticationCode,
      requiresUserAction,
      lastRecovery: await readJson(`${this.authStatePath}.recovery.json`, null),
      username: identity?.username ?? null,
      userId: identity?.userId ?? null,
      accountType: identity?.accountType ?? null,
      ...(authenticationError ? { authenticationError } : {}),
      debugPort: this.config.debugPort,
      profilePath: this.paths.browserProfile,
    };
  }

  async clearSession() {
    await this.updateLoginState({ disabled: true, failure: null });
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
    await rm(this.authStatePath, { force: true });
    await rm(`${this.authStatePath}.recovery.json`, { force: true });
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
