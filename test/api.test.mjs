import test from "node:test";
import assert from "node:assert/strict";
import { AicpApi } from "../lib/api.mjs";

function withLease(browser) {
  browser.withBrowser = async (callback) => {
    const { spawned } = await browser.launchHeadless();
    try { return await callback(); }
    finally { if (spawned) await browser.closeActiveBrowser(); }
  };
  return browser;
}

test("training list forwards page, large limits, and creator IDs", async () => {
  const calls = [];
  const browser = {
    graphql: async (operation, _query, variables) => {
      calls.push({ operation, variables });
      return { DescribeTrainJobs: { TotalCount: 399, Page: variables.Page, PageSize: variables.PageSize, TrainJobSet: [] } };
    },
  };
  const api = new AicpApi(browser, { region: "region-1" });
  const result = await api.listTrainJobs({ page: 2, limit: 399, creatorId: "iam-user-id" });
  assert.equal(result.TotalCount, 399);
  assert.deepEqual(calls[0].variables, {
    Region: "region-1",
    Page: 2,
    PageSize: 399,
    SkipUserPermissionCheck: false,
    CreateUser: "iam-user-id",
  });
  await assert.rejects(() => api.listTrainJobs({ page: 0 }), /page/);
  await assert.rejects(() => api.listTrainJobs({ limit: 1001 }), /limit/);
});

test("developer create options combine live platform selectors without mutations", async () => {
  let closed = 0;
  const calls = [];
  const browser = withLease({
    launchHeadless: async () => ({ spawned: true }),
    closeActiveBrowser: async () => { closed += 1; },
    graphql: async (operation, _query, variables) => {
      calls.push({ operation, variables });
      if (operation === "DescribeAllResourcePool") return { DescribeAllResourcePool: { ResourcePoolSet: [{ ResourcePoolId: "pool", ResourcePoolName: "Pool" }] } };
      if (operation === "DescribeClusterQueue") return { DescribeClusterQueue: { Queues: [{ Id: "queue-id", Name: "queue", ResourcePoolId: "pool" }] } };
      if (operation === "DescribeAicpImages") return { DescribeAicpImages: { ImageSet: [{ ImageId: `${variables.ImageSource}-image` }] } };
      if (operation === "DataSetList") return { DataSetList: { StorageConfigSet: [{ StorageConfigId: variables.Type }] } };
      if (operation === "DescribeImageRegistry") return { DescribeImageRegistry: { ImageRegistryInfo: [] } };
      if (operation === "DescribleNoUseAddress") return { DescribleNoUseAddress: { AddressesSet: [{ AllocationId: "allocation-id", PublicIp: "203.0.113.1" }] } };
      if (operation === "QueryPublicNetworkCondition") return { QueryPublicNetworkCondition: { IsAllow: true } };
      throw new Error(`unexpected operation ${operation}`);
    },
  });
  const api = new AicpApi(browser, { region: "region-1" });
  const options = await api.developerCreateOptions();
  assert.equal(options.resourcePools.length, 1);
  assert.equal(options.queues[0].Name, "queue");
  assert.equal(options.images.official[0].ImageId, "Official-image");
  assert.equal(options.images.personal[0].ImageId, "Personal-image");
  assert.equal(options.storageConfigs.length, 2);
  assert.equal(options.publicNetworkByPool.pool, true);
  assert.equal(options.availableAddresses[0].PublicIp, "203.0.113.1");
  assert.equal(closed, 1);
  assert.equal(calls.some((call) => call.operation.startsWith("Create")), false);
});

