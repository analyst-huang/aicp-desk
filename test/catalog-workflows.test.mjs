import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AicpService } from '../lib/service.mjs';

function fixture(overrides = {}) {
  const calls = [];
  const api = {
    region: region => region || 'default-region',
    withSession: async callback => { calls.push('open'); try { return await callback(); } finally { calls.push('close'); } },
    listProjects: async () => [{ ProjectId: 0 }],
    listResourcePools: async () => [{ ResourcePoolId: 'pool' }],
    listClusterQueues: async (_pool, _region, options = {}) => { calls.push(options); return [{ Name: 'queue', ResourcePoolId: 'pool' }]; },
    listImages: async (source, _region, options) => { calls.push({ source, ...options }); return [{ ImageId: 'image' }]; },
    listStorageConfigs: async type => [{ StorageConfigId: type }],
    listImageRegistries: async () => [{ Id: 'active', RegistryStatus: 'Active' }, { Id: 'numeric', RegistryStatus: '4' }, { Id: 'deleted', RegistryStatus: 'Deleted' }],
    listAvailableAddresses: async () => [],
    publicNetworkCondition: async () => ({ IsAllow: true }),
    resourcePoolGpuInfo: async () => ({ Num: 8, AvailableGpuNum: 4 }),
    listResourcePoolInstances: async () => [],
    imageConfig: async () => ({ ImageServiceInfo: { Deleted: false } }),
    listSaveImageNamespaces: async () => [{ Namespace: 'images', Public: false, InternalEndpoint: 'internal.example' }],
    listKcrInstances: async () => [],
    listNotebooks: async () => ({ Notebooks: [{ Name: 'dev', NotebookId: 'kaic-dev', State: 'running' }] }),
    submitNotebookImage: async payload => { calls.push(structuredClone(payload)); return { Return: true }; },
    submitCreate: async (kind, payload) => { calls.push({ kind, payload }); return { NotebookId: 'created' }; },
    ...overrides,
  };
  return { api, calls, service: new AicpService(api, {}, { region: 'default-region' }) };
}

test('business services build catalog results from primitive cloud reads', async () => {
  const { service, calls } = fixture();
  const dev = await service.developerCreateOptions('region');
  assert.equal(dev.region, 'region');
  assert.deepEqual(dev.imageRegistries.map(item => item.Id), ['active', 'numeric']);
  assert.deepEqual(dev.storageConfigs.map(item => item.StorageConfigId), ['KS3', 'KPFS']);
  assert.deepEqual(dev.publicNetworkByPool, { pool: true });
  const train = await service.trainingCreateOptions();
  assert.equal(train.region, 'default-region');
  assert.ok(calls.some(item => item.workloadType === 'trainjob'));
  assert.ok(calls.some(item => item.source === 'Official' && item.applicationScenario === '训练任务'));
  assert.equal((await service.gpuCapacity()).summary.physicalFreeGpu, 4);
  assert.equal((await service.saveImageOptions()).personalConfigured, true);
  assert.equal(calls.filter(item => item === 'open').length, 4);
  assert.equal(calls.filter(item => item === 'close').length, 4);
});

test('public network lookup failure rejects create options and remains distinct from an explicit denial', async () => {
  const failure = new Error('public-network-query-failed');
  let fail = true, allowed = false;
  const { service, calls } = fixture({
    publicNetworkCondition: async () => {
      if (fail) throw failure;
      return { IsAllow: allowed };
    },
  });
  await assert.rejects(service.developerCreateOptions('region'), error => error === failure);
  fail = false;
  assert.deepEqual((await service.developerCreateOptions('region')).publicNetworkByPool, { pool: false });
  allowed = true;
  assert.deepEqual((await service.developerCreateOptions('region')).publicNetworkByPool, { pool: true });
  assert.equal(calls.filter(item => item === 'open').length, 3);
  assert.equal(calls.filter(item => item === 'close').length, 3);
  assert.equal(calls.some(item => item.kind === 'dev'), false);
});

test('save-image workflow owns native namespace validation and submits once', async () => {
  const { service, calls } = fixture();
  const variables = { ImageType: 'Personal', ImageName: 'snapshot', Namespace: 'images', ImageRepo: 'repo', ImageVersion: 'v1', Password: 'obsolete' };
  const result = await service.saveDeveloperImage('dev', variables);
  assert.equal(result.result.Return, true);
  const writes = calls.filter(item => item.NotebookId);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].ImageDomain, 'internal.example');
  assert.equal(writes[0].NamespacePermission, 'Private');
  assert.equal(writes[0].Password, undefined);
  assert.equal(variables.Password, 'obsolete');
});

test('create execution uses its own cloud port and does not dispatch during preparation', async () => {
  const { service, calls } = fixture();
  const variables = JSON.parse(await readFile(new URL('../examples/dev-create.json', import.meta.url), 'utf8'));
  Object.assign(variables, { ResourcePoolId: 'pool', QueueName: 'queue', ImageId: 'image', StorageConfigs: [], ProjectId: 0 });
  const prepared = await service.prepareCreate('dev', { variables });
  assert.deepEqual(calls, []);
  const result = await service.executeCreate(prepared);
  assert.equal(result.result.NotebookId, 'created');
  assert.equal(calls.filter(item => item.kind === 'dev').length, 1);
  assert.equal(calls.at(-1), 'close');
});
