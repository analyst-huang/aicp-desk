import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { RESOURCE_STATES, resourceCapabilities } from '../lib/domain/resource-policy.mjs';

const dev = JSON.parse(await readFile(new URL('../examples/dev-create.json', import.meta.url), 'utf8'));
const train = JSON.parse(await readFile(new URL('../examples/train-create.json', import.meta.url), 'utf8'));
dev.DisplayName = 'template-dev'; dev.AutoSave = false;
train.TrainJobName = 'template-train';
const templates = [{ kind: 'dev', name: 'saved-dev', variables: dev }, { kind: 'train', name: 'saved-train', variables: train }];
const options = {
  projects: [{ ProjectId: 0, ProjectName: 'Default project' }],
  resourcePools: [{ ResourcePoolId: dev.ResourcePoolId, ResourcePoolName: 'Pool' }],
  queues: [{ Id: 'q1', Name: dev.QueueName, ResourcePoolId: dev.ResourcePoolId, GpuModels: [{ Model: dev.GPUType }, { Model: train.Roles[0].ResourceConfig.GPUType }] }],
  images: { official: [], personal: [{ ImageId: dev.ImageId, ImageName: 'Dev image' }, { ImageId: train.Roles[0].ImageConfig.ImageId, ImageName: 'Train image' }] },
  imageRegistries: [], storageConfigs: [{ StorageConfigId: train.StorageConfigs[0].StorageConfigId, Name: 'Data' }], availableAddresses: [],
};

test('a completed image save preserves the newly opened dialog and its draft', async ({ page }) => {
  let pending;
  const { writes, errors } = await setup(page, {
    '/api/dev': route => route.fulfill({ json: { Notebooks: [
      { NotebookId: 'dev-1', Name: 'First', State: 'running' },
      { NotebookId: 'dev-2', Name: 'Second', State: 'running' },
    ], TotalCount: 2 } }),
    '/api/dev/save-image-options': route => route.fulfill({ json: { personalConfigured: true, personalNamespaces: [{ Namespace: 'images', Public: true }], officialInstances: [] } }),
    '/api/dev/save-image-repositories': route => route.fulfill({ json: [] }),
    '/api/dev/save-image': route => new Promise(resolve => {
      pending = async () => { await route.fulfill({ json: { result: { ImageId: 'old-image' } } }); resolve(); };
    }),
  });
  await page.locator('[data-save-dev-image][data-id="dev-1"]').click();
  await expect(page.locator('#save-image-options-status')).toHaveClass(/ready/);
  await page.locator('#save-image-namespace').selectOption('images');
  await page.locator('#save-image-repo').fill('first-repo');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#submit-save-image').click();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await page.locator('[data-close-modal="save-image-modal"]').first().click();
  await page.locator('[data-save-dev-image][data-id="dev-2"]').click();
  await expect(page.locator('#save-image-options-status')).toHaveClass(/ready/);
  await page.locator('#save-image-name').fill('second-draft');
  await pending();
  await expect(page.locator('#toast-stack')).toContainText('old-image');
  await expect(page.locator('#save-image-modal')).toBeVisible();
  await expect(page.locator('#save-image-dev-name')).toHaveText('Second');
  await expect(page.locator('#save-image-name')).toHaveValue('second-draft');
  await expect(page.locator('#submit-save-image')).toBeEnabled();
  expect(writes).toHaveLength(1);
  expect(writes[0].body.selector).toBe('dev-1');
  expect(writes[0].body.variables.ImageRepo).toBe('first-repo');
  expect(errors).toEqual([]);
});

for (const oldResult of ['success', 'failure']) test(`an old image save ${oldResult} does not unlock the current submission, which can be retried after failure`, async ({ page }) => {
  const pending = [];
  const { writes, errors } = await setup(page, {
    '/api/dev': route => route.fulfill({ json: { Notebooks: [
      { NotebookId: 'dev-1', Name: 'First', State: 'running' },
      { NotebookId: 'dev-2', Name: 'Second', State: 'running' },
    ], TotalCount: 2 } }),
    '/api/dev/save-image-options': route => route.fulfill({ json: { personalConfigured: true, personalNamespaces: [{ Namespace: 'images', Public: true }], officialInstances: [] } }),
    '/api/dev/save-image-repositories': route => route.fulfill({ json: [] }),
    '/api/dev/save-image': route => new Promise(resolve => {
      pending.push(async (response) => { await route.fulfill(response); resolve(); });
    }),
  });
  for (const id of ['dev-1', 'dev-2']) {
    await page.locator(`[data-save-dev-image][data-id="${id}"]`).click();
    await expect(page.locator('#save-image-options-status')).toHaveClass(/ready/);
    await expect(page.locator('#submit-save-image')).toBeEnabled();
    await page.locator('#save-image-namespace').selectOption('images');
    await page.locator('#save-image-repo').fill(`${id}-repo`);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#submit-save-image').click();
    await expect.poll(() => pending.length).toBe(id === 'dev-1' ? 1 : 2);
    if (id === 'dev-1') await page.locator('[data-close-modal="save-image-modal"]').first().click();
  }
  await pending[0](oldResult === 'success' ? { json: { result: { ImageId: 'old-result' } } } : { status: 400, json: { error: 'old-result failed' } });
  await expect(page.locator('#toast-stack')).toContainText('old-result');
  await expect(page.locator('#save-image-modal')).toBeVisible();
  await expect(page.locator('#save-image-dev-name')).toHaveText('Second');
  await expect(page.locator('#submit-save-image')).toBeDisabled();
  await pending[1]({ status: 400, json: { error: 'current-save failed' } });
  await expect(page.locator('#toast-stack')).toContainText('current-save failed');
  await expect(page.locator('#submit-save-image')).toBeEnabled();
  await expect(page.locator('#save-image-repo')).toHaveValue('dev-2-repo');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#submit-save-image').click();
  await expect.poll(() => pending.length).toBe(3);
  await pending[2]({ json: { result: { ImageId: 'new-result' } } });
  await expect(page.locator('#save-image-modal')).not.toBeVisible();
  expect(writes.map(item => item.body.selector)).toEqual(['dev-1', 'dev-2', 'dev-2']);
  expect(errors).toEqual([]);
});

test('a completed save-as does not change a reopened create dialog or its template selection', async ({ page }) => {
  let pending;
  await setup(page, { '/api/template': route => route.request().method() === 'POST'
    ? new Promise(resolve => { pending = async () => { await route.fulfill({ json: { saved: true } }); resolve(); }; })
    : route.fulfill({ json: templates.find(item => item.name === new URL(route.request().url()).searchParams.get('name')) }) });
  await page.locator('.nav-item[data-page="templates"]').click();
  await page.locator('[data-use-template="saved-dev"]').click();
  await expect(page.locator('#create-name')).toHaveValue('template-dev');
  page.once('dialog', dialog => dialog.accept('copy-dev'));
  await page.locator('#save-create-template').click();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await page.locator('[data-close-modal="create-modal"]').first().click();
  await page.locator('[data-use-template="saved-train"]').click();
  await expect(page.locator('#create-name')).toHaveValue('template-train');
  await pending();
  await expect(page.locator('#toast-stack')).toContainText('copy-dev');
  await expect(page.locator('#create-template')).toHaveValue('saved-train');
  await expect(page.locator('#create-name')).toHaveValue('template-train');
});

test('a completed editor save does not close or reset a newly opened template editor', async ({ page }) => {
  let pending;
  await setup(page, { '/api/template': route => route.request().method() === 'POST'
    ? new Promise(resolve => { pending = async () => { await route.fulfill({ json: { saved: true } }); resolve(); }; })
    : route.fulfill({ json: templates.find(item => item.name === new URL(route.request().url()).searchParams.get('name')) }) });
  await page.locator('.nav-item[data-page="templates"]').click();
  await page.locator('[data-edit-template="saved-dev"]').click();
  await expect(page.locator('#template-name')).toHaveValue('saved-dev');
  await page.locator('#save-template-button').click();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await page.locator('[data-close-modal="template-modal"]').first().click();
  await page.locator('#new-template-button').click();
  await page.locator('#template-name').fill('new-draft');
  await pending();
  await expect(page.locator('#toast-stack')).toContainText('saved-dev');
  await expect(page.locator('#template-modal')).toBeVisible();
  await expect(page.locator('#template-name')).toHaveValue('new-draft');
  await expect(page.locator('#save-template-button')).toBeEnabled();
});