test("developer create converts a legacy public IP to its Allocation ID before mutation", async () => {
  const calls = [];
  let closed = 0;
  const browser = withLease({
    launchHeadless: async () => ({ spawned: true }),
    closeActiveBrowser: async () => { closed += 1; },
    graphql: async (operation, _query, variables) => {
      calls.push({ operation, variables });
      if (operation === "DescribeAllResourcePool") return { DescribeAllResourcePool: { ResourcePoolSet: [{ ResourcePoolId: "pool" }] } };
      if (operation === "DescribeClusterQueue") return { DescribeClusterQueue: { Queues: [{ Id: "queue-id", Name: "queue" }] } };
      if (operation === "DescribleNoUseAddress") {
        return { DescribleNoUseAddress: { AddressesSet: [{ AllocationId: "allocation-id", PublicIp: "203.0.113.1" }] } };
      }
      if (operation === "CreateNotebook") return { CreateNotebook: { NotebookId: "kaic-new" } };
      throw new Error(`unexpected operation ${operation}`);
    },
  });
  const api = new AicpApi(browser, { region: "region-1" });
  const result = await api.createNotebook({
    DisplayName: "dev",
    ResourcePoolId: "pool",
    QueueName: "queue",
    ImageSource: 0,
    ImageUrl: "legacy-image",
    AllocationId: "203.0.113.1",
    EnablePublicNetworkSsh: true,
    StorageConfigs: [],
    ServiceConfigs: [],
  });
  assert.equal(result.NotebookId, "kaic-new");
  assert.equal(calls.find((call) => call.operation === "CreateNotebook").variables.AllocationId, "allocation-id");
  assert.equal(closed, 1);
});

test("developer create rejects an unavailable EIP before mutation", async () => {
  const browser = withLease({
    launchHeadless: async () => ({ spawned: true }),
    closeActiveBrowser: async () => {},
    graphql: async (operation) => {
      if (operation === "DescribeAllResourcePool") return { DescribeAllResourcePool: { ResourcePoolSet: [{ ResourcePoolId: "pool" }] } };
      if (operation === "DescribeClusterQueue") return { DescribeClusterQueue: { Queues: [{ Id: "queue-id", Name: "queue" }] } };
      if (operation === "DescribleNoUseAddress") return { DescribleNoUseAddress: { AddressesSet: [] } };
      throw new Error("mutation must not run");
    },
  });
  const api = new AicpApi(browser, { region: "region-1" });
  await assert.rejects(() => api.createNotebook({
    ResourcePoolId: "pool",
    QueueName: "queue",
    ImageSource: 0,
    ImageUrl: "legacy-image",
    AllocationId: "203.0.113.1",
    EnablePublicNetworkSsh: true,
    StorageConfigs: [],
    ServiceConfigs: [],
  }), /当前不可用于创建/);
});

test("developer create rejects an unavailable fixed node before mutation", async () => {
  const calls = [];
  const browser = withLease({
    launchHeadless: async () => ({ spawned: true }),
    closeActiveBrowser: async () => {},
    graphql: async (operation) => {
      calls.push(operation);
      if (operation === "DescribeAllResourcePool") return { DescribeAllResourcePool: { ResourcePoolSet: [{ ResourcePoolId: "pool" }] } };
      if (operation === "DescribeClusterQueue") return { DescribeClusterQueue: { Queues: [{ Id: "queue-id", Name: "queue" }] } };
      if (operation === "DescribeInstancesByResource") return { DescribeInstancesByResource: { InstanceIps: [{ InstanceIp: "10.0.0.2" }] } };
      if (operation === "CreateNotebook") throw new Error("mutation must not run");
      throw new Error(`unexpected operation ${operation}`);
    },
  });
  const api = new AicpApi(browser, { region: "region-1" });
  await assert.rejects(() => api.createNotebook({
    ResourcePoolId: "pool",
    QueueName: "queue",
    ImageSource: 0,
    ImageUrl: "legacy-image",
    CpuNum: 8,
    Memory: 16,
    ServiceConfigs: [],
    StorageConfigs: [],
    NodeAffinity: { RequiredNodeIp: "10.0.0.1" },
  }), /当前不能满足/);
  assert.equal(calls.includes("CreateNotebook"), false);
});

