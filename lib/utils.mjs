import { readFile } from "node:fs/promises";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export function parseArgs(argv) {
  const positionals = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const equalIndex = token.indexOf("=");
    let key;
    let value;
    if (equalIndex >= 0) {
      key = token.slice(2, equalIndex);
      value = token.slice(equalIndex + 1);
    } else {
      key = token.slice(2);
      if (key.startsWith("no-")) {
        key = key.slice(3);
        value = false;
      } else if (argv[index + 1] !== undefined && !argv[index + 1].startsWith("--")) {
        value = argv[index + 1];
        index += 1;
      } else {
        value = true;
      }
    }
    if (Object.hasOwn(options, key)) {
      options[key] = Array.isArray(options[key]) ? [...options[key], value] : [options[key], value];
    } else {
      options[key] = value;
    }
  }
  return { positionals, options };
}

export function optionList(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function parseScalar(rawValue) {
  if (typeof rawValue !== "string") return rawValue;
  const trimmed = rawValue.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (trimmed === "undefined") return undefined;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    return JSON.parse(trimmed);
  }
  return rawValue;
}

export function splitPath(pathExpression) {
  const parts = [];
  const pattern = /([^.\[\]]+)|\[(\d+)\]/g;
  let match;
  while ((match = pattern.exec(pathExpression)) !== null) {
    parts.push(match[1] ?? Number(match[2]));
  }
  if (!parts.length) throw new Error(`无效字段路径：${pathExpression}`);
  return parts;
}

export function deepSet(target, pathExpression, value) {
  const parts = splitPath(pathExpression);
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    const next = parts[index + 1];
    if (cursor[part] === undefined || cursor[part] === null) {
      cursor[part] = typeof next === "number" ? [] : {};
    }
    cursor = cursor[part];
  }
  cursor[parts.at(-1)] = value;
  return target;
}

export async function applySetOverrides(target, setValues = []) {
  for (const assignment of optionList(setValues)) {
    const equalIndex = String(assignment).indexOf("=");
    if (equalIndex <= 0) throw new Error(`--set 必须使用 路径=值：${assignment}`);
    const fieldPath = String(assignment).slice(0, equalIndex);
    const rawValue = String(assignment).slice(equalIndex + 1);
    let value;
    if (rawValue.startsWith("@")) {
      const contents = await readFile(rawValue.slice(1), "utf8");
      try {
        value = JSON.parse(contents);
      } catch {
        value = contents;
      }
    } else {
      value = parseScalar(rawValue);
    }
    deepSet(target, fieldPath, value);
  }
  return target;
}

export function clone(value) {
  return structuredClone(value);
}

export function redact(value, { showSensitive = false } = {}) {
  if (showSensitive) return clone(value);
  const visit = (item, parentKey = "") => {
    if (Array.isArray(item)) return item.map((entry) => visit(entry, parentKey));
    if (!item || typeof item !== "object") return item;
    const result = {};
    for (const [key, entry] of Object.entries(item)) {
      const lowered = key.toLowerCase();
      const sensitiveKey = ["password", "token", "secret"].some((word) => lowered.includes(word));
      const envValue = parentKey === "Envs" && key === "Value";
      result[key] = sensitiveKey || envValue ? "<redacted>" : visit(entry, key);
    }
    return result;
  };
  return visit(value);
}

export async function confirmAction(message, { yes = false } = {}) {
  if (yes) return true;
  if (!input.isTTY) throw new Error(`${message}；非交互模式请添加 --yes`);
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(`${message} [y/N] `);
    return ["y", "yes", "是"].includes(answer.trim().toLowerCase());
  } finally {
    rl.close();
  }
}

export function formatTable(rows, columns) {
  if (!rows.length) return "（无数据）";
  const widths = columns.map(({ key, label }) => Math.max(label.length, ...rows.map((row) => String(row[key] ?? "").length)));
  const render = (row) => columns.map(({ key }, index) => String(row[key] ?? "").padEnd(widths[index])).join("  ");
  const header = render(Object.fromEntries(columns.map(({ key, label }) => [key, label])));
  const line = widths.map((width) => "-".repeat(width)).join("  ");
  return [header, line, ...rows.map(render)].join("\n");
}

export async function readVariablesFile(filePath) {
  let text;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`无法读取 JSON 文件“${filePath}”：${error.message}`);
  }
  if (!text.trim()) throw new Error(`JSON 文件“${filePath}”为空`);
  try {
    const payload = JSON.parse(text);
    return clone(payload.variables ?? payload);
  } catch (error) {
    throw new Error(`JSON 文件“${filePath}”格式错误：${error.message}`);
  }
}

export function jsonOutput(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
