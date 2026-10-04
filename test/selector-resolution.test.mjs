import test from 'node:test';
import assert from 'node:assert/strict';
import { DevelopersService } from '../lib/services/developers.mjs';
import { TrainingService } from '../lib/services/training.mjs';

for (const kind of ['dev', 'train']) {
  const developer = kind === 'dev';
  const idKey = developer ? 'NotebookId' : 'TrainJobId';
  const nameKey = developer ? 'Name' : 'TrainJobName';
  const listMethod = developer ? 'listNotebooks' : 'listTrainJobs';
  const resultKey = developer ? 'Notebooks' : 'TrainJobSet';
  const resolveMethod = developer ? 'resolveDeveloper' : 'resolveTraining';
  const selector = 'kaic-my-experiment';
  const row = (id, name, time = '') => ({ [idKey]: id, [nameKey]: name, JobStatus: { SubmitTime: time } });

  function fixture(items, idError) {
    const calls = [];
    const api = { [listMethod]: async filters => {
      calls.push(filters);
      const ids = developer ? filters.id && [filters.id] : filters.ids;
      if (ids && idError) throw idError;
      return { [resultKey]: items.filter(item => ids
        ? ids.includes(item[idKey])
        : item[nameKey].includes(filters.name)) };
    } };
    const service = developer ? new DevelopersService({ api }) : new TrainingService({ api });
    return { calls, resolve: (...args) => service[resolveMethod](...args) };
  }

  test(`${kind} resolves a kaic-prefixed name after an empty ID lookup`, async () => {
    const expected = row('kaic-resource-1', selector);
    const { resolve, calls } = fixture([row('kaic-unrelated', `${selector}-other`), expected]);
    assert.deepEqual(await resolve(selector, { region: 'region-2' }), expected);
    assert.equal(calls.length, 2);
    assert.deepEqual(developer ? [calls[0].id] : calls[0].ids, [selector]);
    assert.equal(calls[0].name, undefined);
    assert.deepEqual(calls[1], { name: selector, limit: 100, region: 'region-2' });
    assert.equal(calls[0].region, 'region-2');
  });

  test(`${kind} keeps exact ID precedence over a colliding resource name`, async () => {
    const expected = row(selector, 'different-name');
    const { resolve, calls } = fixture([row('kaic-other', selector), expected]);
    assert.deepEqual(await resolve(selector), expected);
    assert.equal(calls.length, 1);
  });

  test(`${kind} keeps duplicate-name protections after the fallback`, async () => {
    const older = row('kaic-older', selector, '2026-01-01');
    const newer = row('kaic-newer', selector, '2026-02-01');
    const { resolve } = fixture([older, newer]);
    await assert.rejects(() => resolve(selector), developer ? /名称不唯一/ : /--latest/);
    if (!developer) assert.deepEqual(await resolve(selector, { latest: true }), newer);
    const missing = fixture([row('kaic-similar', `${selector}-other`)]);
    await assert.rejects(() => missing.resolve(selector), /找不到/);
  });

  test(`${kind} does not reinterpret lookup failures as an absent ID`, async () => {
    const error = new Error('permission or network failure');
    const { resolve, calls } = fixture([row('kaic-other', selector)], error);
    await assert.rejects(() => resolve(selector), thrown => thrown === error);
    assert.equal(calls.length, 1);
  });
}
