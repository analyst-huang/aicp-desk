import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const read = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("package exposes a portable aicp executable on Node.js 22", () => {
  assert.equal(packageJson.bin.aicp, "./bin/aicp.mjs");
  assert.match(packageJson.engines.node, />=22/);
  assert.equal(packageJson.private, true);
});

test("distribution includes installers and launchers for all supported platforms", async () => {
  const [windowsInstall, windowsUninstall, unixInstall, unixUninstall, unixLauncher] = await Promise.all([
    read("install.ps1"), read("uninstall.ps1"), read("install.sh"), read("uninstall.sh"), read("aicp"),
  ]);
  assert.match(windowsInstall, /LOCALAPPDATA/);
  assert.match(windowsInstall, /aicp\.cmd/);
  assert.match(windowsInstall, /Get-CimInstance Win32_Process/);
  assert.match(windowsInstall, /Stop-Process/);
  assert.match(windowsUninstall, /KeepData/);
  assert.match(unixInstall, /Darwin/);
  assert.match(unixInstall, /Linux/);
  assert.match(unixInstall, /\.local\/bin/);
  assert.match(unixInstall, /Stopped running AICP Desk GUI/);
  assert.match(unixUninstall, /--keep-data/);
  assert.match(unixLauncher, /^#!\/usr\/bin\/env sh/);
});

test("README documents Windows, macOS, Linux, GUI, and CLI workflows", async () => {
  const readme = await read("README.md");
  for (const phrase of ["### Windows", "### macOS", "### Linux", "## GUI 用法", "## CLI 用法", "aicp login", "aicp gui", "--dry-run"]) {
    assert.match(readme, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("CLI exposes GPU capacity in human and JSON modes", async () => {
  const cli = await read("bin/aicp.mjs");
  assert.match(cli, /aicp gpu \[--only-free\].*\[--json\]/);
  assert.match(cli, /context\.service\.gpuCapacity/);
  assert.match(cli, /资源组物理 GPU/);
  assert.match(cli, /GPU剩余\/可分配/);
  assert.match(cli, /内存剩余\/可分配/);
  assert.match(cli, /--only-free/);
  assert.match(cli, /--sort-gpu desc\|asc/);
});

test("CLI exposes one-shot and follow training logs", async () => {
  const [cli, readme] = await Promise.all([read("bin/aicp.mjs"), read("README.md")]);
  assert.match(cli, /aicp train logs NAME_OR_ID/);
  assert.match(cli, /context\.service\.trainingLogs/);
  assert.match(cli, /options\.follow/);
  assert.match(cli, /options\.pod/);
  assert.match(cli, /options\.role/);
  assert.match(readme, /aicp train logs TRAIN_NAME_OR_ID --follow/);
  assert.match(readme, /logs\[\]/);
});
