import test from "node:test";
import assert from "node:assert/strict";
import { AicpService } from "../lib/service.mjs";

function makeService(overrides = {}) {
  const api = {
    listNotebooks: async () => ({ Notebooks: [] }),
    setNotebookStatus: async () => ({ Return: true }),
    listTrainJobs: async () => ({ TrainJobSet: [] }),
    startTrainJobs: async () => ({ Results: [{ JobName: "job", Return: true }] }),
    stopTrainJobs: async () => ({ Results: [{ JobName: "job", Return: true }] }),
    deleteNotebooks: async () => ({ Results: [{ NotebookId: "kaic-dev", Return: true }] }),
    deleteTrainJobs: async () => ({ Results: [{ JobName: "kaic-job", Return: true }] }),
    gpuCapacity: async () => ({ region: "region-1", groups: [] }),
    currentUser: async () => ({ accountType: "iam", username: "me", userId: "user-id" }),
    ...overrides,
  };
  const templates = {
    get: async () => ({ variables: {} }),
    save: async () => ({}),
  };
  return new AicpService(api, templates, { region: "region-1", username: "me" });
}

test("developer start is idempotent", async () => {
  let mutations = 0;
  const service = makeService({
    listNotebooks: async () => ({ Notebooks: [{ NotebookId: "kaic-1", Name: "dev", State: "running" }] }),
    setNotebookStatus: async () => { mutations += 1; return { Return: true }; },
  });
  const result = await service.startDeveloper("dev");
  assert.equal(result.noop, true);
  assert.equal(mutations, 0);
});

test("training duplicate names require latest", async () => {
  const service = makeService({
    listTrainJobs: async () => ({ TrainJobSet: [
      { TrainJobId: "kaic-old", TrainJobName: "same", JobStatus: { SubmitTime: "2026-01-01" } },
      { TrainJobId: "kaic-new", TrainJobName: "same", JobStatus: { SubmitTime: "2026-02-01" } },
    ] }),
  });
  await assert.rejects(() => service.resolveTraining("same"), /--latest/);
  assert.equal((await service.resolveTraining("same", { latest: true })).TrainJobId, "kaic-new");
});

test("mine filters come from the authenticated identity and training accepts explicit pagination", async () => {
  const developerCalls = [];
  const trainingCalls = [];
  const service = makeService({
    currentUser: async () => ({ accountType: "iam", username: "login-name", userId: "login-id" }),
    listNotebooks: async (filters) => { developerCalls.push(filters); return { Notebooks: [] }; },
    listTrainJobs: async (filters) => { trainingCalls.push(filters); return { TrainJobSet: [] }; },
  });
  await service.listDevelopers({ mine: true });
  await service.listTraining({ mine: true, page: 3, limit: 200 });
  await service.listTraining({ creatorId: "other-id", page: 2, limit: 1000 });
  assert.equal(developerCalls[0].username, "login-name");
  assert.equal(trainingCalls[0].creatorId, "login-id");
  assert.equal(trainingCalls[0].page, 3);
  assert.equal(trainingCalls[0].limit, 200);
  assert.equal(trainingCalls[1].creatorId, "other-id");
  assert.equal(trainingCalls[1].page, 2);
  assert.equal(trainingCalls[1].limit, 1000);
  await assert.rejects(() => service.listTraining({ mine: true, creatorId: "other-id" }), /不能与/);
});