test("training create options use training queues and training official images", async () => {
  const calls = [];
  const browser = withLease({
    launchHeadless: async () => ({ spawned: true }),
    closeActiveBrowser: async () => {},
    graphql: async (operation, _query, variables) => {
      calls.push({ operation, variables });
      if (operation === "DescribeAllResourcePool") return { DescribeAllResourcePool: { ResourcePoolSet: [{ ResourcePoolId: "pool" }] } };
      if (operation === "DescribeClusterQueue") return { DescribeClusterQueue: { Queues: [{ Id: "queue-id", Name: "train-queue", ResourcePoolId: "pool" }] } };
      if (operation === "DescribeAicpImages") return { DescribeAicpImages: { ImageSet: [{ ImageId: `${variables.ImageSource}-image` }] } };
      if (operation === "DataSetList") return { DataSetList: { StorageConfigSet: [] } };
      if (operation === "DescribeImageRegistry") return { DescribeImageRegistry: { ImageRegistryInfo: [] } };
      throw new Error(`unexpected operation ${operation}`);
    },
  });
  const options = await new AicpApi(browser, { region: "region-1" }).trainingCreateOptions();
  assert.equal(options.queues[0].Name, "train-queue");
  assert.equal(calls.find((call) => call.operation === "DescribeClusterQueue").variables.WorkloadType, "trainjob");
  assert.equal(calls.find((call) => call.operation === "DescribeAicpImages" && call.variables.ImageSource === "Official").variables.ApplicationScenario, "训练任务");
});

test("training log APIs use native pod and tail queries", async () => {
  const calls = [];
  const browser = {
    graphql: async (operation, _query, variables) => {
      calls.push({ operation, variables });
      if (operation === "DescribeQueueJobPod") return { DescribeQueueJobPod: { TotalCount: 1, Pods: [{ Name: "master-0" }] } };
      if (operation === "DescribeQueueJobLog") return { DescribeQueueJobLog: { RequestId: "request", PodLogs: "hello" } };
      throw new Error(`unexpected operation ${operation}`);
    },
  };
  const api = new AicpApi(browser, { region: "region-1" });
  const pods = await api.trainJobPods("kaic-job", { clusterId: "cluster", resourcePoolId: "pool", limit: 25 });
  const logs = await api.trainJobLog("kaic-job", "master-0", { clusterId: "cluster", resourcePoolId: "pool", tailLines: 200, sinceSeconds: 30 });
  assert.equal(pods.Pods[0].Name, "master-0");
  assert.equal(logs.PodLogs, "hello");
  assert.deepEqual(calls[0].variables, { Region: "region-1", ClusterId: "cluster", ResourcePoolId: "pool", JobName: "kaic-job", Role: undefined, Name: undefined, State: undefined, Marker: 1, MaxResults: 25 });
  assert.deepEqual(calls[1].variables, { Region: "region-1", ClusterId: "cluster", ResourcePoolId: "pool", JobName: "kaic-job", PodName: "master-0", SinceSeconds: 30, TailLines: 200 });
});

test("training create rejects a stale image before mutation", async () => {
  const calls = [];
  const browser = withLease({
    launchHeadless: async () => ({ spawned: true }),
    closeActiveBrowser: async () => {},
    graphql: async (operation, _query, variables) => {
      calls.push(operation);
      if (operation === "DescribeAllResourcePool") return { DescribeAllResourcePool: { ResourcePoolSet: [{ ResourcePoolId: "pool" }] } };
      if (operation === "DescribeClusterQueue") return { DescribeClusterQueue: { Queues: [{ Name: "queue" }] } };
      if (operation === "DescribeAicpImages") return { DescribeAicpImages: { ImageSet: [{ ImageId: "current" }] } };
      if (operation === "CreateTrainJob") throw new Error("mutation must not run");
      throw new Error(`unexpected operation ${operation} ${JSON.stringify(variables)}`);
    },
  });
  const api = new AicpApi(browser, { region: "region-1" });
  await assert.rejects(() => api.createTrainJob({
    ResourcePoolId: "pool",
    QueueName: "queue",
    Roles: [{ RoleName: "Master", ImageConfig: { ImageSource: "Personal", ImageId: "stale" } }],
    StorageConfigs: [],
  }), /镜像当前不可用/);
  assert.equal(calls.includes("CreateTrainJob"), false);
});

