import {
  BATCH_DELETE_NOTEBOOKS,
  BATCH_DELETE_TRAIN_JOBS,
  BATCH_START_TRAIN_JOBS,
  BATCH_STOP_TRAIN_JOBS,
  CREATE_NOTEBOOK,
  CREATE_TRAIN_JOB,
  DATA_SET_LIST,
  DESCRIBE_KCR_INSTANCES,
  DESCRIBE_NAMESPACES,
  DESCRIBE_PERSONAL_NAMESPACES,
  DESCRIBE_PERSONAL_REPOSITORIES,
  DESCRIBE_REPOSITORIES,
  DESCRIBE_AVAILABLE_ADDRESSES,
  DESCRIBE_AICP_IMAGES,
  DESCRIBE_ALL_RESOURCE_POOLS,
  DESCRIBE_CLUSTER_QUEUES,
  DESCRIBE_GPU_INFO,
  DESCRIBE_IMAGE_REGISTRIES,
  DESCRIBE_INSTANCES_BY_RESOURCE,
  DESCRIBE_NOTEBOOK_DETAIL,
  DESCRIBE_NOTEBOOKS,
  DESCRIBE_QUEUE_RESOURCE_CONFIG,
  DESCRIBE_RESOURCE_POOL_INSTANCES,
  DESCRIBE_REGISTRY_REPOS,
  DESCRIBE_REPO_TAGS,
  DESCRIBE_TRAIN_JOB_DETAIL,
  DESCRIBE_TRAIN_JOBS,
  GET_IMAGE_CONFIG,
  MODIFY_NOTEBOOK_STATUS,
  QUERY_PUBLIC_NETWORK_CONDITION,
  SAVE_NOTEBOOK_IMAGE,
} from "./operations.mjs";

function hasActiveImageConfig(config) {
  const info = config?.ImageServiceInfo;
  const entries = Array.isArray(info) ? info : info ? [info] : [];
  return entries.some((item) => !item.Deleted);
}

export class AicpApi {
  constructor(browser, config) {
    this.browser = browser;
    this.config = config;
  }

  region(override) {
    return override || this.config.region;
  }

  async listNotebooks(filters = {}) {
    const variables = {
      Region: this.region(filters.region),
      Marker: Number(filters.marker ?? 1),
      MaxResults: Math.min(Number(filters.limit ?? 100), 100),
      SkipUserPermissionCheck: Boolean(filters.skipUserPermissionCheck ?? false),
    };
    if (filters.id) variables.NotebookId = filters.id;
    if (filters.name) variables.Name = filters.name;
    if (filters.queueId) variables.QueueId = filters.queueId;
    if (filters.state) variables.State = filters.state;
    if (filters.username) variables.UserName = filters.username;
    const data = await this.browser.graphql("DescribeNotebook", DESCRIBE_NOTEBOOKS, variables);
    return data.DescribeNotebook;
  }

  async notebookDetail(id, region) {
    const data = await this.browser.graphql("DescribeNotebookDetail", DESCRIBE_NOTEBOOK_DETAIL, {
      Region: this.region(region),
      NotebookId: id,
    });
    return data.DescribeNotebookDetail?.NotebookDetail;
  }

  async deleteNotebooks(ids, region) {
    const data = await this.browser.graphql("BatchDeleteNotebook", BATCH_DELETE_NOTEBOOKS, {
      Region: this.region(region),
      NotebookIds: ids,
    });
    return data.BatchDeleteNotebook;
  }

  async listResourcePools(region) {
    const data = await this.browser.graphql("DescribeAllResourcePool", DESCRIBE_ALL_RESOURCE_POOLS, {
      Region: this.region(region),
      ResourcePoolType: "",
      Status: "normal",
    });
    return data.DescribeAllResourcePool?.ResourcePoolSet ?? [];
  }

  async listClusterQueues(resourcePoolId, region, { workloadType = "notebook" } = {}) {
    const variables = {
      Region: this.region(region),
      ResourcePoolId: resourcePoolId,
      Marker: 1,
      MaxResults: 1000,
      State: "normal",
    };
    if (workloadType) variables.WorkloadType = workloadType;
    const data = await this.browser.graphql("DescribeClusterQueue", DESCRIBE_CLUSTER_QUEUES, variables);
    return data.DescribeClusterQueue?.Queues ?? [];
  }