test("GPU capacity keeps pool free cards separate from queue quota remaining", async () => {
  const service = makeService({
    gpuCapacity: async () => ({
      region: "region-1",
      groups: [{
        pool: { ResourcePoolId: "pool", ResourcePoolName: "Pool", ResourcePoolType: "KCE" },
        gpu: { Num: 20, FreeGpuNum: 6, AvailableGpuNum: null, AssignedGpuNum: 14, UnavailableGpuNum: 0 },
        queues: [{
          Id: "queue", Name: "GPU Queue", QueueType: "normal", WorkloadType: ["notebook", "trainjob"], AllowBorrowing: true,
          GpuModels: [{ Model: "A100", Quota: 8 }, { Model: "H800", Quota: 4 }],
          Status: { State: "normal", Allocated: { gpu: 9 }, Running: 2, Inqueue: 1 },
        }],
        nodes: [{
          InstanceId: "node-1", InstanceName: "Node 1", InstanceIp: "10.0.0.1", InstanceStatus: "normal", InstanceStatusName: "正常",
          UnSchedulable: false, IsGpu: true, GpuType: "A100",
          Gpu: { Allocatable: 8, Allocated: 3 }, Memory: { Allocatable: 512, Allocated: 128 }, Cpu: { Allocatable: 96, Allocated: 40 },
        }, {
          InstanceId: "node-2", InstanceName: "Node 2", InstanceIp: "10.0.0.2", InstanceStatus: "normal", InstanceStatusName: "正常",
          UnSchedulable: true, IsGpu: false,
          Gpu: { Allocatable: 0, Allocated: 0 }, Memory: { Allocatable: 256, Allocated: 200 }, Cpu: { Allocatable: 48, Allocated: 48 },
        }],
      }],
    }),
  });
  const capacity = await service.gpuCapacity();
  assert.equal(capacity.summary.physicalFreeGpu, 6);
  assert.equal("freeGpu" in capacity.summary, false);
  assert.equal(capacity.summary.totalGpu, 20);
  assert.equal(capacity.pools[0].queues[0].quotaGpu, 12);
  assert.equal(capacity.pools[0].queues[0].allocatedGpu, 9);
  assert.equal(capacity.pools[0].queues[0].quotaRemainingGpu, 3);
  assert.equal("remainingGpu" in capacity.pools[0].queues[0], false);
  assert.equal(capacity.pools[0].queues[0].allowBorrowing, true);
  assert.equal(capacity.summary.nodeCount, 2);
  assert.equal(capacity.summary.gpuNodeCount, 1);
  assert.equal(capacity.summary.matchedNodeCount, 2);
  assert.equal("visibleNodeCount" in capacity.summary, false);
  assert.deepEqual(capacity.filters, { onlyFree: false, sortGpu: "desc" });
  assert.equal(capacity.pools[0].nodes[0].gpuModel, "A100");
  assert.equal(capacity.pools[0].nodes[0].remainingGpu, 5);
  assert.equal(capacity.pools[0].nodes[0].remainingMemoryGiB, 384);
  assert.equal(capacity.pools[0].nodes[0].remainingCpu, 56);
  assert.equal(capacity.pools[0].nodes[1].schedulable, false);
});

test("GPU capacity can keep only schedulable free-GPU nodes and sort ascending", async () => {
  const service = makeService({
    gpuCapacity: async () => ({
      region: "region-1",
      groups: [{
        pool: { ResourcePoolId: "pool", ResourcePoolName: "Pool" }, gpu: {}, queues: [],
        nodes: [
          { InstanceId: "five", InstanceName: "Five", IsGpu: true, UnSchedulable: false, Gpu: { Allocatable: 8, Allocated: 3 }, Memory: { Allocatable: 100, Allocated: 20 } },
          { InstanceId: "two", InstanceName: "Two", IsGpu: true, UnSchedulable: false, Gpu: { Allocatable: 8, Allocated: 6 }, Memory: { Allocatable: 100, Allocated: 20 } },
          { InstanceId: "zero", InstanceName: "Zero", IsGpu: true, UnSchedulable: false, Gpu: { Allocatable: 8, Allocated: 8 }, Memory: { Allocatable: 100, Allocated: 20 } },
          { InstanceId: "blocked", InstanceName: "Blocked", IsGpu: true, UnSchedulable: true, Gpu: { Allocatable: 8, Allocated: 4 }, Memory: { Allocatable: 100, Allocated: 20 } },
        ],
      }],
    }),
  });
  const capacity = await service.gpuCapacity({ onlyFree: true, sortGpu: "asc" });
  assert.deepEqual(capacity.pools[0].nodes.map((node) => node.id), ["two", "five"]);
  assert.equal(capacity.summary.nodeCount, 4);
  assert.equal(capacity.summary.matchedNodeCount, 2);
  assert.deepEqual(capacity.filters, { onlyFree: true, sortGpu: "asc" });
  await assert.rejects(() => service.gpuCapacity({ sortGpu: "random" }), /asc 或 desc/);
});

test("prepare train variables applies nested overrides", async () => {
  const service = makeService();
  const variables = await service.prepareCreateVariables("train", {
    variables: {
      TrainJobName: "job",
      ResourcePoolId: "pool",
      QueueName: "queue",
      Framework: "pytorch",
      StorageConfigs: [],
      Roles: [{ RoleName: "Master", Replicas: 1, ImageConfig: { ImageSource: "Personal", ImageId: "image" }, ResourceConfig: { GPUType: "A100", GPUNumber: 1, CPUNum: 8, Memory: 16 }, Envs: [] }],
    },
    set: "Roles[0].ResourceConfig.GPUNumber=8",
  });
  assert.equal(variables.Region, "region-1");
  assert.equal(variables.Roles[0].ResourceConfig.GPUNumber, 8);
});