test("save-image options accept the native single image-config object", async () => {
  const browser = withLease({
    launchHeadless: async () => ({ spawned: true }),
    closeActiveBrowser: async () => {},
    graphql: async (operation) => {
      if (operation === "GetImageConfig") return { GetImageConfig: { TotalCount: 1, ImageServiceInfo: { Id: "config", Deleted: false } } };
      if (operation === "DescribePersonalNamespaces") return { DescribePersonalNamespaces: { data: [{ Namespace: "team", Public: false, InternalEndpoint: "10.0.0.1" }] } };
      if (operation === "DescribeKcrInstances") return { DescribeKcrInstances: { data: [] } };
      throw new Error(`unexpected operation ${operation}`);
    },
  });
  const options = await new AicpApi(browser, { region: "region-1" }).saveImageOptions();
  assert.equal(options.personalConfigured, true);
  assert.equal(options.personalNamespaces[0].Namespace, "team");
  assert.deepEqual(options.officialInstances, []);
});

test("personal save-image derives native namespace fields and discards an obsolete password", async () => {
  const calls = [];
  const browser = withLease({
    launchHeadless: async () => ({ spawned: true }),
    closeActiveBrowser: async () => {},
    graphql: async (operation, _query, variables) => {
      calls.push({ operation, variables });
      if (operation === "GetImageConfig") return { GetImageConfig: { ImageServiceInfo: { Id: "config", Deleted: false } } };
      if (operation === "DescribePersonalNamespaces") return { DescribePersonalNamespaces: { data: [{ Namespace: "team", Public: false, InternalEndpoint: "10.0.0.1" }] } };
      if (operation === "SaveNotebookImage") return { SaveNotebookImage: { ImageId: "image-1" } };
      throw new Error(`unexpected operation ${operation}`);
    },
  });
  const result = await new AicpApi(browser, { region: "region-1" }).saveNotebookImage("kaic-dev", {
    ImageName: "snapshot", ImageType: "Personal", Namespace: "team", ImageRepo: "repo", ImageVersion: "v1", Password: "obsolete",
  });
  const mutation = calls.find((call) => call.operation === "SaveNotebookImage");
  assert.equal(result.ImageId, "image-1");
  assert.equal(mutation.variables.ImageDomain, "10.0.0.1");
  assert.equal(mutation.variables.NamespacePermission, "Private");
  assert.equal(mutation.variables.ImagePermission, "Public");
  assert.equal("Password" in mutation.variables, false);
});

test("first personal save-image requires a KCR password before mutation", async () => {
  const calls = [];
  const browser = withLease({
    launchHeadless: async () => ({ spawned: true }),
    closeActiveBrowser: async () => {},
    graphql: async (operation) => {
      calls.push(operation);
      if (operation === "GetImageConfig") return { GetImageConfig: { TotalCount: 0, ImageServiceInfo: null } };
      if (operation === "DescribePersonalNamespaces") return { DescribePersonalNamespaces: { data: [{ Namespace: "team", Public: true, InternalEndpoint: "10.0.0.1" }] } };
      throw new Error("mutation must not run");
    },
  });
  const api = new AicpApi(browser, { region: "region-1" });
  await assert.rejects(() => api.saveNotebookImage("kaic-dev", {
    ImageName: "snapshot", ImageType: "Personal", Namespace: "team", ImageRepo: "repo", ImageVersion: "v1",
  }), /KCR/);
  assert.equal(calls.includes("SaveNotebookImage"), false);
});

