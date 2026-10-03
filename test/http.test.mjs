import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createContext } from "../lib/context.mjs";
import { listenGui } from "../lib/gui-server.mjs";
import { AicpService } from "../lib/service.mjs";
import { TemplateStore } from "../lib/templates.mjs";

export async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aicp-http-"));
  const templates = new TemplateStore();
  templates.paths = { templates: directory };
  const calls = [];
  const api = {
    createNotebook: async (variables) => { calls.push(structuredClone(variables)); return { NotebookId: "new-dev" }; },
    createTrainJob: async (variables) => { calls.push(structuredClone(variables)); return { TrainJobId: "new-train" }; },
    listNotebooks: async () => ({ Notebooks: [{ NotebookId: "dev-1", Name: "dev", State: "stopped" }] }),
    setNotebookStatus: async (...args) => { calls.push(args); return { ok: true }; },
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
  return { ...server, request, calls, templates, service, dev };
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
  assert.equal(calls.length, 0);
  const response = await request("/api/dev/create", { variables: dev });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { result: { NotebookId: "new-dev" }, variables: dev });
  assert.deepEqual(calls, [dev]);
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
