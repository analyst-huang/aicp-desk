import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BrowserSession } from "../lib/browser.mjs";
import { LoginError, expiredSession, isPassportUrl, loginPageStep } from "../lib/login.mjs";
const identity = { username: "alice", userId: "u1", accountType: "iam" };
const consolePage = { id: "console", type: "page", url: "https://aicp.console.ksyun.com/#/taskDev", webSocketDebuggerUrl: "ws://fixture" };
const passportPage = { id: "login", type: "page", url: "https://passport.ksyun.com/iam-login.html", webSocketDebuggerUrl: "ws://fixture" };
async function session(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), "aicp-login-test-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const browser = new BrowserSession({ debugPort: 9337, consoleUrl: consolePage.url });
  browser.paths.home = home;
  browser.authStatePath = path.join(home, "login-state.json");
  browser.withBrowser = async (callback) => callback();
  browser.waitForConsoleTarget = browser.waitForAicpTarget = async () => consolePage;
  browser.targets = async () => [];
  return browser;
}
// Execute the injected production function; stub only DOM primitives.
function fixture({ missing = false, challenge = false, skip = false, error = false, origin = "https://passport.ksyun.com" } = {}) {
  let passwords = 0, skips = 0;
  const elements = {};
  const doc = {
    location: { origin, pathname: "/iframe-login-iam.html" },
    defaultView: { getComputedStyle: () => ({ display: "block", visibility: "visible" }), Event: class {} },
    documentElement: { dataset: {} }, getElementById: (id) => elements[id],
    querySelectorAll: (selector) => selector === ".input-message-wrap" && error ? [element("bad password")] : [],
  };
  function element(value = "", visible = true, click = () => {}) {
    return { value, textContent: value, ownerDocument: doc, disabled: false, getClientRects: () => visible ? [{}] : [], getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }), click, dispatchEvent() {} };
  }
  elements.authMethod = element("password"); elements.username = element("alice");
  elements.password = element(missing ? "" : "fixture-password"); elements.account_id = element("parent");
  elements.login = element("", true, () => passwords++); elements.skip = element("", skip, () => skips++);
  elements.mfaCode = element("", challenge);
  const run = (options = {}) => vm.runInNewContext(`(${loginPageStep.toString()})(${JSON.stringify(options)})`, { document: doc, location: doc.location });
  return { run, elements, doc, counts: () => [passwords, skips] };
}
test("passport matching rejects lookalikes and insecure pages", () => {
  assert.equal(isPassportUrl(passportPage.url), true);
  for (const url of ["https://passport.ksyun.com.evil.test", "https://evil.test/?passport.ksyun.com", "http://passport.ksyun.com", "bad"]) assert.equal(isPassportUrl(url), false);
});
test("saved password submits once and never leaves page", () => {
  const page = fixture(), result = page.run();
  assert.equal(result.state, "submitted");
  assert.equal(JSON.stringify(result).includes("fixture-password"), false);
  assert.equal(page.run().state, "waiting");
  assert.deepEqual(page.counts(), [1, 0]);
});
test("official optional skip precedes visible MFA and is clicked once", () => {
  const page = fixture({ challenge: true, skip: true });
  assert.equal(page.run().state, "skipped"); assert.equal(page.run().state, "waiting");
  assert.deepEqual(page.counts(), [0, 1]);
});
test("mandatory verification, missing credentials and form errors do not submit", () => {
  for (const [options, state] of [[{ challenge: true }, "verification_required"], [{ missing: true }, "credentials_missing"], [{ error: true }, "login_failed"], [{ origin: "https://evil.test" }, "unsupported"]]) {
    const page = fixture(options); assert.equal(page.run().state, state); assert.deepEqual(page.counts(), [0, 0]);
  }
});
test("IAM parent-account hint fills only the missing parent field", () => {
  const page = fixture(); page.elements.account_id.value = "";
  assert.equal(page.run().state, "credentials_missing");
  assert.equal(page.run({ accountId: "remembered-parent" }).state, "submitted");
  assert.equal(page.elements.account_id.value, "remembered-parent");
});
test("same-origin iframe form is discovered", () => {
  const page = fixture();
  const parent = { location: { origin: "https://passport.ksyun.com", pathname: "/iam-login.html" }, defaultView: page.doc.defaultView };
  parent.querySelectorAll = () => [{ ownerDocument: parent, getClientRects: () => [{}], getBoundingClientRect: () => ({ left: 100, top: 50 }), contentDocument: page.doc }];
  assert.equal(vm.runInNewContext(`(${loginPageStep.toString()})()`, { document: parent, location: parent.location }).state, "submitted");
});
test("healthy session verifies identity without recovery", async (t) => {
  const browser = await session(t); browser.fetchCurrentUser = async () => identity;
  browser.recoverLogin = async () => assert.fail("unexpected login");
  assert.deepEqual(await browser.currentUser(), identity);
});
test("expiry recovers once; check mode never recovers", async (t) => {
  const browser = await session(t); let recovered = 0;
  browser.fetchCurrentUser = async () => { if (!recovered) throw expiredSession(); return identity; };
  browser.recoverLogin = async () => { recovered++; };
  await assert.rejects(browser.currentUser({ autoLogin: false }), { code: "AUTH_EXPIRED" });
  assert.equal(recovered, 0); assert.deepEqual(await browser.currentUser(), identity); assert.equal(recovered, 1);
});
test("concurrent callers and late failures share one recovery", async (t) => {
  const browser = await session(t); let attempts = 0;
  browser.performLoginRecovery = async () => { attempts++; await new Promise((r) => setTimeout(r, 20)); return identity; };
  await Promise.all([browser.recoverLogin(0), browser.recoverLogin(0), browser.recoverLogin(0)]);
  await browser.recoverLogin(0); assert.equal(attempts, 1);
});
test("failed recovery cooldown persists across instances", async (t) => {
  const browser = await session(t);
  browser.performLoginRecovery = async () => { throw new LoginError("LOGIN_FAILED", "登录失败", true); };
  await assert.rejects(browser.recoverLogin(), { code: "LOGIN_FAILED" });
  const second = await session(t); second.paths.home = browser.paths.home; second.authStatePath = browser.authStatePath;
  second.performLoginRecovery = async () => assert.fail("must honor cooldown");
  await assert.rejects(second.recoverLogin(), { code: "LOGIN_FAILED", requiresUserAction: true });
});
test("same-profile lock serializes processes", async (t) => {
  const first = await session(t), second = await session(t);
  second.paths.home = first.paths.home; second.authStatePath = first.authStatePath;
  const events = [];
  await Promise.all([
    first.withLoginLock(async () => { events.push("a:start"); await new Promise((r) => setTimeout(r, 20)); events.push("a:end"); }),
    second.withLoginLock(async () => { events.push("b:start"); events.push("b:end"); }),
  ]);
  assert.equal(events[0][0], events[1][0]);
});
test("logout suppresses recovery until explicitly enabled", async (t) => {
  const browser = await session(t); await browser.updateLoginState({ disabled: true });
  browser.performLoginRecovery = async () => identity;
  await assert.rejects(browser.recoverLogin(), { code: "AUTO_LOGIN_DISABLED" });
  await browser.enableAutoLogin(); assert.deepEqual(await browser.recoverLogin(), identity);
});
test("account change aborts recovery and preserves previous identity", async (t) => {
  const browser = await session(t); await browser.rememberIdentity(identity);
  await assert.rejects(browser.verifyRecoveredIdentity({ ...identity, userId: "u2" }), { code: "LOGIN_ACCOUNT_CHANGED" });
  assert.deepEqual((await browser.loginState()).identity, identity);
});
test("recovery submits, skips optional verification, then verifies identity", async (t) => {
  const browser = await session(t); await browser.rememberIdentity(identity); let steps = 0;
  browser.targets = async () => steps >= 2 ? [passportPage, consolePage] : [passportPage];
  browser.evaluate = async () => ({ state: ++steps === 1 ? "submitted" : "skipped" }); browser.fetchCurrentUser = async () => identity;
  assert.deepEqual(await browser.performLoginRecovery({ identity }, { interval: 0 }), identity); assert.equal(steps, 2);
});
test("required verification yields structured user-action reason", async (t) => {
  const browser = await session(t); browser.targets = async () => [passportPage];
  browser.evaluate = async () => ({ state: "verification_required" });
  await assert.rejects(browser.performLoginRecovery({ identity }, { interval: 0 }), { code: "LOGIN_VERIFICATION_REQUIRED", requiresUserAction: true });
});
test("redirect or timeout alone never proves successful login", async (t) => {
  const browser = await session(t); browser.targets = async () => [passportPage]; browser.evaluate = async () => ({ state: "waiting" });
  await assert.rejects(browser.performLoginRecovery({ identity }, { timeout: 5, interval: 1 }), { code: "LOGIN_INTERACTION_REQUIRED" });
});
function graphqlSetup(browser) {
  browser.fetchCurrentUser = async () => identity; let recoveries = 0;
  browser.recoverLogin = async () => { recoveries++; }; return () => recoveries;
}
test("read retries once after an explicit expired-token response", async (t) => {
  const browser = await session(t), recoveries = graphqlSetup(browser); let calls = 0;
  browser.evaluate = async () => ++calls === 1 ? { status: 200, text: JSON.stringify({ errors: [{ message: "UserTokenEmpty" }] }) } : { status: 200, text: JSON.stringify({ data: { items: [] } }) };
  assert.deepEqual(await browser.graphql("List", "query List { items }", {}), { items: [] }); assert.equal(calls, 2); assert.equal(recoveries(), 1);
});
test("writes are never replayed after dispatch", async (t) => {
  const browser = await session(t), recoveries = graphqlSetup(browser); let calls = 0;
  browser.evaluate = async () => { calls++; return { status: 401, text: "" }; };
  await assert.rejects(browser.graphql("Create", "mutation Create { create }", {}), { code: "OPERATION_NOT_RETRIED" });
  assert.equal(calls, 1); assert.equal(recoveries(), 1);
});
test("network, permission and partial-data failures do not trigger login or replay", async (t) => {
  for (const response of [null, { status: 403, text: "denied" }, { status: 200, text: JSON.stringify({ data: { created: "id" }, errors: [{ message: "UserTokenEmpty" }] }) }]) {
    const browser = await session(t), recoveries = graphqlSetup(browser); let calls = 0;
    browser.evaluate = async () => { calls++; return response; };
    await assert.rejects(browser.graphql("Create", "mutation Create { create }", {})); assert.equal(calls, 1); assert.equal(recoveries(), 0);
  }
});
test("failed auth preflight prevents dispatching mutation", async (t) => {
  const browser = await session(t); browser.fetchCurrentUser = async () => { throw expiredSession(); };
  browser.recoverLogin = async () => { throw new LoginError("LOGIN_VERIFICATION_REQUIRED", "需要验证码", true); };
  browser.evaluate = async () => assert.fail("must not dispatch");
  await assert.rejects(browser.graphql("Create", "mutation Create { create }", {}), { code: "LOGIN_VERIFICATION_REQUIRED" });
});