  async resourcePoolGpuInfo(resourcePoolId, region) {
    const data = await this.browser.graphql("DescribeGpuInfo", DESCRIBE_GPU_INFO, {
      Region: this.region(region),
      ResourcePoolId: resourcePoolId,
    });
    return data.DescribeGpuInfo?.Gpu ?? {};
  }

  async listResourcePoolInstances(resourcePoolId, region) {
    const pageSize = 100;
    const instances = [];
    for (let page = 1; ; page += 1) {
      const data = await this.browser.graphql("DescribeResourcePoolInstances", DESCRIBE_RESOURCE_POOL_INSTANCES, {
        Region: this.region(region),
        ResourcePoolId: resourcePoolId,
        Page: page,
        PageSize: pageSize,
      });
      const response = data.DescribeResourcePoolInstances ?? {};
      const current = response.ResourcePoolInstanceSet ?? [];
      instances.push(...current);
      const total = Number(response.TotalCount ?? instances.length);
      if (!current.length || instances.length >= total) break;
    }
    return instances;
  }

  async gpuCapacity(region) {
    return this.browser.withBrowser(async () => {
      const resourcePools = await this.listResourcePools(region);
      const groups = await Promise.all(resourcePools.map(async (pool) => {
        const [gpu, queues, nodes] = await Promise.all([
          this.resourcePoolGpuInfo(pool.ResourcePoolId, region),
          this.listClusterQueues(pool.ResourcePoolId, region, { workloadType: null }),
          this.listResourcePoolInstances(pool.ResourcePoolId, region),
        ]);
        return { pool, gpu, queues, nodes };
      }));
      return { region: this.region(region), groups };
    });
  }

  async listImages(source, region, { applicationScenario } = {}) {
    const variables = {
      Region: this.region(region),
      ImageSource: source,
      Page: 1,
      PageSize: 1000,
    };
    if (source === "Personal") variables.ImageStatuses = "active";
    if (applicationScenario) variables.ApplicationScenario = applicationScenario;
    const data = await this.browser.graphql("DescribeAicpImages", DESCRIBE_AICP_IMAGES, variables);
    return data.DescribeAicpImages?.ImageSet ?? [];
  }

  async listStorageConfigs(type, region) {
    const data = await this.browser.graphql("DataSetList", DATA_SET_LIST, {
      Region: this.region(region),
      Type: type,
      Page: 1,
      PageSize: 1000,
    });
    return data.DataSetList?.StorageConfigSet ?? [];
  }

  async listImageRegistries(region) {
    const data = await this.browser.graphql("DescribeImageRegistry", DESCRIBE_IMAGE_REGISTRIES, {
      Region: this.region(region),
      Marker: 1,
      MaxResults: 10000,
    });
    return data.DescribeImageRegistry?.ImageRegistryInfo ?? [];
  }

  async listImageRepos(imageRegistryId, region) {
    const data = await this.browser.graphql("DescribeRegistryRepo", DESCRIBE_REGISTRY_REPOS, {
      Region: this.region(region),
      ImageRegistryId: imageRegistryId,
      Marker: 1,
      MaxResults: 10000,
    });
    return data.DescribeRegistryRepo?.ImageRegistryRepoInfo ?? [];
  }

  async listImageTags(imageRegistryId, repoId, region) {
    const data = await this.browser.graphql("DescribeRepoTag", DESCRIBE_REPO_TAGS, {
      Region: this.region(region),
      ImageRegistryId: imageRegistryId,
      RepoId: repoId,
      Marker: 1,
      MaxResults: 10000,
    });
    return data.DescribeRepoTag?.ImageRegistryTagInfo ?? [];
  }

  async queueResourceInfo(queueId, { gpuType, gpuNumber, region } = {}) {
    const cpuOnly = !gpuType;
    const data = await this.browser.graphql("DescribeQueueResourceConfigInfo", DESCRIBE_QUEUE_RESOURCE_CONFIG, {
      Region: this.region(region),
      QueueId: queueId,
      OnlyCpuNode: cpuOnly,
      GpuModel: gpuType || undefined,
      GpuNum: cpuOnly ? undefined : Number(gpuNumber || 1),
    });
    return data.DescribeQueueResourceConfigInfo;
  }