test('changing the draft during submission keeps the confirmed payload and releases the same dialog', async ({ page }) => {
  let pending;
  const { writes } = await setup(page, { '/api/dev/create': route => new Promise(resolve => {
    pending = async () => { await route.fulfill({ json: { result: { id: 'created' } } }); resolve(); };
  }) });
  await page.locator('.nav-item[data-page="templates"]').click();
  await page.locator('[data-use-template="saved-dev"]').click();
  await expect(page.locator('#create-name')).toHaveValue('template-dev');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#submit-create').click();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await page.locator('#create-template').selectOption('');
  await expect(page.locator('#create-name')).toHaveValue('');
  await pending();
  await expect(page.locator('#create-modal')).not.toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0].body.variables.DisplayName).toBe('template-dev');
  await page.locator('[data-use-template="saved-dev"]').click();
  await expect(page.locator('#submit-create')).toBeEnabled();
});

test('leaving the template page invalidates a pending editor load', async ({ page }) => {
  let pending;
  await setup(page, { '/api/template': route => new Promise(resolve => { pending = async () => { await route.fulfill({ json: templates[0] }); resolve(); }; }) });
  await page.locator('.nav-item[data-page="templates"]').click();
  await page.locator('[data-edit-template="saved-dev"]').click();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await page.locator('.nav-item[data-page="dev"]').click();
  await pending();
  await expect(page.locator('#template-modal')).not.toBeVisible();
});

for (const kind of ['dev', 'train']) test(`${kind} buttons follow the shared policy for all states`, async ({ page }) => {
  const states = [...RESOURCE_STATES[kind].active, ...RESOURCE_STATES[kind].terminal, 'stopping', 'future-status'];
  const items = states.map(state => kind === 'dev'
    ? { NotebookId: state, Name: state, State: state }
    : { TrainJobId: state, TrainJobName: state, JobStatus: { Status: state } });
  await setup(page, { [`/api/${kind}`]: route => route.fulfill({ json: { [kind === 'dev' ? 'Notebooks' : 'TrainJobSet']: items, TotalCount: items.length } }) });
  await page.locator(`.nav-item[data-page="${kind}"]`).click();
  for (const state of states) for (const action of ['start', 'stop', 'delete']) {
    const allowed = resourceCapabilities(kind, state)[`can${action[0].toUpperCase()}${action.slice(1)}`];
    await expect(page.locator(`[data-${kind}-action="${action}"][data-id="${state}"]`)).toBeEnabled({ enabled: allowed });
  }
});

async function setup(page, overrides = {}, templateRecords = templates) {
  const writes = [], requests = [], errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push(url.pathname);
    if (request.method() === 'POST') writes.push({ path: url.pathname, body: request.postDataJSON() });
    if (overrides[url.pathname]) return overrides[url.pathname](route);
    let json;
    if (url.pathname === '/api/bootstrap') json = { token: 'test-token', config: { region: dev.Region }, session: { authenticated: true }, templates: templateRecords };
    else if (url.pathname === '/api/dev') json = { Notebooks: [], TotalCount: 0 };
    else if (url.pathname === '/api/train') json = { TrainJobSet: [{ TrainJobId: 'job-1', TrainJobName: 'test-job', JobStatus: { Status: 'running' }, Roles: [] }], TotalCount: 1 };
    else if (url.pathname === '/api/gpu') json = { pools: [], summary: { poolCount: 0, physicalFreeGpu: 0, totalGpu: 0, nodeCount: 0, gpuNodeCount: 0, meanGpuUtilization: null } };
    else if (url.pathname === '/api/templates') json = templateRecords;
    else if (url.pathname === '/api/template') json = templateRecords.find((entry) => entry.name === url.searchParams.get('name'));
    else if (url.pathname.endsWith('/create-options')) json = options;
    else if (url.pathname === '/api/dev/resource-info') json = {};
    else if (url.pathname === '/api/dev/nodes') json = [];
    else if (url.pathname.endsWith('/create')) json = { result: { id: 'created' } };
    else if (url.pathname === '/api/train/detail') json = { item: { TrainJobId: 'job-1', TrainJobName: 'test-job' }, detail: { Roles: [], StorageConfigs: [], EntryPointCommand: 'python train.py' }, monitor: { available: false, reason: 'fixture' } };
    else if (url.pathname === '/api/train/logs') json = { pods: [], logs: [] };
    else return route.fulfill({ status: 400, json: { error: `Unexpected mock route: ${url.pathname}` } });
    return route.fulfill({ json });
  });
  await page.goto('/');
  await expect(page.locator('#dev-count')).toContainText('共');
  return { writes, requests, errors };
}

test('all pages load real modules without browser errors', async ({ page }) => {
  const { errors } = await setup(page);
  for (const name of ['train', 'gpu', 'templates', 'settings', 'dev']) {
    await page.locator(`.nav-item[data-page="${name}"]`).click();
    await expect(page.locator(`#page-${name}`)).toHaveClass(/active/);
  }
  expect(errors).toEqual([]);
});

function creationTemplate(kind, name, cpu = 32) {
  const variables = structuredClone(kind === 'dev' ? dev : train);
  variables[kind === 'dev' ? 'DisplayName' : 'TrainJobName'] = name;
  if (kind === 'dev') variables.CpuNum = cpu;
  else variables.Roles[0].ResourceConfig.CPUNum = cpu;
  return { kind, name, variables };
}

async function useCreationTemplate(page, name) {
  await page.locator('.nav-item[data-page="templates"]').click();
  await page.locator(`[data-use-template="${name}"]`).click();
  await expect(page.locator('#submit-create')).toBeEnabled();
}

