import { DEV_RUNNING_STATES, DEV_STOPPED_STATES, exactMatches } from './helpers.mjs';
import { assertBatchSuccess } from './results.mjs';

export class DevelopersService {
  developerCreateOptions(...args) { return this.catalog.developerCreateOptions(...args); }
  queueResourceInfo(...args) { return this.api.queueResourceInfo(...args); }
  listAvailableNodes(...args) { return this.api.listAvailableNodes(...args); }
  constructor({ api, identity, catalog, saveNotebookImage }) {
    Object.assign(this, { api, identity, catalog, saveNotebookImage });
  }

  async listDevelopers(options = {}) {
    const identity = options.mine ? await this.identity.currentUser() : null;
    return this.api.listNotebooks({
      limit: options.limit ?? 100,
      username: options.mine ? this.identity.creatorUsername(identity) : options.username,
      state: options.state,
      region: options.region,
    });
  }

  async resolveDeveloper(selector, options = {}) {
    const response = await this.api.listNotebooks({
      id: selector.startsWith("kaic-") ? selector : undefined,
      name: selector.startsWith("kaic-") ? undefined : selector,
      limit: 100,
      region: options.region,
    });
    const matches = exactMatches(response.Notebooks ?? [], selector, "NotebookId", "Name");
    if (!matches.length) throw new Error(`找不到开发机：${selector}`);
    if (matches.length > 1) throw new Error(`开发机名称不唯一，请改用 ID：${selector}`);
    return matches[0];
  }

  /** @returns {Promise<import('../contracts.mjs').ResourceResult>} */
  async startDeveloper(selector, options = {}) {
    const item = await this.resolveDeveloper(selector, options);
    const state = String(item.State).toLowerCase();
    if (DEV_RUNNING_STATES.has(state)) return { noop: true, item, message: "开发机已在运行或启动中" };
    if (state === "stopping") return { noop: true, item, message: "开发机正在停止，请停止完成后再启动" };
    if (!DEV_STOPPED_STATES.has(state)) return { noop: true, item, message: `开发机当前状态“${item.State || "未知"}”不能启动` };
    const result = await this.api.setNotebookStatus(item.NotebookId, "start", options);
    return { noop: false, item, result };
  }

  async stopDeveloper(selector, options = {}) {
    const item = await this.resolveDeveloper(selector, options);
    const state = String(item.State).toLowerCase();
    if (DEV_STOPPED_STATES.has(state)) return { noop: true, item, message: "开发机已经停止" };
    if (state === "stopping") return { noop: true, item, message: "开发机正在停止" };
    if (!DEV_RUNNING_STATES.has(state)) return { noop: true, item, message: `开发机当前状态“${item.State || "未知"}”不能停止` };
    const result = await this.api.setNotebookStatus(item.NotebookId, "stop", options);
    return { noop: false, item, result };
  }

  async deleteDeveloper(selector, options = {}) {
    const item = await this.resolveDeveloper(selector, options);
    const state = String(item.State).toLowerCase();
    if (!DEV_STOPPED_STATES.has(state)) throw new Error(`开发机当前状态“${item.State || "未知"}”不能删除，请先停止开发机`);
    const result = await this.api.deleteNotebooks([item.NotebookId], options.region);
    assertBatchSuccess(result?.Results);
    return { item, result };
  }

  async saveDeveloperImage(selector, variables, options = {}) {
    const item = await this.resolveDeveloper(selector, options);
    if (String(item.State).toLowerCase() !== "running") throw new Error("只有运行中的开发机可以保存镜像");
    const payload = { ...variables };
    const required = ["ImageName", "ImageType", "Namespace", "ImageRepo", "ImageVersion"];
    const missing = required.filter((key) => !String(payload[key] || "").trim());
    if (missing.length) throw new Error(`保存镜像缺少参数：${missing.join(", ")}`);
    if (!["Personal", "Official"].includes(payload.ImageType)) throw new Error("ImageType 必须是 Personal 或 Official");
    if (payload.ImageType === "Official" && !payload.OfficialInstance) throw new Error("保存到企业版实例时必须填写 OfficialInstance");
    if (payload.ImagePermission && !["Public", "Private"].includes(payload.ImagePermission)) throw new Error("ImagePermission 必须是 Public 或 Private");
    const result = await this.saveNotebookImage(item.NotebookId, payload, options.region);
    return { item, result };
  }
}
