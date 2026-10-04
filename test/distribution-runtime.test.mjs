import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('CLI runs through a linked application directory', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aicp-linked-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL('../', import.meta.url));
  await symlink(root, path.join(directory, 'app'), process.platform === 'win32' ? 'junction' : 'dir');
  const { stdout } = await promisify(execFile)(process.execPath, [path.join('app', 'bin', 'aicp.mjs'), '--help'], {
    cwd: directory,
    env: { ...process.env, AICP_HOME: path.join(directory, 'state') },
    windowsHide: true,
  });
  assert.match(stdout, /AICP 本地控制工具/);
});

test('distributed application runs CLI and serves modules without node_modules', { timeout: 15000 }, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aicp-distribution-'));
  const app = path.join(directory, 'app');
  await mkdir(app);
  const root = fileURLToPath(new URL('../', import.meta.url));
  for (const name of ['bin', 'lib', 'web', 'package.json']) await cp(path.join(root, name), path.join(app, name), { recursive: true });
  const env = { ...process.env, AICP_HOME: path.join(directory, 'state') };
  const entry = path.join(app, 'bin', 'aicp.mjs');
  let child;
  t.after(async () => {
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  });
  const { stdout } = await promisify(execFile)(process.execPath, [entry, '--help'], { cwd: app, env, windowsHide: true });
  assert.match(stdout, /AICP 本地控制工具/);
  child = spawn(process.execPath, [entry, 'gui', '--no-open', '--port', '0'], { cwd: app, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    let output = '', error = '';
    child.stdout.on('data', (data) => {
      output += data;
      const match = /http:\/\/127\.0\.0\.1:\d+/.exec(output);
      if (match) resolve(match[0]);
    });
    child.stderr.on('data', (data) => { error += data; });
    child.once('error', reject);
    child.once('exit', () => reject(new Error(error || 'GUI exited before listening')));
  });
  for (const asset of ['/', '/app.js', '/application.js', '/features/devForm.js', '/core/repeaters.js', '/core/request.js', '/models/dev-form.js', '/models/train-form.js', '/core/request-scope.js', '/shared/resource-policy.js']) {
    assert.equal((await fetch(url + asset)).status, 200);
  }
});

test('GUI startup releases its listening port when opening the browser fails', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aicp-gui-startup-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const script = `
    import { startGui } from ${JSON.stringify(new URL('../lib/gui-server.mjs', import.meta.url).href)};
    try {
      await startGui({ config: { guiPort: 0, edgePath: ${JSON.stringify(directory)} } });
    } catch (error) {
      console.log('handled browser startup error');
    }
  `;
  // A leaked server prevents this isolated process from exiting and triggers the timeout.
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { timeout: 5000, windowsHide: true });
  assert.match(stdout, /handled browser startup error/);
});