  async listAvailableNodes(queueId, { cpu, gpuType, gpuNumber, memory, region } = {}) {
    const data = await this.browser.graphql("DescribeInstancesByResource", DESCRIBE_INSTANCES_BY_RESOURCE, {
      Region: this.region(region),
      QueueId: queueId,
      CpuNum: Math.trunc(Number(cpu || 0)),
      GpuModel: gpuType || undefined,
      GpuNum: String(gpuNumber || 0),
      MemNum: Math.trunc(Number(memory || 0)),
    });
    return data.DescribeInstancesByResource?.InstanceIps ?? [];
  }

  async publicNetworkCondition(resourcePoolId, region) {
    const data = await this.browser.graphql("QueryPublicNetworkCondition", QUERY_PUBLIC_NETWORK_CONDITION, {
      Region: this.region(region),
      ResourcePoolId: resourcePoolId,
    });
    return data.QueryPublicNetworkCondition;
  }

  async listAvailableAddresses(region) {
    const data = await this.browser.graphql("DescribleNoUseAddress", DESCRIBE_AVAILABLE_ADDRESSES, {
      Region: this.region(region),
      MaxResults: 100,
      IpVersion: "ipv4",
    });
    return data.DescribleNoUseAddress?.AddressesSet ?? [];
  }

  async developerCreateOptions(region) {
    return this.browser.withBrowser(async () => {
      const [resourcePools, officialImages, personalImages, ks3Storage, kpfsStorage, imageRegistries, availableAddresses] = await Promise.all([
        this.listResourcePools(region),
        this.listImages("Official", region),
        this.listImages("Personal", region),
        this.listStorageConfigs("KS3", region),
        this.listStorageConfigs("KPFS", region),
        this.listImageRegistries(region),
        this.listAvailableAddresses(region),
      ]);
      const queueGroups = await Promise.all(resourcePools.map(async (pool) => ({
        resourcePoolId: pool.ResourcePoolId,
        queues: await this.listClusterQueues(pool.ResourcePoolId, region),
        publicNetwork: await this.publicNetworkCondition(pool.ResourcePoolId, region).catch(() => ({ IsAllow: false })),
      })));
      return {
        region: this.region(region),
        resourcePools,
        queues: queueGroups.flatMap((group) => group.queues),
        publicNetworkByPool: Object.fromEntries(queueGroups.map((group) => [group.resourcePoolId, Boolean(group.publicNetwork?.IsAllow)])),
        images: { official: officialImages, personal: personalImages },
        storageConfigs: [...ks3Storage, ...kpfsStorage],
        imageRegistries: imageRegistries.filter((item) => ["Active", "4"].includes(item.RegistryStatus)),
        availableAddresses,
      };
    });
  }

  async trainingCreateOptions(region) {
    return this.browser.withBrowser(async () => {
      const [resourcePools, officialImages, personalImages, ks3Storage, kpfsStorage, imageRegistries] = await Promise.all([
        this.listResourcePools(region),
        this.listImages("Official", region, { applicationScenario: "训练任务" }),
        this.listImages("Personal", region),
        this.listStorageConfigs("KS3", region),
        this.listStorageConfigs("KPFS", region),
        this.listImageRegistries(region),
      ]);
      const queueGroups = await Promise.all(resourcePools.map(async (pool) => ({
        resourcePoolId: pool.ResourcePoolId,
        queues: await this.listClusterQueues(pool.ResourcePoolId, region, { workloadType: "trainjob" }),
      })));
      return {
        region: this.region(region),
        resourcePools,
        queues: queueGroups.flatMap((group) => group.queues),
        images: { official: officialImages, personal: personalImages },
        storageConfigs: [...ks3Storage, ...kpfsStorage],
        imageRegistries: imageRegistries.filter((item) => ["Active", "4"].includes(item.RegistryStatus)),
      };
    });
  }

