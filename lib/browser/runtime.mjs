import path from 'node:path';
import { exists, writeJsonAtomic } from '../paths.mjs';
import { LoginError, expiredSession, isPassportUrl } from '../login.mjs';
import { cleanupStaleEdgeSingletonLinks, stopSpawnedChild } from './environment.mjs';

/** BrowserRuntime depends on the session port, not on CLI/HTTP entry points. */
export class BrowserRuntime {
  constructor(host) { this.host = host; }

  async version() {
    const host = this.host;
    try {
      return await host.dependencies.fetchJson(`${host.baseUrl}/json/version`, { timeout: 1000 });
    } catch {
      return null;
    }
  }

  async targets() {
    const host = this.host;
    try {
      return await host.dependencies.fetchJson(`${host.baseUrl}/json`, { timeout: 2000 });
    } catch {
      return [];
    }
  }

  async createTarget(url) {
    const host = this.host;
    return host.dependencies.fetchJson(`${host.baseUrl}/json/new?${encodeURIComponent(url)}`, {
      method: "PUT",
      timeout: 5000,
    });
  }

  async activateTarget(targetId) {
    const host = this.host;
    await host.dependencies.fetchText(`${host.baseUrl}/json/activate/${encodeURIComponent(targetId)}`, { timeout: 5000 });
  }

  async closeTarget(targetId) {
    const host = this.host;
    await host.dependencies.fetchText(`${host.baseUrl}/json/close/${encodeURIComponent(targetId)}`, { timeout: 5000 });
  }

  async waitForVersion(timeout = 20000) {
    const host = this.host;
    const startedAt = host.dependencies.now();
    while (host.dependencies.now() - startedAt < timeout) {
      const version = await host.version();
      if (version) {
        if (!String(version.Browser ?? "").toLowerCase().includes("edg")) {
          throw new Error(`端口 ${host.config.debugPort} 已被其他程序占用`);
        }
        return version;
      }
      await host.dependencies.sleep(200);
    }
    throw new Error("Edge 启动超时");
  }

  async waitForAicpTarget(timeout = 25000) {
    const host = this.host;
    const startedAt = host.dependencies.now();
    while (host.dependencies.now() - startedAt < timeout) {
      const targets = await host.targets();
      const passport = targets.find((item) => item.type === "page" && isPassportUrl(item.url));
      const target = targets.find((item) => item.type === "page" && item.url.startsWith("https://aicp.console.ksyun.com/"));
      if (passport && target) {
        await host.fetchCurrentUser(target);
        return target;
      }
      if (passport) throw expiredSession();
      if (target) return target;
      await host.dependencies.sleep(250);
    }
    throw new LoginError("CONSOLE_NOT_FOUND", "未找到星流平台页面，可运行 aicp login --auto 恢复页面");
  }

  async waitForConsoleTarget(timeout = 25000) {
    const host = this.host;
    const startedAt = host.dependencies.now();
    while (host.dependencies.now() - startedAt < timeout) {
      const targets = await host.targets();
      const target = targets.find((item) => item.type === "page" && item.url.startsWith("https://aicp.console.ksyun.com/"));
      if (target) return target;
      if (targets.some((item) => item.type === "page" && isPassportUrl(item.url))) {
        throw expiredSession();
      }
      await host.dependencies.sleep(250);
    }
    throw new LoginError("CONSOLE_NOT_FOUND", "未找到星流平台页面，可运行 aicp login --auto 恢复页面");
  }

