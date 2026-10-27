import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CONSOLE_ORIGINS, DEFAULT_CONSOLE_URL, isConsoleUrl, migrateConsoleUrl } from '../lib/console.mjs';
import { BrowserSession } from '../lib/browser.mjs';
import { DEFAULT_CONFIG } from '../lib/config.mjs';
import { KsyunApi } from '../lib/cloud/api.mjs';
import { AicpService } from '../lib/service.mjs';
import { handleDev } from '../bin/aicp.mjs';
import { notebookDetailToVariables, trainDetailToVariables } from '../lib/templates.mjs';
import { normalizeCreateVariables, validateCreateVariables } from '../lib/domain/create-input.mjs';
import * as devForm from '../web/models/dev-form.js';
import * as trainForm from '../web/models/train-form.js';
import { CREATE_NOTEBOOK, CREATE_TRAIN_JOB } from '../lib/operations.mjs';

const example = async kind => JSON.parse(await readFile(new URL(`../examples/${kind}-create.json`, import.meta.url), 'utf8'));

test('console recognition accepts both exact HTTPS origins and migrates only the old default', () => {
  for (const origin of CONSOLE_ORIGINS) assert.equal(isConsoleUrl(`${origin}/#/taskDev`), true);
  for (const url of ['https://ksp.console.ksyun.com.evil.test/', 'https://evil.test/?https://ksp.console.ksyun.com/', 'http://ksp.console.ksyun.com/', 'https://ksp.console.ksyun.com:444/', 'https://user@ksp.console.ksyun.com/', 'bad', null]) assert.equal(isConsoleUrl(url), false, String(url));
  assert.equal(DEFAULT_CONFIG.consoleUrl, DEFAULT_CONSOLE_URL);
  assert.equal(isConsoleUrl('https://ksp.console.ksyun.com/webide-proxy/grafana/cluster/kaic-grafana/d/ezyy84dHz/kaic-dashboard'), false);
  assert.equal(migrateConsoleUrl('https://aicp.console.ksyun.com/#/taskDev'), DEFAULT_CONSOLE_URL);
  assert.equal(migrateConsoleUrl('https://aicp.console.ksyun.com/#/taskTraining'), 'https://aicp.console.ksyun.com/#/taskTraining');
});

for (const origin of CONSOLE_ORIGINS) test(`browser readiness and login recovery reuse ${origin}`, async () => {
  const browser = new BrowserSession(DEFAULT_CONFIG);
  const target = { type: 'page', url: `${origin}/#/taskDev` };
  const identity = { accountType: 'iam', userId: 'fixture', username: 'fixture' };
  browser.targets = async () => [target];
  browser.fetchCurrentUser = async page => { assert.equal(page, target); return identity; };
  browser.verifyRecoveredIdentity = async value => value;
  browser.withLoginLock = async callback => callback();
  browser.performLoginRecovery = async () => assert.fail('An existing authenticated console must be reused');
  assert.equal(await browser.waitForConsoleTarget(), target);
  assert.equal(await browser.waitForAicpTarget(), target);
  assert.equal(await browser.recoverLogin(), identity);
});

test('developer deletion uses object requests, retains disks by default and rejects invalid policies before dispatch', async () => {
  const calls = [];
  const api = new KsyunApi({ graphql: async (operation, query, variables) => {
    calls.push({ operation, query, variables });
    return { BatchDeleteNotebook: { Results: [{ NotebookId: 'dev', Return: true }] } };
  } }, { region: 'test' });
  await api.deleteNotebooks(['one', 'two']);
  assert.deepEqual(calls[0].variables, { Region: 'test', DeleteNotebookReqs: [
    { NotebookId: 'one', VolumeReclaimPolicy: 'reclaim' }, { NotebookId: 'two', VolumeReclaimPolicy: 'reclaim' },
  ] });
  assert.match(calls[0].query, /\$DeleteNotebookReqs: \[DeleteNotebookItem!\]!/);
  assert.doesNotMatch(calls[0].query, /NotebookIds/);
  await api.deleteNotebooks(['one'], 'other', { volumeReclaimPolicy: 'delete' });
  assert.equal(calls[1].variables.DeleteNotebookReqs[0].VolumeReclaimPolicy, 'delete');
  assert.equal(calls[1].variables.Region, 'other');
  await assert.rejects(() => api.deleteNotebooks(['one'], 'test', { volumeReclaimPolicy: 'typo' }), /volumeReclaimPolicy/);
  assert.equal(calls.length, 2);
});

test('CLI and developer service preserve the selected disk policy and cancellation never deletes', async () => {
  const writes = [];
  const service = new AicpService({
    listNotebooks: async () => ({ Notebooks: [{ NotebookId: 'kaic-dev', Name: 'dev', State: 'stopped', EnableVolume: true }] }),
    deleteNotebooks: async (ids, region, options) => { writes.push({ ids, region, options }); return { Results: [{ Return: true }] }; },
  }, {}, {});
  const prompts = [];
  const io = { confirm: async message => { prompts.push(message); return true; }, output() {} };
  await handleDev({ service }, 'delete', ['dev'], io);
  await handleDev({ service }, 'delete', ['dev', '--volume-policy', 'delete'], io);
  assert.deepEqual(writes.map(x => x.options.volumeReclaimPolicy), ['reclaim', 'delete']);
  assert.match(prompts[0], /保留关联云盘/);
  assert.match(prompts[1], /永久删除关联云盘/);
  await handleDev({ service }, 'delete', ['dev'], { ...io, confirm: async () => false });
  await assert.rejects(() => handleDev({ service }, 'delete', ['dev', '--volume-policy', 'invalid'], io), /volumeReclaimPolicy/);
  assert.equal(writes.length, 2);
});