async function expectCreateBlocked(page, writes) {
  let confirmations = 0;
  const accept = async dialog => { confirmations++; await dialog.accept(); };
  page.on('dialog', accept);
  await page.locator('#submit-create').click();
  // The handler must also reject submissions that bypass native form validation.
  await page.locator('#create-form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(confirmations).toBe(0);
  expect(writes).toHaveLength(0);
  page.off('dialog', accept);
}

test('training defaults keep a third-party image when a template omits its resource pool', async ({ page }) => {
  const record = creationTemplate('train', 'third-party-defaults');
  record.variables.ResourcePoolId = '';
  record.variables.QueueName = '';
  record.variables.Roles[0].ImageConfig = { ImageSource: 'ThirdParty', ImageRegistryId: 'registry', ImageRepoId: 'repo', ImageTagId: 'tag' };
  const original = structuredClone(record.variables);
  const { writes, errors } = await setup(page, {
    '/api/train/create-options': route => route.fulfill({ json: { ...options, imageRegistries: [{ Id: 'registry', Name: 'Registry' }] } }),
    '/api/dev/image-repos': route => route.fulfill({ json: [{ RepoId: 'repo', RepoName: 'Repository' }] }),
    '/api/dev/image-tags': route => route.fulfill({ json: [{ TagId: 'tag', TagName: 'Version' }] }),
  }, [record]);
  await useCreationTemplate(page, record.name);
  await expect(page.locator('#train-resource-pool')).toHaveValue(options.resourcePools[0].ResourcePoolId);
  await expect(page.locator('#train-image-source')).toHaveValue('ThirdParty');
  await expect(page.locator('#train-image-tag')).toHaveValue('tag');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#submit-create').click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body.variables.Roles[0].ImageConfig).toEqual(original.Roles[0].ImageConfig);
  expect(record.variables).toEqual(original);
  expect(errors).toEqual([]);
});

for (const masterStartsWithGpu of [false, true]) {
  test(`training GPU workers preserve task type when the master ${masterStartsWithGpu ? 'switches to' : 'starts on'} CPU`, async ({ page }) => {
    const record = creationTemplate('train', 'gpu-workers');
    const worker = { ...structuredClone(record.variables.Roles[0]), RoleName: 'Worker' };
    record.variables.Roles.push(worker);
    record.variables.JobRunOnCPU = false;
    if (!masterStartsWithGpu) Object.assign(record.variables.Roles[0].ResourceConfig, { GPUType: '', GPUNumber: 0 });
    const { writes, errors } = await setup(page, {}, [record]);
    await useCreationTemplate(page, record.name);
    await expect(page.locator('#train-job-cpu')).not.toBeChecked();
    if (masterStartsWithGpu) await page.locator('#train-gpu-type').selectOption('');
    await page.locator('#create-name').fill('edited-gpu-workers');
    await expect(page.locator('#train-job-cpu')).not.toBeChecked();
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#submit-create').click();
    await expect.poll(() => writes.length).toBe(1);
    const submitted = writes[0].body.variables;
    expect(submitted.JobRunOnCPU).toBe(false);
    expect(submitted.Roles[0].ResourceConfig.GPUNumber).toBe(0);
    expect(submitted.Roles[1]).toEqual(worker);
    expect(errors).toEqual([]);
  });
}

test('personal autosave destination survives template loading, editing and submission', async ({ page }) => {
  const record = creationTemplate('dev', 'personal-autosave');
  record.variables.AutoSave = true;
  record.variables.AutoSaveConfig = { ImageType: 'Personal', Namespace: 'images', ImageRepo: 'snapshots', FutureOption: { keep: true } };
  const { writes, errors } = await setup(page, {}, [record]);
  await useCreationTemplate(page, record.name);
  await page.locator('#create-name').fill('edited-autosave');
  await page.locator('#dev-description').fill('updated description');
  expect(JSON.parse(await page.locator('#create-json').inputValue()).AutoSaveConfig).toEqual(record.variables.AutoSaveConfig);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#submit-create').click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body.variables.AutoSave).toBe(true);
  expect(writes[0].body.variables.AutoSaveConfig).toEqual(record.variables.AutoSaveConfig);
  expect(errors).toEqual([]);
});

for (const failedStage of ['initial', 'refresh']) {
  test(`public network configuration survives an ${failedStage} options failure and retry`, async ({ page }) => {
    const record = creationTemplate('dev', 'public-access');
    Object.assign(record.variables, { EnableSsh: true, SshPort: 22, EnablePublicNetworkSsh: true, AllocationId: 'eip' });
    record.variables.ServiceConfigs = [{ Service: 'web', Port: 8080, EnablePublicNetwork: true }];
    const publicOptions = { ...options,
      publicNetworkByPool: { [dev.ResourcePoolId]: true },
      availableAddresses: [{ AllocationId: 'eip', PublicIp: '192.0.2.1' }],
    };
    let fail = failedStage === 'initial';
    const { writes, errors } = await setup(page, {
      '/api/dev/create-options': route => fail
        ? route.fulfill({ status: 400, json: { error: 'public-network-query-failed' } })
        : route.fulfill({ json: publicOptions }),
    }, [record]);
    await page.locator('.nav-item[data-page="templates"]').click();
    await page.locator(`[data-use-template="${record.name}"]`).click();
    if (failedStage === 'refresh') {
      await expect(page.locator('#submit-create')).toBeEnabled();
      fail = true;
      await page.locator('#refresh-dev-options').click();
    }
    await expect(page.locator('#dev-options-status')).toContainText('public-network-query-failed');
    if (failedStage === 'initial') {
      await expect(page.locator('#submit-create')).toBeDisabled();
    } else {
      await expect(page.locator('#dev-public-ssh')).toBeChecked();
      await expect(page.locator('#dev-allocation-id')).toHaveValue('eip');
      await expect(page.locator('[data-service-public]')).toHaveValue('true');
      await page.locator('#create-name').fill('edited-public-access');
    }
    expect(writes).toHaveLength(0);
    fail = false;
    await page.locator('#refresh-dev-options').click();
    await expect(page.locator('#dev-options-status')).toHaveClass(/ready/);
    await expect(page.locator('#submit-create')).toBeEnabled();
    await expect(page.locator('#dev-public-ssh')).toBeChecked();
    await expect(page.locator('#dev-allocation-id')).toHaveValue('eip');
    await expect(page.locator('[data-service-public]')).toHaveValue('true');
    await expect(page.locator('#create-name')).toHaveValue(failedStage === 'refresh' ? 'edited-public-access' : record.name);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#submit-create').click();
    await expect.poll(() => writes.length).toBe(1);
    const submitted = writes[0].body.variables;
    expect(submitted.EnablePublicNetworkSsh).toBe(true);
    expect(submitted.AllocationId).toBe('eip');
    expect(submitted.ServiceConfigs).toEqual(record.variables.ServiceConfigs);
    expect(errors).toEqual([]);
  });
}

for (const allocation of ['', 'restored-eip']) {
  test(`developer refresh recovers a ${allocation ? 'temporarily unavailable' : 'missing'} EIP and preserves pending edits`, async ({ page }) => {
    const record = creationTemplate('dev', 'eip-refresh');
    Object.assign(record.variables, { EnableSsh: true, SshPort: 22, EnablePublicNetworkSsh: true, AllocationId: allocation });
    const publicOptions = { ...options, publicNetworkByPool: { [dev.ResourcePoolId]: true }, availableAddresses: [] };
    let pending, calls = 0;
    const { writes, errors } = await setup(page, {
      '/api/dev/create-options': route => {
        if (++calls === 2) { pending = route; return; }
        return route.fulfill({ json: publicOptions });
      },
    }, [record]);
    await useCreationTemplate(page, record.name);
    await expectCreateBlocked(page, writes);
    await page.locator('#refresh-dev-options').click();
    await expect.poll(() => Boolean(pending)).toBe(true);
    await page.locator('#create-name').fill('edited-public-draft');
    await page.locator('#dev-cpu').fill('24');
    await page.locator('#dev-description').fill('kept while refreshing');
    await pending.fulfill({ json: { ...publicOptions, availableAddresses: [{ AllocationId: 'restored-eip', PublicIp: '192.0.2.1' }] } });
    await expect(page.locator('#toast-stack')).toContainText('选项已刷新');
    await expect(page.locator('#dev-allocation-id option[value="restored-eip"]')).toHaveCount(1);
    await expect(page.locator('#dev-allocation-id')).toHaveValue(allocation);
    await expect(page.locator('#create-name')).toHaveValue('edited-public-draft');
    await expect(page.locator('#dev-cpu')).toHaveValue('24');
    if (!allocation) {
      await expectCreateBlocked(page, writes);
      await page.locator('#dev-allocation-id').selectOption('restored-eip');
    }
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#submit-create').click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].body.variables).toMatchObject({ DisplayName: 'edited-public-draft', CpuNum: 24, Description: 'kept while refreshing', EnablePublicNetworkSsh: true, AllocationId: 'restored-eip' });
    expect(errors).toEqual([]);
  });
}

test('developer refresh does not restore an EIP after the user explicitly clears it', async ({ page }) => {
  const record = creationTemplate('dev', 'clear-eip');
  Object.assign(record.variables, { EnableSsh: true, SshPort: 22, EnablePublicNetworkSsh: true, AllocationId: 'old-eip' });
  const addresses = [{ AllocationId: 'other-eip', PublicIp: '192.0.2.2' }];
  const { writes, errors } = await setup(page, {
    '/api/dev/create-options': route => route.fulfill({ json: { ...options, publicNetworkByPool: { [dev.ResourcePoolId]: true }, availableAddresses: addresses } }),
  }, [record]);
  await useCreationTemplate(page, record.name);
  await page.locator('#dev-allocation-id').selectOption('other-eip');
  await page.locator('#dev-allocation-id').selectOption('');
  addresses.push({ AllocationId: 'old-eip', PublicIp: '192.0.2.1' });
  await page.locator('#refresh-dev-options').click();
  await expect(page.locator('#toast-stack')).toContainText('选项已刷新');
  await expect(page.locator('#dev-allocation-id')).toHaveValue('');
  expect(JSON.parse(await page.locator('#create-json').inputValue()).AllocationId).toBe('');
  await expectCreateBlocked(page, writes);
  expect(errors).toEqual([]);
});

test('developer refresh can populate projects while the draft has no project', async ({ page }) => {
  const record = creationTemplate('dev', 'missing-project');
  record.variables.ProjectId = null;
  let projects = [];
  const { writes, errors } = await setup(page, {
    '/api/dev/create-options': route => route.fulfill({ json: { ...options, projects } }),
  }, [record]);
  await useCreationTemplate(page, record.name);
  await page.locator('#create-name').fill('edited-without-project');
  projects = options.projects;
  await page.locator('#refresh-dev-options').click();
  await expect(page.locator('#toast-stack')).toContainText('选项已刷新');
  await expect(page.locator('#dev-project option[value="0"]')).toHaveCount(1);
  await expect(page.locator('#dev-project')).toHaveValue('');
  expect(JSON.parse(await page.locator('#create-json').inputValue()).ProjectId).toBeNull();
  await expectCreateBlocked(page, writes);
  await page.locator('#dev-project').selectOption('0');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#submit-create').click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body.variables).toMatchObject({ DisplayName: 'edited-without-project', ProjectId: 0 });
  expect(errors).toEqual([]);
});

for (const kind of ['dev', 'train']) for (const recovery of ['refresh', 'select', 'remove']) {
  test(`${kind} retains an unavailable storage ID through edits until ${recovery}`, async ({ page }) => {
    const record = creationTemplate(kind, 'unavailable-storage');
    const mount = { StorageConfigId: 'missing-storage', MountPath: '/data', MountProtocol: 'NFS',
      ...(kind === 'dev' ? { StorageConfigType: 'Output' } : { MountType: 'Output', StorageSubPath: 'subset' }) };
    record.variables.StorageConfigs = [mount];
    let restored = false;
    const { writes, errors } = await setup(page, {
      [`/api/${kind}/create-options`]: route => route.fulfill({ json: { ...options, storageConfigs: [
        { StorageConfigId: 'replacement-storage', StorageConfigName: 'Replacement', Type: 'KPFS' },
        ...(restored ? [{ StorageConfigId: mount.StorageConfigId, StorageConfigName: 'Restored', Type: 'KPFS' }] : []),
      ] } }),
    }, [record]);
    await useCreationTemplate(page, record.name);
    const selector = page.locator(kind === 'dev' ? '[data-storage-id]' : '[data-train-storage-id]');
    await expect(selector).toHaveValue(mount.StorageConfigId);
    expect(await selector.evaluate(select => select.validity.customError)).toBe(true);
    await page.locator('#create-name').fill('edited-storage-draft');
    expect(JSON.parse(await page.locator('#create-json').inputValue()).StorageConfigs).toEqual([mount]);
    await expectCreateBlocked(page, writes);
    let expected = [mount];
    if (recovery === 'refresh') {
      restored = true;
      await page.locator(`#refresh-${kind}-options`).click();
      await expect(page.locator('#toast-stack')).toContainText('选项已刷新');
      await expect(selector).toHaveValue(mount.StorageConfigId);
      expect(await selector.evaluate(select => select.validity.customError)).toBe(false);
    } else if (recovery === 'select') {
      await selector.selectOption('replacement-storage');
      expect(await selector.evaluate(select => select.validity.customError)).toBe(false);
      expected = [{ ...mount, StorageConfigId: 'replacement-storage' }];
    } else {
      await page.locator(`#${kind}-storage-rows [data-remove-row]`).click();
      await expect(selector).toHaveCount(0);
      expected = [];
    }
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#submit-create').click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].body.variables.StorageConfigs).toEqual(expected);
    expect(writes[0].body.variables[kind === 'dev' ? 'DisplayName' : 'TrainJobName']).toBe('edited-storage-draft');
    expect(errors).toEqual([]);
  });
}

for (const kind of ['dev', 'train']) for (const recovery of ['select', 'refresh', 'cpu']) {
  test(`${kind} preserves an unavailable GPU until explicit ${recovery} recovery`, async ({ page }) => {
    const original = kind === 'dev' ? dev : train.Roles[0].ResourceConfig;
    let currentOptions = structuredClone(options);
    currentOptions.queues[0].GpuModels = [{ Model: 'replacement-gpu' }];
    const { writes, errors } = await setup(page, {
      [`/api/${kind}/create-options`]: route => route.fulfill({ json: currentOptions }),
    });
    await useCreationTemplate(page, `saved-${kind}`);
    const gpu = page.locator(`#${kind}-gpu-type`);
    await expect(gpu).toHaveValue(original.GPUType);
    await expect(gpu.locator('option:checked')).toContainText('当前不可用');
    await expect(page.locator(`#${kind}-gpu-number`)).toHaveValue(String(original.GPUNumber));
    await page.locator('#create-name').fill('unchanged-gpu-draft');
    const draft = JSON.parse(await page.locator('#create-json').inputValue());
    const draftResource = kind === 'dev' ? draft : draft.Roles[0].ResourceConfig;
    expect(draftResource.GPUType).toBe(original.GPUType);
    expect(draftResource.GPUNumber).toBe(original.GPUNumber);
    if (kind === 'train') expect(draft.JobRunOnCPU).toBe(false);
    await expectCreateBlocked(page, writes);
    if (recovery === 'refresh') {
      currentOptions = options;
      await page.locator(`#refresh-${kind}-options`).click();
      await expect(page.locator('#toast-stack')).toContainText('选项已刷新');
    } else {
      await gpu.selectOption(recovery === 'cpu' ? '' : 'replacement-gpu');
    }
    expect(await gpu.evaluate(select => select.validity.valid)).toBe(true);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#submit-create').click();
    await expect.poll(() => writes.length).toBe(1);
    const submitted = writes[0].body.variables;
    const resource = kind === 'dev' ? submitted : submitted.Roles[0].ResourceConfig;
    expect(resource.GPUType).toBe(recovery === 'cpu' ? '' : recovery === 'select' ? 'replacement-gpu' : original.GPUType);
    expect(resource.GPUNumber).toBe(recovery === 'cpu' ? 0 : original.GPUNumber);
    if (kind === 'train') expect(submitted.JobRunOnCPU).toBe(recovery === 'cpu');
    expect(errors).toEqual([]);
  });
}

for (const recovery of ['select', 'refresh']) test(`an unavailable project is preserved until ${recovery}`, async ({ page }) => {
  const record = creationTemplate('dev', 'missing-project');
  record.variables.ProjectId = 321;
  let currentOptions = structuredClone(options);
  const { writes, errors } = await setup(page, {
    '/api/dev/create-options': route => route.fulfill({ json: currentOptions }),
  }, [record]);
  await useCreationTemplate(page, record.name);
  const project = page.locator('#dev-project');
  await expect(project).toHaveValue('321');
  await expect(project.locator('option:checked')).toContainText('当前不可用');
  await page.locator('#create-name').fill('same-project-draft');
  expect(JSON.parse(await page.locator('#create-json').inputValue()).ProjectId).toBe(321);
  await expectCreateBlocked(page, writes);
  if (recovery === 'refresh') {
    currentOptions.projects.push({ ProjectId: 321, ProjectName: 'Restored project' });
    await page.locator('#refresh-dev-options').click();
    await expect(page.locator('#toast-stack')).toContainText('选项已刷新');
  } else await project.selectOption('0');
  expect(await project.evaluate(select => select.validity.valid)).toBe(true);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#submit-create').click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body.variables.ProjectId).toBe(recovery === 'refresh' ? 321 : 0);
  expect(errors).toEqual([]);
});

test('project defaults only fill a missing project and preserve an explicit zero', async ({ page }) => {
  const missing = creationTemplate('dev', 'without-project');
  delete missing.variables.ProjectId;
  const zero = creationTemplate('dev', 'project-zero');
  zero.variables.ProjectId = 0;
  await setup(page, {
    '/api/dev/create-options': route => route.fulfill({ json: { ...options, projects: [{ ProjectId: 44, ProjectName: 'First' }, ...options.projects] } }),
  }, [missing, zero]);
  await useCreationTemplate(page, missing.name);
  await expect(page.locator('#dev-project')).toHaveValue('44');
  expect(JSON.parse(await page.locator('#create-json').inputValue()).ProjectId).toBe(44);
  await page.locator('#create-template').selectOption(zero.name);
  await expect(page.locator('#dev-project')).toHaveValue('0');
  expect(JSON.parse(await page.locator('#create-json').inputValue()).ProjectId).toBe(0);
});

for (const failure of ['lookup-error', 'unavailable']) test(`a fixed node survives ${failure} and can recover on refresh`, async ({ page }) => {
  const record = creationTemplate('dev', 'fixed-node');
  record.variables.NodeAffinity.RequiredNodeIp = '10.0.0.42';
  let pending, attempts = 0;
  const { writes, errors } = await setup(page, {
    '/api/dev/nodes': route => {
      if (++attempts === 1) { pending = route; return; }
      return route.fulfill({ json: [{ InstanceIp: '10.0.0.42', InstanceName: 'Requested node' }] });
    },
  }, [record]);
  await useCreationTemplate(page, record.name);
  await expect.poll(() => Boolean(pending)).toBe(true);
  const node = page.locator('#dev-affinity-ip');
  await expect(node).toHaveValue('10.0.0.42');
  await expectCreateBlocked(page, writes);
  await pending.fulfill(failure === 'lookup-error' ? { status: 503, json: { error: 'temporary-lookup-failure' } } : { json: [] });
  await expect(page.locator('#dev-affinity-status')).toContainText(failure === 'lookup-error' ? 'temporary-lookup-failure' : '不满足当前规格');
  await expect(node).toHaveValue('10.0.0.42');
  await page.locator('#create-name').fill('keep-fixed-node');
  expect(JSON.parse(await page.locator('#create-json').inputValue()).NodeAffinity.RequiredNodeIp).toBe('10.0.0.42');
  await expectCreateBlocked(page, writes);
  await page.locator('#refresh-dev-options').click();
  await expect.poll(() => attempts).toBe(2);
  await expect.poll(() => node.evaluate(select => select.validity.valid)).toBe(true);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#submit-create').click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body.variables.NodeAffinity.RequiredNodeIp).toBe('10.0.0.42');
  expect(errors).toEqual([]);
});

for (const clearDuring of ['failure', 'pending']) test(`a user can explicitly clear a fixed node during ${clearDuring}`, async ({ page }) => {
  const record = creationTemplate('dev', 'fixed-node');
  record.variables.NodeAffinity.RequiredNodeIp = '10.0.0.42';
  let pending;
  const { writes, errors } = await setup(page, { '/api/dev/nodes': route => { pending = route; } }, [record]);
  await useCreationTemplate(page, record.name);
  await expect.poll(() => Boolean(pending)).toBe(true);
  if (clearDuring === 'failure') {
    await pending.fulfill({ status: 503, json: { error: 'lookup-failed' } });
    await expect(page.locator('#dev-affinity-status')).toContainText('lookup-failed');
  }
  await page.locator('#dev-affinity-ip').selectOption('');
  if (clearDuring === 'pending') {
    await pending.fulfill({ json: [{ InstanceIp: '10.0.0.42', InstanceName: 'Original node' }] });
    await expect(page.locator('#dev-affinity-status')).toContainText('1 个可用节点');
  }
  await expect(page.locator('#dev-affinity-ip')).toHaveValue('');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#submit-create').click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body.variables.NodeAffinity.RequiredNodeIp).toBeUndefined();
  expect(errors).toEqual([]);
});

test('changing training status starts a new request and ignores older results', async ({ page }) => {
  const pending = [];
  const { errors } = await setup(page, {
    '/api/train': route => { pending.push({ route, status: new URL(route.request().url()).searchParams.get('status') }); },
  });
  await page.locator('.nav-item[data-page="train"]').click();
  await expect.poll(() => pending.length).toBe(1);
  await page.locator('#train-status').selectOption('failed');
  await expect.poll(() => pending.length).toBe(2);
  await page.locator('#train-status').selectOption('stopped');
  await expect.poll(() => pending.length).toBe(3);
  expect(pending.map(item => item.status)).toEqual(['', 'failed', 'stopped']);
  const result = (status) => ({ json: { TrainJobSet: [{ TrainJobId: `job-${status}`, TrainJobName: `job-${status}`, JobStatus: { Status: status }, Roles: [] }], TotalCount: 1 } });
  await pending[2].route.fulfill(result('stopped'));
  await expect(page.locator('#train-table')).toContainText('job-stopped');
  const finished = page.waitForResponse(response => response.url().includes('/api/train?') && new URL(response.url()).searchParams.get('status') === 'failed');
  await pending[1].route.fulfill(result('failed'));
  await (await finished).finished();
  await pending[0].route.fulfill(result('running'));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator('#train-table')).toContainText('job-stopped');
  await expect(page.locator('#train-table')).not.toContainText('job-failed');
  await expect(page.locator('#train-table')).not.toContainText('job-running');
  await expect(page.locator('#train-status')).toHaveValue('stopped');
  expect(errors).toEqual([]);
});