  browserArgs({ headless = false, url = this.host.config.consoleUrl, passwordStore, noSandbox = false } = {}) {
    const host = this.host;
    const args = [
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${host.config.debugPort}`,
      `--user-data-dir=${host.paths.browserProfile}`,
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
    const host = this.host;
    if (process.platform !== "linux") return process.env;
    const locale = !process.env.LANG || /^(?:C|POSIX)$/i.test(process.env.LANG) ? "C.UTF-8" : process.env.LANG;
    const fontConfig = path.join(host.paths.runtime, "fonts.conf");
    const environment = {
      ...process.env,
      LANG: locale,
      LC_CTYPE: locale,
      XDG_CONFIG_HOME: host.paths.edgeConfig,
      ...(await exists(fontConfig) ? { FONTCONFIG_FILE: fontConfig } : {}),
      ...(display ? { DISPLAY: display } : {}),
    };
    if (display) delete environment.WAYLAND_DISPLAY;
    return environment;
  }

  async launchLogin({ display, passwordStore } = {}) {
    const host = this.host;
    await host.dependencies.ensureAppDirs(host.paths);
    const running = await host.version();
    await host.enableAutoLogin();
    if (running) return { alreadyRunning: true, port: host.config.debugPort, ...(await host.status()) };
    const staleSingletons = await cleanupStaleEdgeSingletonLinks({ profilePath: host.paths.browserProfile });
    const edge = await host.dependencies.findEdge(host.config);
    const effectivePasswordStore = passwordStore || (await exists(host.paths.remoteUiProfile) ? "basic" : undefined);
    const noSandbox = await exists(path.join(host.paths.runtime, "allow-no-sandbox"));
    const loginUrl = await host.loginUrl();
    const browserEnvironment = await host.browserEnvironment({ display });
    const child = host.dependencies.spawn(edge, host.browserArgs({ headless: false, url: loginUrl, passwordStore: effectivePasswordStore, noSandbox }), {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
      env: browserEnvironment,
    });
    child.unref();
    await host.waitForVersion();
    if (effectivePasswordStore === "basic") {
      await writeJsonAtomic(host.paths.remoteUiProfile, { passwordStore: "basic", createdAt: new Date(host.dependencies.now()).toISOString() });
    }
    return {
      alreadyRunning: false,
      port: host.config.debugPort,
      ...(await host.status()),
      ...(staleSingletons.cleaned ? { staleSingletons } : {}),
    };
  }

  async launchHeadless() {
    const host = this.host;
    await host.dependencies.ensureAppDirs(host.paths);
    if (await host.version()) return { spawned: false, child: null };
    if (!(await exists(host.paths.browserProfile))) {
      throw new LoginError("LOGIN_REQUIRED", "尚未保存登录资料，请运行 aicp login，在专用 Edge 中完成首次登录", true);
    }
    const staleSingletons = await cleanupStaleEdgeSingletonLinks({ profilePath: host.paths.browserProfile });
    const edge = await host.dependencies.findEdge(host.config);
    const passwordStore = await exists(host.paths.remoteUiProfile) ? "basic" : undefined;
    const noSandbox = await exists(path.join(host.paths.runtime, "allow-no-sandbox"));
    const browserEnvironment = await host.browserEnvironment();
    const child = host.dependencies.spawn(edge, host.browserArgs({ headless: true, passwordStore, noSandbox }), {
      detached: false,
      stdio: "ignore",
      windowsHide: true,
      env: browserEnvironment,
    });
    child.on("error", () => {});
    try {
      await host.waitForVersion(30000);
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
    const host = this.host;
    if (host.browserClose) await host.browserClose;
    host.browserStart ??= host.launchHeadless().catch((error) => {
      host.browserStart = null;
      throw error;
    });
    const session = await host.browserStart;
    host.browserUsers += 1;
    try {
      return await callback();
    } finally {
      host.browserUsers -= 1;
      if (host.browserUsers === 0) {
        if (session.spawned) {
          host.browserClose = host.closeActiveBrowser().finally(async () => {
            await stopSpawnedChild(session.child);
            host.browserClose = null;
            host.browserStart = null;
          });
          await host.browserClose;
        } else {
          host.browserStart = null;
        }
      }
    }
  }

  async evaluate(target, expression, timeout = 30000, userGesture = false) {
    const host = this.host;
    const connection = await host.dependencies.connect(target.webSocketDebuggerUrl);
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
    const host = this.host;
    const version = await host.version();
    if (!version?.webSocketDebuggerUrl) throw new Error("无法连接专用 Edge；请检查本机调试端口或执行环境的沙箱限制");
    const connection = await host.dependencies.connect(version.webSocketDebuggerUrl);
    try { return (await connection.send("Target.createTarget", { url })).targetId; }
    finally { connection.close(); }
  }

  async focusLoginField(target, point) {
    const host = this.host;
    const connection = await host.dependencies.connect(target.webSocketDebuggerUrl);
    try {
      await connection.send("Page.bringToFront");
      await connection.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
      await connection.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
    } finally { connection.close(); }
  }

  async closeActiveBrowser() {
    const host = this.host;
    const version = await host.version();
    if (!version?.webSocketDebuggerUrl) return false;
    const connection = await host.dependencies.connect(version.webSocketDebuggerUrl);
    try {
      await connection.send("Browser.close", {}, 5000).catch(() => {});
    } finally {
      connection.close();
    }
    for (let index = 0; index < 20; index += 1) {
      if (!(await host.version())) return true;
      await host.dependencies.sleep(100);
    }
    return true;
  }
}
