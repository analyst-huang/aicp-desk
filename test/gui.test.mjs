import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
const script = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
const server = await readFile(new URL("../lib/gui-server.mjs", import.meta.url), "utf8");
const styles = await readFile(new URL("../web/styles.css", import.meta.url), "utf8");

test("GUI IDs are unique", () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test("static HTML avoids inline script and event handlers", () => {
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/i);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
});

test("GUI server binds loopback and applies request protections", () => {
  assert.match(server, /const host = "127\.0\.0\.1"/);
  assert.match(server, /x-aicp-token/);
  assert.match(server, /content-security-policy/);
  assert.doesNotMatch(server, /0\.0\.0\.0/);
});

test("hard-coded DOM ID selectors exist", () => {
  const htmlIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
  const selectors = [...script.matchAll(/\$\("#([A-Za-z0-9_-]+)"\)/g)].map((match) => match[1]);
  const missing = [...new Set(selectors)].filter((id) => !htmlIds.has(id));
  assert.deepEqual(missing, []);
});

test("GUI exposes separate retain-password and forget-login actions", () => {
  assert.match(html, /id="logout-button"[^>]*>清除会话（保留密码）</);
  assert.match(html, /id="forget-login-button"[^>]*>忘记所有登录资料</);
  assert.match(script, /JSON\.stringify\(\{ forget: false \}\)/);
  assert.match(script, /JSON\.stringify\(\{ forget: true \}\)/);
});

test("modal close controls bypass required-field validation", () => {
  assert.match(html, /type="button"[^>]*data-close-modal="create-modal"/);
  assert.match(html, /type="button"[^>]*data-close-modal="template-modal"/);
  assert.match(script, /closest\("\[data-close-modal\]"\)/);
  assert.match(script, /event\.target === modal/);
});

test("developer creation mirrors native configuration sections", () => {
  for (const label of ["环境配置", "资源配置", "挂载配置", "访问配置", "权限配置"]) assert.match(html, new RegExp(label));
  for (const id of ["dev-image-select", "dev-resource-pool", "dev-queue", "dev-storage-rows", "dev-enable-ssh", "dev-service-rows", "dev-queue-share"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(script, /\/api\/dev\/create-options/);
  assert.match(script, /loadSelectedTemplate/);
  assert.match(html, /id="dev-allocation-id"[^>]*><option/);
  assert.match(script, /item\.PublicIp === selectedValue/);
});

test("developer rows always expose separate start and stop controls", () => {
  assert.match(script, /data-dev-action="start"/);
  assert.match(script, /data-dev-action="stop"/);
  assert.match(script, /const canStart =/);
  assert.match(script, /const canStop =/);
});

test("first template selection never parses an empty advanced JSON value", () => {
  const openCreate = script.slice(script.indexOf("async function openCreate"), script.indexOf("async function loadSelectedTemplate"));
  assert.ok(openCreate.indexOf("updateJson(variables)") < openCreate.indexOf("showModal()"));
  assert.match(script, /event\.target\.id === "create-json" \|\| event\.target\.id === "create-template"/);
  assert.match(script, /if \(event\.target\.id === "create-template"\) return;/);
});

test("developer rows expose a public SSH copy action using the external IP", () => {
  assert.match(script, /item\.EnablePublicNetworkSsh && item\.ExternalIp/);
  assert.match(script, /data-copy-ssh/);
  assert.match(script, /root@\$\{copySsh\.dataset\.externalIp\}/);
});

test("developer rows expose native save-image controls", () => {
  assert.match(script, /data-save-dev-image/);
  assert.match(html, /id="save-image-modal"/);
  for (const route of ["save-image-options", "save-image-namespaces", "save-image-repositories", "save-image"]) {
    assert.match(server, new RegExp(`/api/dev/${route}`));
  }
  for (const id of ["save-image-instance", "save-image-namespace", "save-image-repo-list", "save-image-endpoint-detail", "save-image-kcr-password-field"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(html, /id="save-image-domain"/);
  assert.doesNotMatch(html, /id="save-image-namespace-permission"/);
  assert.match(script, /personalConfigured/);
  assert.match(script, /企业版实例只能选择已有镜像仓库/);
  assert.match(styles, /#save-image-modal \{ inset: 0 0 0 auto;/);
  assert.match(script, /developerState === "running"/);
});

test("training creation uses live native selectors and remains template-editable", () => {
  for (const id of ["train-resource-pool", "train-queue", "train-image-source", "train-image-select", "train-gpu-type", "train-storage-rows"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(script, /\/api\/train\/create-options/);
  assert.match(script, /fillTrainFields/);
  assert.match(script, /readTrainStorageRows/);
  assert.doesNotMatch(html, /data-field="ResourcePoolId"/);
});

test("training rows expose separate start and stop controls", () => {
  assert.match(script, /data-train-action="start"/);
  assert.match(script, /data-train-action="stop"/);
});

test("developer fixed-node selector refreshes against current resource filters", () => {
  assert.match(html, /id="dev-affinity-ip"/);
  assert.match(script, /\/api\/dev\/nodes/);
  assert.match(script, /已自动改为“不指定节点”/);
});

test("loaded templates remain editable and save-as is explicit", () => {
  assert.match(html, /载入后仍可修改任意配置/);
  assert.match(html, /id="save-create-template"/);
  assert.match(script, /saveCurrentCreateTemplate/);
  assert.doesNotMatch(script, /create-template[^\n]*disabled\s*=/);
});
