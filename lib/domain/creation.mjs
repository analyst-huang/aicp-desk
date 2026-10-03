// Availability checks use read-only cloud lookups; dispatch stays with the caller.

export async function prepareNotebookPayload(api, variables) {
  const payload = { ...variables, Region: api.region(variables.Region) };
  if (payload.ProjectId === undefined || payload.ProjectId === null || payload.ProjectId === "") {
    throw new Error("请选择系统资源所属项目（ProjectId）");
  }
  payload.ProjectId = Number(payload.ProjectId);
  if (!Number.isFinite(payload.ProjectId)) throw new Error("ProjectId 必须是有效数字");
  const needsAllocation = Boolean(payload.EnablePublicNetworkSsh)
    || (payload.ServiceConfigs ?? []).some((item) => item.EnablePublicNetwork);
  const requiredNodeIp = payload.NodeAffinity?.RequiredNodeIp;
  if (!needsAllocation) delete payload.AllocationId;
  if (needsAllocation && !payload.AllocationId) throw new Error("已开启公网访问，请选择一个当前可用的公网 EIP");

  const [pools, projects] = await Promise.all([
    api.listResourcePools(payload.Region),
    api.listProjects(payload.Region),
  ]);
  if (!pools.some((item) => item.ResourcePoolId === payload.ResourcePoolId)) {
    throw new Error(`开发机资源组“${payload.ResourcePoolId}”当前不可用，请刷新创建选项后重新选择`);
  }
  if (!projects.some((item) => Number(item.ProjectId) === payload.ProjectId)) {
    throw new Error(`系统资源所属项目“${payload.ProjectId}”当前不可用，请刷新创建选项后重新选择`);
  }
  const queues = await api.listClusterQueues(payload.ResourcePoolId, payload.Region);
  const queue = queues.find((item) => item.Name === payload.QueueName);
  if (!queue) throw new Error(`开发机队列“${payload.QueueName}”当前不可用，请刷新创建选项后重新选择`);

  const imageSource = Number(payload.ImageSource);
  if ([0, 1].includes(imageSource) && payload.ImageId) {
    const source = imageSource === 0 ? "Official" : "Personal";
    const images = await api.listImages(source, payload.Region);
    if (!images.some((item) => item.ImageId === payload.ImageId)) {
      throw new Error(`选择的${source === "Official" ? "官方" : "自定义"}镜像当前不可用，请刷新创建选项后重新选择`);
    }
  } else if (imageSource === 2) {
    const repos = await api.listImageRepos(payload.ImageRegistryId, payload.Region);
    if (!repos.some((item) => item.RepoId === payload.ImageRepoId)) throw new Error("选择的第三方镜像仓库当前不可用，请重新选择");
    const tags = await api.listImageTags(payload.ImageRegistryId, payload.ImageRepoId, payload.Region);
    if (!tags.some((item) => item.TagId === payload.ImageTagId)) throw new Error("选择的第三方镜像版本当前不可用，请重新选择");
  }

  if (payload.StorageConfigs?.length) {
    const [ks3, kpfs] = await Promise.all([
      api.listStorageConfigs("KS3", payload.Region),
      api.listStorageConfigs("KPFS", payload.Region),
    ]);
    const availableIds = new Set([...ks3, ...kpfs].map((item) => item.StorageConfigId));
    const unavailable = payload.StorageConfigs.find((item) => !availableIds.has(item.StorageConfigId));
    if (unavailable) throw new Error(`挂载配置“${unavailable.StorageConfigId}”当前不可用，请重新选择`);
  }

  if (needsAllocation) {
    const addresses = await api.listAvailableAddresses(payload.Region);
    const address = addresses.find((item) => item.AllocationId === payload.AllocationId || item.PublicIp === payload.AllocationId);
    if (!address) {
      throw new Error(`公网 EIP“${payload.AllocationId}”当前不可用于创建，请刷新创建选项后重新选择`);
    }
    payload.AllocationId = address.AllocationId;
  }
  if (requiredNodeIp) {
    const nodes = await api.listAvailableNodes(queue.Id, {
      cpu: payload.CpuNum,
      gpuType: payload.GPUType,
      gpuNumber: payload.GPUNumber,
      memory: payload.Memory,
      region: payload.Region,
    });
    if (!nodes.some((item) => item.InstanceIp === requiredNodeIp)) {
      throw new Error(`固定节点 IP“${requiredNodeIp}”当前不能满足所选队列和资源规格，请改为“不指定节点”或重新选择节点`);
    }
  }
  return payload;
}

export async function prepareTrainJobPayload(api, variables) {
  const payload = { ...variables, Region: api.region(variables.Region) };
  const pools = await api.listResourcePools(payload.Region);
  if (!pools.some((item) => item.ResourcePoolId === payload.ResourcePoolId)) {
    throw new Error(`训练资源组“${payload.ResourcePoolId}”当前不可用，请刷新创建选项后重新选择`);
  }
  const queues = await api.listClusterQueues(payload.ResourcePoolId, payload.Region, { workloadType: "trainjob" });
  if (!queues.some((item) => item.Name === payload.QueueName)) {
    throw new Error(`训练队列“${payload.QueueName}”当前不可用，请刷新创建选项后重新选择`);
  }

  const imageLists = new Map();
  for (const role of payload.Roles ?? []) {
    const image = role.ImageConfig ?? {};
    const source = String(image.ImageSource || "");
    if (["Official", "Personal"].includes(source)) {
      if (!imageLists.has(source)) {
        imageLists.set(source, await api.listImages(source, payload.Region, {
          applicationScenario: source === "Official" ? "训练任务" : undefined,
        }));
      }
      if (!imageLists.get(source).some((item) => item.ImageId === image.ImageId)) {
        throw new Error(`角色“${role.RoleName || "未命名"}”选择的${source === "Official" ? "官方" : "自定义"}镜像当前不可用，请重新选择`);
      }
    } else if (source === "ThirdParty") {
      const required = ["ImageRegistryId", "ImageRepoId", "ImageTagId"];
      if (required.some((key) => !image[key])) {
        throw new Error(`角色“${role.RoleName || "未命名"}”的第三方镜像配置不完整`);
      }
      const repos = await api.listImageRepos(image.ImageRegistryId, payload.Region);
      if (!repos.some((item) => item.RepoId === image.ImageRepoId)) {
        throw new Error(`角色“${role.RoleName || "未命名"}”选择的第三方镜像仓库当前不可用`);
      }
      const tags = await api.listImageTags(image.ImageRegistryId, image.ImageRepoId, payload.Region);
      if (!tags.some((item) => item.TagId === image.ImageTagId)) {
        throw new Error(`角色“${role.RoleName || "未命名"}”选择的第三方镜像版本当前不可用`);
      }
    }
  }

  if (payload.StorageConfigs?.length) {
    const [ks3, kpfs] = await Promise.all([
      api.listStorageConfigs("KS3", payload.Region),
      api.listStorageConfigs("KPFS", payload.Region),
    ]);
    const availableIds = new Set([...ks3, ...kpfs].map((item) => item.StorageConfigId));
    const unavailable = payload.StorageConfigs.find((item) => !availableIds.has(item.StorageConfigId));
    if (unavailable) throw new Error(`挂载配置“${unavailable.StorageConfigId}”当前不可用，请重新选择`);
  }

  return payload;
}
