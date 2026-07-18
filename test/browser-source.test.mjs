import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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

test("a visible passport tab wins over a stale restored console tab", () => {
  const waitForTarget = source.slice(source.indexOf("async waitForAicpTarget"), source.indexOf("browserArgs("));
  assert.ok(waitForTarget.indexOf("const passport =") < waitForTarget.indexOf("const target ="));
  assert.ok(waitForTarget.indexOf("if (passport)") < waitForTarget.indexOf("if (target)"));
});

test("remote UI startup retains per-process logs and includes stderr on failure", () => {
  assert.match(remoteUiSource, /remote-ui-\$\{spec\.name\}\.log/);
  assert.match(remoteUiSource, /slice\(-20\)/);
  assert.match(remoteUiSource, /details \? `\\n\$\{details\}`/);
});
