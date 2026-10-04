import path from 'node:path';
import { exists, writeJsonAtomic } from '../paths.mjs';
import { LoginError, expiredSession, isPassportUrl } from '../login.mjs';
import { stopSpawnedChild } from './environment.mjs';

/** Owns browser processes, CDP calls and reference-counted leases; knows no authentication state. */
export class BrowserRuntime {
  /** @param {{config: import('../contracts.mjs').AppConfig, paths: ReturnType<typeof import('../paths.mjs').appPaths>, platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv,
   * dependencies: Pick<import('../browser.mjs').BrowserDependencies, 'now'|'sleep'|'connect'|'spawn'|'findEdge'|'ensureAppDirs'|'fetchJson'|'fetchText'|'cleanupSingletons'>}} dependencies */
  constructor({ config, paths, dependencies, platform = process.platform, env = process.env }) {
    this.config = config; this.paths = paths; this.dependencies = dependencies; this.platform = platform; this.env = env;
    this.baseUrl = `http://127.0.0.1:${config.debugPort}`;
    this.browserUsers = 0;
    this.browserStart = null;
    this.browserClose = null;
  }

  async version() {
    try {
      return await this.dependencies.fetchJson(`${this.baseUrl}/json/version`, { timeout: 1000 });
    } catch {
      return null;
    }
  }

  async targets() {
    try {
      return await this.dependencies.fetchJson(`${this.baseUrl}/json`, { timeout: 2000 });
    } catch {
      return [];
    }
  }

  async createTarget(url) {
    return this.dependencies.fetchJson(`${this.baseUrl}/json/new?${encodeURIComponent(url)}`, {
      method: "PUT",
      timeout: 5000,
    });
  }

  async activateTarget(targetId) {
    await this.dependencies.fetchText(`${this.baseUrl}/json/activate/${encodeURIComponent(targetId)}`, { timeout: 5000 });
  }

  async closeTarget(targetId) {
    await this.dependencies.fetchText(`${this.baseUrl}/json/close/${encodeURIComponent(targetId)}`, { timeout: 5000 });
  }

  /** @param {number} [timeout] @param {{signal?: AbortSignal}} [options] */
  async waitForVersion(timeout = 20000, { signal } = {}) {
    const startedAt = this.dependencies.now();
    while (this.dependencies.now() - startedAt < timeout) {
      signal?.throwIfAborted();
      const version = await this.version();
      signal?.throwIfAborted();
      if (version) {
        if (!String(version.Browser ?? "").toLowerCase().includes("edg")) {
          throw new Error(`端口 ${this.config.debugPort} 已被其他程序占用`);
        }
        return version;
      }
      await this.dependencies.sleep(200);
    }
    signal?.throwIfAborted();
    throw new Error("Edge 启动超时");
  }

  /** @param {import('node:child_process').ChildProcess} child @param {number} [timeout] */
  async waitForSpawnedBrowser(child, timeout = 20000) {
    const controller = new AbortController();
    const onError = error => controller.abort(error);
    // Keep handling errors until close, including asynchronous failures from kill().
    child.on('error', onError);
    child.once('close', () => child.off('error', onError));
    try {
      return await this.waitForVersion(timeout, { signal: controller.signal });
    } catch (error) {
      if (child.pid && child.exitCode === null) child.kill();
      throw error;
    }
  }

