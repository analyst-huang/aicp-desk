/** @param {string} region @returns {import('../../lib/contracts.mjs').DeveloperCreateVariables} */
export const defaults = (region) => ({
  Region: region,
  ProjectId: null,
  DisplayName: "",
  Description: "",
  ImageSource: 0,
  ImageId: "",
  AutoSave: true,
  AutoSaveConfig: { ImageType: "Personal" },
  ResourcePoolId: "",
  QueueName: "",
  GPUType: "",
  GPUNumber: 0,
  CpuNum: 8,
  Memory: 16,
  AccessType: "Creator",
  StorageConfigs: [],
  EnableSsh: false,
  ServiceConfigs: [],
  Envs: [],
  NodeAffinity: { RunOnCPU: false, RunOnGPU: false },
});

/** Pure form conversion: detached output, unknown advanced JSON fields retained.
 * @param {import('../../lib/contracts.mjs').FormInput<ReturnType<typeof fromVariables>>} fields
 * @param {import('../../lib/contracts.mjs').DeveloperCreateVariables} base
 */
export function toVariables(fields, base) {
  fields = structuredClone(fields);
  const variables = structuredClone(base);
  variables.DisplayName = fields.name.trim();
  variables.Region = fields.region;
  const projectId = fields.project;
  if (projectId === "") throw new Error("请选择系统资源所属项目");
  variables.ProjectId = Number(projectId);
  variables.Description = fields.description.trim();
  variables.ImageSource = Number(fields.imageSource);
  delete variables.ImageId;
  delete variables.ImageRegistryId;
  delete variables.ImageRepoId;
  delete variables.ImageTagId;
  if (variables.ImageSource === 2) {
    variables.ImageRegistryId = fields.imageRegistry;
    variables.ImageRepoId = fields.imageRepo;
    variables.ImageTagId = fields.imageTag;
  } else {
    variables.ImageId = fields.imageSelect;
  }
  variables.AutoSave = fields.autosave;
  if (variables.AutoSave && fields.autosaveType === "Official") {
    variables.AutoSaveConfig = { ...variables.AutoSaveConfig, ImageType: "Official" };
    Object.assign(variables.AutoSaveConfig, {
        OfficialInstance: fields.autosaveInstance.trim(),
        UserName: fields.autosaveUsername.trim(),
        Password: fields.autosavePassword,
    });
  } else delete variables.AutoSaveConfig;
  variables.ResourcePoolId = fields.resourcePool;
  variables.QueueName = fields.queue;
  variables.GPUType = fields.gpuType;
  variables.GPUNumber = variables.GPUType ? Number(fields.gpuNumber || 0) : 0;
  variables.CpuNum = Number(fields.cpu || 0);
  variables.Memory = Number(fields.memory || 0);
  variables.AccessType = fields.queueShare ? "QueueMember" : "Creator";
  variables.Envs = fields.envs;
  variables.StorageConfigs = fields.storageConfigs;
  variables.EnableSsh = fields.enableSsh;
  if (variables.EnableSsh) {
    variables.SshPort = Number(fields.sshPort || 22);
    variables.SshAuthorizedKeys = fields.sshKeys.trim();
    variables.EnablePublicNetworkSsh = fields.publicSsh;
  } else {
    delete variables.SshPort;
    delete variables.SshAuthorizedKeys;
    delete variables.EnablePublicNetworkSsh;
  }
  variables.ServiceConfigs = fields.serviceConfigs;
  const needsAllocation = variables.EnablePublicNetworkSsh || variables.ServiceConfigs.some((item) => item.EnablePublicNetwork);
  if (needsAllocation) {
    if (!fields.allocationId) {
      const unavailable = fields.allocationUnavailable;
      throw new Error(unavailable
        ? `模板中的公网 EIP“${unavailable}”当前不可用，请重新选择`
        : "已开启公网访问，请选择一个当前可用的公网 EIP");
    }
    variables.AllocationId = fields.allocationId;
  } else delete variables.AllocationId;
  variables.NodeAffinity = {
    ...variables.NodeAffinity,
    RunOnCPU: fields.affinityCpu,
    RunOnGPU: fields.affinityGpu,
  };
  delete variables.NodeAffinity.RequiredNodeIp;
  if (fields.affinityIp.trim()) variables.NodeAffinity.RequiredNodeIp = fields.affinityIp.trim();
  return variables;
}

/** @param {import('../../lib/contracts.mjs').DeveloperCreateVariables} variables */
export function fromVariables(variables) {
  return structuredClone({
    region: variables.Region,
    name: variables.DisplayName || '',
    project: String(variables.ProjectId ?? ''),
    description: variables.Description || '',
    imageSource: [0, 1, 2].includes(Number(variables.ImageSource)) ? Number(variables.ImageSource) : 0,
    imageSelect: variables.ImageId || '',
    imageRegistry: variables.ImageRegistryId || '',
    imageRepo: variables.ImageRepoId || '',
    imageTag: variables.ImageTagId || '',
    autosave: Boolean(variables.AutoSave),
    autosaveType: variables.AutoSaveConfig?.ImageType || 'Personal',
    autosaveInstance: variables.AutoSaveConfig?.OfficialInstance || '',
    autosaveUsername: variables.AutoSaveConfig?.UserName || '',
    autosavePassword: variables.AutoSaveConfig?.Password || '',
    resourcePool: variables.ResourcePoolId || '',
    queue: variables.QueueName || '',
    gpuType: variables.GPUType || '',
    gpuNumber: variables.GPUNumber ?? 0,
    cpu: variables.CpuNum ?? 8,
    memory: variables.Memory ?? 16,
    queueShare: variables.AccessType === 'QueueMember',
    envs: variables.Envs || [],
    storageConfigs: variables.StorageConfigs || [],
    serviceConfigs: variables.ServiceConfigs || [],
    enableSsh: Boolean(variables.EnableSsh),
    sshPort: variables.SshPort ?? 22,
    sshKeys: variables.SshAuthorizedKeys || '',
    publicSsh: Boolean(variables.EnablePublicNetworkSsh),
    allocationId: variables.AllocationId || '',
    allocationUnavailable: '',
    affinityCpu: Boolean(variables.NodeAffinity?.RunOnCPU),
    affinityGpu: Boolean(variables.NodeAffinity?.RunOnGPU),
    affinityIp: variables.NodeAffinity?.RequiredNodeIp || '',
  });
}
