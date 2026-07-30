import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openExternalUrl } from "./browser.mjs";
import { saveConfig } from "./config.mjs";
import { redact } from "./utils.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(currentDirectory, "..", "web");
const staticFiles = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
};

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw new Error("请求内容超过 2 MiB");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function boolParam(value) {
  return ["1", "true", "yes"].includes(String(value).toLowerCase());
}

function routeMatch(urlPath, expected) {
  return urlPath === expected;
}

export async function startGui(context, { port, open = true } = {}) {
  const token = randomBytes(24).toString("hex");
  const host = "127.0.0.1";
  const actualPort = Number(port || context.config.guiPort);
  const baseUrl = `http://${host}:${actualPort}`;

  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, baseUrl);
      const hostHeader = String(request.headers.host || "");
      if (![`${host}:${actualPort}`, `localhost:${actualPort}`].includes(hostHeader)) {
        return sendJson(response, 403, { error: "拒绝非本机 Host" });
      }
      const origin = request.headers.origin;
      if (origin && ![baseUrl, `http://localhost:${actualPort}`].includes(origin)) {
        return sendJson(response, 403, { error: "拒绝跨来源请求" });
      }

      if (request.method === "GET" && staticFiles[requestUrl.pathname]) {
        const [filename, contentType] = staticFiles[requestUrl.pathname];
        const body = await readFile(path.join(webRoot, filename));
        response.writeHead(200, {
          "content-type": contentType,
          "content-length": body.length,
          "cache-control": "no-store",
          "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src https://ksp.console.ksyun.com https://passport.ksyun.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          "x-content-type-options": "nosniff",
          "x-frame-options": "DENY",
        });
        return response.end(body);
      }

      if (request.method === "GET" && routeMatch(requestUrl.pathname, "/api/bootstrap")) {
        return sendJson(response, 200, {
          token,
          config: context.config,
          session: await context.browser.status(),
          templates: (await context.templates.list()).map((item) => redact(item)),
        });
      }

      if (requestUrl.pathname.startsWith("/api/") && request.headers["x-aicp-token"] !== token) {
        return sendJson(response, 403, { error: "请求令牌无效，请刷新页面" });
      }

      if (request.method === "POST" && routeMatch(requestUrl.pathname, "/api/login")) {
        return sendJson(response, 200, await context.browser.launchLogin());
      }
      if (request.method === "POST" && routeMatch(requestUrl.pathname, "/api/logout")) {
        const body = await readBody(request);
        return sendJson(response, 200, await context.browser.logout({ forget: Boolean(body.forget) }));
      }
      if (request.method === "GET" && routeMatch(requestUrl.pathname, "/api/session")) {
        return sendJson(response, 200, await context.browser.status());
      }
      if (request.method === "GET" && routeMatch(requestUrl.pathname, "/api/gpu")) {
        return sendJson(response, 200, await context.service.gpuCapacity({
          region: requestUrl.searchParams.get("region") || undefined,
        }));
      }

      if (request.method === "GET" && routeMatch(requestUrl.pathname, "/api/dev/create-options")) {
        return sendJson(response, 200, redact(await context.api.developerCreateOptions(requestUrl.searchParams.get("region") || undefined)));
      }
      if (request.method === "GET" && routeMatch(requestUrl.pathname, "/api/dev/save-image-options")) {
        return sendJson(response, 200, redact(await context.api.saveImageOptions(requestUrl.searchParams.get("region") || undefined)));
      }
      if (request.method === "GET" && routeMatch(requestUrl.pathname, "/api/dev/save-image-namespaces")) {
        const type = requestUrl.searchParams.get("type");
        if (!["Personal", "Official"].includes(type)) throw new Error("type 必须是 Personal 或 Official");
        return sendJson(response, 200, await context.api.listSaveImageNamespaces(type, {
          instanceId: requestUrl.searchParams.get("instanceId") || undefined,
          region: requestUrl.searchParams.get("region") || undefined,
        }));
      }
      if (request.method === "GET" && routeMatch(requestUrl.pathname, "/api/dev/save-image-repositories")) {
        const type = requestUrl.searchParams.get("type");
        const namespace = requestUrl.searchParams.get("namespace");
        if (!["Personal", "Official"].includes(type) || !namespace) throw new Error("缺少有效的 type 或 namespace");
        return sendJson(response, 200, await context.api.listSaveImageRepositories(type, namespace, {
          instanceId: requestUrl.searchParams.get("instanceId") || undefined,
          region: requestUrl.searchParams.get("region") || undefined,
        }));
      }
      if (request.method === "GET" && routeMatch(requestUrl.pathname, "/api/dev/image-repos")) {
        const registryId = requestUrl.searchParams.get("registryId");
        if (!registryId) throw new Error("缺少 registryId");
        return sendJson(response, 200, await context.api.listImageRepos(registryId));
      }
      if (request.method === "GET" && routeMatch(requestUrl.pathname, "/api/dev/image-tags")) {
        const registryId = requestUrl.searchParams.get("registryId");
        const repoId = requestUrl.searchParams.get("repoId");
        if (!registryId || !repoId) throw new Error("缺少 registryId 或 repoId");
        return sendJson(response, 200, await context.api.listImageTags(registryId, repoId));
      }
      if (request.method === "GET" && routeMatch(requestUrl.pathname, "/api/dev/resource-info")) {
        const queueId = requestUrl.searchParams.get("queueId");
        if (!queueId) throw new Error("缺少 queueId");
        return sendJson(response, 200, await context.api.queueResourceInfo(queueId, {
          gpuType: requestUrl.searchParams.get("gpuType") || undefined,
          gpuNumber: requestUrl.searchParams.get("gpuNumber") || undefined,
        }));
      }
      if (request.method === "GET" && routeMatch(requestUrl.pathname, "/api/dev/nodes")) {
        const queueId = requestUrl.searchParams.get("queueId");
        if (!queueId) throw new Error("缺少 queueId");
        return sendJson(response, 200, await context.api.listAvailableNodes(queueId, {
          cpu: requestUrl.searchParams.get("cpu") || 0,
          gpuType: requestUrl.searchParams.get("gpuType") || undefined,
          gpuNumber: requestUrl.searchParams.get("gpuNumber") || 0,
          memory: requestUrl.searchParams.get("memory") || 0,
          region: requestUrl.searchParams.get("region") || undefined,
        }));
      }
      if (request.method === "GET" && routeMatch(requestUrl.pathname, "/api/dev")) {
        const result = await context.service.listDevelopers({
          mine: boolParam(requestUrl.searchParams.get("mine")),
          state: requestUrl.searchParams.get("state") || undefined,
          limit: requestUrl.searchParams.get("limit") || 100,
        });
        return sendJson(response, 200, result);
      }
      if (request.method === "POST" && routeMatch(requestUrl.pathname, "/api/dev/create")) {
        const body = await readBody(request);
        const result = await context.service.create("dev", { variables: body.variables, dryRun: false });
        return sendJson(response, 200, { result: result.result, variables: redact(result.variables) });
      }
      if (request.method === "POST" && routeMatch(requestUrl.pathname, "/api/dev/action")) {
        const body = await readBody(request);
        if (!["start", "stop", "delete"].includes(body.action)) throw new Error("开发机 action 必须是 start、stop 或 delete");
        const result = body.action === "start"
          ? await context.service.startDeveloper(body.selector, {})
          : body.action === "stop"
            ? await context.service.stopDeveloper(body.selector, { force: Boolean(body.force) })
            : await context.service.deleteDeveloper(body.selector, {});
        return sendJson(response, 200, result);
      }
      if (request.method === "POST" && routeMatch(requestUrl.pathname, "/api/dev/save-image")) {
        const body = await readBody(request);
        if (!body.selector || !body.variables) throw new Error("缺少开发机或镜像参数");
        return sendJson(response, 200, redact(await context.service.saveDeveloperImage(body.selector, body.variables)));
      }

      if (request.method === "GET" && routeMatch(requestUrl.pathname, "/api/train")) {
        const result = await context.service.listTraining({
          mine: boolParam(requestUrl.searchParams.get("mine")),
          statuses: requestUrl.searchParams.get("status")?.split(",").filter(Boolean),
          limit: requestUrl.searchParams.get("limit") || 50,
        });
        return sendJson(response, 200, result);
      }
      if (request.method === "GET" && routeMatch(requestUrl.pathname, "/api/train/create-options")) {
        return sendJson(response, 200, redact(await context.api.trainingCreateOptions(requestUrl.searchParams.get("region") || undefined)));
      }
      if (request.method === "GET" && routeMatch(requestUrl.pathname, "/api/train/detail")) {
        const selector = requestUrl.searchParams.get("selector");
        if (!selector) throw new Error("缺少训练任务名称或 ID");
        return sendJson(response, 200, redact(await context.service.trainingDetail(selector, {
          latest: boolParam(requestUrl.searchParams.get("latest")),
        })));
      }
      if (request.method === "GET" && routeMatch(requestUrl.pathname, "/api/train/logs")) {
        const selector = requestUrl.searchParams.get("selector");
        if (!selector) throw new Error("缺少训练任务名称或 ID");
        return sendJson(response, 200, redact(await context.service.trainingLogs(selector, {
          latest: boolParam(requestUrl.searchParams.get("latest")),
          pod: requestUrl.searchParams.get("pod") || undefined,
          role: requestUrl.searchParams.get("role") || undefined,
          tailLines: requestUrl.searchParams.get("tail") || 200,
          sinceSeconds: requestUrl.searchParams.get("since") || undefined,
        })));
      }
      if (request.method === "POST" && routeMatch(requestUrl.pathname, "/api/train/create")) {
        const body = await readBody(request);
        const result = await context.service.create("train", { variables: body.variables, dryRun: false });
        return sendJson(response, 200, { result: result.result, variables: redact(result.variables) });
      }
      if (request.method === "POST" && routeMatch(requestUrl.pathname, "/api/train/action")) {
        const body = await readBody(request);
        if (!["start", "stop", "delete"].includes(body.action)) throw new Error("训练任务 action 必须是 start、stop 或 delete");
        const options = { latest: Boolean(body.latest) };
        const result = body.action === "start"
          ? await context.service.startTraining(body.selector, options)
          : body.action === "stop"
            ? await context.service.stopTraining(body.selector, options)
            : await context.service.deleteTraining(body.selector, options);
        return sendJson(response, 200, result);
      }

      if (request.method === "GET" && routeMatch(requestUrl.pathname, "/api/templates")) {
        return sendJson(response, 200, (await context.templates.list()).map((item) => redact(item)));
      }
      if (request.method === "GET" && routeMatch(requestUrl.pathname, "/api/template")) {
        const kind = requestUrl.searchParams.get("kind");
        const name = requestUrl.searchParams.get("name");
        return sendJson(response, 200, await context.templates.get(kind, name));
      }
      if (request.method === "POST" && routeMatch(requestUrl.pathname, "/api/template")) {
        const body = await readBody(request);
        return sendJson(response, 200, redact(await context.templates.save(body.kind, body.name, body.variables, body.source)));
      }
      if (request.method === "POST" && routeMatch(requestUrl.pathname, "/api/template/from")) {
        const body = await readBody(request);
        const result = await context.service.saveTemplateFromResource(body.kind, body.name, body.selector, {
          latest: Boolean(body.latest),
        });
        return sendJson(response, 200, redact(result));
      }
      if (request.method === "DELETE" && routeMatch(requestUrl.pathname, "/api/template")) {
        const kind = requestUrl.searchParams.get("kind");
        const name = requestUrl.searchParams.get("name");
        return sendJson(response, 200, await context.templates.delete(kind, name));
      }
      if (request.method === "POST" && routeMatch(requestUrl.pathname, "/api/config")) {
        const body = await readBody(request);
        const updated = await saveConfig({ ...context.config, ...body });
        Object.assign(context.config, updated);
        return sendJson(response, 200, updated);
      }

      return sendJson(response, 404, { error: "未找到接口" });
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(actualPort, host, resolve);
  });
  process.stdout.write(`AICP 可视化控制台已启动：${baseUrl}\n`);
  process.stdout.write("按 Ctrl+C 停止。服务仅监听 127.0.0.1。\n");
  if (open) await openExternalUrl(context.config, baseUrl);
  return new Promise(() => {});
}
