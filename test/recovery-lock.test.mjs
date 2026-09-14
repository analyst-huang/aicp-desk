import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, utimes, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { withRecoveryLock, reclaimRecoveryLock, inspectRecoveryLock } from "../lib/recovery-lock.mjs";

async function lockPath(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), "aicp-lock-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  return path.join(home, "login-state.json.lock");
}

test("a killed owner is reclaimed immediately instead of waiting five minutes", { timeout: 5000 }, async (t) => {
  const lock = await lockPath(t);
  const moduleUrl = new URL("../lib/recovery-lock.mjs", import.meta.url).href;
  const script = `import { withRecoveryLock } from ${JSON.stringify(moduleUrl)}; await withRecoveryLock(${JSON.stringify(lock)}, async () => { console.log('locked'); await new Promise(() => setInterval(() => {}, 1000)); });`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => child.kill("SIGKILL"));
  await new Promise((resolve, reject) => {
    child.stdout.once("data", resolve);
    child.once("error", reject);
    child.once("exit", () => reject(new Error("child exited before acquiring lock")));
  });
  assert.equal((await inspectRecoveryLock(lock)).reason, "owner_alive");
  const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
  assert.equal((await inspectRecoveryLock(lock)).reason, "owner_exited");
  assert.equal(await withRecoveryLock(lock, async () => "recovered", { timeout: 200 }), "recovered");
  assert.equal((await inspectRecoveryLock(lock)).exists, false);
});

test("old but live locks cannot be stolen", async (t) => {
  const lock = await lockPath(t);
  await withRecoveryLock(lock, async () => {
    const old = new Date(Date.now() - 600000); await utimes(lock, old, old);
    await assert.rejects(withRecoveryLock(lock, async () => assert.fail("stolen"), { timeout: 5, interval: 1 }), { code: "LOGIN_BUSY" });
    assert.equal((await inspectRecoveryLock(lock)).reason, "owner_alive");
  });
});

test("legacy empty locks are reclaimed, newly initializing locks are protected", async (t) => {
  const lock = await lockPath(t); await mkdir(lock);
  assert.equal((await reclaimRecoveryLock(lock)).reclaimed, undefined);
  const old = new Date(Date.now() - 11000); await utimes(lock, old, old);
  assert.equal((await reclaimRecoveryLock(lock)).reclaimed, true);
});

test("foreign-host locks are not reclaimed based on local PID or age", async (t) => {
  const lock = await lockPath(t); await mkdir(lock);
  await writeFile(path.join(lock, "owner-0000000000000000-99999-abc.json"), JSON.stringify({ hostname: "other-host", pid: 99999 }));
  const old = new Date(Date.now() - 600000); await utimes(lock, old, old);
  assert.equal((await reclaimRecoveryLock(lock)).reason, "foreign_or_unknown_owner");
  assert.equal((await readdir(lock)).length, 1);
});

test("callback failure releases only the owned marker", async (t) => {
  const lock = await lockPath(t);
  await assert.rejects(withRecoveryLock(lock, async () => { throw new Error("fixture failure"); }), /fixture failure/);
  assert.equal((await inspectRecoveryLock(lock)).exists, false);
});
