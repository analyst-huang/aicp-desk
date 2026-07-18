import test from "node:test";
import assert from "node:assert/strict";
import * as operations from "../lib/operations.mjs";

test("all GraphQL documents have an operation declaration", () => {
  for (const [name, document] of Object.entries(operations)) {
    assert.match(document, /\b(query|mutation)\s+[A-Za-z0-9_]+/, name);
  }
});

test("write operations use the expected platform operation names", () => {
  assert.match(operations.CREATE_NOTEBOOK, /mutation CreateNotebook/);
  assert.match(operations.MODIFY_NOTEBOOK_STATUS, /mutation ModifyNotebookStatus/);
  assert.match(operations.BATCH_DELETE_NOTEBOOKS, /mutation BatchDeleteNotebook/);
  assert.match(operations.SAVE_NOTEBOOK_IMAGE, /mutation SaveNotebookImage/);
  assert.match(operations.CREATE_TRAIN_JOB, /mutation CreateTrainJob/);
  assert.match(operations.BATCH_START_TRAIN_JOBS, /mutation BatchStartQueueJobs/);
  assert.match(operations.BATCH_STOP_TRAIN_JOBS, /mutation BatchStopQueueJobs/);
  assert.match(operations.BATCH_DELETE_TRAIN_JOBS, /mutation BatchDeleteQueueJobs/);
});

test("developer creation option queries match the current platform operations", () => {
  assert.match(operations.DESCRIBE_AICP_IMAGES, /query DescribeAicpImages/);
  assert.match(operations.DESCRIBE_AICP_IMAGES, /ApplicationScenario/);
  assert.match(operations.DESCRIBE_ALL_RESOURCE_POOLS, /query DescribeAllResourcePool/);
  assert.match(operations.DESCRIBE_CLUSTER_QUEUES, /query DescribeClusterQueue/);
  assert.match(operations.DESCRIBE_CLUSTER_QUEUES, /Allocated \{ cpu memory storage gpu \}/);
  assert.match(operations.DESCRIBE_GPU_INFO, /query DescribeGpuInfo/);
  assert.match(operations.DESCRIBE_GPU_INFO, /FreeGpuNum/);
  assert.match(operations.DATA_SET_LIST, /query DataSetList/);
  assert.match(operations.DESCRIBE_QUEUE_RESOURCE_CONFIG, /query DescribeQueueResourceConfigInfo/);
  assert.match(operations.DESCRIBE_AVAILABLE_ADDRESSES, /query DescribleNoUseAddress/);
  assert.match(operations.DESCRIBE_INSTANCES_BY_RESOURCE, /query DescribeInstancesByResource/);
});

test("save-image option queries match the native KCR selectors", () => {
  assert.match(operations.GET_IMAGE_CONFIG, /query GetImageConfig/);
  assert.match(operations.DESCRIBE_KCR_INSTANCES, /query DescribeKcrInstances/);
  assert.match(operations.DESCRIBE_PERSONAL_NAMESPACES, /query DescribePersonalNamespaces/);
  assert.match(operations.DESCRIBE_NAMESPACES, /query DescribeNamespaces/);
  assert.match(operations.DESCRIBE_PERSONAL_REPOSITORIES, /query DescribePersonalRepositories/);
  assert.match(operations.DESCRIBE_REPOSITORIES, /query DescribeRepositories/);
  assert.match(operations.DESCRIBE_PERSONAL_NAMESPACES, /InternalEndpoint/);
});
