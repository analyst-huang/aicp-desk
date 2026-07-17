import test from "node:test";
import assert from "node:assert/strict";
import { defaultHome } from "../lib/paths.mjs";
import { commonEdgePaths } from "../lib/config.mjs";

test("application data directories follow each operating system convention", () => {
  assert.equal(defaultHome({ platform: "win32", env: { LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local" }, homedir: "C:\\Users\\demo" }), "C:\\Users\\demo\\AppData\\Local\\aicp-cli");
  assert.equal(defaultHome({ platform: "darwin", env: {}, homedir: "/Users/demo" }), "/Users/demo/Library/Application Support/aicp-cli");
  assert.equal(defaultHome({ platform: "linux", env: { XDG_STATE_HOME: "/state" }, homedir: "/home/demo" }), "/state/aicp-cli");
  assert.equal(defaultHome({ platform: "linux", env: {}, homedir: "/home/demo" }), "/home/demo/.local/state/aicp-cli");
  assert.equal(defaultHome({ platform: "linux", env: { AICP_HOME: "/custom/aicp" }, homedir: "/home/demo" }), "/custom/aicp");
});

test("Edge candidates cover Windows, macOS, and Linux", () => {
  const windows = commonEdgePaths({ platform: "win32", env: { ProgramFiles: "C:\\Program Files", LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local" }, homedir: "C:\\Users\\demo" });
  const mac = commonEdgePaths({ platform: "darwin", env: {}, homedir: "/Users/demo" });
  const linux = commonEdgePaths({ platform: "linux", env: {}, homedir: "/home/demo" });
  assert.ok(windows.some((item) => item.endsWith("msedge.exe")));
  assert.ok(mac.some((item) => item.includes("Microsoft Edge.app/Contents/MacOS/Microsoft Edge")));
  assert.ok(linux.includes("microsoft-edge-stable"));
});
