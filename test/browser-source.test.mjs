import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../lib/browser.mjs", import.meta.url), "utf8");

test("normal logout clears cookies without deleting the Edge profile", () => {
  const clearSession = source.slice(source.indexOf("async clearSession()"), source.indexOf("async forgetLogin()"));
  assert.match(clearSession, /Network\.clearBrowserCookies/);
  assert.doesNotMatch(clearSession, /rm\(this\.paths\.browserProfile/);
});

test("forget-login explicitly deletes the dedicated Edge profile", () => {
  const forgetLogin = source.slice(source.indexOf("async forgetLogin()"), source.indexOf("async logout("));
  assert.match(forgetLogin, /rm\(this\.paths\.browserProfile/);
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
