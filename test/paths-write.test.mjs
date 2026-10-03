import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readJson, updateJsonAtomic, writeJsonAtomic } from "../lib/paths.mjs";

test("concurrent state patches preserve all fields and leave no temporary files", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aicp-writes-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "state.json");
  await Promise.all(Array.from({ length: 30 }, (_, i) => updateJsonAtomic(file, (value) => ({ ...value, [i]: i }))));
  assert.equal(Object.keys(await readJson(file)).length, 30);
  await assert.rejects(updateJsonAtomic(file, () => { throw new Error("test failure"); }));
  await writeFile(file, "corrupt");
  await writeJsonAtomic(file, { recovered: true });
  assert.deepEqual(await readJson(file), { recovered: true });
  assert.deepEqual(await readdir(directory), ["state.json"]);
});
