import { spawn } from 'node:child_process';
import { appPaths, ensureAppDirs } from './paths.mjs';
import { withRecoveryLock } from './recovery-lock.mjs';
import { readSavedParentAccount } from './saved-info.mjs';
import { CdpConnection } from './browser/cdp.mjs';
import { findEdge, fetchJson, fetchText, cleanupStaleEdgeSingletonLinks } from './browser/environment.mjs';
export { findEdge, cleanupStaleEdgeSingletonLinks, openExternalUrl } from './browser/environment.mjs';
import { BrowserRuntime } from './browser/runtime.mjs';
import { SessionAuthentication } from './browser/authentication.mjs';
import { GraphqlTransport } from './browser/graphql.mjs';
import { GpuMonitor } from './browser/monitor.mjs';

import { methodPort } from './ports.mjs';

/** Stable integration facade. State belongs to the components, dependencies are named ports. */
export class BrowserSession {
  constructor(config, options = {}) {
    this.config = config;
    this.paths = options.paths ?? appPaths();
    this.dependencies = {
      now: Date.now, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
      connect: url => CdpConnection.connect(url), spawn, findEdge, ensureAppDirs,
      fetchJson, fetchText, withRecoveryLock, readSavedParentAccount, cleanupSingletons: cleanupStaleEdgeSingletonLinks, ...options,
    };
    this.runtimeAdapter = new BrowserRuntime({ config, paths: this.paths, platform: options.platform, env: options.env, dependencies: methodPort(this.dependencies, [
      'now', 'sleep', 'connect', 'spawn', 'findEdge', 'ensureAppDirs', 'fetchJson', 'fetchText', 'cleanupSingletons',
    ]) });
    this.authenticationAdapter = new SessionAuthentication({ config, paths: this.paths,
      dependencies: methodPort(this.dependencies, ['now', 'sleep', 'connect', 'withRecoveryLock', 'readSavedParentAccount']),
      runtime: methodPort(this.runtimeAdapter, ['withBrowser', 'waitForConsoleTarget', 'evaluate', 'closeActiveBrowser', 'createPage', 'focusLoginField', 'targets', 'version', 'startInteractive']),
    });
    this.graphqlAdapter = new GraphqlTransport({ config,
      runtime: methodPort(this.runtimeAdapter, ['withBrowser', 'evaluate']),
      authentication: Object.freeze({
        ...methodPort(this.authenticationAdapter, ['withAuthentication', 'waitForAicpTarget', 'rememberIdentity', 'fetchCurrentUser', 'recoverLogin']),
        generation: () => this.authenticationAdapter.authGeneration,
      }),
    });
    this.monitorAdapter = new GpuMonitor({
      runtime: methodPort(this.runtimeAdapter, ['withBrowser', 'createTarget', 'activateTarget', 'targets', 'evaluate', 'closeTarget']),
      waitForAicpTarget: () => this.authenticationAdapter.waitForAicpTarget(),
      clock: methodPort(this.dependencies, ['now', 'sleep']),
    });
    exposeMethods(this, this.runtimeAdapter, ["version","targets","createTarget","activateTarget","closeTarget","waitForVersion","waitForConsoleTarget","browserArgs","browserEnvironment","launchHeadless","withBrowser","evaluate","createPage","focusLoginField","closeActiveBrowser"]);
    exposeMethods(this, this.authenticationAdapter, ["waitForAicpTarget","launchLogin","fetchCurrentUser","currentUser","loginState","updateLoginState","rememberIdentity","enableAutoLogin","loginUrl","withAuthentication","recoverLogin","withLoginLock","recoveryProgress","verifyRecoveredIdentity","performLoginRecovery","autoLogin","status","clearSession","forgetLogin","logout"]);
    exposeMethods(this, this.graphqlAdapter, ["graphql","graphqlResponse"]);
    exposeMethods(this, this.monitorAdapter, ["grafanaGpuMetrics"]);
    exposeState(this, this.runtimeAdapter, ['baseUrl', 'browserUsers', 'browserStart', 'browserClose']);
    exposeState(this, this.authenticationAdapter, ['authStatePath', 'authGeneration', 'loginRecovery']);
  }
}

// Legacy integrations can still override facade methods without sharing the facade with components.
function exposeMethods(facade, owner, names) {
  for (const name of names) Object.defineProperty(facade, name, {
    configurable: true,
    get: () => owner[name].bind(owner),
    set: value => { owner[name] = value; },
  });
}

function exposeState(facade, owner, names) {
  for (const name of names) Object.defineProperty(facade, name, {
    configurable: true,
    get: () => owner[name],
    set: value => { owner[name] = value; },
  });
}