test("developer create validation requires a selectable native-form configuration", async () => {
  const service = makeService();
  await assert.rejects(() => service.prepareCreateVariables("dev", {
    variables: { DisplayName: "dev", ResourcePoolId: "pool", QueueName: "queue", CpuNum: 8, Memory: 16, StorageConfigs: [], ServiceConfigs: [], Envs: [] },
  }), /请选择官方镜像/);
  const variables = await service.prepareCreateVariables("dev", {
    variables: { DisplayName: "dev", ImageSource: 0, ImageId: "image", ResourcePoolId: "pool", QueueName: "queue", CpuNum: 8, Memory: 16, StorageConfigs: [], ServiceConfigs: [], Envs: [] },
  });
  assert.equal(variables.Region, "region-1");
  assert.equal(variables.ImageId, "image");
});

test("training create validation rejects missing image and invalid role resources", async () => {
  const service = makeService();
  const base = {
    TrainJobName: "job", ResourcePoolId: "pool", QueueName: "queue", Framework: "pytorch", StorageConfigs: [],
    Roles: [{ RoleName: "Master", Replicas: 1, ImageConfig: { ImageSource: "Personal", ImageId: "" }, ResourceConfig: { GPUNumber: 0, CPUNum: 8, Memory: 16 }, Envs: [] }],
  };
  await assert.rejects(() => service.prepareCreateVariables("train", { variables: base }), /ImageId 不能为空/);
  base.Roles[0].ImageConfig.ImageId = "image";
  base.Roles[0].ResourceConfig.CPUNum = 0;
  await assert.rejects(() => service.prepareCreateVariables("train", { variables: base }), /CPU 和内存必须大于 0/);
});

test("create sources and command sources are mutually exclusive", async () => {
  const service = makeService();
  await assert.rejects(() => service.prepareCreateVariables("dev", { file: "a.json", template: "x" }), /不能同时使用/);
  await assert.rejects(() => service.prepareCreateVariables("train", { command: "a", commandFile: "b.sh" }), /不能同时使用/);
});

test("transitional states never send duplicate start or stop mutations", async () => {
  let devMutations = 0;
  let trainMutations = 0;
  const service = makeService({
    listNotebooks: async () => ({ Notebooks: [{ NotebookId: "kaic-dev", Name: "dev", State: "stopping" }] }),
    setNotebookStatus: async () => { devMutations += 1; },
    listTrainJobs: async () => ({ TrainJobSet: [{ TrainJobId: "kaic-job", TrainJobName: "job", JobStatus: { Status: "stopping" } }] }),
    startTrainJobs: async () => { trainMutations += 1; },
    stopTrainJobs: async () => { trainMutations += 1; },
  });
  assert.equal((await service.startDeveloper("dev")).noop, true);
  assert.equal((await service.stopDeveloper("dev")).noop, true);
  assert.equal((await service.startTraining("job")).noop, true);
  assert.equal((await service.stopTraining("job")).noop, true);
  assert.equal(devMutations, 0);
  assert.equal(trainMutations, 0);
});

test("batch operations require an explicit platform result", () => {
  const service = makeService();
  assert.throws(() => service.assertBatchSuccess(undefined), /未返回任务操作结果/);
  assert.throws(() => service.assertBatchSuccess([]), /未返回任务操作结果/);
});

test("developer deletion requires a terminal state and validates the native result", async () => {
  let deletions = 0;
  const running = makeService({
    listNotebooks: async () => ({ Notebooks: [{ NotebookId: "kaic-dev", Name: "dev", State: "running" }] }),
    deleteNotebooks: async () => { deletions += 1; },
  });
  await assert.rejects(() => running.deleteDeveloper("dev"), /请先停止开发机/);
  const stopped = makeService({
    listNotebooks: async () => ({ Notebooks: [{ NotebookId: "kaic-dev", Name: "dev", State: "stopped" }] }),
    deleteNotebooks: async (ids) => { deletions += 1; return { Results: [{ NotebookId: ids[0], Return: true }] }; },
  });
  assert.equal((await stopped.deleteDeveloper("dev")).item.NotebookId, "kaic-dev");
  assert.equal(deletions, 1);
});

