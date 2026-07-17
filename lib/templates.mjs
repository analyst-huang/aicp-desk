import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { appPaths, readJson, writeJsonAtomic } from "./paths.mjs";
import { clone } from "./utils.mjs";

const KINDS = new Set(["dev", "train"]);

function compact(value) {
  if (Array.isArray(value)) return value.map(compact).filter((item) => item !== undefined);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || key === "__typename") continue;
    result[key] = compact(entry);
  }
  return result;
}

function notebookStorage(detail) {
  const map = (items, storageConfigType) => (items ?? []).map((item) => ({
    StorageConfigId: item.StorageConfigId,
    MountPath: item.MountPath,
    StorageConfigType: storageConfigType || item.StorageConfigType,
    MountProtocol: item.MountProtocol || null,
  }));
  const explicit = [
    ...map(detail.DataSetConfigs, "DataSet"),
    ...map(detail.VolumeConfigs, "Output"),
  ];
  return explicit.length ? explicit : map(detail.StorageConfigs);
}

export function notebookDetailToVariables(detail, region) {
  if (!detail) throw new Error("开发机详情为空");
  return compact({
    Region: region,
    DisplayName: detail.Name,
    Description: detail.Description,
    Type: detail.Type,
    ImageUrl: detail.ImageUrl,
    ClusterId: detail.ClusterId,
    ImageId: detail.ImageId,
    ImageSource: detail.ImageSource,
    ImageRegistryId: detail.ImageRegistryId,
    ImageRepoId: detail.ImageRepoId,
    ImageTagId: detail.ImageTagId,
    AutoSave: detail.AutoSave,
    ResourcePoolId: detail.ResourcePoolId,
    QueueName: detail.QueueName,
    GPUType: detail.GPUType || "",
    GPUNumber: detail.GPUNumber,
    AccessType: detail.AccessType,
    StorageConfigs: notebookStorage(detail),
    AllocationId: detail.AllocationId,
    EnableSsh: detail.EnableSsh,
    SshPort: detail.SshPort,
    SshAuthorizedKeys: detail.SshAuthorizedKeys,
    EnablePublicNetworkSsh: detail.EnablePublicNetworkSsh,
    CpuNum: detail.CpuNum,
    Memory: detail.Memory,
    ServiceConfigs: (detail.ServiceConfigs ?? []).map((item) => ({
      Service: item.Service,
      Port: item.Port,
      EnablePublicNetwork: item.EnablePublicNetwork,
    })),
    AutoSaveConfig: detail.AutoSave ? detail.AutoSaveConfig : undefined,
    RunOnCpu: detail.RunOnCpu,
    Envs: (detail.Envs ?? []).map(({ Name, Value }) => ({ Name, Value })),
    NodeAffinity: detail.NodeAffinity,
  });
}

export function trainDetailToVariables(detail, region) {
  if (!detail) throw new Error("训练任务详情为空");
  return compact({
    Region: region,
    TrainJobName: detail.TrainJobName,
    Description: detail.Description,
    ResourcePoolId: detail.ResourcePoolId,
    Priority: detail.Priority,
    QueueName: detail.QueueName,
    Framework: detail.Framework,
    AccessType: detail.AccessType,
    SelfHealing: detail.SelfHealing,
    UseIdleResource: detail.UseIdleResource,
    MaxRuntimeHour: detail.MaxRuntimeHour,
    HoldingTimeMinutes: detail.HoldingTimeMinutes,
    JobRunOnCPU: detail.JobRunOnCPU,
    SupportTensorboard: detail.SupportTensorboard,
    StorageConfigs: (detail.StorageConfigs ?? []).map((item) => ({
      StorageConfigId: item.StorageConfigId,
      MountType: item.MountType,
      MountPath: item.MountPath,
      MountProtocol: item.MountProtocol || null,
      StorageSubPath: item.StorageSubPath,
    })),
    Roles: (detail.Roles ?? []).map((role) => ({
      RoleName: role.RoleName,
      Replicas: role.Replicas,
      ImageConfig: compact({
        ImageId: role.ImageConfig?.ImageId,
        ImageSource: role.ImageConfig?.ImageSource,
        ImageRegistryId: role.ImageConfig?.ImageRegistryId,
        ImageRepoId: role.ImageConfig?.ImageRepoId,
        ImageTagId: role.ImageConfig?.ImageTagId,
      }),
      ResourceConfig: role.ResourceConfig,
      RunCommand: role.RunCommand || "",
      RestartPolicy: role.RestartPolicy || "Never",
      Envs: (role.Envs ?? []).map(({ Name, Value }) => ({ Name, Value })),
      IsChiefRole: role.IsChiefRole || false,
      DefaultPort: role.DefaultPort || undefined,
      AdditionalPort: role.AdditionalPort || undefined,
    })),
    EnableDeviceHealthCheck: detail.EnableDeviceHealthCheck,
    DeviceHealthCheckConfig: detail.EnableDeviceHealthCheck ? detail.DeviceHealthCheckConfig : undefined,
    NodeAffinity: detail.NodeAffinity,
    RuntimeEnv: detail.RuntimeEnv,
    EntryPointCommand: detail.EntryPointCommand,
  });
}

function validateKind(kind) {
  if (!KINDS.has(kind)) throw new Error(`模板类型必须是 dev 或 train：${kind}`);
}

function validateName(name) {
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(name)) {
    throw new Error("模板名称仅支持字母、数字、点、下划线和连字符，最长 80 个字符");
  }
}

export class TemplateStore {
  constructor() {
    this.paths = appPaths();
  }

  filePath(kind, name) {
    validateKind(kind);
    validateName(name);
    return path.join(this.paths.templates, kind, `${name}.json`);
  }

  async save(kind, name, variables, source = undefined) {
    const filePath = this.filePath(kind, name);
    await mkdir(path.dirname(filePath), { recursive: true });
    const record = {
      version: 1,
      kind,
      name,
      updatedAt: new Date().toISOString(),
      source,
      variables: compact(clone(variables)),
    };
    await writeJsonAtomic(filePath, record);
    return record;
  }

  async get(kind, name) {
    const record = await readJson(this.filePath(kind, name));
    if (record.kind !== kind || !record.variables) throw new Error(`模板格式无效：${kind}/${name}`);
    return record;
  }

  async list() {
    const records = [];
    for (const kind of KINDS) {
      const directory = path.join(this.paths.templates, kind);
      let names = [];
      try {
        names = await readdir(directory);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      for (const filename of names.filter((item) => item.endsWith(".json"))) {
        try {
          records.push(await readJson(path.join(directory, filename)));
        } catch {
          records.push({ kind, name: filename.slice(0, -5), invalid: true });
        }
      }
    }
    return records.sort((left, right) => `${left.kind}/${left.name}`.localeCompare(`${right.kind}/${right.name}`));
  }

  async delete(kind, name) {
    await rm(this.filePath(kind, name), { force: true });
    return { deleted: true, kind, name };
  }
}
