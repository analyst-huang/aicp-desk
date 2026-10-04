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
  DESCRIBE_QUEUE_JOB_LOG,
  DESCRIBE_QUEUE_JOB_PODS,
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
  LIST_AICP_PROJECTS,
  MODIFY_NOTEBOOK_STATUS,
  QUERY_PUBLIC_NETWORK_CONDITION,
  SAVE_NOTEBOOK_IMAGE,
} from "../operations.mjs";

export class KsyunApi {
  constructor(browser, config) {
    this.browser = browser;
    this.config = config;
  }

  region(override) {
    return override || this.config.region;
  }

  withSession(callback) { return this.browser.withBrowser(callback); }

  async submitCreate(kind, variables) {
    if (kind === "dev") return (await this.browser.graphql("CreateNotebook", CREATE_NOTEBOOK, variables)).CreateNotebook;
    if (kind === "train") return (await this.browser.graphql("CreateTrainJob", CREATE_TRAIN_JOB, variables)).CreateTrainJob;
    throw new Error(`未知资源类型：${kind}`);
  }

  async submitNotebookImage(payload) {
    const data = await this.browser.graphql("SaveNotebookImage", SAVE_NOTEBOOK_IMAGE, payload);
    return data.SaveNotebookImage;
  }

  async currentUser() {
    return this.browser.currentUser();
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

  async listProjects(region) {
    const data = await this.browser.graphql("AicpGetAccountAllProjectList", LIST_AICP_PROJECTS, {
      Region: this.region(region),
    });
    const projects = data.AicpGetAccountAllProjectList?.ListProjectResult?.ProjectList ?? [];
    return [...projects].sort((left, right) => Number(left.ProjectId) - Number(right.ProjectId));
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

  async listTrainJobs(filters = {}) {
    const page = Number(filters.page ?? 1);
    const limit = Number(filters.limit ?? 50);
    if (!Number.isInteger(page) || page < 1) throw new Error("page 必须是大于等于 1 的整数");
    if (!Number.isInteger(limit) || limit < 5 || limit > 1000) throw new Error("limit 必须是 5 到 1000 之间的整数");
    const variables = {
      Region: this.region(filters.region),
      Page: page,
      PageSize: limit,
      SkipUserPermissionCheck: Boolean(filters.skipUserPermissionCheck ?? false),
    };
    if (filters.ids?.length) variables.TrainJobIds = filters.ids;
    if (filters.name) variables.TrainJobName = filters.name;
    if (filters.statuses?.length) variables.TrainJobStatus = filters.statuses;
    if (filters.creatorId) variables.CreateUser = filters.creatorId;
    else if (filters.username) variables.CreateUser = filters.username;
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

  async trainJobGpuMetrics(monitorUrl) {
    return this.browser.grafanaGpuMetrics(monitorUrl);
  }

  async trainJobPods(jobName, options = {}) {
    const data = await this.browser.graphql("DescribeQueueJobPod", DESCRIBE_QUEUE_JOB_PODS, {
      Region: this.region(options.region),
      ClusterId: options.clusterId,
      ResourcePoolId: options.resourcePoolId,
      JobName: jobName,
      Role: options.role,
      Name: options.name,
      State: options.state,
      Marker: Number(options.marker ?? 1),
      MaxResults: Math.min(Number(options.limit ?? 100), 100),
    });
    return data.DescribeQueueJobPod;
  }

  async trainJobLog(jobName, podName, options = {}) {
    const data = await this.browser.graphql("DescribeQueueJobLog", DESCRIBE_QUEUE_JOB_LOG, {
      Region: this.region(options.region),
      ClusterId: options.clusterId,
      ResourcePoolId: options.resourcePoolId,
      JobName: jobName,
      PodName: podName,
      SinceSeconds: options.sinceSeconds,
      TailLines: options.tailLines,
    });
    return data.DescribeQueueJobLog;
  }

  // Compatibility entry for integrations using the adapter directly.

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
