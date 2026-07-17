import { readFile } from "node:fs/promises";
import { applySetOverrides, clone, readVariablesFile } from "./utils.mjs";
import { notebookDetailToVariables, trainDetailToVariables } from "./templates.mjs";

const DEV_RUNNING_STATES = new Set(["running", "starting", "pending", "deploying"]);
const DEV_STOPPED_STATES = new Set(["stopped", "failed", "succeed"]);
const TRAIN_ACTIVE_STATES = new Set(["running", "submit", "pending", "deploying", "restarting", "succeed_holding", "failed_holding"]);
const TRAIN_TERMINAL_STATES = new Set(["stopped", "succeed", "failed"]);

function exactMatches(items, selector, idKey, nameKey) {
  const byId = items.filter((item) => item[idKey] === selector);
  if (byId.length) return byId;
  return items.filter((item) => item[nameKey] === selector);
}

export class AicpService {
  constructor(api, templates, config) {
    this.api = api;
    this.templates = templates;
    this.config = config;
  }

  async listDevelopers(options = {}) {
    return this.api.listNotebooks({
      limit: options.limit ?? 100,
      username: options.mine ? this.requireUsername() : options.username,
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
    this.assertBatchSuccess(result?.Results);
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
    const result = await this.api.saveNotebookImage(item.NotebookId, payload, options.region);
    return { item, result };
  }

  async listTraining(options = {}) {
    return this.api.listTrainJobs({
      limit: options.limit ?? 50,
      username: options.mine ? this.requireUsername() : options.username,
      statuses: options.statuses,
      frameworks: options.frameworks,
      priorities: options.priorities,
      region: options.region,
    });
  }

  async resolveTraining(selector, options = {}) {
    const response = await this.api.listTrainJobs({
      ids: selector.startsWith("kaic-") ? [selector] : undefined,
      name: selector.startsWith("kaic-") ? undefined : selector,
      limit: 100,
      region: options.region,
    });
    const matches = exactMatches(response.TrainJobSet ?? [], selector, "TrainJobId", "TrainJobName");
    if (!matches.length) throw new Error(`找不到训练任务：${selector}`);
    if (matches.length > 1 && !options.latest) {
      throw new Error(`训练任务名称对应 ${matches.length} 条记录，请改用 ID 或添加 --latest`);
    }
    return matches.sort((left, right) => String(right.JobStatus?.SubmitTime ?? "").localeCompare(String(left.JobStatus?.SubmitTime ?? "")))[0];
  }

  async trainingDetail(selector, options = {}) {
    const item = await this.resolveTraining(selector, options);
    const detail = await this.api.trainJobDetail(item.TrainJobId, options.region);
    if (!detail) throw new Error(`训练任务详情不存在：${item.TrainJobId}`);
    return { item, detail };
  }

  async startTraining(selector, options = {}) {
    const item = await this.resolveTraining(selector, options);
    const state = String(item.JobStatus?.Status ?? "").toLowerCase();
    if (TRAIN_ACTIVE_STATES.has(state)) return { noop: true, item, message: "训练任务已在活动状态" };
    if (state === "stopping") return { noop: true, item, message: "训练任务正在停止，请停止完成后再启动" };
    if (!TRAIN_TERMINAL_STATES.has(state)) return { noop: true, item, message: `训练任务当前状态“${item.JobStatus?.Status || "未知"}”不能启动` };
    const result = await this.api.startTrainJobs([item], options.region);
    this.assertBatchSuccess(result?.Results);
    return { noop: false, item, result };
  }

  async stopTraining(selector, options = {}) {
    const item = await this.resolveTraining(selector, options);
    const state = String(item.JobStatus?.Status ?? "").toLowerCase();
    if (TRAIN_TERMINAL_STATES.has(state)) return { noop: true, item, message: "训练任务已经结束" };
    if (state === "stopping") return { noop: true, item, message: "训练任务正在停止" };
    if (!TRAIN_ACTIVE_STATES.has(state)) return { noop: true, item, message: `训练任务当前状态“${item.JobStatus?.Status || "未知"}”不能停止` };
    const result = await this.api.stopTrainJobs([item], options.region);
    this.assertBatchSuccess(result?.Results);
    return { noop: false, item, result };
  }

  async deleteTraining(selector, options = {}) {
    const item = await this.resolveTraining(selector, options);
    const state = String(item.JobStatus?.Status ?? "").toLowerCase();
    if (!TRAIN_TERMINAL_STATES.has(state)) throw new Error(`训练任务当前状态“${item.JobStatus?.Status || "未知"}”不能删除，请先停止任务`);
    const result = await this.api.deleteTrainJobs([item], options.region);
    this.assertBatchSuccess(result?.Results);
    return { item, result };
  }

  assertBatchSuccess(results) {
    if (!Array.isArray(results) || !results.length) throw new Error("平台未返回任务操作结果，无法确认操作是否成功");
    const failed = results.filter((item) => !item.Return);
    if (failed.length) throw new Error(failed.map((item) => `${item.JobName || item.NotebookId || "未知资源"}: ${item.ErrorMessage || "操作失败"}`).join("；"));
  }

  requireUsername() {
    if (!this.config.username) throw new Error("尚未配置用户名，请运行：aicp config set username <IAM用户名>");
    return this.config.username;
  }

  async saveTemplateFromResource(kind, name, selector, options = {}) {
    if (kind === "dev") {
      const item = await this.resolveDeveloper(selector, options);
      const detail = await this.api.notebookDetail(item.NotebookId, options.region);
      return this.templates.save("dev", name, notebookDetailToVariables(detail, options.region || this.config.region), {
        id: item.NotebookId,
        name: item.Name,
      });
    }
    if (kind === "train") {
      const item = await this.resolveTraining(selector, options);
      const detail = await this.api.trainJobDetail(item.TrainJobId, options.region);
      return this.templates.save("train", name, trainDetailToVariables(detail, options.region || this.config.region), {
        id: item.TrainJobId,
        name: item.TrainJobName,
      });
    }
    throw new Error(`未知模板类型：${kind}`);
  }

  async importTemplate(kind, name, filePath) {
    const variables = await readVariablesFile(filePath);
    return this.templates.save(kind, name, variables, { file: filePath });
  }

  async prepareCreateVariables(kind, options = {}) {
    if (options.file && options.template) throw new Error("--file 和 --template 不能同时使用");
    if (options.command !== undefined && options.commandFile) throw new Error("--command 和 --command-file 不能同时使用");
    let variables = {};
    if (options.file) variables = await readVariablesFile(options.file);
    if (options.template) variables = clone((await this.templates.get(kind, options.template)).variables);
    if (!options.file && !options.template && options.variables) variables = clone(options.variables);
    if (options.name) variables[kind === "dev" ? "DisplayName" : "TrainJobName"] = options.name;
    if (options.command !== undefined && kind === "train") {
      if (String(variables.Framework).toLowerCase() === "ray") variables.EntryPointCommand = options.command;
      else {
        variables.Roles ??= [{}];
        variables.Roles[0] ??= {};
        variables.Roles[0].RunCommand = options.command;
      }
    }
    if (options.commandFile && kind === "train") {
      const command = await readFile(options.commandFile, "utf8");
      if (String(variables.Framework).toLowerCase() === "ray") variables.EntryPointCommand = command;
      else {
        variables.Roles ??= [{}];
        variables.Roles[0] ??= {};
        variables.Roles[0].RunCommand = command;
      }
    }
    if (options.region) variables.Region = options.region;
    await applySetOverrides(variables, options.set);
    variables.Region ||= this.config.region;
    this.validateCreateVariables(kind, variables);
    return variables;
  }

  validateCreateVariables(kind, variables) {
    const required = kind === "dev"
      ? ["Region", "DisplayName", "ResourcePoolId", "QueueName"]
      : ["Region", "TrainJobName", "ResourcePoolId", "QueueName", "Framework", "StorageConfigs", "Roles"];
    const missing = required.filter((key) => variables[key] === undefined || variables[key] === null || variables[key] === "");
    if (missing.length) throw new Error(`缺少必填参数：${missing.join(", ")}`);
    if (kind === "train" && (!Array.isArray(variables.Roles) || !variables.Roles.length)) {
      throw new Error("训练任务至少需要一个 Roles 项");
    }
    if (kind === "train") {
      if (!Array.isArray(variables.StorageConfigs)) throw new Error("StorageConfigs 必须是数组");
      if (variables.MaxRuntimeHour !== undefined && Number(variables.MaxRuntimeHour) <= 0) throw new Error("MaxRuntimeHour 必须大于 0");
      variables.Roles.forEach((role, index) => {
        const label = `Roles[${index}]`;
        if (!role || typeof role !== "object") throw new Error(`${label} 必须是对象`);
        if (!String(role.RoleName || "").trim()) throw new Error(`${label}.RoleName 不能为空`);
        if (!Number.isInteger(Number(role.Replicas)) || Number(role.Replicas) <= 0) throw new Error(`${label}.Replicas 必须是大于 0 的整数`);
        const image = role.ImageConfig;
        if (!image || typeof image !== "object") throw new Error(`${label}.ImageConfig 不能为空`);
        if (["Official", "Personal"].includes(image.ImageSource)) {
          if (!image.ImageId) throw new Error(`${label}.ImageConfig.ImageId 不能为空`);
        } else if (image.ImageSource === "ThirdParty") {
          const missingImage = ["ImageRegistryId", "ImageRepoId", "ImageTagId"].filter((key) => !image[key]);
          if (missingImage.length) throw new Error(`${label}.ImageConfig 缺少参数：${missingImage.join(", ")}`);
        } else {
          throw new Error(`${label}.ImageConfig.ImageSource 必须是 Official、Personal 或 ThirdParty`);
        }
        const resource = role.ResourceConfig;
        if (!resource || typeof resource !== "object") throw new Error(`${label}.ResourceConfig 不能为空`);
        if (Number(resource.CPUNum) <= 0 || Number(resource.Memory) <= 0) throw new Error(`${label} 的 CPU 和内存必须大于 0`);
        if (Number(resource.GPUNumber || 0) < 0) throw new Error(`${label}.ResourceConfig.GPUNumber 不能小于 0`);
        if (Number(resource.GPUNumber || 0) > 0 && !resource.GPUType) throw new Error(`${label} 使用 GPU 时必须选择 GPUType`);
        if (!Array.isArray(role.Envs)) throw new Error(`${label}.Envs 必须是数组`);
      });
      variables.StorageConfigs.forEach((item, index) => {
        if (!item?.StorageConfigId) throw new Error(`StorageConfigs[${index}].StorageConfigId 不能为空`);
        if (!item?.MountPath) throw new Error(`StorageConfigs[${index}].MountPath 不能为空`);
        if (!item?.MountType) throw new Error(`StorageConfigs[${index}].MountType 不能为空`);
      });
    }
    if (kind === "dev") {
      const thirdPartyImage = Number(variables.ImageSource) === 2;
      if (thirdPartyImage) {
        const imageFields = ["ImageRegistryId", "ImageRepoId", "ImageTagId"];
        const missingImageFields = imageFields.filter((key) => !variables[key]);
        if (missingImageFields.length) throw new Error(`第三方镜像缺少参数：${missingImageFields.join(", ")}`);
      } else if (!variables.ImageId && !variables.ImageUrl) {
        throw new Error("请选择官方镜像或自定义镜像");
      }
      if (Number(variables.CpuNum) <= 0 || Number(variables.Memory) <= 0) {
        throw new Error("CPU 和内存必须大于 0");
      }
      if (!Array.isArray(variables.StorageConfigs)) throw new Error("StorageConfigs 必须是数组");
      if (!Array.isArray(variables.ServiceConfigs)) throw new Error("ServiceConfigs 必须是数组");
      if (!Array.isArray(variables.Envs)) throw new Error("Envs 必须是数组");
    }
  }

  async create(kind, options = {}) {
    const variables = await this.prepareCreateVariables(kind, options);
    if (options.dryRun) return { dryRun: true, variables };
    const result = kind === "dev"
      ? await this.api.createNotebook(variables)
      : await this.api.createTrainJob(variables);
    return { dryRun: false, variables, result };
  }
}
