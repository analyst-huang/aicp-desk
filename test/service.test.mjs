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
