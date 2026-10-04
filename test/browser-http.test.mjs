import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchJson, fetchText } from '../lib/browser/environment.mjs';

async function bodyServer(t, delay) {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.write('{"value":');
    const timer = setTimeout(() => response.end('"ready"}'), delay);
    response.once('close', () => clearTimeout(timer));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

for (const [read, expected] of [[fetchJson, { value: 'ready' }], [fetchText, '{"value":"ready"}']]) {
  test(`${read.name} reads the complete response body before resolving`, { timeout: 4000 }, async t => {
    const url = await bodyServer(t, 20);
    assert.deepEqual(await read(url, { timeout: 2000 }), expected);
  });

  test(`${read.name} aborts a stalled body after headers have arrived`, { timeout: 4000 }, async t => {
    const url = await bodyServer(t, 1000);
    await assert.rejects(read(url, { timeout: 150 }), { name: 'AbortError' });
  });
}
