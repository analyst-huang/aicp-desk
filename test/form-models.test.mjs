import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as dev from '../web/models/dev-form.js';
import * as train from '../web/models/train-form.js';

const example = async kind => JSON.parse(await readFile(new URL(`../examples/${kind}-create.json`, import.meta.url), 'utf8'));

for (const [kind, model] of [['dev', dev], ['train', train]]) {
  test(`${kind} form round-trip preserves advanced fields without mutating the template`, async () => {
    const template = await example(kind);
    template.FutureOption = { nested: ['keep'] };
    const original = structuredClone(template);
    const fields = model.fromVariables(template);
    fields.name = '  edited  ';
    fields.cpu = '12';
    const result = model.toVariables(fields, template);
    assert.equal(result[kind === 'dev' ? 'DisplayName' : 'TrainJobName'], 'edited');
    assert.equal(kind === 'dev' ? result.CpuNum : result.Roles[0].ResourceConfig.CPUNum, 12);
    assert.deepEqual(result.FutureOption, original.FutureOption);
    assert.deepEqual(template, original);
    result.FutureOption.nested.push('isolated');
    assert.deepEqual(template, original);
    assert.deepEqual(model.fromVariables(model.toVariables(model.fromVariables(result), result)), model.fromVariables(result));
  });

  test(`${kind} switching image sources removes incompatible identifiers`, async () => {
    const base = await example(kind);
    const fields = model.fromVariables(base);
    fields.imageSource = kind === 'dev' ? 2 : 'ThirdParty';
    Object.assign(fields, { imageRegistry: 'registry', imageRepo: 'repo', imageTag: 'tag' });
    const thirdParty = model.toVariables(fields, base);
    const image = kind === 'dev' ? thirdParty : thirdParty.Roles[0].ImageConfig;
    assert.equal(image.ImageId, undefined);
    assert.equal(image.ImageTagId, 'tag');
    const back = model.fromVariables(thirdParty);
    back.imageSource = kind === 'dev' ? 1 : 'Personal';
    back.imageSelect = 'personal';
    const restored = model.toVariables(back, thirdParty);
    const restoredImage = kind === 'dev' ? restored : restored.Roles[0].ImageConfig;
    assert.equal(restoredImage.ImageId, 'personal');
    for (const key of ['ImageRegistryId', 'ImageRepoId', 'ImageTagId']) assert.equal(restoredImage[key], undefined);
  });
}

test('developer form distinguishes project zero from a missing project', async () => {
  const base = await example('dev');
  const fields = dev.fromVariables(base);
  fields.project = '';
  assert.throws(() => dev.toVariables(fields, base), /项目/);
  fields.project = '0';
  assert.equal(dev.toVariables(fields, base).ProjectId, 0);
});

test('developer refresh can capture incomplete fields without weakening submission validation', async () => {
  const base = await example('dev');
  const original = structuredClone(base);
  const fields = dev.fromVariables(base);
  Object.assign(fields, { project: '', name: 'edited while refreshing', enableSsh: true, publicSsh: true, allocationId: '', allocationUnavailable: 'unavailable-eip' });
  const draft = dev.toVariables(fields, base, { allowIncomplete: true });
  assert.equal(draft.ProjectId, null);
  assert.equal(draft.DisplayName, 'edited while refreshing');
  assert.equal(draft.EnablePublicNetworkSsh, true);
  assert.equal(draft.AllocationId, 'unavailable-eip');
  assert.deepEqual(base, original);
  assert.throws(() => dev.toVariables(fields, base), /项目/);
  fields.project = '0';
  assert.throws(() => dev.toVariables(fields, base), /unavailable-eip.*不可用/);
  fields.allocationUnavailable = '';
  assert.equal(dev.toVariables(fields, base, { allowIncomplete: true }).AllocationId, '');
  assert.throws(() => dev.toVariables(fields, base), /请选择.*EIP/);
});

test('developer public network and SSH settings remove stale dependent values', async () => {
  const base = await example('dev');
  const fields = dev.fromVariables(base);
  Object.assign(fields, { enableSsh: true, publicSsh: true, allocationId: '', allocationUnavailable: 'old-ip' });
  assert.throws(() => dev.toVariables(fields, base), /old-ip.*不可用/);
  fields.allocationId = 'eip';
  const publicSsh = dev.toVariables(fields, base);
  assert.equal(publicSsh.AllocationId, 'eip');
  fields.enableSsh = false;
  fields.serviceConfigs = [];
  const privateOnly = dev.toVariables(fields, publicSsh);
  for (const key of ['AllocationId', 'SshPort', 'SshAuthorizedKeys', 'EnablePublicNetworkSsh']) assert.equal(privateOnly[key], undefined);
  fields.serviceConfigs = [{ Service: 'web', Port: 8080, EnablePublicNetwork: true }];
  assert.equal(dev.toVariables(fields, privateOnly).AllocationId, 'eip');
});

test('developer form preserves affinity extensions and detaches repeated rows', async () => {
  const base = await example('dev');
  base.NodeAffinity = { RequiredNodeIp: 'old-node', FuturePolicy: 'keep' };
  const fields = dev.fromVariables(base);
  fields.affinityIp = '';
  fields.envs = [{ Name: 'KEY', Value: 'value' }];
  const result = dev.toVariables(fields, base);
  assert.equal(result.NodeAffinity.RequiredNodeIp, undefined);
  assert.equal(result.NodeAffinity.FuturePolicy, 'keep');
  result.Envs[0].Value = 'changed';
  assert.equal(fields.envs[0].Value, 'value');
});

