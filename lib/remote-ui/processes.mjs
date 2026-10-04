import { spawn } from 'node:child_process';
import { open, readFile } from 'node:fs/promises';
import path from 'node:path';

/** Owns process identity, startup and bounded shutdown, independently of UI state. */
export class ProcessSupervisor {
  constructor({ platform = process.platform, launch = spawn, kill = process.kill.bind(process), read = readFile, openLog = open,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    Object.assign(this, { platform, launch, kill, read, openLog, sleep });
  }

  async birth(pid) {
    if (this.platform !== 'linux') return undefined;
    const stat = await this.read(`/proc/${pid}/stat`, 'utf8');
    // comm can contain spaces and parentheses; starttime is field 22.
    return stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/)[19];
  }

  async isAlive(record) {
    if (!record || !Number.isInteger(record.pid) || record.pid <= 1) return false;
    try { this.kill(record.pid, 0); } catch { return false; }
    if (this.platform !== 'linux') return true;
    try {
      if (record.birth !== undefined && record.birth !== await this.birth(record.pid)) return false;
      const args = (await this.read(`/proc/${record.pid}/cmdline`, 'utf8')).split('\0').filter(Boolean);
      if (!args.some(arg => path.basename(arg) === path.basename(record.command))) return false;
      if (!(record.args ?? []).every(argument => args.includes(String(argument)))) return false;
      if (record.display) {
        const env = await this.read(`/proc/${record.pid}/environ`, 'utf8');
        if (!env.split('\0').includes(`DISPLAY=${record.display}`)) return false;
      }
      return true;
    } catch { return false; }
  }

  async signal(record, force = false) {
    if (!await this.isAlive(record)) return false;
    try { this.kill(record.pid, force ? 'SIGKILL' : 'SIGTERM'); return true; }
    catch { return false; }
  }

  async remaining(records) {
    const live = await Promise.all(records.map(record => this.isAlive(record)));
    return records.filter((_, index) => live[index]);
  }

  async waitForExit(records, timeout) {
    let remaining = await this.remaining(records);
    for (let elapsed = 0; remaining.length && elapsed < timeout; elapsed += 100) {
      await this.sleep(Math.min(100, timeout - elapsed));
      remaining = await this.remaining(remaining);
    }
    return remaining;
  }

  async stop(records, { grace = 500 } = {}) {
    const ordered = [...records].reverse();
    let stopped = false;
    for (const record of ordered) stopped = await this.signal(record) || stopped;
    const remaining = await this.waitForExit(ordered, grace);
    for (const record of remaining) stopped = await this.signal(record, true) || stopped;
    const survivors = await this.waitForExit(remaining, grace);
    if (survivors.length) throw new Error(`进程未能退出：${survivors.map(record => `${record.name} (${record.pid})`).join('、')}；已保留状态，请重试停止`);
    return stopped;
  }

  async start(spec) {
    const log = spec.logPath ? await this.openLog(spec.logPath, 'w', 0o600) : null;
    let child, record, spawnError;
    try {
      child = this.launch(spec.command, spec.args, {
        detached: true, windowsHide: true, stdio: log ? ['ignore', log.fd, log.fd] : 'ignore', env: spec.env,
      });
      child.once('error', error => { spawnError = error; });
      record = { name: spec.name, pid: child.pid, command: spec.command, args: spec.args, display: spec.env?.DISPLAY, logPath: spec.logPath };
      if (child.pid) record.birth = await this.birth(child.pid).catch(() => undefined);
      child.unref();
      await log?.close();
      await this.sleep(spec.wait);
      if (spawnError) throw spawnError;
      if (!child.pid || child.exitCode !== null || !await this.isAlive(record)) {
        let details = '';
        if (spec.logPath) try { details = (await this.read(spec.logPath, 'utf8')).trim().split(/\r?\n/).slice(-20).join('\n'); } catch {}
        throw new Error(`${spec.name} 启动失败${details ? `\n${details}` : ''}`);
      }
      return record;
    } catch (error) {
      if (record?.pid) {
        try { await this.stop([record]); }
        catch (cleanupError) { throw Object.assign(new AggregateError([error, cleanupError], `${error.message}；${cleanupError.message}`), { records: [record] }); }
      }
      throw error;
    } finally { await log?.close().catch(() => {}); }
  }
}
