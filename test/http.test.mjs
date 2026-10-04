import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import net from 'node:net';
import { once } from 'node:events';
import { createContext } from "../lib/context.mjs";
import { listenGui } from "../lib/gui-server.mjs";
import { AicpService } from "../lib/service.mjs";
import { TemplateStore } from "../lib/templates.mjs";
import { LoginError } from '../lib/login.mjs';
import { createApi, ApiError } from '../web/core/request.js';

export async function fixture(t, apiOverrides = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aicp-http-"));
  const templates = new TemplateStore();
  templates.paths = { templates: directory };
  const calls = [];
  const api = {
    createNotebook: async (variables) => { calls.push(structuredClone(variables)); return { NotebookId: "new-dev" }; },
    createTrainJob: async (variables) => { calls.push(structuredClone(variables)); return { TrainJobId: "new-train" }; },
    listNotebooks: async () => ({ Notebooks: [{ NotebookId: "dev-1", Name: "dev", State: "stopped" }] }),
    setNotebookStatus: async (...args) => { calls.push(args); return { Return: true }; },
    ...apiOverrides,
  };
  const config = { region: "test-region", guiPort: 0 };
  const browser = { status: async () => ({ authenticated: true }) };
  const service = new AicpService(api, templates, config);
  const server = await listenGui(await createContext({ config, browser, api, templates, service }));
  t.after(async () => { await server.close(); await rm(directory, { recursive: true, force: true }); });
  const bootstrap = await (await fetch(`${server.url}/api/bootstrap`)).json();
  const request = (route, body, extra = {}) => fetch(`${server.url}${route}`, {
    method: body === undefined ? "GET" : "POST",
    ...extra,
    headers: { "content-type": "application/json", "x-aicp-token": bootstrap.token, ...extra.headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const dev = JSON.parse(await readFile(new URL("../examples/dev-create.json", import.meta.url), "utf8"));
  return { ...server, request, calls, templates, service, dev, token: bootstrap.token };
}

test("HTTP protections reject invalid tokens, foreign origins and hosts", async (t) => {
  const { request, url } = await fixture(t);
  assert.equal((await fetch(`${url}/api/dev`)).status, 403);
  assert.equal((await request("/api/dev", undefined, { headers: { origin: "https://example.com" } })).status, 403);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    http.get(`${url}/api/bootstrap`, { headers: { host: "example.com" } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).on("error", reject);
  });
  assert.equal(foreignHostStatus, 403);
  assert.equal((await request("/missing")).status, 404);
  const page = await request("/");
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), /script-src 'self'/);
});

test("HTTP create validates before dispatch and returns the existing response shape", async (t) => {
  const { request, calls, dev } = await fixture(t);
  assert.equal((await request("/api/dev/create", { variables: {} })).status, 400);
  for (const CpuNum of ['abc', null, '', true, {}]) assert.equal((await request('/api/dev/create', { variables: { ...dev, CpuNum } })).status, 400);
  assert.equal(calls.length, 0);
  const response = await request("/api/dev/create", { variables: dev });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { result: { NotebookId: "new-dev" }, variables: dev });
  assert.deepEqual(calls, [dev]);
});

test('GUI works through a different local TCP port while enforcing origin and token checks', async t => {
  const { url, calls } = await fixture(t);
  const sockets = new Set();
  const tunnel = net.createServer(socket => {
    const upstream = net.connect(Number(new URL(url).port), '127.0.0.1');
    for (const stream of [socket, upstream]) {
      sockets.add(stream);
      stream.on('close', () => sockets.delete(stream));
      stream.on('error', () => { socket.destroy(); upstream.destroy(); });
    }
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  try {
    tunnel.listen(0, '127.0.0.1');
    await once(tunnel, 'listening');
    const forwarded = `http://127.0.0.1:${tunnel.address().port}`;
    assert.notEqual(forwarded, url);
    assert.equal((await fetch(forwarded)).status, 200);
    const { token } = await (await fetch(`${forwarded}/api/bootstrap`)).json();
    const action = (headers = {}) => fetch(`${forwarded}/api/dev/action`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-aicp-token': token, origin: forwarded, ...headers },
      body: JSON.stringify({ action: 'start', selector: 'dev-1' }),
    });
    assert.equal((await action({ 'x-aicp-token': '' })).status, 403);
    for (const origin of [url, 'http://localhost:9999', 'https://example.com', 'null']) {
      assert.equal((await action({ origin })).status, 403);
    }
    assert.equal(calls.length, 0);
    assert.equal((await action()).status, 200);
    assert.equal(calls.length, 1);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => tunnel.close(resolve));
  }
});