test('new developer settings survive detail, template and form conversion without reusing a disk ID', async () => {
  const detail = { ...(await example('dev')), Name: 'new-dev', EnableCustomShareMemory: true, ShareMemory: 8, EnableVolume: true,
    VolumeConfig: { VolumeType: 'ESSD_PL0', VolumeSize: 100, VolumeId: 'existing-disk', VolumeStatus: 'in-use', AvailabilityZone: 'az' } };
  const variables = notebookDetailToVariables(detail, detail.Region);
  const original = structuredClone(variables);
  const fields = devForm.fromVariables(variables);
  const result = devForm.toVariables(fields, variables);
  assert.deepEqual(result.VolumeConfig, { VolumeType: 'ESSD_PL0', VolumeSize: 100 });
  assert.equal(result.ShareMemory, 8);
  assert.equal(result.EnableCustomShareMemory, true);
  validateCreateVariables('dev', result);
  assert.deepEqual(variables, original);
  fields.customShareMemory = false; fields.enableVolume = false;
  const disabled = devForm.toVariables(fields, result);
  assert.equal(disabled.ShareMemory, undefined);
  assert.equal(disabled.VolumeConfig, undefined);
});

test('new training settings and TensorBoard mounts survive detail, template and form conversion', async () => {
  const detail = { ...(await example('train')), EnableRDMADepsCheck: true, RDMADepsCheckConfig: { CheckTiming: 'BeforeRunning', MaxCheckTime: 2 },
    SupportTensorboard: true, TensorboardStatus: { HoldingTimeHours: 48 }, StorageConfigs: [{ StorageConfigId: 'logs', MountType: 'Tensorboard', MountPath: '/logs' }] };
  const variables = trainDetailToVariables(detail, detail.Region);
  const fields = trainForm.fromVariables(variables);
  const result = trainForm.toVariables(fields, variables);
  assert.equal(result.TensorboardHoldingTimeHours, 48);
  assert.deepEqual(result.RDMADepsCheckConfig, { CheckTiming: 'BeforeRunning', MaxCheckTime: 2 });
  assert.equal(result.StorageConfigs[0].MountType, 'Tensorboard');
  validateCreateVariables('train', result);
  fields.rdmaCheck = false; fields.tensorboard = false;
  const disabled = trainForm.toVariables(fields, result);
  assert.equal(disabled.RDMADepsCheckConfig, undefined);
  assert.equal(disabled.TensorboardHoldingTimeHours, undefined);
});

test('new numeric settings are normalized and malformed settings fail before cloud execution', async () => {
  const developer = { ...(await example('dev')), EnableCustomShareMemory: true, ShareMemory: '8', EnableVolume: true, VolumeConfig: { VolumeType: 'ESSD_PL0', VolumeSize: '100' } };
  const normalized = normalizeCreateVariables('dev', developer);
  assert.equal(normalized.ShareMemory, 8); assert.equal(normalized.VolumeConfig.VolumeSize, 100);
  validateCreateVariables('dev', normalized);
  const training = { ...(await example('train')), SupportTensorboard: true, TensorboardHoldingTimeHours: '24', EnableRDMADepsCheck: true, RDMADepsCheckConfig: { CheckTiming: 'BeforeRunning', MaxCheckTime: '1' } };
  const train = normalizeCreateVariables('train', training);
  assert.equal(train.TensorboardHoldingTimeHours, 24); assert.equal(train.RDMADepsCheckConfig.MaxCheckTime, 1);
  validateCreateVariables('train', train);
  for (const changes of [{ ShareMemory: -1 }, { ShareMemory: Number(normalized.Memory) + 1 }, { VolumeConfig: null }, { VolumeConfig: { VolumeType: 'ESSD_PL0', VolumeSize: 0 } }, { VolumeConfig: { VolumeType: '', VolumeSize: 10 } }, { EnableVolume: 'true' }]) {
    assert.throws(() => validateCreateVariables('dev', { ...normalized, ...changes }), /ShareMemory|Volume/);
  }
  for (const changes of [{ TensorboardHoldingTimeHours: 0.5 }, { TensorboardHoldingTimeHours: NaN }, { EnableRDMADepsCheck: 'true' }, { RDMADepsCheckConfig: null }, { RDMADepsCheckConfig: { CheckTiming: 'BeforeRunning', MaxCheckTime: 6 } }, { RDMADepsCheckConfig: { CheckTiming: 'typo', MaxCheckTime: 1 } }]) {
    assert.throws(() => validateCreateVariables('train', { ...train, ...changes }), /TensorboardHoldingTimeHours|RDMA/);
  }
});

test('creation documents bind all newly editable top-level variables', () => {
  for (const [query, fields] of [[CREATE_NOTEBOOK, ['ShareMemory', 'EnableCustomShareMemory', 'EnableVolume', 'VolumeConfig']], [CREATE_TRAIN_JOB, ['TensorboardHoldingTimeHours', 'EnableRDMADepsCheck', 'RDMADepsCheckConfig']]]) {
    for (const field of fields) {
      assert.match(query, new RegExp('\\$' + field + ':'));
      assert.match(query, new RegExp(field + ': \\$' + field + '\\b'));
    }
  }
});
