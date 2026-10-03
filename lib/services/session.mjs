/** Session use cases shared by both entry points. */
export class SessionService {
  constructor(browser, config, remoteUi = () => import("../remote-ui.mjs")) {
    Object.assign(this, { browser, config, remoteUi });
  }
  status(options) { return this.browser.status(options); }
  login(options) { return this.browser.launchLogin(options); }
  autoLogin() { return this.browser.autoLogin(); }
  logout(options) { return this.browser.logout(options); }
  withBrowser(callback) { return this.browser.withBrowser(callback); }

  async loginRemote(options) {
    const { normalizeRemoteUiOptions, remoteUiStatus, startRemoteUi, stopRemoteUi } = await this.remoteUi();
    const existing = await remoteUiStatus();
    const desired = normalizeRemoteUiOptions(options);
    const canReuse = (existing.running || existing.accessStopped)
      && ["display", "vncPort", "webPort"].every((key) => existing[key] === desired[key]);
    if (!canReuse) await this.browser.closeActiveBrowser();
    const remoteUi = await startRemoteUi(this.config, options);
    try {
      const browser = await this.login({ display: remoteUi.display, passwordStore: "basic" });
      return { remoteUi, browser };
    } catch (error) {
      if (!remoteUi.alreadyRunning) await stopRemoteUi();
      throw error;
    }
  }

  async remoteStatus() { return (await this.remoteUi()).remoteUiStatus(); }
  async remoteDoctor(options) { return (await this.remoteUi()).remoteUiDoctor(this.config, options); }
  async remoteInstall(options) { return (await this.remoteUi()).installRemoteUiRuntime(options); }
  async remoteStop(all) {
    const remote = await this.remoteUi();
    if (!all) return remote.suspendRemoteUi();
    const browserClosed = await this.browser.closeActiveBrowser();
    return { browserClosed, ...(await remote.stopRemoteUi()), sessionKept: false };
  }
}