test("native delete mutations receive notebook IDs and queue-job requests", async () => {
  const calls = [];
  const browser = withLease({
    launchHeadless: async () => ({ spawned: true }),
    closeActiveBrowser: async () => {},
    graphql: async (operation, _query, variables) => {
      calls.push({ operation, variables });
      if (operation === "BatchDeleteNotebook") return { BatchDeleteNotebook: { Results: [{ NotebookId: "kaic-dev", Return: true }] } };
      if (operation === "BatchDeleteQueueJobs") return { BatchDeleteQueueJobs: { Results: [{ JobName: "kaic-job", Return: true }] } };
      throw new Error(`unexpected operation ${operation}`);
    },
  });
  const api = new AicpApi(browser, { region: "region-1" });
  await api.deleteNotebooks(["kaic-dev"]);
  await api.deleteTrainJobs([{ TrainJobId: "kaic-job", ResourcePoolId: "pool" }]);
  assert.deepEqual(calls[0].variables, { Region: "region-1", NotebookIds: ["kaic-dev"] });
  assert.deepEqual(calls[1].variables, { Region: "region-1", DeleteQueueJobRequests: [{ JobName: "kaic-job", ResourcePoolId: "pool" }] });
});

test("GPU capacity combines native resource-pool totals with unfiltered queues", async () => {
  const calls = [];
  const browser = withLease({
    launchHeadless: async () => ({ spawned: true }),
    closeActiveBrowser: async () => {},
    graphql: async (operation, _query, variables) => {
      calls.push({ operation, variables });
      if (operation === "DescribeAllResourcePool") return { DescribeAllResourcePool: { ResourcePoolSet: [{ ResourcePoolId: "pool", ResourcePoolName: "Pool" }] } };
      if (operation === "DescribeGpuInfo") return { DescribeGpuInfo: { Gpu: { Num: 16, FreeGpuNum: 5, AssignedGpuNum: 11 } } };
      if (operation === "DescribeClusterQueue") return { DescribeClusterQueue: { Queues: [{ Id: "queue", Name: "gpu-queue" }] } };
      if (operation === "DescribeResourcePoolInstances") return { DescribeResourcePoolInstances: {
        TotalCount: 1,
        ResourcePoolInstanceSet: [{ InstanceId: "node", InstanceName: "Node", Gpu: { Allocatable: 8, Allocated: 3 }, Memory: { Allocatable: 512, Allocated: 128 } }],
      } };
      throw new Error(`unexpected operation ${operation}`);
    },
  });
  const result = await new AicpApi(browser, { region: "region-1" }).gpuCapacity();
  assert.equal(result.groups[0].gpu.FreeGpuNum, 5);
  assert.equal(result.groups[0].queues[0].Name, "gpu-queue");
  assert.equal(result.groups[0].nodes[0].InstanceName, "Node");
  const queueCall = calls.find((call) => call.operation === "DescribeClusterQueue");
  assert.equal("WorkloadType" in queueCall.variables, false);
});

test("resource-pool instances are collected across native page responses", async () => {
  const calls = [];
  const browser = withLease({
    launchHeadless: async () => ({ spawned: true }),
    closeActiveBrowser: async () => {},
    graphql: async (operation, _query, variables) => {
      calls.push({ operation, variables });
      return { DescribeResourcePoolInstances: {
        TotalCount: 3,
        ResourcePoolInstanceSet: variables.Page === 1
          ? [{ InstanceId: "one" }, { InstanceId: "two" }]
          : [{ InstanceId: "three" }],
      } };
    },
  });
  const nodes = await new AicpApi(browser, { region: "region-1" }).listResourcePoolInstances("pool");
  assert.deepEqual(nodes.map((item) => item.InstanceId), ["one", "two", "three"]);
  assert.deepEqual(calls.map((call) => call.variables.Page), [1, 2]);
  assert.equal(calls[0].variables.PageSize, 100);
});
