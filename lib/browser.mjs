// @ts-check
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

/**
 * @typedef {{now: () => number, sleep: (ms: number) => Promise<void>, connect: (url: string) => Promise<CdpConnection>, spawn: typeof spawn,
 * findEdge: typeof findEdge, ensureAppDirs: typeof ensureAppDirs, fetchJson: typeof fetchJson, fetchText: typeof fetchText,
 * withRecoveryLock: typeof withRecoveryLock, readSavedParentAccount: typeof readSavedParentAccount,
 * cleanupSingletons: typeof cleanupStaleEdgeSingletonLinks}} BrowserDependencies
 * @typedef {Partial<BrowserDependencies> & {paths?: ReturnType<typeof appPaths>, platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv}} BrowserOptions
 */
/** Stable integration facade. State belongs to the components, dependencies are named ports. */
export class BrowserSession {
  /** @param {import('./contracts.mjs').AppConfig} config @param {BrowserOptions} [options] */
  constructor(config, options = {}) {
    this.config = config;
    this.paths = options.paths ?? appPaths();
    this.dependencies = {
      now: Date.now, sleep: /** @param {number} ms */ ms => new Promise(resolve => setTimeout(() => resolve(undefined), ms)),
      connect: /** @param {string} url */ url => CdpConnection.connect(url), spawn, findEdge, ensureAppDirs,
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

  }

  get version() { return this.runtimeAdapter.version.bind(this.runtimeAdapter); }
  /** @param {typeof this.runtimeAdapter.version} value */
  set version(value) { this.runtimeAdapter.version = value; }
  get targets() { return this.runtimeAdapter.targets.bind(this.runtimeAdapter); }
  /** @param {typeof this.runtimeAdapter.targets} value */
  set targets(value) { this.runtimeAdapter.targets = value; }
  get createTarget() { return this.runtimeAdapter.createTarget.bind(this.runtimeAdapter); }
  /** @param {typeof this.runtimeAdapter.createTarget} value */
  set createTarget(value) { this.runtimeAdapter.createTarget = value; }
  get activateTarget() { return this.runtimeAdapter.activateTarget.bind(this.runtimeAdapter); }
  /** @param {typeof this.runtimeAdapter.activateTarget} value */
  set activateTarget(value) { this.runtimeAdapter.activateTarget = value; }
  get closeTarget() { return this.runtimeAdapter.closeTarget.bind(this.runtimeAdapter); }
  /** @param {typeof this.runtimeAdapter.closeTarget} value */
  set closeTarget(value) { this.runtimeAdapter.closeTarget = value; }
  get waitForVersion() { return this.runtimeAdapter.waitForVersion.bind(this.runtimeAdapter); }
  /** @param {typeof this.runtimeAdapter.waitForVersion} value */
  set waitForVersion(value) { this.runtimeAdapter.waitForVersion = value; }
  get waitForConsoleTarget() { return this.runtimeAdapter.waitForConsoleTarget.bind(this.runtimeAdapter); }
  /** @param {typeof this.runtimeAdapter.waitForConsoleTarget} value */
  set waitForConsoleTarget(value) { this.runtimeAdapter.waitForConsoleTarget = value; }
  get browserArgs() { return this.runtimeAdapter.browserArgs.bind(this.runtimeAdapter); }
  /** @param {typeof this.runtimeAdapter.browserArgs} value */
  set browserArgs(value) { this.runtimeAdapter.browserArgs = value; }
  get browserEnvironment() { return this.runtimeAdapter.browserEnvironment.bind(this.runtimeAdapter); }
  /** @param {typeof this.runtimeAdapter.browserEnvironment} value */
  set browserEnvironment(value) { this.runtimeAdapter.browserEnvironment = value; }
  get launchHeadless() { return this.runtimeAdapter.launchHeadless.bind(this.runtimeAdapter); }
  /** @param {typeof this.runtimeAdapter.launchHeadless} value */
  set launchHeadless(value) { this.runtimeAdapter.launchHeadless = value; }
  get withBrowser() { return this.runtimeAdapter.withBrowser.bind(this.runtimeAdapter); }
  /** @param {typeof this.runtimeAdapter.withBrowser} value */
  set withBrowser(value) { this.runtimeAdapter.withBrowser = value; }
  get evaluate() { return this.runtimeAdapter.evaluate.bind(this.runtimeAdapter); }
  /** @param {typeof this.runtimeAdapter.evaluate} value */
  set evaluate(value) { this.runtimeAdapter.evaluate = value; }
  get createPage() { return this.runtimeAdapter.createPage.bind(this.runtimeAdapter); }
  /** @param {typeof this.runtimeAdapter.createPage} value */
  set createPage(value) { this.runtimeAdapter.createPage = value; }
  get focusLoginField() { return this.runtimeAdapter.focusLoginField.bind(this.runtimeAdapter); }
  /** @param {typeof this.runtimeAdapter.focusLoginField} value */
  set focusLoginField(value) { this.runtimeAdapter.focusLoginField = value; }
  get closeActiveBrowser() { return this.runtimeAdapter.closeActiveBrowser.bind(this.runtimeAdapter); }
  /** @param {typeof this.runtimeAdapter.closeActiveBrowser} value */
  set closeActiveBrowser(value) { this.runtimeAdapter.closeActiveBrowser = value; }
  get waitForAicpTarget() { return this.authenticationAdapter.waitForAicpTarget.bind(this.authenticationAdapter); }
  /** @param {typeof this.authenticationAdapter.waitForAicpTarget} value */
  set waitForAicpTarget(value) { this.authenticationAdapter.waitForAicpTarget = value; }
  get launchLogin() { return this.authenticationAdapter.launchLogin.bind(this.authenticationAdapter); }
  /** @param {typeof this.authenticationAdapter.launchLogin} value */
  set launchLogin(value) { this.authenticationAdapter.launchLogin = value; }
  get fetchCurrentUser() { return this.authenticationAdapter.fetchCurrentUser.bind(this.authenticationAdapter); }
  /** @param {typeof this.authenticationAdapter.fetchCurrentUser} value */
  set fetchCurrentUser(value) { this.authenticationAdapter.fetchCurrentUser = value; }
  get currentUser() { return this.authenticationAdapter.currentUser.bind(this.authenticationAdapter); }
  /** @param {typeof this.authenticationAdapter.currentUser} value */
  set currentUser(value) { this.authenticationAdapter.currentUser = value; }
  get loginState() { return this.authenticationAdapter.loginState.bind(this.authenticationAdapter); }
  /** @param {typeof this.authenticationAdapter.loginState} value */
  set loginState(value) { this.authenticationAdapter.loginState = value; }
  get updateLoginState() { return this.authenticationAdapter.updateLoginState.bind(this.authenticationAdapter); }
  /** @param {typeof this.authenticationAdapter.updateLoginState} value */
  set updateLoginState(value) { this.authenticationAdapter.updateLoginState = value; }
  get rememberIdentity() { return this.authenticationAdapter.rememberIdentity.bind(this.authenticationAdapter); }
  /** @param {typeof this.authenticationAdapter.rememberIdentity} value */
  set rememberIdentity(value) { this.authenticationAdapter.rememberIdentity = value; }
  get enableAutoLogin() { return this.authenticationAdapter.enableAutoLogin.bind(this.authenticationAdapter); }
  /** @param {typeof this.authenticationAdapter.enableAutoLogin} value */
  set enableAutoLogin(value) { this.authenticationAdapter.enableAutoLogin = value; }
  get loginUrl() { return this.authenticationAdapter.loginUrl.bind(this.authenticationAdapter); }
  /** @param {typeof this.authenticationAdapter.loginUrl} value */
  set loginUrl(value) { this.authenticationAdapter.loginUrl = value; }
  get withAuthentication() { return this.authenticationAdapter.withAuthentication.bind(this.authenticationAdapter); }
  /** @param {typeof this.authenticationAdapter.withAuthentication} value */
  set withAuthentication(value) { this.authenticationAdapter.withAuthentication = value; }
  get recoverLogin() { return this.authenticationAdapter.recoverLogin.bind(this.authenticationAdapter); }
  /** @param {typeof this.authenticationAdapter.recoverLogin} value */
  set recoverLogin(value) { this.authenticationAdapter.recoverLogin = value; }
  get withLoginLock() { return this.authenticationAdapter.withLoginLock.bind(this.authenticationAdapter); }
  /** @param {typeof this.authenticationAdapter.withLoginLock} value */
  set withLoginLock(value) { this.authenticationAdapter.withLoginLock = value; }
  get recoveryProgress() { return this.authenticationAdapter.recoveryProgress.bind(this.authenticationAdapter); }
  /** @param {typeof this.authenticationAdapter.recoveryProgress} value */
  set recoveryProgress(value) { this.authenticationAdapter.recoveryProgress = value; }
  get verifyRecoveredIdentity() { return this.authenticationAdapter.verifyRecoveredIdentity.bind(this.authenticationAdapter); }
  /** @param {typeof this.authenticationAdapter.verifyRecoveredIdentity} value */
  set verifyRecoveredIdentity(value) { this.authenticationAdapter.verifyRecoveredIdentity = value; }
  get performLoginRecovery() { return this.authenticationAdapter.performLoginRecovery.bind(this.authenticationAdapter); }
  /** @param {typeof this.authenticationAdapter.performLoginRecovery} value */
  set performLoginRecovery(value) { this.authenticationAdapter.performLoginRecovery = value; }
  get autoLogin() { return this.authenticationAdapter.autoLogin.bind(this.authenticationAdapter); }
  /** @param {typeof this.authenticationAdapter.autoLogin} value */
  set autoLogin(value) { this.authenticationAdapter.autoLogin = value; }
  get status() { return this.authenticationAdapter.status.bind(this.authenticationAdapter); }
  /** @param {typeof this.authenticationAdapter.status} value */
  set status(value) { this.authenticationAdapter.status = value; }
  get clearSession() { return this.authenticationAdapter.clearSession.bind(this.authenticationAdapter); }
  /** @param {typeof this.authenticationAdapter.clearSession} value */
  set clearSession(value) { this.authenticationAdapter.clearSession = value; }
  get forgetLogin() { return this.authenticationAdapter.forgetLogin.bind(this.authenticationAdapter); }
  /** @param {typeof this.authenticationAdapter.forgetLogin} value */
  set forgetLogin(value) { this.authenticationAdapter.forgetLogin = value; }
  get logout() { return this.authenticationAdapter.logout.bind(this.authenticationAdapter); }
  /** @param {typeof this.authenticationAdapter.logout} value */
  set logout(value) { this.authenticationAdapter.logout = value; }
  get graphql() { return this.graphqlAdapter.graphql.bind(this.graphqlAdapter); }
  /** @param {typeof this.graphqlAdapter.graphql} value */
  set graphql(value) { this.graphqlAdapter.graphql = value; }
  get graphqlResponse() { return this.graphqlAdapter.graphqlResponse.bind(this.graphqlAdapter); }
  /** @param {typeof this.graphqlAdapter.graphqlResponse} value */
  set graphqlResponse(value) { this.graphqlAdapter.graphqlResponse = value; }
  get grafanaGpuMetrics() { return this.monitorAdapter.grafanaGpuMetrics.bind(this.monitorAdapter); }
  /** @param {typeof this.monitorAdapter.grafanaGpuMetrics} value */
  set grafanaGpuMetrics(value) { this.monitorAdapter.grafanaGpuMetrics = value; }
  get baseUrl() { return this.runtimeAdapter.baseUrl; }
  /** @param {typeof this.runtimeAdapter.baseUrl} value */
  set baseUrl(value) { this.runtimeAdapter.baseUrl = value; }
  get browserUsers() { return this.runtimeAdapter.browserUsers; }
  /** @param {typeof this.runtimeAdapter.browserUsers} value */
  set browserUsers(value) { this.runtimeAdapter.browserUsers = value; }
  get browserStart() { return this.runtimeAdapter.browserStart; }
  /** @param {typeof this.runtimeAdapter.browserStart} value */
  set browserStart(value) { this.runtimeAdapter.browserStart = value; }
  get browserClose() { return this.runtimeAdapter.browserClose; }
  /** @param {typeof this.runtimeAdapter.browserClose} value */
  set browserClose(value) { this.runtimeAdapter.browserClose = value; }
  get authStatePath() { return this.authenticationAdapter.authStatePath; }
  /** @param {typeof this.authenticationAdapter.authStatePath} value */
  set authStatePath(value) { this.authenticationAdapter.authStatePath = value; }
  get authGeneration() { return this.authenticationAdapter.authGeneration; }
  /** @param {typeof this.authenticationAdapter.authGeneration} value */
  set authGeneration(value) { this.authenticationAdapter.authGeneration = value; }
  get loginRecovery() { return this.authenticationAdapter.loginRecovery; }
  /** @param {typeof this.authenticationAdapter.loginRecovery} value */
  set loginRecovery(value) { this.authenticationAdapter.loginRecovery = value; }
}
