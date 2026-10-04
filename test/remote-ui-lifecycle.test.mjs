import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ProcessSupervisor } from '../lib/remote-ui/processes.mjs';
import { RemoteUiSession } from '../lib/remote-ui/session.mjs';

test('process shutdown waits, escalates to SIGKILL and is idempotent', async () => {
  const signals = [], waits = [], live = new Set([12, 13]);
  const supervisor = new ProcessSupervisor({ platform: 'win32',
    kill: (pid, signal) => {
      if (!live.has(pid)) throw new Error('ESRCH');
      if (signal) signals.push([pid, signal]);
      if (signal === 'SIGKILL') live.delete(pid);
    }, sleep: async ms => { waits.push(ms); },
  });
  const records = [{ pid: 12, name: 'first' }, { pid: 13, name: 'second' }];
  assert.equal(await supervisor.stop(records), true);
  assert.deepEqual(signals, [[13, 'SIGTERM'], [12, 'SIGTERM'], [13, 'SIGKILL'], [12, 'SIGKILL']]);
  assert.equal(waits.reduce((a, b) => a + b, 0), 500);
  assert.equal(await supervisor.stop(records), false);
});

test('process ownership checks reject PID reuse and similar but unrelated command arguments', async () => {
  let birth = 'old', args = 'python\0/usr/bin/websockify\0--web\0/private/novnc\0';
  const signals = [];
  const supervisor = new ProcessSupervisor({ platform: 'linux', kill: (_, signal) => { if (signal) signals.push(signal); },
    read: async file => file.endsWith('/stat') ? `12 (name with spaces) ${Array(19).fill('0').join(' ')} ${birth}` : args,
    sleep: async () => {},
  });
  const record = { pid: 12, command: '/usr/bin/websockify', args: ['--web', '/private/novnc'], birth: 'old' };
  assert.equal(await supervisor.isAlive(record), true);
  birth = 'reused';
  await supervisor.stop([record]);
  assert.deepEqual(signals, []);
  birth = 'old'; args = args.replace('/private/novnc', '/private/novnc-other');
  assert.equal(await supervisor.isAlive(record), false);
});

test('startup failures clean a child even when closing its log fails', async () => {
  let alive = true, closed = 0;
  const child = Object.assign(new EventEmitter(), { pid: 12, exitCode: null, unref() {} });
  const supervisor = new ProcessSupervisor({ platform: 'win32', launch: () => child,
    openLog: async () => ({ fd: 3, close: async () => { if (++closed === 1) throw new Error('log failure'); } }),
    kill: (_, signal) => { if (!alive) throw new Error('ESRCH'); if (signal) alive = false; }, sleep: async () => {},
  });
  await assert.rejects(() => supervisor.start({ name: 'xvfb', command: 'Xvfb', args: [], logPath: '/fake/log', wait: 0 }), /log failure/);
  assert.equal(alive, false);
});

test('failed processes retain their private log path and include only the last 20 lines in diagnostics', async () => {
  const child = Object.assign(new EventEmitter(), { pid: 12, exitCode: 1, unref() {} });
  const opened = [];
  const supervisor = new ProcessSupervisor({ platform: 'win32', launch: () => child,
    openLog: async (...args) => { opened.push(args); return { fd: 3, close: async () => {} }; },
    read: async () => Array.from({ length: 30 }, (_, i) => `line-${i}`).join('\n'),
    kill: () => { throw new Error('ESRCH'); }, sleep: async () => {},
  });
  await assert.rejects(() => supervisor.start({ name: 'xvfb', command: 'Xvfb', args: [], logPath: '/private/remote-ui-xvfb.log' }), error => {
    assert.match(error.message, /xvfb 启动失败\nline-10/);
    assert.match(error.message, /line-29$/);
    assert.doesNotMatch(error.message, /line-9\n/);
    return true;
  });
  assert.deepEqual(opened, [['/private/remote-ui-xvfb.log', 'w', 0o600]]);
});

function fixture({ failStart, failStop = false, resumed = false, failSave = false } = {}) {
  const options = { display: ':99', vncPort: 5900, webPort: 6080 };
  const live = new Set(resumed ? ['xvfb'] : []), started = [], stopped = [];
  let state = resumed ? { ...options, accessStopped: true, processes: [{ name: 'xvfb', pid: 12 }] } : null;
  const session = new RemoteUiSession({ platform: 'linux', paths: { remoteUiState: '/fake/state' }, now: () => 'test-time',
    store: { load: async () => structuredClone(state), save: async value => { if (failSave) { failSave = false; throw new Error('disk full'); } state = structuredClone(value); }, remove: async () => { state = null; } },
    processes: {
      isAlive: async record => live.has(record.name),
      start: async spec => { if (spec.name === failStart) throw new Error('start failure'); started.push(spec.name); live.add(spec.name); return { name: spec.name, pid: started.length + 20 }; },
      stop: async records => { if (failStop) throw new Error('cleanup failure'); for (const record of [...records].reverse()) { stopped.push(record.name); live.delete(record.name); } return Boolean(records.length); },
    },
    prepare: async () => ({ specs: ['xvfb', 'windowManager', 'x11vnc', 'websockify'].map(name => ({ name })), url: 'http://127.0.0.1:6080/vnc.html' }),
  });
  return { session, options, live, started, stopped, state: () => state };
}

test('partial startup failure rolls back all newly started processes in reverse order', async () => {
  const f = fixture({ failStart: 'x11vnc' });
  await assert.rejects(() => f.session.start({}, f.options), /start failure/);
  assert.deepEqual(f.stopped, ['windowManager', 'xvfb']);
  assert.equal(f.live.size, 0);
  assert.equal(f.state(), null);
});

test('failed resume preserves the session host and supports a later stop', async () => {
  const f = fixture({ failStart: 'websockify', resumed: true });
  await assert.rejects(() => f.session.start({}, f.options), /start failure/);
  assert.deepEqual([...f.live], ['xvfb']);
  assert.equal(f.state().accessStopped, true);
  await f.session.stop();
  assert.equal(f.live.size, 0);
  assert.equal((await f.session.stop()).wasRunning, false);
});

test('failed rollback retains records for a subsequent cleanup attempt', async () => {
  const f = fixture({ failStart: 'x11vnc', failStop: true });
  await assert.rejects(() => f.session.start({}, f.options), /start failure.*cleanup failure/);
  assert.deepEqual(f.state().processes.map(record => record.name), ['xvfb', 'windowManager']);
  await assert.rejects(() => f.session.stop(), /cleanup failure/);
  assert.ok(f.state());
});

test('state persistence failure rolls back processes and suspend/resume preserves only the host', async () => {
  const failed = fixture({ failSave: true });
  await assert.rejects(() => failed.session.start({}, failed.options), /disk full/);
  assert.equal(failed.live.size, 0);
  const f = fixture();
  await f.session.start({}, f.options);
  assert.equal((await f.session.status()).running, true);
  assert.equal((await f.session.start({}, f.options)).alreadyRunning, true);
  assert.equal(f.started.length, 4);
  assert.equal((await f.session.suspend()).sessionKept, true);
  assert.deepEqual([...f.live], ['xvfb']);
  assert.equal((await f.session.start({}, f.options)).resumed, true);
  assert.equal((await f.session.status()).running, true);
});
