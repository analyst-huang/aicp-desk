import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readSavedParentAccount } from "../lib/saved-info.mjs";

async function fixture(t, rows) {
  const profile = await mkdtemp(path.join(os.tmpdir(), "aicp-saved-info-"));
  t.after(() => rm(profile, { recursive: true, force: true }));
  await mkdir(path.join(profile, "Default"));
  const db = new DatabaseSync(path.join(profile, "Default", "Web Data"));
  db.exec("CREATE TABLE autofill(name TEXT, value TEXT)");
  const insert = db.prepare("INSERT INTO autofill VALUES (?, ?)");
  for (const row of rows) insert.run(...row);
  db.close();
  return profile;
}
test("only a unique IAM account_id is returned from Saved info", async (t) => {
  const profile = await fixture(t, [["account_id", "BeingH"], ["account_id", "BeingH"], ["username", "unrelated"], ["password", "must-not-read"]]);
  assert.equal(await readSavedParentAccount(profile), "BeingH");
});
test("ambiguous Saved info parents are not guessed", async (t) => {
  const profile = await fixture(t, [["account_id", "parent-a"], ["account_id", "parent-b"]]);
  assert.equal(await readSavedParentAccount(profile), "");
});
test("empty parents and unrelated saved fields are not credentials", async (t) => {
  const profile = await fixture(t, [["account_id", " "], ["username", "alice"]]);
  assert.equal(await readSavedParentAccount(profile), "");
});
test("missing or corrupt Saved info falls back without changing files", async (t) => {
  const profile = await fixture(t, []);
  await writeFile(path.join(profile, "Default", "Web Data"), "broken");
  assert.equal(await readSavedParentAccount(profile), "");
  assert.equal(await readSavedParentAccount(path.join(profile, "absent")), "");
});
test("browser exclusive lock still permits reading committed Saved info", async (t) => {
  const profile = await fixture(t, [["account_id", "BeingH"]]);
  const db = new DatabaseSync(path.join(profile, "Default", "Web Data"));
  try {
    db.exec("PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE");
    assert.equal(await readSavedParentAccount(profile), "BeingH");
  } finally { db.close(); }
});
