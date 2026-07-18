import test from "node:test";
import assert from "node:assert/strict";
import {
  detectContainerEnvironment,
  normalizeRemoteUiOptions,
  remoteUiDoctor,
  remoteUiProcessSpecs,
} from "../lib/remote-ui.mjs";

test("remote UI defaults use a private virtual display and predictable forwarding ports", () => {
  assert.deepEqual(normalizeRemoteUiOptions(), {
    display: ":99",
    vncPort: 5900,
    webPort: 6080,
    width: 1440,
    height: 900,
    webRoot: undefined,
  });
  assert.throws(() => normalizeRemoteUiOptions({ display: ":0" }), /不能使用 :0/);
  assert.throws(() => normalizeRemoteUiOptions({ webPort: 5900, vncPort: 5900 }), /不能相同/);
  assert.throws(() => normalizeRemoteUiOptions({ webRoot: true }), /必须提供/);
});

test("remote UI binds both VNC layers to server loopback only", () => {
  const options = normalizeRemoteUiOptions({ webPort: 16080, vncPort: 15900, display: ":109" });
  const specs = remoteUiProcessSpecs(options, {
    xvfb: "/usr/bin/Xvfb",
    x11vnc: "/usr/bin/x11vnc",
    websockify: "/usr/bin/websockify",
    windowManager: "/usr/bin/openbox",
    noVnc: { root: "/usr/share/novnc", entrypoint: "vnc.html" },
  });
  const x11vnc = specs.find((item) => item.name === "x11vnc");
  const websockify = specs.find((item) => item.name === "websockify");
  assert.ok(x11vnc.args.includes("-localhost"));
  assert.deepEqual(websockify.args, ["--web", "/usr/share/novnc", "127.0.0.1:16080", "127.0.0.1:15900"]);
});

test("doctor reports a complete Linux dependency set for an ordinary user", async () => {
  const report = await remoteUiDoctor({}, {}, {
    platform: "linux",
    getuid: () => 1000,
    resolveExecutable: async (candidate) => `/mock/${candidate}`,
    findNoVnc: async () => ({ root: "/mock/novnc", entrypoint: "vnc.html" }),
    findEdge: async () => "/mock/microsoft-edge",
  });
  assert.equal(report.ready, true);
  assert.deepEqual(report.problems, []);
  assert.equal(report.edge, "/mock/microsoft-edge");
});

test("doctor refuses root and explains missing dependencies", async () => {
  const report = await remoteUiDoctor({}, {}, {
    platform: "linux",
    getuid: () => 0,
    resolveExecutable: async () => null,
    findNoVnc: async () => null,
    findEdge: async () => { throw new Error("找不到 Microsoft Edge"); },
  });
  assert.equal(report.ready, false);
  assert.match(report.problems.join("\n"), /裸机 root/);
  assert.match(report.problems.join("\n"), /Xvfb/);
  assert.match(report.problems.join("\n"), /noVNC/);
  assert.match(report.problems.join("\n"), /Microsoft Edge/);
});

test("container detection recognizes standard runtime markers and cgroups", async () => {
  assert.equal(await detectContainerEnvironment({
    env: {},
    existsFn: async (marker) => marker === "/.dockerenv",
    readFileFn: async () => "",
  }), true);
  assert.equal(await detectContainerEnvironment({
    env: {},
    existsFn: async () => false,
    readFileFn: async () => "0::/kubepods.slice/pod123",
  }), true);
  assert.equal(await detectContainerEnvironment({
    env: {},
    existsFn: async () => false,
    readFileFn: async () => "0::/user.slice/user-1000.slice",
  }), false);
});

test("doctor accepts an explicitly installed root-container runtime with a warning", async () => {
  const report = await remoteUiDoctor({}, {}, {
    platform: "linux",
    getuid: () => 0,
    containerDetected: true,
    rootModel: true,
    noSandbox: true,
    resolveExecutable: async (candidate) => `/mock/${candidate}`,
    findNoVnc: async () => ({ root: "/mock/novnc", entrypoint: "vnc.html" }),
    findEdge: async () => "/mock/microsoft-edge",
  });
  assert.equal(report.ready, true);
  assert.equal(report.rootModel, true);
  assert.equal(report.privateRuntime.mode, "root-container");
  assert.match(report.warnings.join("\n"), /root-container/);
});
