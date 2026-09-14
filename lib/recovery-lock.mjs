import { mkdir, readdir, writeFile, stat, rmdir, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { LoginError } from "./login.mjs";

const hostId = createHash("sha256").update(os.hostname()).digest("hex").slice(0, 16);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ignoreMissing = (error) => { if (error.code !== "ENOENT") throw error; };
async function removeEmpty(lock) {
  await rmdir(lock).catch((error) => {
    if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error;
  });
}
const sameDirectory = (a, b) => a && b && a.ino === b.ino && a.dev === b.dev;

// Host and PID are encoded in the atomically created filename, so even a
// SIGKILL during file creation cannot leave an unreadable owner record.
// An owner marker survives SIGKILL. Only demonstrably dead local owners can
// be reclaimed; age alone never permits taking a live process's lock.
export async function inspectRecoveryLock(lock) {
  const info = await stat(lock).catch((error) => { ignoreMissing(error); return null; });
  if (!info) return { exists: false };
  const names = await readdir(lock).catch((error) => { ignoreMissing(error); return []; });
  if (!names.length) return { exists: true, reclaimable: Date.now() - info.mtimeMs > 10000, reason: "owner_missing", info, markers: [] };
  const markers = [];
  for (const name of names) {
    const match = /^owner-([a-f0-9]{16})-(\d+)-[a-f0-9-]+\.json$/.exec(name);
    if (!match) return { exists: true, reclaimable: false, reason: "unknown_lock_format" };
    const owner = { hostId: match[1], pid: Number(match[2]) };
    if (owner.hostId !== hostId || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) {
      return { exists: true, reclaimable: false, reason: "foreign_or_unknown_owner" };
    }
    try {
      process.kill(owner.pid, 0);
      return { exists: true, reclaimable: false, reason: "owner_alive", pid: owner.pid };
    } catch (error) {
      if (error.code !== "ESRCH") return { exists: true, reclaimable: false, reason: "owner_unverifiable", pid: owner.pid };
    }
    markers.push(name);
  }
  return { exists: true, reclaimable: true, reason: "owner_exited", info, markers };
}

export async function reclaimRecoveryLock(lock) {
  const result = await inspectRecoveryLock(lock);
  if (!result.reclaimable) return result;
  const current = await stat(lock).catch((error) => { ignoreMissing(error); return null; });
  if (!sameDirectory(result.info, current)) return { exists: Boolean(current), reclaimed: false };
  // Delete only markers actually inspected, never recursively remove a directory
  // that may now contain another owner's marker.
  for (const marker of result.markers) await unlink(path.join(lock, marker)).catch(ignoreMissing);
  await removeEmpty(lock);
  return { exists: false, reclaimed: true, reason: result.reason };
}

export async function withRecoveryLock(lock, callback, { timeout = 10000, interval = 200 } = {}) {
  await mkdir(path.dirname(lock), { recursive: true });
  const deadline = Date.now() + timeout;
  const marker = path.join(lock, `owner-${hostId}-${process.pid}-${randomUUID()}.json`);
  while (true) {
    let created = false;
    try { await mkdir(lock); created = true; }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    if (created) {
      const before = await stat(lock).catch(() => null);
      try {
        await writeFile(marker, "", { flag: "wx", mode: 0o600 });
        if (!sameDirectory(before, await stat(lock))) throw Object.assign(new Error("Lock changed during initialization"), { code: "ENOENT" });
        break;
      } catch (error) {
        await unlink(marker).catch(ignoreMissing);
        if (error.code !== "ENOENT") throw error;
      }
    }
    const result = await reclaimRecoveryLock(lock);
    if (result.reclaimed || !result.exists) continue;
    if (Date.now() >= deadline) throw new LoginError("LOGIN_BUSY", `登录恢复正在由其他进程处理（${result.reason}）；请稍后运行 aicp session --check，不要重复启动登录`);
    await delay(interval);
  }
  try { return await callback(); }
  finally { await unlink(marker).catch(ignoreMissing); await removeEmpty(lock); }
}
