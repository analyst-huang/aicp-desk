import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { BrowserSession } from '../lib/browser.mjs';
import { expiredSession } from '../lib/login.mjs';

async function fixture(t, overrides = {}) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'aicp-boundaries-'));
  const paths = { home, browserProfile: path.join(home, 'profile'), edgeConfig: path.join(home, 'xdg'), runtime: path.join(home, 'runtime'), remoteUiProfile: path.join(home, 'remote.json') };
  for (const key of ['browserProfile', 'edgeConfig', 'runtime']) await mkdir(paths[key]);
  t.after(() => rm(home, { recursive: true, force: true }));
  return { paths, browser: new BrowserSession({ debugPort: 9337, consoleUrl: 'https://aicp.console.ksyun.com/', apiEndpoint: 'https://fixture/graphql' }, { paths, ...overrides }) };
}

test('logout clears cookies and origin storage, while forget deletes only the dedicated profile', async t => {
  const sent = [];
  let closed = 0;
  const { browser, paths } = await fixture(t, { connect: async () => ({ send: async (...args) => sent.push(args), close: () => closed++ }) });
  const marker = path.join(paths.browserProfile, 'saved-password-marker');
  await writeFile(marker, 'kept');
  await writeFile(paths.remoteUiProfile, '{}');
  browser.withBrowser = async callback => callback();
  browser.targets = async () => [{ type: 'page', webSocketDebuggerUrl: 'ws://fixture' }];
  assert.equal((await browser.logout()).savedPasswordsKept, true);
  assert.equal(await readFile(marker, 'utf8'), 'kept');
  assert.equal(sent[0][0], 'Network.clearBrowserCookies');
  assert.deepEqual(sent.slice(1).map(([, params]) => params.origin), ['https://aicp.console.ksyun.com', 'https://passport.ksyun.com']);
  assert.equal(closed, 1);
  assert.equal((await browser.loginState()).disabled, true);
  browser.closeActiveBrowser = async () => {};
  assert.equal((await browser.logout({ forget: true })).forgotten, true);
  for (const key of ['browserProfile', 'edgeConfig', 'remoteUiProfile']) await assert.rejects(access(paths[key]), { code: 'ENOENT' });
  await access(paths.home);
});

test('interactive and headless launches share private Linux settings and clean before spawn', async t => {
  const calls = [], launches = [];
  const child = Object.assign(new EventEmitter(), { unref() {}, kill() {}, exitCode: 0 });
  const { browser, paths } = await fixture(t, {
    platform: 'linux', env: { LANG: 'C', WAYLAND_DISPLAY: 'wayland-0' },
    ensureAppDirs: async () => {}, findEdge: async () => '/fixture/edge',
    cleanupSingletons: async () => { calls.push('cleanup'); return { cleaned: true }; },
    spawn: (executable, args, options) => { calls.push('spawn'); launches.push({ executable, args, options }); return child; },
  });
  await writeFile(path.join(paths.runtime, 'allow-no-sandbox'), '');
  await writeFile(path.join(paths.runtime, 'fonts.conf'), '');
  await writeFile(paths.remoteUiProfile, '{}');
  browser.version = async () => null;
  browser.waitForVersion = async () => ({});
  browser.status = async () => ({ authenticated: true });
  await browser.launchLogin({ display: ':109' });
  await browser.launchHeadless();
  assert.deepEqual(calls, ['cleanup', 'spawn', 'cleanup', 'spawn']);
  for (const { args, options } of launches) {
    assert.ok(args.includes('--password-store=basic'));
    assert.ok(args.includes('--no-sandbox'));
    assert.ok(args.includes('--lang=zh-CN'));
    assert.ok(args.includes(`--user-data-dir=${paths.browserProfile}`));
    assert.equal(options.env.XDG_CONFIG_HOME, paths.edgeConfig);
    assert.equal(options.env.LANG, 'C.UTF-8');
    assert.equal(options.env.LC_CTYPE, 'C.UTF-8');
    assert.equal(options.env.FONTCONFIG_FILE, path.join(paths.runtime, 'fonts.conf'));
  }
  assert.equal(launches[0].options.env.DISPLAY, ':109');
  assert.equal(launches[0].options.env.WAYLAND_DISPLAY, undefined);
  assert.ok(launches[1].args.includes('--headless=new'));
  assert.equal(launches[1].options.windowsHide, true);
});

test('a passport and console pair must pass an identity probe before using the console', async () => {
  const browser = new BrowserSession({ debugPort: 9337 });
  const consoleTarget = { type: 'page', url: 'https://aicp.console.ksyun.com/' };
  browser.targets = async () => [{ type: 'page', url: 'https://passport.ksyun.com/login.html' }, consoleTarget];
  let probes = 0;
  browser.fetchCurrentUser = async () => { probes++; throw expiredSession(); };
  await assert.rejects(browser.waitForAicpTarget(), { code: 'AUTH_EXPIRED' });
  browser.fetchCurrentUser = async () => { probes++; return { userId: 'verified' }; };
  assert.equal(await browser.waitForAicpTarget(), consoleTarget);
  assert.equal(probes, 2);
});

test('GraphQL creates a trace ID outside the page and transmits it with the request', async () => {
  const browser = new BrowserSession({ debugPort: 9337, apiEndpoint: 'https://fixture/graphql' });
  browser.withBrowser = async callback => callback();
  browser.withAuthentication = async callback => callback();
  browser.waitForAicpTarget = async () => ({});
  browser.fetchCurrentUser = async () => ({});
  browser.rememberIdentity = async () => {};
  const requests = [];
  browser.evaluate = async (_target, expression) => vm.runInNewContext(expression, {
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      return { status: 200, text: async () => JSON.stringify({ data: { ok: true } }) };
    },
  });
  assert.deepEqual(await browser.graphql('List', 'query List { ok }', {}), { ok: true });
  assert.match(requests[0].headers['x-trace-id'], /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  assert.equal(requests[0].credentials, 'include');
  assert.equal(JSON.parse(requests[0].body).operationName, 'List');
});
