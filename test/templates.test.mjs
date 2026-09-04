import test from "node:test";
import assert from "node:assert/strict";
import { notebookDetailToVariables, trainDetailToVariables } from "../lib/templates.mjs";

test("notebook detail maps to CreateNotebook variables", () => {
  const variables = notebookDetailToVariables({
    Name: "dev-a",
    Description: "demo",
    ImageSource: 1,
    ImageId: "image-1",
    ProjectId: 0,
    ResourcePoolId: "pool-1",
    QueueName: "queue-1",
    GPUType: "GPU-X",
    GPUNumber: 2,
    CpuNum: 16,
    Memory: 64,
    AccessType: "Creator",
    DataSetConfigs: [{ StorageConfigId: "data", MountPath: "/data", MountProtocol: "NFS" }],
    VolumeConfigs: [{ StorageConfigId: "out", MountPath: "/out", MountProtocol: "NFS" }],
    Envs: [{ Name: "MODE", Value: "test" }],
  }, "region-1");
  assert.equal(variables.Region, "region-1");
  assert.equal(variables.ProjectId, 0);
  assert.equal(variables.DisplayName, "dev-a");
  assert.deepEqual(variables.StorageConfigs, [
    { StorageConfigId: "data", MountPath: "/data", StorageConfigType: "DataSet", MountProtocol: "NFS" },
    { StorageConfigId: "out", MountPath: "/out", StorageConfigType: "Output", MountProtocol: "NFS" },
  ]);
});

test("train detail maps to CreateTrainJob variables", () => {
  const variables = trainDetailToVariables({
    TrainJobName: "train-a",
    ResourcePoolId: "pool-1",
    QueueName: "queue-1",
    Framework: "pytorch",
    StorageConfigs: [{ StorageConfigId: "data", MountType: "DataSet", MountPath: "/data", MountProtocol: "NFS" }],
    Roles: [{
      RoleName: "Master",
      Replicas: 1,
      ImageConfig: { ImageId: "image-1", ImageSource: "Personal", ImageName: "ignored" },
      ResourceConfig: { GPUType: "GPU-X", GPUNumber: 4, CPUNum: 32, Memory: 128 },
      RunCommand: "python train.py",
      Envs: [{ Name: "MODE", Value: "train" }],
    }],
  }, "region-1");
  assert.equal(variables.TrainJobName, "train-a");
  assert.equal(variables.Roles[0].ImageConfig.ImageName, undefined);
  assert.equal(variables.Roles[0].RunCommand, "python train.py");
  assert.equal(variables.Roles[0].ResourceConfig.GPUNumber, 4);
});