  async waitForConsoleTarget(timeout = 25000) {
    const startedAt = this.dependencies.now();
    while (this.dependencies.now() - startedAt < timeout) {
      const targets = await this.targets();
      const target = targets.find((item) => item.type === "page" && item.url.startsWith("https://aicp.console.ksyun.com/"));
      if (target) return target;
      if (targets.some((item) => item.type === "page" && isPassportUrl(item.url))) {
        throw expiredSession();
      }
      await this.dependencies.sleep(250);
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
    if (this.platform !== "linux") return this.env;
    const locale = !this.env.LANG || /^(?:C|POSIX)$/i.test(this.env.LANG) ? "C.UTF-8" : this.env.LANG;
    const fontConfig = path.join(this.paths.runtime, "fonts.conf");
    const environment = {
      ...this.env,
      LANG: locale,
      LC_CTYPE: locale,
      XDG_CONFIG_HOME: this.paths.edgeConfig,
      ...(await exists(fontConfig) ? { FONTCONFIG_FILE: fontConfig } : {}),
      ...(display ? { DISPLAY: display } : {}),
    };
    if (display) delete environment.WAYLAND_DISPLAY;
    return environment;
  }

  async startInteractive({ display, passwordStore, url = this.config.consoleUrl } = {}) {
    await this.dependencies.ensureAppDirs(this.paths);
    const running = await this.version();
    if (running) return { alreadyRunning: true, port: this.config.debugPort };
    const staleSingletons = await this.dependencies.cleanupSingletons({ profilePath: this.paths.browserProfile });
    const edge = await this.dependencies.findEdge(this.config);
    const effectivePasswordStore = passwordStore || (await exists(this.paths.remoteUiProfile) ? "basic" : undefined);
    const noSandbox = await exists(path.join(this.paths.runtime, "allow-no-sandbox"));
    const browserEnvironment = await this.browserEnvironment({ display });
    const child = this.dependencies.spawn(edge, this.browserArgs({ headless: false, url, passwordStore: effectivePasswordStore, noSandbox }), {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
      env: browserEnvironment,
    });
    child.unref();
    await this.waitForSpawnedBrowser(child);
    if (effectivePasswordStore === "basic") {
      await writeJsonAtomic(this.paths.remoteUiProfile, { passwordStore: "basic", createdAt: new Date(this.dependencies.now()).toISOString() });
    }
    return {
      alreadyRunning: false,
      port: this.config.debugPort,
      ...(staleSingletons.cleaned ? { staleSingletons } : {}),
    };
  }

  async launchHeadless() {
    await this.dependencies.ensureAppDirs(this.paths);
    if (await this.version()) return { spawned: false, child: null };
    if (!(await exists(this.paths.browserProfile))) {
      throw new LoginError("LOGIN_REQUIRED", "尚未保存登录资料，请运行 aicp login，在专用 Edge 中完成首次登录", true);
    }
    const staleSingletons = await this.dependencies.cleanupSingletons({ profilePath: this.paths.browserProfile });
    const edge = await this.dependencies.findEdge(this.config);
    const passwordStore = await exists(this.paths.remoteUiProfile) ? "basic" : undefined;
    const noSandbox = await exists(path.join(this.paths.runtime, "allow-no-sandbox"));
    const browserEnvironment = await this.browserEnvironment();
    const child = this.dependencies.spawn(edge, this.browserArgs({ headless: true, passwordStore, noSandbox }), {
      detached: false,
      stdio: "ignore",
      windowsHide: true,
      env: browserEnvironment,
    });
    await this.waitForSpawnedBrowser(child, 30000);
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
    const connection = await this.dependencies.connect(target.webSocketDebuggerUrl);
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

  async createPage(url) {
    const version = await this.version();
    if (!version?.webSocketDebuggerUrl) throw new Error("无法连接专用 Edge；请检查本机调试端口或执行环境的沙箱限制");
    const connection = await this.dependencies.connect(version.webSocketDebuggerUrl);
    try { return (await connection.send("Target.createTarget", { url })).targetId; }
    finally { connection.close(); }
  }

  async focusLoginField(target, point) {
    const connection = await this.dependencies.connect(target.webSocketDebuggerUrl);
    try {
      await connection.send("Page.bringToFront");
      await connection.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
      await connection.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
    } finally { connection.close(); }
  }

  async closeActiveBrowser() {
    const version = await this.version();
    if (!version?.webSocketDebuggerUrl) return false;
    const connection = await this.dependencies.connect(version.webSocketDebuggerUrl);
    try {
      await connection.send("Browser.close", {}, 5000).catch(() => {});
    } finally {
      connection.close();
    }
    for (let index = 0; index < 20; index += 1) {
      if (!(await this.version())) return true;
      await this.dependencies.sleep(100);
    }
    return true;
  }
}
