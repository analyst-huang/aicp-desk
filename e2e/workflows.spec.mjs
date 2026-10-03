import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

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

async function setup(page, overrides = {}) {
  const writes = [], requests = [], errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push(url.pathname);
    if (request.method() === 'POST') writes.push({ path: url.pathname, body: request.postDataJSON() });
    if (overrides[url.pathname]) return overrides[url.pathname](route);
    let json;
    if (url.pathname === '/api/bootstrap') json = { token: 'test-token', config: { region: dev.Region }, session: { authenticated: true }, templates };
    else if (url.pathname === '/api/dev') json = { Notebooks: [], TotalCount: 0 };
    else if (url.pathname === '/api/train') json = { TrainJobSet: [{ TrainJobId: 'job-1', TrainJobName: 'test-job', JobStatus: { Status: 'running' }, Roles: [] }], TotalCount: 1 };
    else if (url.pathname === '/api/gpu') json = { pools: [], summary: { poolCount: 0, physicalFreeGpu: 0, totalGpu: 0, nodeCount: 0, gpuNodeCount: 0, meanGpuUtilization: null } };
    else if (url.pathname === '/api/templates') json = templates;
    else if (url.pathname === '/api/template') json = templates.find((entry) => entry.name === url.searchParams.get('name'));
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
