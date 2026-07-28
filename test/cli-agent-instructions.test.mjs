import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AGENT_INSTRUCTIONS } from "../lib/agent-instructions.mjs";

const cliSource = await readFile(new URL("../bin/aicp.mjs", import.meta.url), "utf8");

test("--agent-instructions prints a local agent contract without requiring login", () => {
  assert.match(AGENT_INSTRUCTIONS, /AICP Agent 总体说明/);
  assert.match(AGENT_INSTRUCTIONS, /Launch 训练实验前必须确认/);
  assert.match(AGENT_INSTRUCTIONS, /aicp train create 会创建并提交真实训练任务/);
  assert.match(AGENT_INSTRUCTIONS, /--yes 仅跳过 CLI 的交互提示，不代表用户同意/);
  assert.match(AGENT_INSTRUCTIONS, /完全相同的参数去掉 --dry-run 并添加 --yes/);
  assert.match(AGENT_INSTRUCTIONS, /stop、delete、重新 start、扩大资源或创建替代实验需要单独授权/);

  const agentRoute = cliSource.indexOf('if (group === "--agent-instructions")');
  const contextCreation = cliSource.indexOf("const context = await createContext()");
  assert.ok(agentRoute > 0);
  assert.ok(agentRoute < contextCreation, "agent instructions must be available before login context creation");
});

test("--help advertises the agent instructions option", () => {
  assert.match(cliSource, /aicp --agent-instructions/);
  assert.match(cliSource, /训练实验授权说明/);
});