test("training deletion requires a terminal state", async () => {
  let deletions = 0;
  const active = makeService({
    listTrainJobs: async () => ({ TrainJobSet: [{ TrainJobId: "kaic-job", TrainJobName: "job", ResourcePoolId: "pool", JobStatus: { Status: "running" } }] }),
    deleteTrainJobs: async () => { deletions += 1; },
  });
  await assert.rejects(() => active.deleteTraining("job"), /请先停止任务/);
  const failed = makeService({
    listTrainJobs: async () => ({ TrainJobSet: [{ TrainJobId: "kaic-job", TrainJobName: "job", ResourcePoolId: "pool", JobStatus: { Status: "failed" } }] }),
    deleteTrainJobs: async (jobs) => { deletions += 1; return { Results: [{ JobName: jobs[0].TrainJobId, Return: true }] }; },
  });
  assert.equal((await failed.deleteTraining("job")).item.TrainJobId, "kaic-job");
  assert.equal(deletions, 1);
});

test("training detail returns task-level and role commands", async () => {
  const service = makeService({
    listTrainJobs: async () => ({ TrainJobSet: [{ TrainJobId: "kaic-job", TrainJobName: "job", JobStatus: { Status: "succeed" } }] }),
    trainJobDetail: async () => ({ TrainJobId: "kaic-job", EntryPointCommand: "ray start", Roles: [{ RoleName: "Master", RunCommand: "python train.py" }] }),
  });
  const payload = await service.trainingDetail("job");
  assert.equal(payload.detail.EntryPointCommand, "ray start");
  assert.equal(payload.detail.Roles[0].RunCommand, "python train.py");
});

test("training logs enumerate pods and read native output", async () => {
  const calls = [];
  const service = makeService({
    listTrainJobs: async () => ({ TrainJobSet: [{ TrainJobId: "kaic-job", TrainJobName: "job", ResourcePoolId: "pool", JobStatus: { Status: "running" } }] }),
    trainJobDetail: async () => ({ TrainJobId: "kaic-job", ClusterId: "cluster", ResourcePoolId: "pool" }),
    trainJobPods: async (jobName, options) => {
      calls.push({ type: "pods", jobName, options });
      return { Pods: [
        { Name: "master-0", Role: "Master", Status: { State: "running" } },
        { Name: "worker-0", Role: "Worker", Status: { State: "running" } },
      ] };
    },
    trainJobLog: async (jobName, podName, options) => {
      calls.push({ type: "log", jobName, podName, options });
      return { RequestId: `request-${podName}`, PodLogs: `output from ${podName}` };
    },
  });
  const payload = await service.trainingLogs("job", { role: "worker", tailLines: 500, sinceSeconds: 60 });
  assert.equal(payload.pods.length, 2);
  assert.equal(payload.logs.length, 1);
  assert.equal(payload.logs[0].pod.Name, "worker-0");
  assert.equal(payload.logs[0].content, "output from worker-0");
  assert.equal(calls.at(-1).options.clusterId, "cluster");
  assert.equal(calls.at(-1).options.tailLines, 500);
  assert.equal(calls.at(-1).options.sinceSeconds, 60);
});

test("training logs reject invalid limits and unknown pods", async () => {
  const service = makeService({
    listTrainJobs: async () => ({ TrainJobSet: [{ TrainJobId: "kaic-job", TrainJobName: "job", JobStatus: { Status: "running" } }] }),
    trainJobDetail: async () => ({ TrainJobId: "kaic-job" }),
    trainJobPods: async () => ({ Pods: [{ Name: "master-0", Role: "Master" }] }),
  });
  await assert.rejects(() => service.trainingLogs("job", { tailLines: 0 }), /tailLines/);
  await assert.rejects(() => service.trainingLogs("job", { pod: "missing" }), /找不到训练 Pod/);
});

test("saving a developer image is allowed only while running", async () => {
  let saves = 0;
  const variables = { ImageName: "snapshot", ImageType: "Personal", Namespace: "ns", ImageRepo: "repo", ImageVersion: "v1", ImageDomain: "internal.example" };
  const stopped = makeService({
    listNotebooks: async () => ({ Notebooks: [{ NotebookId: "kaic-dev", Name: "dev", State: "stopped" }] }),
    saveNotebookImage: async () => { saves += 1; },
  });
  await assert.rejects(() => stopped.saveDeveloperImage("dev", variables), /只有运行中的/);
  const running = makeService({
    listNotebooks: async () => ({ Notebooks: [{ NotebookId: "kaic-dev", Name: "dev", State: "running" }] }),
    saveNotebookImage: async (_id, payload) => { saves += 1; return { ImageId: payload.ImageName }; },
  });
  assert.equal((await running.saveDeveloperImage("dev", variables)).result.ImageId, "snapshot");
  assert.equal(saves, 1);
});
