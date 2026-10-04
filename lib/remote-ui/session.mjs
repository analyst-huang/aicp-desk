/** Orchestrates remote desktop state. All process, storage and environment effects are injected. */
export class RemoteUiSession {
  constructor({ paths, platform, processes, store, prepare, now = () => new Date().toISOString() }) {
    Object.assign(this, { paths, platform, processes, store, prepare, now });
  }

  async status() {
    const state = await this.store.load();
    if (!state) return { configured: false, running: false, statePath: this.paths.remoteUiState };
    const processStatus = {};
    for (const record of state.processes ?? []) processStatus[record.name] = await this.processes.isAlive(record);
    return {
      configured: true, running: ['xvfb', 'windowManager', 'x11vnc', 'websockify'].every(name => processStatus[name]),
      accessStopped: Boolean(state.accessStopped && processStatus.xvfb), sessionHostRunning: Boolean(processStatus.xvfb),
      display: state.display, vncPort: state.vncPort, webPort: state.webPort, url: state.url, startedAt: state.startedAt,
      processStatus, statePath: this.paths.remoteUiState,
    };
  }

  async stop() {
    const state = await this.store.load();
    if (!state) return { stopped: true, wasRunning: false, statePath: this.paths.remoteUiState };
    const stopped = await this.processes.stop(state.processes ?? []);
    await this.store.remove();
    return { stopped: true, wasRunning: stopped, statePath: this.paths.remoteUiState };
  }

  async suspend() {
    const state = await this.store.load();
    const xvfb = state?.processes?.find(record => record.name === 'xvfb');
    if (!xvfb || !await this.processes.isAlive(xvfb)) return { ...await this.stop(), accessStopped: true, sessionKept: false };
    const stopped = await this.processes.stop(state.processes.filter(record => record.name !== 'xvfb'));
    await this.store.save({ ...state, accessStopped: true, accessStoppedAt: this.now(), processes: [xvfb] });
    return { stopped: true, wasRunning: stopped, accessStopped: true, sessionKept: true, display: state.display, statePath: this.paths.remoteUiState };
  }

  async start(config, options) {
    if (this.platform !== 'linux') throw new Error('--remote-ui 只能在 Linux 无显示器服务器上使用');
    const existing = await this.status();
    const sameSettings = existing.display === options.display && existing.vncPort === options.vncPort && existing.webPort === options.webPort;
    if (existing.running) {
      if (sameSettings) return { ...existing, alreadyRunning: true };
      throw new Error(`远端 UI 已在端口 ${existing.webPort} 运行；请先执行 aicp remote-ui stop`);
    }
    const resuming = Boolean(existing.accessStopped && sameSettings);
    if (existing.configured && !resuming) await this.stop();
    let { specs, url } = await this.prepare(config, options);
    const processes = [], started = [];
    if (resuming) {
      const state = await this.store.load();
      const xvfb = state?.processes?.find(record => record.name === 'xvfb');
      if (!xvfb || !await this.processes.isAlive(xvfb)) {
        await this.stop();
        throw new Error('保留登录会话的 Xvfb 已退出；请重新运行 aicp login --remote-ui --yes');
      }
      processes.push(xvfb);
      specs = specs.filter(spec => spec.name !== 'xvfb');
    }
    const state = { version: 1, startedAt: this.now(), display: options.display, vncPort: options.vncPort,
      webPort: options.webPort, url, accessStopped: false, processes };
    try {
      for (const spec of specs) {
        const record = await this.processes.start(spec);
        started.push(record); processes.push(record);
      }
      await this.store.save(state);
      return { configured: true, running: true, alreadyRunning: false, resumed: resuming,
        display: state.display, vncPort: state.vncPort, webPort: state.webPort, url, startedAt: state.startedAt, statePath: this.paths.remoteUiState };
    } catch (error) {
      // A partially started process may also need a retry after a failed startup cleanup.
      const incomplete = [...started, ...(error.records ?? [])];
      try { await this.processes.stop(incomplete); }
      catch (cleanupError) {
        await this.store.save({ ...state, processes: [...processes, ...(error.records ?? [])] });
        throw new AggregateError([error, cleanupError], `${error.message}；${cleanupError.message}`);
      }
      throw error;
    }
  }
}
