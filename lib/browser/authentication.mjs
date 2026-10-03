import { rm } from 'node:fs/promises';
import { exists, readJson, updateJsonAtomic } from '../paths.mjs';
import { LoginError, expiredSession, isPassportUrl, loginPageStep } from '../login.mjs';
import { reclaimRecoveryLock } from '../recovery-lock.mjs';

/** SessionAuthentication depends on the session port, not on CLI/HTTP entry points. */
export class SessionAuthentication {
  constructor(host) { this.host = host; }

  async fetchCurrentUser(target) {
    const host = this.host;
    const result = await host.evaluate(target, `
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
    const host = this.host;
    return host.withBrowser(async () => {
      const identity = await host.withAuthentication(
        async () => host.fetchCurrentUser(await host.waitForConsoleTarget()), { autoLogin });
      await host.rememberIdentity(identity);
      return identity;
    });
  }

  async loginState() {
    const host = this.host;
    return readJson(host.authStatePath, {});
  }

  async updateLoginState(patch) {
    const host = this.host;
    await updateJsonAtomic(host.authStatePath, (state) => ({ ...state, ...patch }));
  }

  async rememberIdentity(identity) {
    const host = this.host;
    const state = await host.loginState();
    if (JSON.stringify(state.identity) !== JSON.stringify(identity) || state.failure) {
      await host.updateLoginState({ identity, failure: null, ...(state.identity && state.identity.userId !== identity.userId ? { accountId: null } : {}) });
    }
  }

  async enableAutoLogin() {
    const host = this.host;
    await host.updateLoginState({ disabled: false, failure: null });
  }

  async loginUrl() {
    const host = this.host;
    const state = await host.loginState();
    const url = new URL(state.identity?.accountType === "iam"
      ? "https://passport.ksyun.com/iam-login.html" : "https://passport.ksyun.com/login.html");
    url.searchParams.set("callback", host.config.consoleUrl);
    if (state.accountId) url.searchParams.set("account_id", state.accountId);
    return url.href;
  }

  async withAuthentication(callback, { autoLogin = true } = {}) {
    const host = this.host;
    const generation = host.authGeneration;
    try { return await callback(); }
    catch (error) {
      if (!autoLogin || !["AUTH_EXPIRED", "CONSOLE_NOT_FOUND"].includes(error.code)) throw error;
      await host.recoverLogin(generation);
      return callback();
    }
  }

  async recoverLogin(generation = this.host.authGeneration, { force = false } = {}) {
    const host = this.host;
    if (generation !== host.authGeneration) return;
    host.loginRecovery ??= host.withLoginLock(async () => {
      // Another process or the user may have restored the shared Edge meanwhile.
      const target = (await host.targets()).find((item) => item.type === "page" && item.url.startsWith("https://aicp.console.ksyun.com/"));
      if (target && !force) {
        try {
          const identity = await host.fetchCurrentUser(target);
          await host.verifyRecoveredIdentity(identity);
          return identity;
        } catch (error) {
          if (error.code !== "AUTH_EXPIRED") throw error;
        }
      }
      const state = await host.loginState();
      if (state.disabled) throw new LoginError("AUTO_LOGIN_DISABLED", "会话已主动清除；运行 aicp login --auto 可重新启用自动登录", true);
      if (state.failure && host.dependencies.now() - state.failure.at < 60000) {
        throw new LoginError(state.failure.code, state.failure.message, state.failure.requiresUserAction);
      }
      await host.recoveryProgress({ startedAt: new Date(host.dependencies.now()).toISOString(), outcome: "running", stage: "opening_login", code: null, field: null });
      try {
        const identity = await host.performLoginRecovery(state, { force });
        await host.recoveryProgress({ outcome: "succeeded", stage: "identity_verified", code: null });
        return identity;
      }
      catch (error) {
        await host.recoveryProgress({ outcome: "failed", code: error.code || "BROWSER_OR_NETWORK_ERROR" });
        if (error instanceof LoginError) {
          await host.updateLoginState({ failure: { at: host.dependencies.now(), code: error.code, message: error.message, requiresUserAction: error.requiresUserAction } });
        }
        throw error;
      }
    }).then((identity) => { host.authGeneration += 1; return identity; }).finally(() => { host.loginRecovery = null; });
    return host.loginRecovery;
  }

  async withLoginLock(callback) {
    const host = this.host;
    return host.dependencies.withRecoveryLock(`${host.authStatePath}.lock`, callback);
  }

  async recoveryProgress(patch) {
    const host = this.host;
    const file = `${host.authStatePath}.recovery.json`;
    await updateJsonAtomic(file, (state) => ({ ...state, ...patch, updatedAt: new Date(host.dependencies.now()).toISOString() }));
  }

  async verifyRecoveredIdentity(identity) {
    const host = this.host;
    const previous = (await host.loginState()).identity;
    if (previous && (previous.userId !== identity.userId || previous.accountType !== identity.accountType)) {
      throw new LoginError("LOGIN_ACCOUNT_CHANGED", "恢复登录后的账号与之前不同，已停止原操作；请确认账号后重新执行任务", true);
    }
    await host.rememberIdentity(identity);
    return identity;
  }

  async performLoginRecovery(state, { timeout = 35000, interval = 350, force = false } = {}) {
    const host = this.host;
    const accountId = state.accountId || await host.dependencies.readSavedParentAccount(host.paths.browserProfile);
    const url = await host.loginUrl();
    let target = (await host.targets()).find((item) => item.type === "page" && isPassportUrl(item.url) &&
      (state.identity?.accountType !== "iam" || new URL(item.url).pathname === "/iam-login.html"));
    let targetId = target?.id || await host.createPage(url);
    let replacedStalePage = false;
    let submitted = false;
    let skipped = false;
    const focusedFields = new Set();
    let consoleOpened = false;
    let lastState = "loading";
    const started = host.dependencies.now();
    while (host.dependencies.now() - started < timeout) {
      const targets = await host.targets();
      const consoleTarget = targets.find((item) => item.type === "page" && item.url.startsWith("https://aicp.console.ksyun.com/"));
      if (consoleTarget && (!force || (submitted || skipped) && !targets.some((page) => page.id === targetId && isPassportUrl(page.url)))) {
        try { return await host.verifyRecoveredIdentity(await host.fetchCurrentUser(consoleTarget)); }
        catch (error) { if (error.code !== "AUTH_EXPIRED" && !/execution context|context.*destroyed/i.test(error.message)) throw error; }
      }
      target = targets.find((item) => item.id === targetId);
      if (target && !isPassportUrl(target.url)) {
        // Existing login tabs may have a generic console callback.
        if (!consoleOpened && target.url.startsWith("https://console.ksyun.com/")) {
          await host.createPage(host.config.consoleUrl);
          consoleOpened = true;
        }
      } else if (target?.webSocketDebuggerUrl) {
        let result;
        try {
          result = await host.evaluate(target, `(${loginPageStep.toString()})(${JSON.stringify({ submitted, skipped, accountId, expectedUsername: state.identity?.username || "" })})`, 5000, true);
        } catch (error) {
          if (!/execution context|context.*destroyed|Cannot find context/i.test(error.message)) throw error;
        }
        if (result) {
          if (lastState !== result.state) await host.recoveryProgress({ stage: result.state });
          lastState = result.state;
          if (result.state === "stale_submission") {
            if (replacedStalePage) throw new LoginError("LOGIN_FAILED", "登录页保留了旧提交状态，请检查专用 Edge 中的提示", true);
            targetId = await host.createPage(url);
            replacedStalePage = true;
            continue;
          }
          if (result.state === "submitted") {
            submitted = true;
            if (result.accountId) await host.updateLoginState({ accountId: result.accountId });
          }
          if (result.state === "skipped") skipped = true;
          if (result.state === "credentials_missing" && !focusedFields.has(result.field) && result.focus) {
            await host.recoveryProgress({ stage: "selecting_saved_info", field: result.field });
            await host.focusLoginField(target, result.focus);
            focusedFields.add(result.field);
          }
          if (result.state === "account_selection_required") throw new LoginError("LOGIN_ACCOUNT_SELECTION_REQUIRED", "Edge 自动填充的账号与之前使用的账号不同，请在专用 Edge 中选择正确的登录资料", true);
          if (result.state === "verification_required") throw new LoginError("LOGIN_VERIFICATION_REQUIRED", "金山云当前要求验证码或身份验证，且未提供可用的跳过入口；请在专用 Edge 中完成此步骤", true);
          if (result.state === "login_failed") throw new LoginError("LOGIN_FAILED", "金山云登录表单报告错误，已停止自动提交；请检查专用 Edge 中的提示", true);
          if (result.state === "credentials_missing" && host.dependencies.now() - started > 8000) {
            const labels = { account_id: "IAM 主账号", username: "用户名", password: "密码" };
            const missing = (result.missingFields || []).map((field) => labels[field]).filter(Boolean).join("、") || "登录资料";
            throw new LoginError("LOGIN_CREDENTIALS_REQUIRED", `已尝试选择 Edge 保存的资料，仍缺少${missing}；请检查专用 Edge 中的 Saved info 或保存的登录资料`, true);
          }
        }
      }
      await host.dependencies.sleep(interval);
    }
    throw new LoginError("LOGIN_INTERACTION_REQUIRED", `自动登录未完成（${lastState}）；请检查专用 Edge 是否需要选择账号、验证码或其他交互`, true);
  }

  async autoLogin() {
    const host = this.host;
    await host.enableAutoLogin();
    return host.status();
  }

  async status({ autoLogin = true } = {}) {
    const host = this.host;
    const lockStatus = await reclaimRecoveryLock(`${host.authStatePath}.lock`);
    if (lockStatus.reclaimed) {
      const previous = await readJson(`${host.authStatePath}.recovery.json`, {});
      if (previous.outcome === "running") await host.recoveryProgress({ outcome: "interrupted", code: "RECOVERY_PROCESS_EXITED" });
    }
    const browserRunning = Boolean(await host.version());
    const profileExists = await exists(host.paths.browserProfile);
    let identity = null;
    let authenticationError = null;
    let authenticationCode = profileExists ? null : "LOGIN_REQUIRED";
    let requiresUserAction = !profileExists;
    if (profileExists) {
      try {
        identity = await host.currentUser({ autoLogin });
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
      lastRecovery: await readJson(`${host.authStatePath}.recovery.json`, null),
      username: identity?.username ?? null,
      userId: identity?.userId ?? null,
      accountType: identity?.accountType ?? null,
      ...(authenticationError ? { authenticationError } : {}),
      debugPort: host.config.debugPort,
      profilePath: host.paths.browserProfile,
    };
  }

  async clearSession() {
    const host = this.host;
    await host.updateLoginState({ disabled: true, failure: null });
    if (!(await exists(host.paths.browserProfile))) {
      return { sessionCleared: true, profileKept: false, savedPasswordsKept: false };
    }

    await host.withBrowser(async () => {
      let target;
      for (let index = 0; index < 40; index += 1) {
        target = (await host.targets()).find((item) => item.type === "page" && item.webSocketDebuggerUrl);
        if (target) break;
        await host.dependencies.sleep(125);
      }
      if (!target) throw new Error("未找到可用于清除会话的 Edge 页面");

      const connection = await host.dependencies.connect(target.webSocketDebuggerUrl);
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
    const host = this.host;
    await host.closeActiveBrowser();
    await rm(host.paths.browserProfile, { recursive: true, force: true });
    await rm(host.paths.edgeConfig, { recursive: true, force: true });
    await rm(host.paths.remoteUiProfile, { force: true });
    await rm(host.authStatePath, { force: true });
    await rm(`${host.authStatePath}.recovery.json`, { force: true });
    return { sessionCleared: true, profileKept: false, savedPasswordsKept: false, forgotten: true };
  }

  async logout({ forget = false } = {}) {
    const host = this.host;
    return forget ? host.forgetLogin() : host.clearSession();
  }
}
