// @ts-check
/** Input decoding and validation are local and never perform cloud requests.
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** @param {unknown} kind @returns {asserts kind is import('../contracts.mjs').ResourceKind} */
export function assertCreateKind(kind) {
  if (kind !== 'dev' && kind !== 'train') throw new Error(`未知资源类型：${kind}`);
}

/** @param {unknown} value @param {string} [label] @returns {asserts value is Record<string, unknown>} */
export function assertCreateObject(value, label = '创建参数') {
  if (!record(value)) throw new Error(`${label} 必须是对象`);
}

/** Return a copy, preserving unknown platform fields and leaving invalid values for validation.
 * @param {import('../contracts.mjs').ResourceKind} kind @param {unknown} input
 */
export function normalizeCreateVariables(kind, input) {
  assertCreateKind(kind);
  assertCreateObject(input);
  const variables = structuredClone(input);
  const numbers = /** @param {unknown} object @param {string[]} fields */ (object, fields) => {
    if (!record(object)) return;
    for (const field of fields) {
      if (typeof object[field] === 'string' && object[field].trim()) object[field] = Number(object[field]);
    }
  };
  numbers(variables, kind === 'dev'
    ? ['ProjectId', 'CpuNum', 'Memory', 'GPUNumber', 'SshPort', 'ImageSource']
    : ['MaxRuntimeHour']);
  if (kind === 'train' && Array.isArray(variables.Roles)) for (const role of variables.Roles) {
    numbers(role, ['Replicas']);
    numbers(role?.ResourceConfig, ['CPUNum', 'Memory', 'GPUNumber']);
  }
  return variables;
}

/** @param {unknown} value @param {string} label */
function numeric(value, label, { minimum = 0, integer = false, inclusive = false } = {}) {
  const scalar = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '');
  const number = scalar ? Number(value) : NaN;
  if (!Number.isFinite(number) || (integer && !Number.isSafeInteger(number)) || (inclusive ? number < minimum : number <= minimum)) {
    throw new Error(`${label} 必须是${inclusive ? '大于或等于' : '大于'} ${minimum} 的有效${integer ? '整数' : '数字'}`);
  }
  return number;
}

/** @param {unknown} value @param {string} label @returns {asserts value is Record<string, unknown>[]} */
function arrayOfObjects(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
  value.forEach((item, index) => assertCreateObject(item, `${label}[${index}]`));
}

/** Pure validation: safe to call with a frozen prepared snapshot.
 * @param {import('../contracts.mjs').ResourceKind} kind @param {unknown} variables
 * @returns {asserts variables is import('../contracts.mjs').CreateVariables}
 */
export function validateCreateVariables(kind, variables) {
  assertCreateKind(kind);
  assertCreateObject(variables);
  const required = kind === 'dev'
    ? ['Region', 'DisplayName', 'ProjectId', 'ResourcePoolId', 'QueueName']
    : ['Region', 'TrainJobName', 'ResourcePoolId', 'QueueName', 'Framework', 'StorageConfigs', 'Roles'];
  const missing = required.filter(key => variables[key] == null || variables[key] === '');
  if (missing.length) throw new Error(`缺少必填参数：${missing.join(', ')}`);
  for (const key of kind === 'dev' ? ['Region', 'DisplayName', 'ResourcePoolId', 'QueueName'] : ['Region', 'TrainJobName', 'ResourcePoolId', 'QueueName', 'Framework']) {
    if (typeof variables[key] !== 'string' || !variables[key].trim()) throw new Error(`${key} 必须是非空字符串`);
  }
  arrayOfObjects(variables.StorageConfigs, 'StorageConfigs');
  if (kind === 'dev') {
    numeric(variables.ProjectId, 'ProjectId', { integer: true, inclusive: true });
    if (variables.ImageSource != null && ![0, 1, 2].includes(numeric(variables.ImageSource, 'ImageSource', { integer: true, inclusive: true }))) {
      throw new Error('ImageSource 必须是 0、1 或 2');
    }
    if (Number(variables.ImageSource) === 2) {
      const missingImage = ['ImageRegistryId', 'ImageRepoId', 'ImageTagId'].filter(key => !variables[key]);
      if (missingImage.length) throw new Error(`第三方镜像缺少参数：${missingImage.join(', ')}`);
    } else if (!variables.ImageId && !variables.ImageUrl) throw new Error('请选择官方镜像或自定义镜像');
    numeric(variables.CpuNum, 'CPU');
    numeric(variables.Memory, '内存');
    if (variables.GPUNumber !== undefined) numeric(variables.GPUNumber, 'GPUNumber', { integer: true, inclusive: true });
    if (Number(variables.GPUNumber) > 0 && !variables.GPUType) throw new Error('使用 GPU 时必须选择 GPUType');
    if (variables.SshPort !== undefined && (variables.SshPort !== null || variables.EnableSsh)) {
      const port = numeric(variables.SshPort, 'SshPort', { integer: true, inclusive: !variables.EnableSsh });
      if (port > 65535) throw new Error('SshPort 不能大于 65535');
    }
    arrayOfObjects(variables.ServiceConfigs, 'ServiceConfigs');
    arrayOfObjects(variables.Envs, 'Envs');
    return;
  }
  if (!Array.isArray(variables.Roles) || !variables.Roles.length) throw new Error('训练任务至少需要一个 Roles 项');
  if (variables.MaxRuntimeHour !== undefined) numeric(variables.MaxRuntimeHour, 'MaxRuntimeHour');
  variables.Roles.forEach((role, index) => {
    const label = `Roles[${index}]`;
    assertCreateObject(role, label);
    if (typeof role.RoleName !== 'string' || !role.RoleName.trim()) throw new Error(`${label}.RoleName 不能为空`);
    numeric(role.Replicas, `${label}.Replicas`, { integer: true });
    const image = role.ImageConfig;
    assertCreateObject(image, `${label}.ImageConfig`);
    if (image.ImageSource === 'Official' || image.ImageSource === 'Personal') {
      if (!image.ImageId) throw new Error(`${label}.ImageConfig.ImageId 不能为空`);
    } else if (image.ImageSource === 'ThirdParty') {
      const missingImage = ['ImageRegistryId', 'ImageRepoId', 'ImageTagId'].filter(key => !image[key]);
      if (missingImage.length) throw new Error(`${label}.ImageConfig 缺少参数：${missingImage.join(', ')}`);
    } else throw new Error(`${label}.ImageConfig.ImageSource 必须是 Official、Personal 或 ThirdParty`);
    const resource = role.ResourceConfig;
    assertCreateObject(resource, `${label}.ResourceConfig`);
    numeric(resource.CPUNum, `${label} 的 CPU`);
    numeric(resource.Memory, `${label} 的内存`);
    if (resource.GPUNumber !== undefined) numeric(resource.GPUNumber, `${label}.ResourceConfig.GPUNumber`, { integer: true, inclusive: true });
    if (Number(resource.GPUNumber) > 0 && !resource.GPUType) throw new Error(`${label} 使用 GPU 时必须选择 GPUType`);
    arrayOfObjects(role.Envs, `${label}.Envs`);
  });
  variables.StorageConfigs.forEach((item, index) => {
    for (const field of ['StorageConfigId', 'MountPath', 'MountType']) {
      if (!item[field]) throw new Error(`StorageConfigs[${index}].${field} 不能为空`);
    }
  });
}
