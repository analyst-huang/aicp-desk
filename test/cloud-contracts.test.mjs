import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { checkReadContract, captureReadContracts, READ_CONTRACTS } from '../lib/cloud/read-contracts.mjs';
import { KsyunApi } from '../lib/cloud/api.mjs';

const directory = new URL('./fixtures/cloud/', import.meta.url);
const fixtures = await Promise.all((await readdir(directory)).filter(name => name.endsWith('.json')).map(async name => JSON.parse(await readFile(new URL(name, directory), 'utf8'))));
for (const fixture of fixtures) test(`cloud adapter consumes the saved response contracts: ${fixture.source}`, async () => {
  assert.deepEqual(fixture.responses.map(item => item.operation).sort(), Object.keys(READ_CONTRACTS).sort());
  const responses = new Map(fixture.responses.map(item => [item.operation, item.data]));
  const adapter = new KsyunApi({ graphql: async (operation, query) => {
    assert.match(query, /^\s*query\b/);
    const data = structuredClone(responses.get(operation));
    checkReadContract(operation, data);
    return data;
  } }, { region: 'test' });
  assert.deepEqual((await adapter.listNotebooks()).Notebooks, responses.get('DescribeNotebook').DescribeNotebook.Notebooks);
  assert.deepEqual((await adapter.listTrainJobs()).TrainJobSet, responses.get('DescribeTrainJobs').DescribeTrainJobs.TrainJobSet);
  assert.deepEqual(await adapter.listResourcePools(), responses.get('DescribeAllResourcePool').DescribeAllResourcePool.ResourcePoolSet);
  assert.deepEqual(await adapter.listProjects(), [...responses.get('AicpGetAccountAllProjectList').AicpGetAccountAllProjectList.ListProjectResult.ProjectList].sort((a, b) => a.ProjectId - b.ProjectId));
  assert.deepEqual(await adapter.listImages('Personal'), responses.get('DescribeAicpImages').DescribeAicpImages.ImageSet);
});

test('contracts detect missing provider fields and invalid item types, while allowing extensions and empty lists', () => {
  const valid = structuredClone(fixtures[0].responses.find(item => item.operation === 'DescribeNotebook').data);
  assert.doesNotThrow(() => checkReadContract('DescribeNotebook', { ...valid, FutureField: {} }));
  assert.throws(() => checkReadContract('DescribeNotebook', { DescribeNotebook: {} }), /Notebooks.*数组/);
  const invalid = structuredClone(valid);
  invalid.DescribeNotebook.Notebooks[0].State = null;
  assert.throws(() => checkReadContract('DescribeNotebook', invalid), /State.*string/);
  valid.DescribeNotebook.Notebooks = [];
  assert.doesNotThrow(() => checkReadContract('DescribeNotebook', valid));
  assert.throws(() => checkReadContract('CreateNotebook', {}), /未允许/);
});

test('capture only sends allowlisted queries and discards sensitive and unexpected data before saving', async () => {
  const responses = new Map(fixtures[0].responses.map(item => [item.operation, item.data]));
  const calls = [];
  const captured = await captureReadContracts({ graphql: async (operation, query, variables) => {
    calls.push(operation);
    assert.match(query, /^\s*query\b/);
    assert.doesNotMatch(query, /\bmutation\b/);
    assert.equal(variables.Region, 'test-region');
    const data = structuredClone(responses.get(operation));
    data.secretToken = 'never-save-this';
    return data;
  } }, 'test-region');
  assert.equal(calls.length, 5);
  assert.equal(captured.source, 'live-sanitized');
  assert.doesNotMatch(JSON.stringify(captured), /never-save-this|fixture-dev|Fixture developer/);
  for (const response of captured.responses) checkReadContract(response.operation, response.data);
});
