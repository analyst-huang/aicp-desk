import { spawn } from 'node:child_process';
import path from 'node:path';
import { appPaths, ensureAppDirs } from './paths.mjs';
import { withRecoveryLock } from './recovery-lock.mjs';
import { readSavedParentAccount } from './saved-info.mjs';
import { CdpConnection } from './browser/cdp.mjs';
import { findEdge, fetchJson, fetchText } from './browser/environment.mjs';
export { findEdge, cleanupStaleEdgeSingletonLinks, openExternalUrl } from './browser/environment.mjs';
import { BrowserRuntime } from './browser/runtime.mjs';
import { SessionAuthentication } from './browser/authentication.mjs';
import { GraphqlTransport } from './browser/graphql.mjs';
import { GpuMonitor } from './browser/monitor.mjs';

/** Stable session facade and composition root for browser infrastructure.
 * @param {object} config
 * @param {object} options Injectable paths, clock, CDP, process and I/O dependencies.
 */
export class BrowserSession {
  constructor(config, options = {}) {
    this.config = config;
    this.paths = options.paths ?? appPaths();
    this.baseUrl = `http://127.0.0.1:${config.debugPort}`;
    this.browserUsers = 0;
    this.browserStart = null;
    this.browserClose = null;
    this.loginRecovery = null;
    this.authGeneration = 0;
    this.authStatePath = path.join(this.paths.home, 'login-state.json');
    this.dependencies = {
      now: Date.now, sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
      connect: (url) => CdpConnection.connect(url), spawn, findEdge, ensureAppDirs,
      fetchJson, fetchText, withRecoveryLock, readSavedParentAccount, ...options,
    };
    this.runtimeAdapter = new BrowserRuntime(this);
    this.authenticationAdapter = new SessionAuthentication(this);
    this.graphqlAdapter = new GraphqlTransport(this);
    this.monitorAdapter = new GpuMonitor(this);
  }

  version(...args) { return this.runtimeAdapter.version(...args); }
  targets(...args) { return this.runtimeAdapter.targets(...args); }
  createTarget(...args) { return this.runtimeAdapter.createTarget(...args); }
  activateTarget(...args) { return this.runtimeAdapter.activateTarget(...args); }
  closeTarget(...args) { return this.runtimeAdapter.closeTarget(...args); }
  waitForVersion(...args) { return this.runtimeAdapter.waitForVersion(...args); }
  waitForAicpTarget(...args) { return this.runtimeAdapter.waitForAicpTarget(...args); }
  waitForConsoleTarget(...args) { return this.runtimeAdapter.waitForConsoleTarget(...args); }
  browserArgs(...args) { return this.runtimeAdapter.browserArgs(...args); }
  browserEnvironment(...args) { return this.runtimeAdapter.browserEnvironment(...args); }
  launchLogin(...args) { return this.runtimeAdapter.launchLogin(...args); }
  launchHeadless(...args) { return this.runtimeAdapter.launchHeadless(...args); }
  withBrowser(...args) { return this.runtimeAdapter.withBrowser(...args); }
  evaluate(...args) { return this.runtimeAdapter.evaluate(...args); }
  createPage(...args) { return this.runtimeAdapter.createPage(...args); }
  focusLoginField(...args) { return this.runtimeAdapter.focusLoginField(...args); }
  closeActiveBrowser(...args) { return this.runtimeAdapter.closeActiveBrowser(...args); }
  fetchCurrentUser(...args) { return this.authenticationAdapter.fetchCurrentUser(...args); }
  currentUser(...args) { return this.authenticationAdapter.currentUser(...args); }
  loginState(...args) { return this.authenticationAdapter.loginState(...args); }
  updateLoginState(...args) { return this.authenticationAdapter.updateLoginState(...args); }
  rememberIdentity(...args) { return this.authenticationAdapter.rememberIdentity(...args); }
  enableAutoLogin(...args) { return this.authenticationAdapter.enableAutoLogin(...args); }
  loginUrl(...args) { return this.authenticationAdapter.loginUrl(...args); }
  withAuthentication(...args) { return this.authenticationAdapter.withAuthentication(...args); }
  recoverLogin(...args) { return this.authenticationAdapter.recoverLogin(...args); }
  withLoginLock(...args) { return this.authenticationAdapter.withLoginLock(...args); }
  recoveryProgress(...args) { return this.authenticationAdapter.recoveryProgress(...args); }
  verifyRecoveredIdentity(...args) { return this.authenticationAdapter.verifyRecoveredIdentity(...args); }
  performLoginRecovery(...args) { return this.authenticationAdapter.performLoginRecovery(...args); }
  autoLogin(...args) { return this.authenticationAdapter.autoLogin(...args); }
  status(...args) { return this.authenticationAdapter.status(...args); }
  clearSession(...args) { return this.authenticationAdapter.clearSession(...args); }
  forgetLogin(...args) { return this.authenticationAdapter.forgetLogin(...args); }
  logout(...args) { return this.authenticationAdapter.logout(...args); }
  graphql(...args) { return this.graphqlAdapter.graphql(...args); }
  graphqlResponse(...args) { return this.graphqlAdapter.graphqlResponse(...args); }
  grafanaGpuMetrics(...args) { return this.monitorAdapter.grafanaGpuMetrics(...args); }
}