  async createNotebook(variables) {
    const payload = { ...variables, Region: this.region(variables.Region) };
    const needsAllocation = Boolean(payload.EnablePublicNetworkSsh)
      || (payload.ServiceConfigs ?? []).some((item) => item.EnablePublicNetwork);
    const requiredNodeIp = payload.NodeAffinity?.RequiredNodeIp;
    if (!needsAllocation) delete payload.AllocationId;
    if (needsAllocation && !payload.AllocationId) throw new Error("已开启公网访问，请选择一个当前可用的公网 EIP");

    return this.browser.withBrowser(async () => {
      const pools = await this.listResourcePools(payload.Region);
      if (!pools.some((item) => item.ResourcePoolId === payload.ResourcePoolId)) {
        throw new Error(`开发机资源组“${payload.ResourcePoolId}”当前不可用，请刷新创建选项后重新选择`);
      }
      const queues = await this.listClusterQueues(payload.ResourcePoolId, payload.Region);
      const queue = queues.find((item) => item.Name === payload.QueueName);
      if (!queue) throw new Error(`开发机队列“${payload.QueueName}”当前不可用，请刷新创建选项后重新选择`);

      const imageSource = Number(payload.ImageSource);
      if ([0, 1].includes(imageSource) && payload.ImageId) {
        const source = imageSource === 0 ? "Official" : "Personal";
        const images = await this.listImages(source, payload.Region);
        if (!images.some((item) => item.ImageId === payload.ImageId)) {
          throw new Error(`选择的${source === "Official" ? "官方" : "自定义"}镜像当前不可用，请刷新创建选项后重新选择`);
        }
      } else if (imageSource === 2) {
        const repos = await this.listImageRepos(payload.ImageRegistryId, payload.Region);
        if (!repos.some((item) => item.RepoId === payload.ImageRepoId)) throw new Error("选择的第三方镜像仓库当前不可用，请重新选择");
        const tags = await this.listImageTags(payload.ImageRegistryId, payload.ImageRepoId, payload.Region);
        if (!tags.some((item) => item.TagId === payload.ImageTagId)) throw new Error("选择的第三方镜像版本当前不可用，请重新选择");
      }

      if (payload.StorageConfigs?.length) {
        const [ks3, kpfs] = await Promise.all([
          this.listStorageConfigs("KS3", payload.Region),
          this.listStorageConfigs("KPFS", payload.Region),
        ]);
        const availableIds = new Set([...ks3, ...kpfs].map((item) => item.StorageConfigId));
        const unavailable = payload.StorageConfigs.find((item) => !availableIds.has(item.StorageConfigId));
        if (unavailable) throw new Error(`挂载配置“${unavailable.StorageConfigId}”当前不可用，请重新选择`);
      }

      if (needsAllocation) {
        const addresses = await this.listAvailableAddresses(payload.Region);
        const address = addresses.find((item) => item.AllocationId === payload.AllocationId || item.PublicIp === payload.AllocationId);
        if (!address) {
          throw new Error(`公网 EIP“${payload.AllocationId}”当前不可用于创建，请刷新创建选项后重新选择`);
        }
        payload.AllocationId = address.AllocationId;
      }
      if (requiredNodeIp) {
        const nodes = await this.listAvailableNodes(queue.Id, {
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
      const data = await this.browser.graphql("CreateNotebook", CREATE_NOTEBOOK, payload);
      return data.CreateNotebook;
    });
  }

  async setNotebookStatus(id, status, { region, force } = {}) {
    const data = await this.browser.graphql("ModifyNotebookStatus", MODIFY_NOTEBOOK_STATUS, {
      Region: this.region(region),
      NotebookId: id,
      Status: status,
      Force: force || undefined,
    });
    return data.ModifyNotebookStatus;
  }

  async imageConfig(region) {
    const data = await this.browser.graphql("GetImageConfig", GET_IMAGE_CONFIG, { Region: this.region(region) });
    return data.GetImageConfig;
  }

  async listKcrInstances(region) {
    const data = await this.browser.graphql("DescribeKcrInstances", DESCRIBE_KCR_INSTANCES, { Region: this.region(region) });
    return data.DescribeKcrInstances?.data ?? [];
  }

  async listSaveImageNamespaces(type, { instanceId, region } = {}) {
    if (type === "Personal") {
      const data = await this.browser.graphql("DescribePersonalNamespaces", DESCRIBE_PERSONAL_NAMESPACES, { Region: this.region(region) });
      return data.DescribePersonalNamespaces?.data ?? [];
    }
    if (!instanceId) return [];
    const data = await this.browser.graphql("DescribeNamespaces", DESCRIBE_NAMESPACES, {
      Region: this.region(region),
      InstanceId: instanceId,
    });
    return data.DescribeNamespaces?.data ?? [];
  }

  async listSaveImageRepositories(type, namespace, { instanceId, region } = {}) {
    if (!namespace) return [];
    if (type === "Personal") {
      const data = await this.browser.graphql("DescribePersonalRepositories", DESCRIBE_PERSONAL_REPOSITORIES, {
        Region: this.region(region),
        Namespace: namespace,
      });
      return data.DescribePersonalRepositories?.data ?? [];
    }
    if (!instanceId) return [];
    const data = await this.browser.graphql("DescribeRepositories", DESCRIBE_REPOSITORIES, {
      Region: this.region(region),
      Namespace: namespace,
      InstanceId: instanceId,
    });
    return data.DescribeRepositories?.data ?? [];
  }

  async saveImageOptions(region) {
    return this.browser.withBrowser(async () => {
      const [config, personalNamespaces, officialInstances] = await Promise.all([
        this.imageConfig(region),
        this.listSaveImageNamespaces("Personal", { region }),
        this.listKcrInstances(region),
      ]);
      return {
        region: this.region(region),
        personalConfigured: hasActiveImageConfig(config),
        personalNamespaces,
        officialInstances,
      };
    });
  }

  async saveNotebookImage(id, variables, region) {
    const payload = { ...variables, Region: this.region(region || variables.Region), NotebookId: id };
    payload.ImagePermission ||= "Public";
    return this.browser.withBrowser(async () => {
      if (payload.ImageType === "Personal") {
        const [config, namespaces] = await Promise.all([
          this.imageConfig(payload.Region),
          this.listSaveImageNamespaces("Personal", { region: payload.Region }),
        ]);
        const namespace = namespaces.find((item) => item.Namespace === payload.Namespace);
        if (!namespace) throw new Error(`个人版命名空间“${payload.Namespace}”当前不可用，请刷新后重新选择`);
        payload.NamespacePermission = namespace.Public ? "Public" : "Private";
        payload.ImageDomain = namespace.InternalEndpoint;
        if (!payload.ImageDomain) throw new Error(`个人版命名空间“${payload.Namespace}”没有可用的内网上传地址，请先在 KCR 中完成内网访问配置`);
        const configured = hasActiveImageConfig(config);
        if (!configured && !payload.Password) throw new Error("首次使用个人版镜像服务时必须填写 KCR 密码");
        if (!configured) payload.CreateImageConfig = true;
        else {
          delete payload.Password;
          delete payload.CreateImageConfig;
        }
      } else if (payload.ImageType === "Official") {
        const instances = await this.listKcrInstances(payload.Region);
        const instance = instances.find((item) => item.InstanceId === payload.OfficialInstance);
        if (!instance) throw new Error(`企业版镜像实例“${payload.OfficialInstance}”当前不可用，请刷新后重新选择`);
        const namespaces = await this.listSaveImageNamespaces("Official", { instanceId: instance.InstanceId, region: payload.Region });
        const namespace = namespaces.find((item) => item.Namespace === payload.Namespace);
        if (!namespace) throw new Error(`企业版命名空间“${payload.Namespace}”当前不可用，请重新选择`);
        const repositories = await this.listSaveImageRepositories("Official", payload.Namespace, { instanceId: instance.InstanceId, region: payload.Region });
        if (!repositories.some((item) => item.RepoName === payload.ImageRepo)) throw new Error(`企业版镜像仓库“${payload.ImageRepo}”当前不可用，请重新选择`);
        payload.RegistryInstanceId = instance.InstanceId;
        payload.ImageDomain = namespace.InternalEndpoint || instance.InternalEndpoint;
        if (!payload.ImageDomain) throw new Error(`企业版实例“${instance.InstanceName || instance.InstanceId}”没有可用的内网上传地址，请先在 KCR 中完成当前 VPC 的内网访问配置`);
        payload.NamespacePermission = namespace.Public ? "Public" : "Private";
      }
      const data = await this.browser.graphql("SaveNotebookImage", SAVE_NOTEBOOK_IMAGE, payload);
      return data.SaveNotebookImage;
    });
  }

  async listTrainJobs(filters = {}) {
    const variables = {
      Region: this.region(filters.region),
      Page: Number(filters.page ?? 1),
      PageSize: Math.min(Number(filters.limit ?? 50), 100),
      SkipUserPermissionCheck: Boolean(filters.skipUserPermissionCheck ?? false),
    };
    if (filters.ids?.length) variables.TrainJobIds = filters.ids;
    if (filters.name) variables.TrainJobName = filters.name;
    if (filters.statuses?.length) variables.TrainJobStatus = filters.statuses;
    if (filters.username) variables.CreateUser = filters.username;
    if (filters.queueId) variables.QueueId = filters.queueId;
    if (filters.gpuTypes?.length) variables.GpuType = filters.gpuTypes;
    if (filters.priorities?.length) variables.Priority = filters.priorities;
    if (filters.frameworks?.length) variables.Framework = filters.frameworks;
    if (filters.useIdleResource !== undefined) variables.UseIdleResource = filters.useIdleResource;
    const data = await this.browser.graphql("DescribeTrainJobs", DESCRIBE_TRAIN_JOBS, variables);
    return data.DescribeTrainJobs;
  }

  async trainJobDetail(id, region) {
    const data = await this.browser.graphql("DescribeTrainJobDetail", DESCRIBE_TRAIN_JOB_DETAIL, {
      Region: this.region(region),
      TrainJobId: id,
    });
    return data.DescribeTrainJobDetail?.TrainJob;
  }

  async createTrainJob(variables) {
    const payload = { ...variables, Region: this.region(variables.Region) };
    return this.browser.withBrowser(async () => {
      const pools = await this.listResourcePools(payload.Region);
      if (!pools.some((item) => item.ResourcePoolId === payload.ResourcePoolId)) {
        throw new Error(`训练资源组“${payload.ResourcePoolId}”当前不可用，请刷新创建选项后重新选择`);
      }
      const queues = await this.listClusterQueues(payload.ResourcePoolId, payload.Region, { workloadType: "trainjob" });
      if (!queues.some((item) => item.Name === payload.QueueName)) {
        throw new Error(`训练队列“${payload.QueueName}”当前不可用，请刷新创建选项后重新选择`);
      }

      const imageLists = new Map();
      for (const role of payload.Roles ?? []) {
        const image = role.ImageConfig ?? {};
        const source = String(image.ImageSource || "");
        if (["Official", "Personal"].includes(source)) {
          if (!imageLists.has(source)) {
            imageLists.set(source, await this.listImages(source, payload.Region, {
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
          const repos = await this.listImageRepos(image.ImageRegistryId, payload.Region);
          if (!repos.some((item) => item.RepoId === image.ImageRepoId)) {
            throw new Error(`角色“${role.RoleName || "未命名"}”选择的第三方镜像仓库当前不可用`);
          }
          const tags = await this.listImageTags(image.ImageRegistryId, image.ImageRepoId, payload.Region);
          if (!tags.some((item) => item.TagId === image.ImageTagId)) {
            throw new Error(`角色“${role.RoleName || "未命名"}”选择的第三方镜像版本当前不可用`);
          }
        }
      }

      if (payload.StorageConfigs?.length) {
        const [ks3, kpfs] = await Promise.all([
          this.listStorageConfigs("KS3", payload.Region),
          this.listStorageConfigs("KPFS", payload.Region),
        ]);
        const availableIds = new Set([...ks3, ...kpfs].map((item) => item.StorageConfigId));
        const unavailable = payload.StorageConfigs.find((item) => !availableIds.has(item.StorageConfigId));
        if (unavailable) throw new Error(`挂载配置“${unavailable.StorageConfigId}”当前不可用，请重新选择`);
      }

      const data = await this.browser.graphql("CreateTrainJob", CREATE_TRAIN_JOB, payload);
      return data.CreateTrainJob;
    });
  }

  async startTrainJobs(jobs, region) {
    const requests = jobs.map((job) => ({
      JobName: job.TrainJobId,
      ResourcePoolId: job.ResourcePoolId,
    }));
    const data = await this.browser.graphql("BatchStartQueueJobs", BATCH_START_TRAIN_JOBS, {
      Region: this.region(region),
      StartQueueJobRequests: requests,
    });
    return data.BatchStartQueueJobs;
  }

  async stopTrainJobs(jobs, region) {
    const requests = jobs.map((job) => ({
      JobName: job.TrainJobId,
      ResourcePoolId: job.ResourcePoolId,
    }));
    const data = await this.browser.graphql("BatchStopQueueJobs", BATCH_STOP_TRAIN_JOBS, {
      Region: this.region(region),
      StopQueueJobRequests: requests,
    });
    return data.BatchStopQueueJobs;
  }

  async deleteTrainJobs(jobs, region) {
    const requests = jobs.map((job) => ({
      JobName: job.TrainJobId,
      ResourcePoolId: job.ResourcePoolId,
    }));
    const data = await this.browser.graphql("BatchDeleteQueueJobs", BATCH_DELETE_TRAIN_JOBS, {
      Region: this.region(region),
      DeleteQueueJobRequests: requests,
    });
    return data.BatchDeleteQueueJobs;
  }
}
