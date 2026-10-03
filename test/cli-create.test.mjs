import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { handleDev, handleTrain } from "../bin/aicp.mjs";
import { AicpService } from "../lib/service.mjs";

for (const [kind, handler, method] of [["dev", handleDev, "createNotebook"], ["train", handleTrain, "createTrainJob"]]) {
  test(`${kind} CLI cancel and dry-run never dispatch writes`, async () => {
    const variables = JSON.parse(await readFile(new URL(`../examples/${kind}-create.json`, import.meta.url), "utf8"));
    let writes = 0, confirms = 0;
    const service = new AicpService({ [method]: async () => writes++ }, { get: async () => ({ variables }) }, { region: "test" });
    const output = [];
    const io = { confirm: async () => { confirms++; return false; }, output: (value) => output.push(value) };
    await handler({ service }, "create", ["--template", "example", "--dry-run"], io);
    assert.equal(confirms, 0);
    assert.deepEqual(output[0], variables);
    await handler({ service }, "create", ["--template", "example"], io);
    assert.equal(confirms, 1);
    assert.equal(writes, 0);
    assert.equal(output[1], "已取消");
  });

  test(`${kind} CLI submits exactly the snapshot prepared before confirmation`, async () => {
    const variables = JSON.parse(await readFile(new URL(`../examples/${kind}-create.json`, import.meta.url), "utf8"));
    const original = structuredClone(variables);
    let submitted;
    const service = new AicpService({ [method]: async (payload) => { submitted = payload; return { id: "created" }; } }, { get: async () => ({ variables }) }, { region: "test" });
    await handler({ service }, "create", ["--template", "example"], {
      confirm: async () => { variables.QueueName = "changed-during-confirmation"; return true; }, output: () => {},
    });
    assert.deepEqual(submitted, original);
    const prepared = await service.prepareCreate(kind, { variables: original });
    assert.throws(() => { prepared.variables.QueueName = "changed"; }, TypeError);
    await service.create(kind, { variables: original });
    assert.deepEqual(submitted, original);
  });
}
