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
