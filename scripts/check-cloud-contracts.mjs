import { readFile, writeFile } from 'node:fs/promises';
import { BrowserSession } from '../lib/browser.mjs';
import { loadConfig } from '../lib/config.mjs';
import { exists } from '../lib/paths.mjs';
import { captureReadContracts, checkReadContract, READ_CONTRACTS } from '../lib/cloud/read-contracts.mjs';

const args = process.argv.slice(2);
const file = args.indexOf('--file'), record = args.indexOf('--record');
try {
  if (file !== -1) {
    if (!args[file + 1] || args[file + 1].startsWith('--')) throw new Error('--file 后必须提供响应样本路径');
    const fixture = JSON.parse(await readFile(args[file + 1], 'utf8'));
    for (const response of fixture.responses) checkReadContract(response.operation, response.data);
    if (new Set(fixture.responses.map(response => response.operation)).size !== Object.keys(READ_CONTRACTS).length) throw new Error('样本未覆盖全部只读契约');
    console.log(`已验证 ${fixture.responses.length} 个响应契约（${fixture.source}）`);
  } else if (args.includes('--live')) {
    if (record !== -1 && (!args[record + 1] || args[record + 1].startsWith('--'))) throw new Error('--record 后必须提供保存路径');
    const config = await loadConfig();
    const browser = new BrowserSession(config);
    if (!await exists(browser.paths.browserProfile)) throw new Error('请先运行 aicp login 并完成登录；在线契约检查需要已有的专用浏览器资料');
    // Reuse the private profile and normal browser lease; never initiate login recovery or change account state.
    browser.withAuthentication = callback => callback();
    browser.rememberIdentity = async () => {};
    browser.recoverLogin = async () => { throw new Error('会话已过期，请先完成登录，再重新运行契约检查'); };
    const fixture = await browser.withBrowser(() => captureReadContracts(browser, config.region));
    if (record !== -1) await writeFile(args[record + 1], JSON.stringify(fixture, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(`已验证 ${fixture.responses.length} 个真实只读云接口${record !== -1 ? '，并保存脱敏结构样本' : ''}`);
  } else {
    console.log('用法：npm run check:cloud -- --file <样本.json>\n      npm run check:cloud -- --live [--record <新文件.json>]\n在线模式只读取列表，不创建、修改或删除云资源，也不会自动登录。');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