test('training edits preserve other roles and switch command placement by framework', async () => {
  const base = await example('train');
  base.Roles.push({ RoleName: 'Worker', Replicas: 3, RunCommand: 'worker', FutureRole: true });
  base.Roles[0].ImageConfig.FutureImage = 'keep';
  const fields = train.fromVariables(base);
  fields.framework = 'ray';
  fields.command = 'ray job';
  const ray = train.toVariables(fields, base);
  assert.equal(ray.EntryPointCommand, 'ray job');
  assert.equal(ray.Roles[0].RunCommand, undefined);
  assert.deepEqual(ray.Roles[1], base.Roles[1]);
  assert.equal(ray.Roles[0].ImageConfig.FutureImage, 'keep');
  const back = train.fromVariables(ray);
  back.framework = 'pytorch';
  back.command = 'python train.py';
  const pytorch = train.toVariables(back, ray);
  assert.equal(pytorch.EntryPointCommand, undefined);
  assert.equal(pytorch.Roles[0].RunCommand, 'python train.py');
  assert.deepEqual(pytorch.Roles[1], base.Roles[1]);
});

test('defaults and decoded rows are isolated across dialogs', () => {
  const first = train.defaults('region');
  first.Roles[0].Envs.push({ Name: 'X' });
  assert.deepEqual(train.defaults('region').Roles[0].Envs, []);
  const fields = train.fromVariables(first);
  fields.storageConfigs.push({ StorageConfigId: 'new' });
  assert.deepEqual(first.StorageConfigs, []);
});

test('personal autosave preserves its destination and advanced configuration during edits', async () => {
  const base = await example('dev');
  base.AutoSave = true;
  base.AutoSaveConfig = { ImageType: 'Personal', Namespace: 'images', ImageRepo: 'snapshots', FutureOption: { keep: true } };
  const original = structuredClone(base);
  const fields = dev.fromVariables(base);
  fields.name = 'renamed';
  const result = dev.toVariables(fields, base);
  assert.equal(result.AutoSave, true);
  assert.deepEqual(result.AutoSaveConfig, original.AutoSaveConfig);
  result.AutoSaveConfig.FutureOption.keep = false;
  assert.deepEqual(base, original);
});

test('switching autosave registry types removes the old destination and credentials, while disabling removes config', async () => {
  const base = await example('dev');
  base.AutoSave = true;
  base.AutoSaveConfig = { ImageType: 'Personal', Namespace: 'personal', ImageRepo: 'snapshots', Password: 'old-password', FutureOption: 'keep' };
  const fields = dev.fromVariables(base);
  Object.assign(fields, { autosaveType: 'Official', autosaveInstance: 'instance', autosaveUsername: 'user', autosavePassword: 'new-password' });
  const official = dev.toVariables(fields, base);
  assert.deepEqual(official.AutoSaveConfig, { ImageType: 'Official', OfficialInstance: 'instance', UserName: 'user', Password: 'new-password', FutureOption: 'keep' });
  official.AutoSaveConfig.Namespace = 'enterprise';
  official.AutoSaveConfig.ImageRepo = 'enterprise-repo';
  official.AutoSaveConfig.OfficialInstanceName = 'Enterprise';
  const back = dev.fromVariables(official);
  back.autosaveType = 'Personal';
  const personal = dev.toVariables(back, official);
  assert.deepEqual(personal.AutoSaveConfig, { ImageType: 'Personal', FutureOption: 'keep' });
  back.autosave = false;
  const disabled = dev.toVariables(back, personal);
  assert.equal(disabled.AutoSave, false);
  assert.equal(disabled.AutoSaveConfig, undefined);
});

test('CPU master and GPU workers retain their task type and infer defaults from every role', async () => {
  const base = await example('train');
  const worker = { ...structuredClone(base.Roles[0]), RoleName: 'Worker' };
  Object.assign(base.Roles[0].ResourceConfig, { GPUType: '', GPUNumber: 0 });
  base.Roles.push(worker);
  base.JobRunOnCPU = false;
  const original = structuredClone(base);
  const fields = train.fromVariables(base);
  assert.equal(fields.jobCpu, false);
  fields.cpu = '12';
  const result = train.toVariables(fields, base);
  assert.equal(result.JobRunOnCPU, false);
  assert.deepEqual(result.Roles[1], worker);
  assert.deepEqual(base, original);
  delete base.JobRunOnCPU;
  assert.equal(train.fromVariables(base).jobCpu, false);
  Object.assign(base.Roles[1].ResourceConfig, { GPUType: '', GPUNumber: 0 });
  assert.equal(train.fromVariables(base).jobCpu, true);
});

test('an explicit training task type can be edited even when its first role has no GPU', async () => {
  const base = await example('train');
  Object.assign(base.Roles[0].ResourceConfig, { GPUType: '', GPUNumber: 0 });
  for (const jobCpu of [false, true]) {
    base.JobRunOnCPU = jobCpu;
    const fields = train.fromVariables(base);
    assert.equal(fields.jobCpu, jobCpu);
    assert.equal(train.toVariables(fields, base).JobRunOnCPU, jobCpu);
    fields.jobCpu = !jobCpu;
    assert.equal(train.toVariables(fields, base).JobRunOnCPU, !jobCpu);
  }
});
