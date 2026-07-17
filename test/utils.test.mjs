import test from "node:test";
import assert from "node:assert/strict";
import { deepSet, parseArgs, parseScalar, redact, splitPath } from "../lib/utils.mjs";

test("parseArgs supports repeated options and no- flags", () => {
  const parsed = parseArgs(["job", "--set", "A=1", "--set=B=2", "--no-open", "--yes"]);
  assert.deepEqual(parsed.positionals, ["job"]);
  assert.deepEqual(parsed.options.set, ["A=1", "B=2"]);
  assert.equal(parsed.options.open, false);
  assert.equal(parsed.options.yes, true);
});

test("deepSet supports array paths", () => {
  const value = {};
  deepSet(value, "Roles[0].ResourceConfig.GPUNumber", 8);
  assert.equal(value.Roles[0].ResourceConfig.GPUNumber, 8);
  assert.deepEqual(splitPath("Roles[12].Envs[0].Value"), ["Roles", 12, "Envs", 0, "Value"]);
});

test("parseScalar recognizes JSON, booleans and numbers", () => {
  assert.equal(parseScalar("true"), true);
  assert.equal(parseScalar("12.5"), 12.5);
  assert.deepEqual(parseScalar('[{"a":1}]'), [{ a: 1 }]);
  assert.equal(parseScalar("hello"), "hello");
});

test("redact hides passwords, tokens and environment values", () => {
  const value = redact({ Password: "p", ImageToken: "t", Envs: [{ Name: "KEY", Value: "secret" }], Name: "ok" });
  assert.equal(value.Password, "<redacted>");
  assert.equal(value.ImageToken, "<redacted>");
  assert.equal(value.Envs[0].Value, "<redacted>");
  assert.equal(value.Name, "ok");
});