test('GUI rejects non-loopback hosts and forged forwarding headers', async t => {
  const { url } = await fixture(t);
  const request = headers => new Promise((resolve, reject) => {
    http.get(url, { headers }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    }).on('error', reject);
  });
  for (const host of ['example.com', 'localhost.example.com:17863', '127.0.0.1.example.com', '192.168.1.1:17863', 'localhost:0', 'localhost:65536', '127.0.0.1@evil.test']) {
    assert.equal(await request({ host, 'x-forwarded-host': 'localhost:17863', 'x-forwarded-proto': 'http' }), 403, host);
  }
  for (const host of ['localhost:27863', '127.0.0.1:27863', '[::1]:27863']) {
    assert.equal(await request({ host, origin: `http://${host}` }), 200, host);
    assert.equal(await request({ host, origin: 'http://localhost:37863' }), 403, host);
  }
});

test('HTTP developer actions reject platform failure or missing results', async t => {
  let state = 'stopped', result, writes = 0;
  const { request } = await fixture(t, {
    listNotebooks: async () => ({ Notebooks: [{ NotebookId: 'dev-1', Name: 'dev', State: state }] }),
    setNotebookStatus: async () => { writes++; return result; },
  });
  for (const action of ['start', 'stop']) {
    state = action === 'start' ? 'stopped' : 'running';
    for (result of [{ Return: false }, undefined, { Return: true }]) {
      const before = writes;
      const response = await request('/api/dev/action', { action, selector: 'dev-1' });
      assert.equal(response.status, result?.Return === true ? 200 : 400);
      const body = await response.json();
      if (result?.Return === true) assert.equal(body.result.Return, true);
      else assert.match(body.error, result?.Return === false ? /失败/ : /结果未知/);
      assert.equal(writes, before + 1);
    }
  }
});

test("HTTP serves module assets without exposing application files", async (t) => {
  const { request } = await fixture(t);
  for (const asset of ["/application.js", "/features/create.js", "/core/polling.js", "/models/dev-form.js", "/models/train-form.js", "/shared/resource-policy.js"]) {
    const response = await request(asset);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /javascript/);
  }
  for (const asset of ["/lib/config.mjs", "/features/../../package.json", "/features/%2e%2e%2flib%2fconfig.mjs", "/features/missing.js", "/constructor", "/shared/create-input.js", "/shared/../lib/config.mjs"]) {
    assert.equal((await request(asset)).status, 404);
  }
});

test("template read and editable create do not overwrite the stored template", async (t) => {
  const { request, templates, service, calls, dev } = await fixture(t);
  await templates.save("dev", "baseline", dev);
  const record = await (await request("/api/template?kind=dev&name=baseline")).json();
  record.variables.DisplayName = "edited";
  await request("/api/dev/create", { variables: record.variables });
  assert.equal(calls[0].DisplayName, "edited");
  assert.equal((await templates.get("dev", "baseline")).variables.DisplayName, dev.DisplayName);
  const dryRun = await service.create("dev", { template: "baseline", name: "preview", dryRun: true });
  assert.equal(dryRun.variables.DisplayName, "preview");
  assert.equal(calls.length, 1);
});

test("HTTP resource actions reject unknown actions and use business state checks", async (t) => {
  const { request, calls } = await fixture(t);
  assert.equal((await request("/api/dev/action", { action: "invalid", selector: "dev-1" })).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await request("/api/dev/action", { action: "start", selector: "dev-1" })).status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "dev-1");
});

test('HTTP and GUI client preserve login metadata without exposing private error fields', async (t) => {
  const { request, service, token, url } = await fixture(t);
  const api = createApi({ getToken: () => token, fetchImpl: (route, options) => fetch(`${url}${route}`, options) });
  for (const [code, requiresUserAction] of [['AUTH_EXPIRED', false], ['MANUAL_LOGIN_REQUIRED', true], ['OPERATION_NOT_RETRIED', false]]) {
    service.listDevelopers = async () => {
      const error = new LoginError(code, '公开错误文字', requiresUserAction);
      error.credentials = 'private';
      throw error;
    };
    const response = await request('/api/dev');
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: '公开错误文字', code, requiresUserAction });
    await assert.rejects(api('/api/dev'), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.message, '公开错误文字');
      assert.equal(error.code, code);
      assert.equal(error.requiresUserAction, requiresUserAction);
      assert.equal(error.status, 400);
      return true;
    });
  }
  service.listDevelopers = async () => { throw new Error('原有错误'); };
  assert.deepEqual(await (await request('/api/dev')).json(), { error: '原有错误' });
});