for (const kind of ['dev', 'train']) {
  for (const failedStage of ['repos', 'tags']) for (const recovery of ['source', 'refresh']) {
    test(`${kind} can recover from failed image ${failedStage} by ${recovery} without losing the draft`, async ({ page }) => {
      const record = creationTemplate(kind, 'image-recovery');
      const originalImage = kind === 'dev' ? record.variables : record.variables.Roles[0].ImageConfig;
      Object.assign(originalImage, { ImageSource: kind === 'dev' ? 2 : 'ThirdParty', ImageRegistryId: 'registry', ImageRepoId: 'repo', ImageTagId: 'tag' });
      delete originalImage.ImageId;
      let failed = true;
      const { writes, errors } = await setup(page, {
        [`/api/${kind}/create-options`]: route => route.fulfill({ json: { ...options, imageRegistries: [{ Id: 'registry', Name: 'Registry' }] } }),
        '/api/dev/image-repos': route => route.fulfill(failed && failedStage === 'repos'
          ? { status: 503, json: { error: 'registry-outage' } }
          : { json: [{ RepoId: 'repo', RepoName: 'Repository' }] }),
        '/api/dev/image-tags': route => route.fulfill(failed && failedStage === 'tags'
          ? { status: 503, json: { error: 'registry-outage' } }
          : { json: [{ TagId: 'tag', TagName: 'Version' }] }),
      }, [record]);
      await useCreationTemplate(page, record.name);
      await expect(page.locator('#toast-stack')).toContainText('registry-outage');
      await expect(page.locator(`#${kind}-image-repo`)).toHaveValue('repo');
      await expect(page.locator(`#${kind}-image-tag`)).toHaveValue('tag');
      await expectCreateBlocked(page, writes);
      await page.locator('#create-name').fill('edited-after-outage');
      const draft = JSON.parse(await page.locator('#create-json').inputValue());
      const draftImage = kind === 'dev' ? draft : draft.Roles[0].ImageConfig;
      expect(draftImage.ImageRepoId).toBe('repo');
      expect(draftImage.ImageTagId).toBe('tag');
      if (recovery === 'source') {
        if (kind === 'dev') await page.locator('input[name="dev-image-source"][value="1"]').check();
        else await page.locator('#train-image-source').selectOption('Personal');
        await expect(page.locator(`#${kind}-third-image-fields`)).not.toBeVisible();
        await page.locator(`#${kind}-image-select`).selectOption(dev.ImageId);
      } else {
        failed = false;
        await page.locator(`#refresh-${kind}-options`).click();
        await expect(page.locator('#submit-create')).toBeEnabled();
        await expect(page.locator(`#${kind}-image-tag`)).toHaveValue('tag');
        await expect.poll(() => page.locator(`#${kind}-image-tag`).evaluate(select => select.checkValidity())).toBe(true);
      }
      page.once('dialog', dialog => dialog.accept());
      await page.locator('#submit-create').click();
      await expect.poll(() => writes.length).toBe(1);
      const payload = writes[0].body.variables;
      expect(payload[kind === 'dev' ? 'DisplayName' : 'TrainJobName']).toBe('edited-after-outage');
      const submittedImage = kind === 'dev' ? payload : payload.Roles[0].ImageConfig;
      if (recovery === 'source') {
        expect(submittedImage.ImageId).toBe(dev.ImageId);
        expect(submittedImage.ImageRegistryId).toBeUndefined();
        expect(submittedImage.ImageRepoId).toBeUndefined();
        expect(submittedImage.ImageTagId).toBeUndefined();
      } else {
        expect(submittedImage.ImageRepoId).toBe('repo');
        expect(submittedImage.ImageTagId).toBe('tag');
      }
      expect(errors).toEqual([]);
    });
  }

  test(`${kind} advanced JSON edits reach both the visible form and the create request`, async ({ page }) => {
    const { writes, errors } = await setup(page);
    await page.locator('.nav-item[data-page="templates"]').click();
    await page.locator(`[data-use-template="saved-${kind}"]`).click();
    await expect(page.locator('#submit-create')).toBeEnabled();
    const variables = JSON.parse(await page.locator('#create-json').inputValue());
    const nameKey = kind === 'dev' ? 'DisplayName' : 'TrainJobName';
    variables[nameKey] = 'edited-in-json';
    variables.FutureOption = { keep: true };
    if (kind === 'dev') {
      variables.CpuNum = 24;
      variables.Description = 'description from JSON';
    } else {
      variables.Roles[0].ResourceConfig.CPUNum = 24;
      variables.Roles[0].RunCommand = 'python updated.py --epochs 12';
    }
    await page.locator('#create-modal details.advanced summary').click();
    await page.locator('#create-json').fill(JSON.stringify(variables));
    await page.locator('#create-title').click();
    await expect(page.locator('#submit-create')).toBeEnabled();
    await expect(page.locator('#create-name')).toHaveValue('edited-in-json');
    await expect(page.locator(`#${kind}-cpu`)).toHaveValue('24');
    await expect(page.locator(kind === 'dev' ? '#dev-description' : '#train-command'))
      .toHaveValue(kind === 'dev' ? variables.Description : variables.Roles[0].RunCommand);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#submit-create').click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].path).toBe(`/api/${kind}/create`);
    const payload = writes[0].body.variables;
    expect(payload[nameKey]).toBe('edited-in-json');
    expect(kind === 'dev' ? payload.CpuNum : payload.Roles[0].ResourceConfig.CPUNum).toBe(24);
    expect(kind === 'dev' ? payload.Description : payload.Roles[0].RunCommand)
      .toBe(kind === 'dev' ? variables.Description : variables.Roles[0].RunCommand);
    expect(payload.FutureOption).toEqual({ keep: true });
    expect(errors).toEqual([]);
  });

  for (const failedSource of ['options', 'template']) {
    test(`${kind} option refresh recovers the original draft after an initial ${failedSource} failure`, async ({ page }) => {
      let attempts = 0;
      const path = failedSource === 'options' ? `/api/${kind}/create-options` : '/api/template';
      const { writes, errors } = await setup(page, {
        [path]: route => ++attempts === 1
          ? route.fulfill({ status: 503, json: { error: 'temporary-load-failure' } })
          : route.fulfill({ json: failedSource === 'options' ? options : templates.find(item => item.kind === kind) }),
      });
      await page.locator('.nav-item[data-page="templates"]').click();
      await page.locator(`[data-use-template="saved-${kind}"]`).click();
      await expect(page.locator('#create-validation')).toContainText('temporary-load-failure');
      await expect(page.locator('#submit-create')).toBeDisabled();
      await expect(page.locator('#save-create-template')).toBeDisabled();
      await page.locator(`#refresh-${kind}-options`).click();
      await expect(page.locator('#submit-create')).toBeEnabled();
      await expect(page.locator('#save-create-template')).toBeEnabled();
      await expect(page.locator('#create-name')).toHaveValue(`template-${kind}`);
      await expect(page.locator(`#${kind}-cpu`)).toHaveValue(String(kind === 'dev' ? dev.CpuNum : train.Roles[0].ResourceConfig.CPUNum));
      await expect(page.locator('#create-validation')).not.toContainText('失败');
      expect(writes).toHaveLength(0);
      page.once('dialog', dialog => dialog.accept());
      await page.locator('#submit-create').click();
      await expect.poll(() => writes.length).toBe(1);
      expect(writes[0].path).toBe(`/api/${kind}/create`);
      const payload = writes[0].body.variables;
      expect(payload[kind === 'dev' ? 'DisplayName' : 'TrainJobName']).toBe(`template-${kind}`);
      expect(kind === 'dev' ? payload.CpuNum : payload.Roles[0].ResourceConfig.CPUNum)
        .toBe(kind === 'dev' ? dev.CpuNum : train.Roles[0].ResourceConfig.CPUNum);
      expect(attempts).toBe(2);
      expect(errors).toEqual([]);
    });
  }

  test(`${kind} creation ignores invalid controls from the hidden resource form`, async ({ page }) => {
    const other = kind === 'dev' ? 'train' : 'dev';
    const { writes, errors } = await setup(page);
    await page.locator('.nav-item[data-page="templates"]').click();
    await page.locator(`[data-use-template="saved-${other}"]`).click();
    await expect(page.locator('#submit-create')).toBeEnabled();
    await page.locator(`#${other}-cpu`).fill('0');
    await page.locator('[data-close-modal="create-modal"]').first().click();
    await page.locator(`[data-use-template="saved-${kind}"]`).click();
    await expect(page.locator('#submit-create')).toBeEnabled();
    await expect(page.locator(`#${other}-cpu`)).toBeDisabled();
    expect(await page.locator('#create-form').evaluate(form => form.checkValidity())).toBe(true);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#submit-create').click();
    await expect(page.locator('#create-modal')).not.toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe(`/api/${kind}/create`);
    await page.locator(`[data-use-template="saved-${other}"]`).click();
    await expect(page.locator(`#${other}-cpu`)).toBeEnabled();
    expect(errors).toEqual([]);
  });

  for (const delayedStage of ['repositories', 'tags']) {
    test(`${kind} switching templates ignores stale image ${delayedStage}`, async ({ page }) => {
      const records = ['a', 'b'].map(suffix => {
        const record = creationTemplate(kind, `template-${suffix}`);
        const image = kind === 'dev' ? record.variables : record.variables.Roles[0].ImageConfig;
        delete image.ImageId;
        Object.assign(image, {
          ImageSource: kind === 'dev' ? 2 : 'ThirdParty', ImageRegistryId: 'registry',
          ImageRepoId: delayedStage === 'tags' ? 'repo-a' : `repo-${suffix}`, ImageTagId: `tag-${suffix}`,
        });
        return record;
      });
      const repos = [{ RepoId: 'repo-a', RepoName: 'A' }, { RepoId: 'repo-b', RepoName: 'B' }];
      const tags = [{ TagId: 'tag-a', TagName: 'A' }, { TagId: 'tag-b', TagName: 'B' }];
      const imageOptions = { ...options, imageRegistries: [{ Id: 'registry', Name: 'Registry' }] };
      let pending, repoCalls = 0, tagCalls = 0;
      const { writes, errors } = await setup(page, {
        [`/api/${kind}/create-options`]: route => route.fulfill({ json: imageOptions }),
        '/api/dev/image-repos': route => {
          if (++repoCalls === 1 && delayedStage === 'repositories') { pending = route; return; }
          return route.fulfill({ json: repos });
        },
        '/api/dev/image-tags': route => {
          if (++tagCalls === 1 && delayedStage === 'tags') { pending = route; return; }
          return route.fulfill({ json: tags });
        },
      }, records);
      await page.locator('.nav-item[data-page="templates"]').click();
      await page.locator('[data-use-template="template-a"]').click();
      await expect.poll(() => Boolean(pending)).toBe(true);
      await expect(page.locator('#submit-create')).toBeDisabled();
      await expect(page.locator('#save-create-template')).toBeDisabled();
      await page.locator('#create-template').selectOption('template-b');
      await expect(page.locator(`#${kind}-image-tag`)).toHaveValue('tag-b');
      await expect(page.locator('#submit-create')).toBeEnabled();
      await pending.fulfill({ json: delayedStage === 'repositories' ? repos : tags });
      // Drain the completed request and its rendering work before checking the draft.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expect(page.locator('#create-name')).toHaveValue('template-b');
      await expect(page.locator(`#${kind}-image-tag`)).toHaveValue('tag-b');
      page.once('dialog', dialog => dialog.accept());
      await page.locator('#submit-create').click();
      await expect.poll(() => writes.length).toBe(1);
      const payload = writes[0].body.variables;
      const image = kind === 'dev' ? payload : payload.Roles[0].ImageConfig;
      expect(image.ImageRepoId).toBe(delayedStage === 'tags' ? 'repo-a' : 'repo-b');
      expect(image.ImageTagId).toBe('tag-b');
      expect(errors).toEqual([]);
    });
  }

  test(`${kind} loading or failed template selection blocks writes and can recover`, async ({ page }) => {
    const next = creationTemplate(kind, 'next-template');
    const records = [...templates, next];
    let pending, attempts = 0, confirmations = 0;
    const { writes, errors } = await setup(page, {
      '/api/template': route => {
        const name = new URL(route.request().url()).searchParams.get('name');
        if (name === next.name && ++attempts === 1) { pending = route; return; }
        return route.fulfill({ json: records.find(item => item.name === name) });
      },
    }, records);
    page.on('dialog', async dialog => { confirmations++; await dialog.accept(); });
    await page.locator('.nav-item[data-page="templates"]').click();
    await page.locator(`[data-use-template="saved-${kind}"]`).click();
    await expect(page.locator('#submit-create')).toBeEnabled();
    await page.locator('#create-template').selectOption(next.name);
    await expect.poll(() => Boolean(pending)).toBe(true);
    await expect(page.locator('#submit-create')).toBeDisabled();
    await expect(page.locator('#save-create-template')).toBeDisabled();
    await page.locator('#create-form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(writes).toHaveLength(0);
    expect(confirmations).toBe(0);
    await pending.fulfill({ status: 400, json: { error: 'template-load-failed' } });
    await expect(page.locator('#create-validation')).toContainText('template-load-failed');
    await expect(page.locator('#submit-create')).toBeDisabled();
    await page.locator('#create-template').selectOption(`saved-${kind}`);
    await expect(page.locator('#submit-create')).toBeEnabled();
    await page.locator('#create-template').selectOption(next.name);
    await expect(page.locator('#submit-create')).toBeEnabled();
    await expect(page.locator(`#${kind}-cpu`)).toHaveValue('32');
    await page.locator('#submit-create').click();
    await expect.poll(() => writes.length).toBe(1);
    const payload = writes[0].body.variables;
    expect(payload[kind === 'dev' ? 'DisplayName' : 'TrainJobName']).toBe(next.name);
    expect(kind === 'dev' ? payload.CpuNum : payload.Roles[0].ResourceConfig.CPUNum).toBe(32);
    expect(errors).toEqual([]);
  });

  test(`${kind} option refresh preserves edits made while the request is pending`, async ({ page }) => {
    let pending, calls = 0;
    const { writes, errors } = await setup(page, {
      [`/api/${kind}/create-options`]: route => {
        if (++calls === 2) { pending = route; return; }
        return route.fulfill({ json: options });
      },
    });
    await page.locator('.nav-item[data-page="templates"]').click();
    await page.locator(`[data-use-template="saved-${kind}"]`).click();
    await expect(page.locator('#submit-create')).toBeEnabled();
    await page.locator(`#refresh-${kind}-options`).click();
    await expect.poll(() => Boolean(pending)).toBe(true);
    await page.locator(`#${kind}-cpu`).fill('32');
    await page.locator('#create-name').fill('latest-draft');
    const textField = kind === 'dev' ? '#dev-description' : '#train-command';
    await page.locator(textField).fill('latest text');
    await pending.fulfill({ json: options });
    await expect(page.locator('#toast-stack')).toContainText('选项已刷新');
    await expect(page.locator(`#${kind}-cpu`)).toHaveValue('32');
    await expect(page.locator('#create-name')).toHaveValue('latest-draft');
    await expect(page.locator(textField)).toHaveValue('latest text');
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#submit-create').click();
    await expect.poll(() => writes.length).toBe(1);
    const payload = writes[0].body.variables;
    expect(kind === 'dev' ? payload.CpuNum : payload.Roles[0].ResourceConfig.CPUNum).toBe(32);
    expect(kind === 'dev' ? payload.Description : payload.Roles[0].RunCommand).toBe('latest text');
    expect(errors).toEqual([]);
  });

  test(`${kind} option refresh cannot replace a different template in the same dialog`, async ({ page }) => {
    const next = creationTemplate(kind, 'next-template');
    let pending, calls = 0;
    const { errors } = await setup(page, {
      [`/api/${kind}/create-options`]: route => {
        if (++calls === 2) { pending = route; return; }
        return route.fulfill({ json: options });
      },
    }, [...templates, next]);
    await page.locator('.nav-item[data-page="templates"]').click();
    await page.locator(`[data-use-template="saved-${kind}"]`).click();
    await expect(page.locator('#submit-create')).toBeEnabled();
    await page.locator(`#refresh-${kind}-options`).click();
    await expect.poll(() => Boolean(pending)).toBe(true);
    await page.locator('#create-template').selectOption(next.name);
    await expect(page.locator('#submit-create')).toBeEnabled();
    await expect(page.locator(`#${kind}-options-status`)).toHaveClass(/ready/);
    await pending.fulfill({ json: options });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator('#create-name')).toHaveValue(next.name);
    await expect(page.locator(`#${kind}-cpu`)).toHaveValue('32');
    expect(errors).toEqual([]);
  });

  test(`${kind} a failed submission cannot unlock a still-loading replacement template`, async ({ page }) => {
    const next = creationTemplate(kind, 'replacement');
    let pendingWrite, pendingTemplate;
    const { writes, errors } = await setup(page, {
      [`/api/${kind}/create`]: route => {
        if (!pendingWrite) { pendingWrite = route; return; }
        return route.fulfill({ json: { result: { id: 'created' } } });
      },
      '/api/template': route => {
        const name = new URL(route.request().url()).searchParams.get('name');
        if (name === next.name) { pendingTemplate = route; return; }
        return route.fulfill({ json: templates.find(item => item.name === name) });
      },
    }, [...templates, next]);
    await page.locator('.nav-item[data-page="templates"]').click();
    await page.locator(`[data-use-template="saved-${kind}"]`).click();
    await expect(page.locator('#submit-create')).toBeEnabled();
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#submit-create').click();
    await expect.poll(() => Boolean(pendingWrite)).toBe(true);
    await page.locator('#create-template').selectOption(next.name);
    await expect.poll(() => Boolean(pendingTemplate)).toBe(true);
    await pendingWrite.fulfill({ status: 400, json: { error: 'submission-failed' } });
    await expect(page.locator('#toast-stack')).toContainText('submission-failed');
    await expect(page.locator('#submit-create')).toBeDisabled();
    await page.locator('#create-form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(writes).toHaveLength(1);
    await pendingTemplate.fulfill({ json: next });
    await expect(page.locator('#submit-create')).toBeEnabled();
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#submit-create').click();
    await expect(page.locator('#create-modal')).not.toBeVisible();
    expect(writes).toHaveLength(2);
    expect(writes[1].body.variables[kind === 'dev' ? 'DisplayName' : 'TrainJobName']).toBe(next.name);
    expect(errors).toEqual([]);
  });
}

for (const kind of ['dev', 'train']) {
  test(`${kind} template remains editable and cancellation does not write`, async ({ page }) => {
    const { writes, errors } = await setup(page);
    await page.locator(`.nav-item[data-page="templates"]`).click();
    await page.locator(`[data-use-template="saved-${kind}"]`).click();
    await expect(page.locator('#create-name')).toHaveValue(`template-${kind}`);
    await page.locator('#create-name').fill(`edited-${kind}`);
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.locator('#submit-create').click();
    expect(writes).toHaveLength(0);
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#submit-create').click();
    await expect(page.locator('#create-modal')).not.toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe(`/api/${kind}/create`);
    expect(writes[0].body.variables[kind === 'dev' ? 'DisplayName' : 'TrainJobName']).toBe(`edited-${kind}`);
    expect(errors).toEqual([]);
  });
}

test('closing a detail drawer stops log polling', async ({ page }) => {
  await page.clock.install();
  const { requests, errors } = await setup(page);
  await page.locator('.nav-item[data-page="train"]').click();
  await page.locator('[data-train-detail]').click();
  await expect(page.locator('#train-log-output')).toContainText('暂无');
  await expect.poll(() => requests.filter((item) => item === '/api/train/logs').length).toBe(1);
  await page.clock.fastForward(3100);
  await expect.poll(() => requests.filter((item) => item === '/api/train/logs').length).toBe(2);
  await page.locator('[data-close-modal="train-detail-modal"]').first().click();
  await page.clock.fastForward(10000);
  expect(requests.filter((item) => item === '/api/train/logs')).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('switching pages invalidates a pending resource refresh', async ({ page }) => {
  let delayed, count = 0;
  const { errors } = await setup(page, {
    '/api/dev': (route) => {
      if (++count === 2) { delayed = route; return; }
      return route.fulfill({ json: { Notebooks: [], TotalCount: count } });
    },
  });
  await page.locator('#refresh-button').click();
  await expect.poll(() => count).toBe(2);
  await page.locator('.nav-item[data-page="train"]').click();
  await page.locator('.nav-item[data-page="dev"]').click();
  await expect(page.locator('#dev-count')).toHaveText('共 3 台');
  await delayed.fulfill({ json: { Notebooks: [], TotalCount: 99 } });
  await expect(page.locator('#dev-count')).toHaveText('共 3 台');
  expect(errors).toEqual([]);
});

test('closing a drawer invalidates pending detail and prevents starting logs', async ({ page }) => {
  let pending;
  const { requests, errors } = await setup(page, {
    '/api/train/detail': (route) => { pending = route; },
  });
  await page.locator('.nav-item[data-page="train"]').click();
  await page.locator('[data-train-detail]').click();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await page.locator('[data-close-modal="train-detail-modal"]').first().click();
  await pending.fulfill({ json: { item: {}, detail: { EntryPointCommand: 'stale-command', Roles: [] }, monitor: { available: false } } });
  await expect(page.locator('#train-detail-content')).not.toContainText('stale-command');
  expect(requests).not.toContain('/api/train/logs');
  expect(errors).toEqual([]);
});

test('closing and reopening create ignores an old option response', async ({ page }) => {
  let first, count = 0;
  const { errors } = await setup(page, {
    '/api/dev/create-options': (route) => {
      if (++count === 1) { first = route; return; }
      return route.fulfill({ json: options });
    },
  });
  await page.locator('[data-open-create="dev"]').click();
  await expect.poll(() => count).toBe(1);
  await page.locator('[data-close-modal="create-modal"]').first().click();
  await page.locator('[data-open-create="dev"]').click();
  await expect(page.locator('#dev-options-status')).toContainText('已加载');
  await first.fulfill({ json: { ...options, projects: [{ ProjectId: 99, ProjectName: 'Stale project' }] } });
  await expect(page.locator('#dev-project')).not.toContainText('Stale project');
  expect(errors).toEqual([]);
});

test('logout choices send distinct flags and cancel does not write', async ({ page }) => {
  const { writes, errors } = await setup(page, {
    '/api/logout': route => route.fulfill({ json: { sessionCleared: true } }),
    '/api/session': route => route.fulfill({ json: { authenticated: false } }),
  });
  await page.locator('.nav-item[data-page="settings"]').click();
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#logout-button').click();
  expect(writes).toHaveLength(0);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#logout-button').click();
  await expect.poll(() => writes.length).toBe(1);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#forget-login-button').click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes.map(item => item.body.forget)).toEqual([false, true]);
  expect(errors).toEqual([]);
});

test('empty required fields do not prevent closing the create dialog', async ({ page }) => {
  const { writes, errors } = await setup(page);
  await page.locator('[data-open-create="dev"]').click();
  await expect(page.locator('#create-name')).toHaveValue('');
  await page.locator('[data-close-modal="create-modal"]').first().click();
  await expect(page.locator('#create-modal')).not.toBeVisible();
  expect(writes).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('disabled SSH fields stop blocking creation and retain validation when re-enabled', async ({ page }) => {
  const { writes, errors } = await setup(page);
  await page.locator('.nav-item[data-page="templates"]').click();
  await page.locator('[data-use-template="saved-dev"]').click();
  await expect(page.locator('#submit-create')).toBeEnabled();
  await page.locator('#dev-enable-ssh').check();
  await page.locator('#dev-ssh-port').fill('70000');
  await page.locator('#dev-enable-ssh').uncheck();
  await expect(page.locator('#dev-ssh-fields')).not.toBeVisible();
  await expect(page.locator('#dev-ssh-port')).toBeDisabled();
  expect(await page.locator('#create-form').evaluate(form => form.checkValidity())).toBe(true);
  await page.locator('#dev-enable-ssh').check();
  await expect(page.locator('#dev-ssh-port')).toBeEnabled();
  await expect(page.locator('#dev-ssh-port')).toHaveValue('70000');
  expect(await page.locator('#create-form').evaluate(form => form.checkValidity())).toBe(false);
  await expect(page.locator('#dev-public-ssh')).toBeDisabled();
  await page.locator('#dev-enable-ssh').uncheck();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#submit-create').click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].path).toBe('/api/dev/create');
  expect(writes[0].body.variables.EnableSsh).toBe(false);
  expect(writes[0].body.variables).not.toHaveProperty('SshPort');
  expect(writes[0].body.variables).not.toHaveProperty('EnablePublicNetworkSsh');
  expect(errors).toEqual([]);
});

for (const kind of ['dev', 'train']) {
  test(`${kind} advanced JSON and editable fields preserve extensions and save-as explicitly`, async ({ page }) => {
    const { writes, errors } = await setup(page, {
      '/api/template': route => route.request().method() === 'POST'
        ? route.fulfill({ json: { saved: true } })
        : route.fulfill({ json: templates.find(item => item.kind === kind) }),
    });
    await page.locator('.nav-item[data-page="templates"]').click();
    await page.locator(`[data-use-template="saved-${kind}"]`).click();
    await expect(page.locator('#create-name')).toHaveValue(`template-${kind}`);
    const variables = JSON.parse(await page.locator('#create-json').inputValue());
    variables.FutureOption = { keep: true };
    if (kind === 'train') variables.Roles.push({ RoleName: 'Worker', Replicas: 2, RunCommand: 'worker' });
    await page.locator('#create-modal details.advanced summary').click();
    await page.locator('#create-json').fill(JSON.stringify(variables));
    await page.locator('#create-name').click();
    await page.locator(`#${kind}-cpu`).fill('12');
    if (kind === 'dev') {
      await page.locator('[data-add-row="env"]').click();
      await page.locator('[data-env-name]').last().fill('EXTRA');
      await page.locator('[data-env-value]').last().fill('value');
    }
    expect(writes).toHaveLength(0);
    page.once('dialog', dialog => dialog.accept('copy'));
    await page.locator('#save-create-template').click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].path).toBe('/api/template');
    expect(writes[0].body.name).toBe('copy');
    const saved = writes[0].body.variables;
    expect(saved.FutureOption).toEqual({ keep: true });
    expect(kind === 'dev' ? saved.CpuNum : saved.Roles[0].ResourceConfig.CPUNum).toBe(12);
    if (kind === 'train') expect(saved.Roles[1]).toEqual(variables.Roles[1]);
    else expect(saved.Envs).toContainEqual({ Name: 'EXTRA', Value: 'value' });
    expect(errors).toEqual([]);
  });
}

test('resource actions follow the displayed state and cancel leaves cloud resources unchanged', async ({ page }) => {
  const { writes, errors } = await setup(page, {
    '/api/dev': route => route.fulfill({ json: { Notebooks: [
      { NotebookId: 'running', Name: 'running-dev', State: 'running', EnableSsh: true, EnablePublicNetworkSsh: true, ExternalIp: '203.0.113.8', SshPort: 2222 },
      { NotebookId: 'stopped', Name: 'stopped-dev', State: 'stopped' },
    ], TotalCount: 2 } }),
  });
  const running = page.locator('#dev-table tr').filter({ hasText: 'running-dev' });
  const stopped = page.locator('#dev-table tr').filter({ hasText: 'stopped-dev' });
  await expect(running.locator('[data-dev-action="start"]')).toBeDisabled();
  await expect(running.locator('[data-dev-action="stop"]')).toBeEnabled();
  await expect(running.locator('[data-dev-action="delete"]')).toBeDisabled();
  await expect(running.locator('[data-save-dev-image]')).toBeEnabled();
  await expect(running.locator('[data-copy-ssh]')).toHaveAttribute('data-external-ip', '203.0.113.8');
  await expect(stopped.locator('[data-dev-action="start"]')).toBeEnabled();
  await expect(stopped.locator('[data-dev-action="stop"]')).toBeDisabled();
  await expect(stopped.locator('[data-save-dev-image]')).toBeDisabled();
  page.once('dialog', dialog => dialog.dismiss());
  await stopped.locator('[data-dev-action="start"]').click();
  expect(writes).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('background refresh stops on settings and resumes on a resource page', async ({ page }) => {
  await page.clock.install();
  let loads = 0;
  const { requests, errors } = await setup(page, {
    '/api/dev': route => route.fulfill({ json: { Notebooks: [], TotalCount: ++loads } }),
  });
  const count = () => requests.filter(item => item === '/api/dev').length;
  await page.clock.fastForward(10100);
  await expect.poll(count).toBe(2);
  await page.locator('.nav-item[data-page="settings"]').click();
  await page.clock.fastForward(30100);
  expect(count()).toBe(2);
  await page.locator('.nav-item[data-page="dev"]').click();
  await expect(page.locator('#dev-count')).toHaveText('共 3 台');
  await page.clock.fastForward(10100);
  await expect.poll(count).toBe(4);
  expect(errors).toEqual([]);
});

test('completion of an earlier create does not close a newly opened dialog', async ({ page }) => {
  let pending;
  const { writes, errors } = await setup(page, { '/api/dev/create': route => { pending = route; } });
  await page.locator('.nav-item[data-page="templates"]').click();
  await page.locator('[data-use-template="saved-dev"]').click();
  await expect(page.locator('#create-name')).toHaveValue('template-dev');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#submit-create').click();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await page.locator('[data-close-modal="create-modal"]').first().click();
  await page.locator('[data-use-template="saved-train"]').click();
  await expect(page.locator('#create-name')).toHaveValue('template-train');
  await expect(page.locator('#submit-create')).toBeEnabled();
  await pending.fulfill({ json: { result: { id: 'created' } } });
  await expect(page.locator('#toast-stack')).toContainText('template-dev 创建请求已提交');
  await expect(page.locator('#create-modal')).toBeVisible();
  await expect(page.locator('#create-name')).toHaveValue('template-train');
  expect(writes).toHaveLength(1);
  expect(errors).toEqual([]);
});

for (const kind of ['dev', 'train']) {
  test(`${kind} a delayed option refresh cannot refill a reopened dialog`, async ({ page }) => {
    let pending, calls = 0;
    const { errors } = await setup(page, {
      [`/api/${kind}/create-options`]: route => {
        if (++calls === 2) { pending = route; return; }
        return route.fulfill({ json: options });
      },
    });
    await page.locator('.nav-item[data-page="templates"]').click();
    await page.locator(`[data-use-template="saved-${kind}"]`).click();
    await expect(page.locator('#create-name')).toHaveValue(`template-${kind}`);
    await page.locator(`#${kind}-cpu`).fill('12');
    await page.locator(`#refresh-${kind}-options`).click();
    await expect.poll(() => Boolean(pending)).toBe(true);
    await page.locator('[data-close-modal="create-modal"]').first().click();
    await page.locator(`[data-use-template="saved-${kind}"]`).click();
    const cpu = kind === 'dev' ? dev.CpuNum : train.Roles[0].ResourceConfig.CPUNum;
    await expect(page.locator(`#${kind}-cpu`)).toHaveValue(String(cpu));
    await pending.fulfill({ json: options });
    await expect(page.locator(`#${kind}-cpu`)).toHaveValue(String(cpu));
    expect(errors).toEqual([]);
  });
}
