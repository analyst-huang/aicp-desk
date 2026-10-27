import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BrowserSession } from '../lib/browser.mjs';
import { DEFAULT_CONFIG } from '../lib/config.mjs';

const identity = { accountType: 'iam', username: 'alice', userId: 'u1' };
const stale = { id: 'stale', type: 'page', url: 'https://aicp.console.ksyun.com/#/taskDev', webSocketDebuggerUrl: 'ws://stale' };
const fresh = { id: 'fresh', type: 'page', url: DEFAULT_CONFIG.consoleUrl, webSocketDebuggerUrl: 'ws://fresh' };

async function fixture(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'aicp-console-repair-'));
  const paths = { home, browserProfile: path.join(home, 'profile'), templates: path.join(home, 'templates'), edgeConfig: path.join(home, 'edge-config') };
  await mkdir(paths.browserProfile);
  t.after(() => rm(home, { recursive: true, force: true }));
  let clock = 0;
  const browser = new BrowserSession(DEFAULT_CONFIG, { paths, now: () => clock, sleep: async ms => { clock += ms; } });
  const state = { pages: [stale], created: 0, dispatched: 0, freshIdentity: identity, freshFails: false, operationFails: false };
  browser.withBrowser = async callback => callback();
  browser.version = async () => ({ Browser: 'Edg/fixture' });
  browser.targets = async () => state.pages;
  browser.createPage = async url => { assert.equal(url, DEFAULT_CONFIG.consoleUrl); state.created++; state.pages.push(fresh); return fresh.id; };
  browser.closeActiveBrowser = async () => assert.fail('Page recovery must keep the user browser alive');
  browser.recoverLogin = async () => assert.fail('A stuck page is not an expired login');
  browser.evaluate = async (target, expression) => {
    if (expression === 'document.readyState') return 'complete';
    if (expression.includes('get_user_brief')) {
      if (target.id === stale.id || state.freshFails) throw new Error('Runtime.evaluate 执行超时');
      return { status: 200, ok: true, authenticated: true, ...state.freshIdentity };
    }
    state.dispatched++;
    assert.equal(target.id, fresh.id);
    if (state.operationFails) throw new Error('Runtime.evaluate 执行超时');
    return { status: 200, text: JSON.stringify({ data: { created: 'fixture' } }) };
  };
  await browser.rememberIdentity(identity);
  return { browser, state };
}

test('concurrent identity checks reopen a stuck console once and retain the original tab', async t => {
  const { browser, state } = await fixture(t);
  const results = await Promise.all(Array.from({ length: 5 }, () => browser.currentUser()));
  assert.deepEqual(results, Array(5).fill(identity));
  assert.equal(state.created, 1);
  assert.deepEqual(state.pages, [stale, fresh]);
  assert.equal(await browser.waitForConsoleTarget(), fresh);
  assert.equal(await browser.waitForAicpTarget(), fresh);
  assert.deepEqual((await browser.loginState()).identity, identity);
});

test('the login button can repair an already-running browser without entering credentials', async t => {
  const { browser, state } = await fixture(t);
  const status = await browser.launchLogin();
  assert.equal(status.alreadyRunning, true);
  assert.equal(status.authenticated, true);
  assert.equal(state.created, 1);
  assert.equal(state.dispatched, 0);
});

test('check-only identity requests do not reopen pages or start login recovery', async t => {
  const { browser, state } = await fixture(t);
  await assert.rejects(browser.currentUser({ autoLogin: false }), { code: 'CONSOLE_UNRESPONSIVE' });
  assert.equal(state.created, 0);
});

test('a repaired identity preflight dispatches the original mutation only once on the verified page', async t => {
  const { browser, state } = await fixture(t);
  assert.deepEqual(await browser.graphql('Create', 'mutation Create { created }', {}), { created: 'fixture' });
  assert.equal(state.created, 1);
  assert.equal(state.dispatched, 1);
});

test('a changed account after page repair blocks cloud dispatch and keeps the previous identity', async t => {
  const { browser, state } = await fixture(t);
  state.freshIdentity = { ...identity, userId: 'u2' };
  await assert.rejects(browser.graphql('Create', 'mutation Create { created }', {}), { code: 'LOGIN_ACCOUNT_CHANGED' });
  assert.equal(state.dispatched, 0);
  assert.deepEqual((await browser.loginState()).identity, identity);
});

test('a timeout after a mutation was dispatched never reopens a page or replays the operation', async t => {
  const { browser, state } = await fixture(t);
  state.pages = [fresh]; state.operationFails = true;
  await assert.rejects(browser.graphql('Create', 'mutation Create { created }', {}), /Runtime.evaluate 执行超时/);
  assert.equal(state.created, 0);
  assert.equal(state.dispatched, 1);
});

test('repeated identity timeouts do not create a stream of new tabs or claim authentication', async t => {
  const { browser, state } = await fixture(t);
  state.freshFails = true;
  for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(browser.currentUser(), { code: 'CONSOLE_UNRESPONSIVE' });
  assert.equal(state.created, 1);
  assert.equal(state.dispatched, 0);
});

test('identity permission errors are preserved without page replacement or password submission', async t => {
  const { browser, state } = await fixture(t);
  browser.evaluate = async () => ({ status: 403, authenticated: false });
  await assert.rejects(browser.currentUser(), /HTTP 403/);
  assert.equal(state.created, 0);
});

test('console selection prefers the configured origin and excludes Grafana proxy pages', async t => {
  const { browser, state } = await fixture(t);
  state.pages = [{ ...fresh, id: 'monitor', url: 'https://ksp.console.ksyun.com/webide-proxy/grafana/cluster/kaic-dashboard' }, stale, fresh];
  assert.equal(await browser.waitForConsoleTarget(), fresh);
  assert.equal(await browser.waitForAicpTarget(), fresh);
});
