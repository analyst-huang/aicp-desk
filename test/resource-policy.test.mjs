import test from 'node:test';
import assert from 'node:assert/strict';
import { resourceCapabilities } from '../lib/domain/resource-policy.mjs';
import { AicpService } from '../lib/service.mjs';

const active = { dev: ['running', 'starting', 'pending', 'deploying'], train: ['running', 'submit', 'pending', 'deploying', 'restarting', 'succeed_holding', 'failed_holding'] };
for (const kind of ['dev', 'train']) test(`${kind} policy and actual service writes agree across every known and unknown state`, async () => {
  for (const state of [...active[kind], 'stopped', 'failed', 'succeed', 'stopping', 'future-status', '', undefined]) {
    const writes = [];
    const item = kind === 'dev' ? { NotebookId: 'kaic-id', State: state } : { TrainJobId: 'job-id', JobStatus: { Status: state } };
    const write = action => async () => { writes.push(action); return { Results: [{ Return: true }] }; };
    const service = new AicpService({
      listNotebooks: async () => ({ Notebooks: [item] }), listTrainJobs: async () => ({ TrainJobSet: [item] }),
      setNotebookStatus: async (_, action) => write(action)(), deleteNotebooks: write('delete'),
      startTrainJobs: write('start'), stopTrainJobs: write('stop'), deleteTrainJobs: write('delete'),
    }, {}, {});
    const policy = resourceCapabilities(kind, state);
    assert.equal(policy.canStop, active[kind].includes(state));
    assert.equal(policy.canStart, ['stopped', 'failed', 'succeed'].includes(state));
    assert.equal(policy.canDelete, policy.canStart);
    for (const action of ['start', 'stop', 'delete']) {
      writes.length = 0;
      const allowed = policy[`can${action[0].toUpperCase()}${action.slice(1)}`];
      const call = () => service[`${action}${kind === 'dev' ? 'Developer' : 'Training'}`](kind === 'dev' ? 'kaic-id' : 'job-id');
      if (action === 'delete' && !allowed) await assert.rejects(call, /不能删除/);
      else await call();
      assert.deepEqual(writes, allowed ? [action] : [], `${kind} ${state} ${action}`);
    }
  }
});