test("failed recovery after write retains the no-replay instruction", async (t) => {
  const browser = await session(t); browser.fetchCurrentUser = async () => identity;
  browser.evaluate = async () => ({ status: 401, text: "" });
  browser.recoverLogin = async () => { throw new LoginError("LOGIN_VERIFICATION_REQUIRED", "需要验证码", true); };
  await assert.rejects(browser.graphql("Create", "mutation Create { create }", {}), { code: "OPERATION_NOT_RETRIED", requiresUserAction: true });
});
test("documents containing a mutation are not classified as safe reads", async (t) => {
  const browser = await session(t); graphqlSetup(browser); let calls = 0;
  browser.evaluate = async () => { calls++; return { status: 401, text: "" }; };
  await assert.rejects(browser.graphql("Create", "query List { items } mutation Create { create }", {}), { code: "OPERATION_NOT_RETRIED" });
  assert.equal(calls, 1);
});
test("concurrent identity probes do not collide when writing state", async (t) => {
  const browser = await session(t); browser.fetchCurrentUser = async () => identity;
  await Promise.all(Array.from({ length: 20 }, () => browser.currentUser()));
  assert.deepEqual((await browser.loginState()).identity, identity);
});
test("forced API-token recovery does not accept the old console identity", async (t) => {
  const browser = await session(t); await browser.rememberIdentity(identity);
  browser.targets = async () => [passportPage, consolePage];
  browser.fetchCurrentUser = async () => assert.fail("old identity must not satisfy forced login");
  browser.evaluate = async () => ({ state: "verification_required" });
  await assert.rejects(browser.performLoginRecovery({ identity }, { force: true }), { code: "LOGIN_VERIFICATION_REQUIRED" });
});
test("autofilled different account is not submitted", () => {
  const page = fixture();
  assert.equal(page.run({ expectedUsername: "bob" }).state, "account_selection_required");
  assert.deepEqual(page.counts(), [0, 0]);
});

test("manual authentication retains the last recovery failure and stage", async (t) => {
  const browser = await session(t);
  browser.performLoginRecovery = async () => {
    await browser.recoveryProgress({ stage: "credentials_missing" });
    throw new LoginError("LOGIN_CREDENTIALS_REQUIRED", "missing", true);
  };
  await assert.rejects(browser.recoverLogin(), { code: "LOGIN_CREDENTIALS_REQUIRED" });
  await browser.rememberIdentity(identity);
  await browser.enableAutoLogin();
  const { readFile } = await import("node:fs/promises");
  const record = JSON.parse(await readFile(`${browser.authStatePath}.recovery.json`, "utf8"));
  assert.equal(record.outcome, "failed");
  assert.equal(record.stage, "credentials_missing");
  assert.equal(record.code, "LOGIN_CREDENTIALS_REQUIRED");
});
