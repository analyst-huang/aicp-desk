import { readFile } from 'node:fs/promises';
import { applySetOverrides, clone, readVariablesFile } from '../utils.mjs';
import { prepareNotebookPayload, prepareTrainJobPayload } from '../domain/creation.mjs';

export class CreationService {
  constructor({ executePayload, templates, config }) {
    Object.assign(this, { executePayload, templates, config });
  }

  async prepareCreateVariables(kind, options = {}) {
    if (!["dev", "train"].includes(kind)) throw new Error(`未知资源类型：${kind}`);
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
      ? ["Region", "DisplayName", "ProjectId", "ResourcePoolId", "QueueName"]
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
      if (!Number.isFinite(Number(variables.ProjectId))) throw new Error("ProjectId 必须是有效数字");
      variables.ProjectId = Number(variables.ProjectId);
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

  /** @returns {Promise<import('../contracts.mjs').PreparedCreate>} */
  async prepareCreate(kind, options = {}) {
    const variables = await this.prepareCreateVariables(kind, options);
    return freeze({ kind, variables });
  }

  /** Execute the confirmed snapshot; never reread a template or variable file. */
  async executeCreate(prepared) {
    const { kind } = prepared;
    if (!["dev", "train"].includes(kind)) throw new Error(`未知资源类型：${kind}`);
    const variables = clone(prepared.variables);
    this.validateCreateVariables(kind, variables);
    const result = await this.executePayload(kind, variables);
    return { dryRun: false, variables, result };
  }

  async create(kind, options = {}) {
    const prepared = await this.prepareCreate(kind, options);
    if (options.dryRun) return { dryRun: true, variables: prepared.variables };
    return this.executeCreate(prepared);
  }
}

/** Build the execution port once at composition time, including legacy adapter support. */
export function creationExecutor(api) {
  if (!api.submitCreate) return (kind, variables) => kind === 'dev' ? api.createNotebook(variables) : api.createTrainJob(variables);
  return (kind, variables) => api.withSession(async () => {
    const payload = await (kind === 'dev' ? prepareNotebookPayload : prepareTrainJobPayload)(api, variables);
    return api.submitCreate(kind, payload);
  });
}

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
