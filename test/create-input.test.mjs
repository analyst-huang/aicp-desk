import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeCreateVariables, validateCreateVariables } from '../lib/domain/create-input.mjs';
import { CreationService } from '../lib/services/creation.mjs';

const examples = Object.fromEntries(await Promise.all(['dev', 'train'].map(async kind => [kind,
  JSON.parse(await readFile(new URL(`../examples/${kind}-create.json`, import.meta.url), 'utf8')),
])));

test('creation rejects malformed numeric values locally, including missing fields and non-finite numbers', async () => {
  let writes = 0;
  const service = new CreationService({ executePayload: async () => writes++, templates: {}, config: {} });
  const cases = [
    ['dev', v => v, 'CpuNum'], ['dev', v => v, 'Memory'], ['dev', v => v, 'ProjectId'],
    ['train', v => v.Roles[0].ResourceConfig, 'CPUNum'], ['train', v => v.Roles[0].ResourceConfig, 'Memory'],
    ['train', v => v.Roles[0], 'Replicas'],
  ];
  for (const [kind, target, field] of cases) for (const value of [undefined, null, '', ' ', 'abc', NaN, Infinity, -1, true, [], {}]) {
    const variables = structuredClone(examples[kind]);
    target(variables)[field] = value;
    await assert.rejects(() => service.create(kind, { variables }), Error, `${kind}.${field} accepted ${String(value)}`);
  }
  for (const field of ['MaxRuntimeHour', 'GPUNumber']) for (const value of ['abc', Infinity, null, -1]) {
    const variables = structuredClone(examples.train);
    (field === 'GPUNumber' ? variables.Roles[0].ResourceConfig : variables)[field] = value;
    await assert.rejects(() => service.prepareCreate('train', { variables }), Error);
  }
  assert.equal(writes, 0);
});

test('normalization copies numeric strings and pure validation accepts frozen input without mutation', () => {
  const source = { ...examples.dev, ProjectId: '0', CpuNum: '12', GPUNumber: '0', Future: { retained: true } };
  const before = structuredClone(source);
  const normalized = normalizeCreateVariables('dev', source);
  assert.equal(normalized.ProjectId, 0);
  assert.equal(normalized.CpuNum, 12);
  assert.equal(normalized.GPUNumber, 0);
  validateCreateVariables('dev', Object.freeze(normalized));
  validateCreateVariables('dev', Object.freeze(source));
  assert.deepEqual(source, before);
  normalized.Future.retained = false;
  assert.equal(source.Future.retained, true);
});

test('creation rejects invalid object and array shapes with actionable field errors', async () => {
  const service = new CreationService({ executePayload: async () => assert.fail('write'), templates: {}, config: {} });
  for (const variables of [null, [], 'text', 1, false]) await assert.rejects(() => service.prepareCreate('dev', { variables }), /必须是对象/);
  for (const [field, value] of [['Roles', [null]], ['Roles', [[]]], ['StorageConfigs', [null]]]) {
    await assert.rejects(() => service.prepareCreate('train', { variables: { ...examples.train, [field]: value } }), /必须是对象/);
  }
  await assert.rejects(() => service.prepareCreate('train', { variables: { ...examples.train, Roles: {} }, command: 'python train.py' }), /Roles 必须是数组/);
  for (const field of ['Envs', 'ServiceConfigs', 'StorageConfigs']) {
    await assert.rejects(() => service.prepareCreate('dev', { variables: { ...examples.dev, [field]: [null] } }), /必须是对象/);
  }
  assert.throws(() => validateCreateVariables('unknown', {}), /未知资源类型/);
});
