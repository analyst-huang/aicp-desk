/** @param {string} region @returns {import('../../lib/contracts.mjs').TrainingCreateVariables} */
export const defaults = (region) => ({
  Region: region,
  TrainJobName: "",
  Description: "",
  ResourcePoolId: "",
  Priority: "kaic-normal",
  QueueName: "",
  Framework: "pytorch",
  AccessType: "Creator",
  SelfHealing: false,
  UseIdleResource: false,
  MaxRuntimeHour: 720,
  HoldingTimeMinutes: 0,
  JobRunOnCPU: true,
  SupportTensorboard: false,
  StorageConfigs: [],
  Roles: [{
    RoleName: "Master",
    Replicas: 1,
    ImageConfig: { ImageId: "", ImageSource: "Personal" },
    ResourceConfig: { GPUType: "", GPUNumber: 0, CPUNum: 8, Memory: 16 },
    RunCommand: "",
    RestartPolicy: "Never",
    Envs: [],
    IsChiefRole: false,
  }],
  EnableDeviceHealthCheck: false,
});

/** Pure form conversion: detached output, unknown advanced JSON fields retained.
 * @param {import('../../lib/contracts.mjs').FormInput<ReturnType<typeof fromVariables>>} fields
 * @param {import('../../lib/contracts.mjs').TrainingCreateVariables} base
 */
export function toVariables(fields, base) {
  fields = structuredClone(fields);
  const variables = structuredClone(base);
  variables.TrainJobName = fields.name.trim();
  variables.Region = fields.region;
  variables.ResourcePoolId = fields.resourcePool;
  variables.QueueName = fields.queue;
  variables.Framework = fields.framework;
  variables.Priority = fields.priority;
  variables.AccessType = fields.queueShare ? "QueueMember" : "Creator";
  variables.Roles ||= [{}];
  variables.Roles[0] ||= {};
  variables.Roles[0].RoleName = fields.roleName.trim();
  variables.Roles[0].Replicas = Number(fields.replicas || 0);
  variables.Roles[0].ImageConfig ||= {};
  variables.Roles[0].ImageConfig.ImageSource = fields.imageSource;
  delete variables.Roles[0].ImageConfig.ImageId;
  delete variables.Roles[0].ImageConfig.ImageRegistryId;
  delete variables.Roles[0].ImageConfig.ImageRepoId;
  delete variables.Roles[0].ImageConfig.ImageTagId;
  if (variables.Roles[0].ImageConfig.ImageSource === "ThirdParty") {
    variables.Roles[0].ImageConfig.ImageRegistryId = fields.imageRegistry;
    variables.Roles[0].ImageConfig.ImageRepoId = fields.imageRepo;
    variables.Roles[0].ImageConfig.ImageTagId = fields.imageTag;
  } else {
    variables.Roles[0].ImageConfig.ImageId = fields.imageSelect;
  }
  variables.Roles[0].ResourceConfig ||= {};
  variables.Roles[0].ResourceConfig.GPUType = fields.gpuType;
  variables.Roles[0].ResourceConfig.GPUNumber = variables.Roles[0].ResourceConfig.GPUType ? Number(fields.gpuNumber || 0) : 0;
  variables.Roles[0].ResourceConfig.CPUNum = Number(fields.cpu || 0);
  variables.Roles[0].ResourceConfig.Memory = Number(fields.memory || 0);
  variables.JobRunOnCPU = fields.jobCpu || !variables.Roles[0].ResourceConfig.GPUType;
  variables.StorageConfigs = fields.storageConfigs;
  if (String(variables.Framework).toLowerCase() === "ray") {
    variables.EntryPointCommand = fields.command;
    delete variables.Roles[0].RunCommand;
  } else {
    variables.Roles[0].RunCommand = fields.command;
    delete variables.EntryPointCommand;
  }
  return variables;
}

/** @param {import('../../lib/contracts.mjs').TrainingCreateVariables} variables */
export function fromVariables(variables) {
  const role = variables.Roles?.[0] || {};
  const image = role.ImageConfig || {};
  const resource = role.ResourceConfig || {};
  return structuredClone({
    region: variables.Region,
    name: variables.TrainJobName || '',
    resourcePool: variables.ResourcePoolId || '',
    queue: variables.QueueName || '',
    framework: variables.Framework || 'pytorch',
    priority: variables.Priority || 'kaic-normal',
    queueShare: variables.AccessType === 'QueueMember',
    roleName: role.RoleName || 'Master',
    replicas: role.Replicas ?? 1,
    imageSource: ['Official', 'Personal', 'ThirdParty'].includes(image.ImageSource || '') ? image.ImageSource : 'Personal',
    imageSelect: image.ImageId || '',
    imageRegistry: image.ImageRegistryId || '',
    imageRepo: image.ImageRepoId || '',
    imageTag: image.ImageTagId || '',
    gpuType: resource.GPUType || '',
    gpuNumber: resource.GPUNumber ?? 0,
    cpu: resource.CPUNum ?? 8,
    memory: resource.Memory ?? 16,
    jobCpu: Boolean(variables.JobRunOnCPU || !resource.GPUType),
    storageConfigs: variables.StorageConfigs || [],
    command: String(variables.Framework).toLowerCase() === 'ray' ? variables.EntryPointCommand || '' : role.RunCommand || '',
  });
}
