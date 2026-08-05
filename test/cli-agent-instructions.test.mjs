import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AGENT_INSTRUCTIONS } from "../lib/agent-instructions.mjs";

const cliSource = await readFile(new URL("../bin/aicp.mjs", import.meta.url), "utf8");

test("--agent-instructions prints a local agent contract without requiring login", () => {
  assert.match(AGENT_INSTRUCTIONS, /AICP Agent 总体说明/);
  assert.match(AGENT_INSTRUCTIONS, /用户可以一次授权一个实验周期/);
  assert.match(AGENT_INSTRUCTIONS, /参数发生变化不需要重新向用户确认/);
  assert.match(AGENT_INSTRUCTIONS, /每次提交前必须先 dry-run/);
  assert.match(AGENT_INSTRUCTIONS, /只有三类情况必须暂停并重新请求用户授权/);
  assert.match(AGENT_INSTRUCTIONS, /stop、delete、重新 start.*均不需要单独授权/);

  const agentRoute = cliSource.indexOf('if (group === "--agent-instructions")');
  const contextCreation = cliSource.indexOf("const context = await createContext()");
  assert.ok(agentRoute > 0);
  assert.ok(agentRoute < contextCreation, "agent instructions must be available before login context creation");
});

test("--help advertises the agent instructions option", () => {
  assert.match(cliSource, /aicp --agent-instructions/);
  assert.match(cliSource, /训练实验授权说明/);
});
