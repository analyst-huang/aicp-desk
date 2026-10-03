import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { BrowserSession } from '../lib/browser.mjs';
import { stopSpawnedChild } from '../lib/browser/environment.mjs';
import { SessionService } from '../lib/services/session.mjs';

test('concurrent browser leases share startup and close only after the final request', async () => {
  const browser = new BrowserSession({ debugPort: 9337 });
  let launches = 0, closes = 0, release;
  browser.launchHeadless = async () => { launches++; return { spawned: true, child: { exitCode: 0 } }; };
  browser.closeActiveBrowser = async () => { closes++; };
  const held = new Promise((resolve) => { release = resolve; });
  const first = browser.withBrowser(() => held);
  const second = browser.withBrowser(async () => 'second');
  assert.equal(await second, 'second');
  assert.equal(launches, 1);
  assert.equal(closes, 0);
  release('first');
  assert.equal(await first, 'first');
  assert.equal(closes, 1);
  assert.equal(browser.browserUsers, 0);
  assert.equal(browser.browserStart, null);
  await assert.rejects(browser.withBrowser(async () => { throw new Error('request failed'); }), /request failed/);
  assert.equal(closes, 2);
});

test('reused user browser remains alive when an operation finishes', async () => {
  const browser = new BrowserSession({ debugPort: 9337 });
  browser.launchHeadless = async () => ({ spawned: false });
  browser.closeActiveBrowser = async () => assert.fail('must not close an existing browser');
  assert.equal(await browser.withBrowser(async () => 7), 7);
});

test('browser startup timeout uses the injected clock and network', async () => {
  let time = 0, probes = 0;
  const browser = new BrowserSession({ debugPort: 9337 }, {
    now: () => time,
    sleep: async (ms) => { time += ms; },
    fetchJson: async () => { probes++; throw new Error('not listening'); },
  });
  await assert.rejects(browser.waitForVersion(500), /Edge 启动超时/);
  assert.equal(time, 600);
  assert.equal(probes, 3);
});

test('CDP evaluation releases its connection on success and browser exceptions', async () => {
  let closed = 0, failure = false;
  const browser = new BrowserSession({ debugPort: 9337 }, {
    connect: async () => ({
      send: async (method, params) => {
        assert.equal(method, 'Runtime.evaluate');
        assert.equal(params.returnByValue, true);
        return failure ? { exceptionDetails: { text: 'fixture exception' } } : { result: { value: 42 } };
      },
      close: () => closed++,
    }),
  });
  assert.equal(await browser.evaluate({ webSocketDebuggerUrl: 'ws://fixture' }, 'test'), 42);
  failure = true;
  await assert.rejects(browser.evaluate({ webSocketDebuggerUrl: 'ws://fixture' }, 'test'), /fixture exception/);
  assert.equal(closed, 2);
});

test('spawned-child cleanup removes listeners on exit and on timeout', async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  let kills = 0;
  child.kill = () => kills++;
  const pending = stopSpawnedChild(child);
  child.exitCode = 0;
  child.emit('exit', 0);
  await pending;
  assert.equal(kills, 0);
  assert.equal(child.listenerCount('exit'), 0);
  child.exitCode = null;
  await stopSpawnedChild(child, { timeout: 1 });
  assert.equal(kills, 1);
  assert.equal(child.listenerCount('exit'), 0);
});

test('remote login failure cleans newly started UI but preserves an existing host', async () => {
  for (const alreadyRunning of [true, false]) {
    let stopped = 0;
    const session = new SessionService({
      closeActiveBrowser: async () => {},
      launchLogin: async () => { throw new Error('login unavailable'); },
    }, {}, async () => ({
      remoteUiStatus: async () => ({}),
      normalizeRemoteUiOptions: () => ({}),
      startRemoteUi: async () => ({ alreadyRunning, display: ':99' }),
      stopRemoteUi: async () => stopped++,
    }));
    await assert.rejects(session.loginRemote({}), /login unavailable/);
    assert.equal(stopped, alreadyRunning ? 0 : 1);
  }
});
