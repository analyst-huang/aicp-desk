import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { BrowserSession, cleanupStaleEdgeSingletonLinks } from "../lib/browser.mjs";

const source = await readFile(new URL("../lib/browser.mjs", import.meta.url), "utf8");
const remoteUiSource = await readFile(new URL("../lib/remote-ui.mjs", import.meta.url), "utf8");

test("normal logout clears cookies without deleting the Edge profile", () => {
  const clearSession = source.slice(source.indexOf("async clearSession()"), source.indexOf("async forgetLogin()"));
  assert.match(clearSession, /Network\.clearBrowserCookies/);
  assert.doesNotMatch(clearSession, /rm\(this\.paths\.browserProfile/);
});

test("forget-login explicitly deletes the dedicated Edge profile", () => {
  const forgetLogin = source.slice(source.indexOf("async forgetLogin()"), source.indexOf("async logout("));
  assert.match(forgetLogin, /rm\(this\.paths\.browserProfile/);
  assert.match(forgetLogin, /rm\(this\.paths\.remoteUiProfile/);
});

test("headless Linux requests reuse the password store selected by remote UI login", () => {
  assert.match(source, /remoteUiProfile/);
  assert.match(source, /--password-store=\$\{passwordStore\}/);
  const launchHeadless = source.slice(source.indexOf("async launchHeadless()"), source.indexOf("async withBrowser("));
  assert.match(launchHeadless, /exists\(this\.paths\.remoteUiProfile\)/);
  assert.match(launchHeadless, /passwordStore: "basic"|\? "basic"/);
});

test("root-container markers apply no-sandbox even when Edge comes from the environment", () => {
  assert.match(source, /allow-no-sandbox/);
  assert.match(source, /args\.push\("--no-sandbox"\)/);
  const launchLogin = source.slice(source.indexOf("async launchLogin("), source.indexOf("async launchHeadless("));
  const launchHeadless = source.slice(source.indexOf("async launchHeadless()"), source.indexOf("async withBrowser("));
  assert.match(launchLogin, /noSandbox/);
  assert.match(launchHeadless, /noSandbox/);
});

test("Linux Edge always receives a private writable XDG config directory", () => {
  assert.match(source, /XDG_CONFIG_HOME: this\.paths\.edgeConfig/);
  const launchLogin = source.slice(source.indexOf("async launchLogin("), source.indexOf("async launchHeadless("));
  const launchHeadless = source.slice(source.indexOf("async launchHeadless()"), source.indexOf("async withBrowser("));
  assert.match(launchLogin, /browserEnvironment/);
  assert.match(launchHeadless, /browserEnvironment/);
});

test("Linux remote Edge receives UTF-8 locale and the AICP private font configuration", () => {
  assert.match(source, /--lang=zh-CN/);
  assert.match(source, /LANG: locale/);
  assert.match(source, /LC_CTYPE: locale/);
  assert.match(source, /FONTCONFIG_FILE: fontConfig/);
});

function fakeSingletonFileSystem(initialLinks, { existingTargets = [], processCommandLines = {} } = {}) {
  const links = new Map(Object.entries(initialLinks));
  const targets = new Set(existingTargets);
  const commandLines = new Map(Object.entries(processCommandLines));
  const removed = [];
  const missing = () => Object.assign(new Error("missing"), { code: "ENOENT" });
  return {
    removed,
    links,
    fileSystem: {
      async readFile(filePath) {
        if (!commandLines.has(filePath)) throw missing();
        return Buffer.from(commandLines.get(filePath));
      },
      async readlink(filePath) {
        const name = filePath.split(/[\\/]/).at(-1);
        if (!links.has(name)) throw missing();
        return links.get(name);
      },
      async stat(filePath) {
        const name = filePath.split(/[\\/]/).at(-1);
        const target = links.get(name);
        if (!target || !targets.has(target)) throw missing();
        return {};
      },
      async unlink(filePath) {
        const name = filePath.split(/[\\/]/).at(-1);
        if (!links.delete(name)) throw missing();
        removed.push(name);
      },
    },
  };
}

test("Linux Edge startup removes stale singleton links after the container hostname changes", async () => {
  const fake = fakeSingletonFileSystem({
    SingletonCookie: "3263048368727861673",
    SingletonSocket: "/tmp/com.microsoft.Edge.old/SingletonSocket",
    SingletonLock: "old-container-0-2636",
  });
  const result = await cleanupStaleEdgeSingletonLinks({
    profilePath: "/state/edge-profile",
    platform: "linux",
    currentHostname: "new-container-0",
    fileSystem: fake.fileSystem,
  });

  assert.equal(result.cleaned, true);
  assert.equal(result.previousHostname, "old-container-0");
  assert.equal(result.currentHostname, "new-container-0");
  assert.deepEqual(fake.removed, ["SingletonCookie", "SingletonSocket", "SingletonLock"]);
  assert.equal(fake.links.size, 0);
});

test("Linux Edge startup removes same-host singleton links when both the PID and socket are gone", async () => {
  const fake = fakeSingletonFileSystem({
    SingletonCookie: "cookie",
    SingletonSocket: "/tmp/com.microsoft.Edge.stale/SingletonSocket",
    SingletonLock: "current-container-0-4812",
  });
  const result = await cleanupStaleEdgeSingletonLinks({
    profilePath: "/state/edge-profile",
    platform: "linux",
    currentHostname: "current-container-0",
    fileSystem: fake.fileSystem,
  });

  assert.equal(result.cleaned, true);
  assert.equal(result.reason, "same-host-stale");
  assert.equal(result.lockPid, 4812);
  assert.deepEqual(fake.removed, ["SingletonCookie", "SingletonSocket", "SingletonLock"]);
  assert.equal(fake.links.size, 0);
});

test("Linux Edge startup preserves same-host singleton links while that PID owns the profile", async () => {
  const profilePath = "/state/edge-profile";
  const fake = fakeSingletonFileSystem({
    SingletonCookie: "cookie",
    SingletonSocket: "/tmp/com.microsoft.Edge.current/SingletonSocket",
    SingletonLock: "current-container-0-4812",
  }, {
    processCommandLines: {
      "/proc/4812/cmdline": `microsoft-edge\0--user-data-dir=${profilePath}\0`,
    },
  });
  const result = await cleanupStaleEdgeSingletonLinks({
    profilePath,
    platform: "linux",
    currentHostname: "current-container-0",
    fileSystem: fake.fileSystem,
  });

  assert.equal(result.cleaned, false);
  assert.equal(result.reason, "same-host-active");
  assert.equal(result.processState, "profile-owner");
  assert.equal(result.socketAlive, false);
  assert.deepEqual(fake.removed, []);
  assert.equal(fake.links.size, 3);
});

test("Linux Edge startup cleans a stale lock when its PID was reused by an unrelated process", async () => {
  const fake = fakeSingletonFileSystem({
    SingletonCookie: "cookie",
    SingletonSocket: "/tmp/com.microsoft.Edge.stale/SingletonSocket",
    SingletonLock: "current-container-0-4812",
  }, {
    processCommandLines: {
      "/proc/4812/cmdline": "python\0worker.py\0",
    },
  });
  const result = await cleanupStaleEdgeSingletonLinks({
    profilePath: "/state/edge-profile",
    platform: "linux",
    currentHostname: "current-container-0",
    fileSystem: fake.fileSystem,
  });

  assert.equal(result.cleaned, true);
  assert.equal(result.reason, "same-host-stale");
  assert.deepEqual(fake.removed, ["SingletonCookie", "SingletonSocket", "SingletonLock"]);
  assert.equal(fake.links.size, 0);
});

test("Linux Edge startup preserves same-host singleton links while the socket target exists", async () => {
  const socketTarget = "/tmp/com.microsoft.Edge.current/SingletonSocket";
  const fake = fakeSingletonFileSystem({
    SingletonCookie: "cookie",
    SingletonSocket: socketTarget,
    SingletonLock: "current-container-0-4812",
  }, { existingTargets: [socketTarget] });
  const result = await cleanupStaleEdgeSingletonLinks({
    profilePath: "/state/edge-profile",
    platform: "linux",
    currentHostname: "current-container-0",
    fileSystem: fake.fileSystem,
  });

  assert.equal(result.cleaned, false);
  assert.equal(result.reason, "same-host-active");
  assert.equal(result.processState, "missing");
  assert.equal(result.socketAlive, true);
  assert.deepEqual(fake.removed, []);
  assert.equal(fake.links.size, 3);
});

test("Linux Edge startup preserves same-host singleton links when process ownership cannot be inspected", async () => {
  const fake = fakeSingletonFileSystem({
    SingletonCookie: "cookie",
    SingletonSocket: "/tmp/com.microsoft.Edge.current/SingletonSocket",
    SingletonLock: "current-container-0-4812",
  });
  const accessDenied = () => Object.assign(new Error("denied"), { code: "EACCES" });
  const result = await cleanupStaleEdgeSingletonLinks({
    profilePath: "/state/edge-profile",
    platform: "linux",
    currentHostname: "current-container-0",
    fileSystem: {
      ...fake.fileSystem,
      async readFile() {
        throw accessDenied();
      },
    },
  });

  assert.equal(result.cleaned, false);
  assert.equal(result.reason, "same-host-active");
  assert.equal(result.processState, "unknown");
  assert.deepEqual(fake.removed, []);
  assert.equal(fake.links.size, 3);
});

test("browser launches run stale singleton cleanup before spawning Edge", () => {
  const launchLogin = source.slice(source.indexOf("async launchLogin("), source.indexOf("async launchHeadless("));
  const launchHeadless = source.slice(source.indexOf("async launchHeadless()"), source.indexOf("async withBrowser("));
  assert.match(launchLogin, /cleanupStaleEdgeSingletonLinks/);
  assert.match(launchHeadless, /cleanupStaleEdgeSingletonLinks/);
});

test("browser requests use a shared reference-counted session lease", () => {
  assert.match(source, /async withBrowser\(callback\)/);
  assert.match(source, /this\.browserUsers \+= 1/);
  assert.match(source, /this\.browserUsers -= 1/);
  const graphql = source.slice(source.indexOf("async graphql("), source.indexOf("async closeActiveBrowser"));
  assert.match(graphql, /return this\.withBrowser/);
});

test("platform empty-token errors are reported as an expired login", () => {
  assert.match(source, /UserTokenEmpty/);
  assert.match(source, /登录状态已过期/);
});

test("a stale passport tab requires a successful identity probe before using a restored console tab", () => {
  const waitForTarget = source.slice(source.indexOf("async waitForAicpTarget"), source.indexOf("browserArgs("));
  assert.ok(waitForTarget.indexOf("const passport =") < waitForTarget.indexOf("const target ="));
  assert.match(waitForTarget, /passport && target/);
  assert.match(waitForTarget, /fetchCurrentUser\(target\)/);
});

test("current-user probe exposes only authenticated identity fields", async () => {
  const browser = new BrowserSession({ debugPort: 9337 });
  browser.withBrowser = async (callback) => callback();
  browser.waitForConsoleTarget = async () => ({ webSocketDebuggerUrl: "ws://example" });
  browser.evaluate = async () => ({
    status: 200,
    ok: true,
    authenticated: true,
    accountType: "iam",
    username: "alice",
    userId: "user-id",
  });
  assert.deepEqual(await browser.currentUser(), {
    accountType: "iam",
    username: "alice",
    userId: "user-id",
  });
});

test("Grafana GPU metrics use a temporary authenticated target and always close it", async () => {
  const browser = new BrowserSession({ debugPort: 9337 });
  const calls = [];
  browser.withBrowser = async (callback) => callback();
  browser.waitForAicpTarget = async () => ({ id: "console" });
  browser.createTarget = async (url) => { calls.push(["create", url]); return { id: "grafana" }; };
  browser.activateTarget = async (id) => { calls.push(["activate", id]); };
  browser.targets = async () => [{
    id: "grafana",
    url: "https://ksp.console.ksyun.com/webide-proxy/grafana/cluster/kaic-grafana/d/ezyy84dHz/kaic-dashboard",
  }];
  browser.evaluate = async () => ({
    ready: true,
    panels: [{ title: "GPU 利用率", rows: [["Global-AVG", "50%", "40%", "80%"]] }],
  });
  browser.closeTarget = async (id) => { calls.push(["close", id]); };
  const result = await browser.grafanaGpuMetrics(
    "https://ksp.console.ksyun.com/webide-proxy/grafana/cluster/kaic-grafana/d/ezyy84dHz/kaic-dashboard",
  );
  assert.equal(result.panels[0].title, "GPU 利用率");
  assert.deepEqual(calls.map(([action]) => action), ["create", "activate", "close"]);
  await assert.rejects(
    () => browser.grafanaGpuMetrics("https://example.com/kaic-dashboard"),
    /无效的训练任务 Grafana 监控地址/,
  );
});

test("remote UI startup retains per-process logs and includes stderr on failure", () => {
  assert.match(remoteUiSource, /remote-ui-\$\{spec\.name\}\.log/);
  assert.match(remoteUiSource, /slice\(-20\)/);
  assert.match(remoteUiSource, /details \? `\\n\$\{details\}`/);
});

test("ordinary remote UI stop keeps Xvfb while the all mode can fully terminate it", () => {
  assert.match(remoteUiSource, /export async function suspendRemoteUi/);
  assert.match(remoteUiSource, /if \(record\.name === "xvfb"\) continue/);
  assert.match(remoteUiSource, /accessStopped: true/);
  assert.match(remoteUiSource, /resumed: resuming/);
});
