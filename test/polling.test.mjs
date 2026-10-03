import test from 'node:test';
import assert from 'node:assert/strict';
import { createPoller } from '../web/core/polling.js';

test('polling waits for a request to finish and never resumes after disposal', async () => {
  let callback, calls = 0, complete;
  const timers = { setTimeout(fn) { callback = fn; return 1; }, clearTimeout() { callback = undefined; } };
  const poller = createPoller(() => { calls++; return new Promise((resolve) => { complete = resolve; }); }, { delay: 100, timers });
  poller.schedule();
  const fire = callback;
  callback = undefined;
  const pending = fire();
  assert.equal(calls, 1);
  poller.stop();
  complete();
  await pending;
  assert.equal(callback, undefined);
});
