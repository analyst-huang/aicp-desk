import test from 'node:test';
import assert from 'node:assert/strict';
import { CdpConnection } from '../lib/browser/cdp.mjs';

class Socket extends EventTarget {
  sent = [];
  closes = 0;
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.closes++; this.dispatchEvent(new Event('close')); }
  reply(data) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })); }
}

for (const event of ['close', 'error', 'explicit']) {
  test(`CDP ${event} rejects every pending request and closes idempotently`, { timeout: 1000 }, async () => {
    const socket = new Socket();
    const connection = new CdpConnection(socket);
    const first = assert.rejects(connection.send('first'), /连接/);
    const second = assert.rejects(connection.send('second'), /连接/);
    if (event === 'explicit') connection.close();
    else socket.dispatchEvent(new Event(event));
    await Promise.all([first, second]);
    connection.close();
    assert.equal(socket.closes, 1);
    assert.equal(connection.pending.size, 0);
    await assert.rejects(connection.send('after-close'), /已关闭/);
    assert.equal(socket.sent.length, 2);
  });
}

test('CDP send failure releases earlier requests as well as the failed send', async () => {
  const socket = new Socket();
  const connection = new CdpConnection(socket);
  const first = assert.rejects(connection.send('first'), /unavailable/);
  socket.send = () => { throw new Error('unavailable'); };
  await assert.rejects(connection.send('second'), /unavailable/);
  await first;
  assert.equal(connection.pending.size, 0);
  assert.equal(socket.closes, 1);
});

test('CDP routes responses by ID, rejects protocol errors and ignores late replies', async () => {
  const socket = new Socket();
  const connection = new CdpConnection(socket);
  const first = connection.send('first');
  const second = assert.rejects(connection.send('second'), /denied/);
  socket.reply({ id: 2, error: { message: 'denied' } });
  socket.reply({ method: 'event' });
  socket.reply({ id: 1, result: { value: 7 } });
  socket.reply({ id: 1, result: { value: 8 } });
  assert.deepEqual(await first, { value: 7 });
  await second;
  assert.equal(connection.pending.size, 0);
  connection.close();
});

test('CDP request timeout does not cancel unrelated requests', async () => {
  const socket = new Socket();
  const connection = new CdpConnection(socket);
  const first = assert.rejects(connection.send('first', {}, 5), /超时/);
  const second = connection.send('second');
  await first;
  socket.reply({ id: 1, result: 'late' });
  socket.reply({ id: 2, result: 'ok' });
  assert.equal(await second, 'ok');
  connection.close();
});

test('invalid CDP JSON fails pending requests instead of escaping the event handler', async () => {
  const socket = new Socket();
  const connection = new CdpConnection(socket);
  const request = assert.rejects(connection.send('first'), /无效 JSON/);
  socket.dispatchEvent(new MessageEvent('message', { data: '{' }));
  await request;
  assert.equal(connection.pending.size, 0);
});

test('CDP connection timeout and early disconnect close the failed socket', async () => {
  for (const event of [null, 'error', 'close']) {
    let socket;
    class ConnectingSocket extends Socket {
      constructor() { super(); socket = this; }
    }
    const connecting = CdpConnection.connect('ws://fixture', { WebSocketImpl: ConnectingSocket, timeout: 5 });
    const rejection = assert.rejects(connecting, /调试端口/);
    if (event) socket.dispatchEvent(new Event(event));
    await rejection;
    assert.equal(socket.closes, 1);
  }
});
