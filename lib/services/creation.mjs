// @ts-check
import { normalizeCreateVariables, validateCreateVariables, assertCreateObject } from '../domain/create-input.mjs';
import { readFile } from 'node:fs/promises';
import { applySetOverrides, clone, readVariablesFile } from '../utils.mjs';
import { prepareNotebookPayload, prepareTrainJobPayload } from '../domain/creation.mjs';

/** @typedef {import('../contracts.mjs').ResourceKind} ResourceKind
 * @typedef {import('../contracts.mjs').CreateVariables} CreateVariables
 * @typedef {{variables?: unknown, file?: string, template?: string, name?: string, command?: string, commandFile?: string, region?: string, set?: string[], dryRun?: boolean}} CreateOptions
 */
export class CreationService {
  /** @param {{executePayload: import('../contracts.mjs').CreateExecutor, templates: Pick<import('../templates.mjs').TemplateStore, 'get'>, config: import('../contracts.mjs').AppConfig}} dependencies */
  constructor({ executePayload, templates, config }) {
    this.executePayload = executePayload; this.templates = templates; this.config = config;
  }

  /** @param {ResourceKind} kind @param {CreateOptions} [options] */
  async prepareCreateVariables(kind, options = {}) {
    if (!["dev", "train"].includes(kind)) throw new Error(`未知资源类型：${kind}`);
    if (options.file && options.template) throw new Error("--file 和 --template 不能同时使用");
    if (options.command !== undefined && options.commandFile) throw new Error("--command 和 --command-file 不能同时使用");
    /** @type {Record<string, unknown>} */
    let variables = {};
    if (options.file) variables = await readVariablesFile(options.file);
    if (options.template) variables = clone((await this.templates.get(kind, options.template)).variables);
    if (!options.file && !options.template && options.variables !== undefined) variables = clone(options.variables);
    assertCreateObject(variables);
    if (options.name) variables[kind === "dev" ? "DisplayName" : "TrainJobName"] = options.name;
    const command = options.commandFile ? await readFile(options.commandFile, 'utf8') : options.command;
    if (command !== undefined && kind === 'train') {
      if (String(variables.Framework).toLowerCase() === 'ray') variables.EntryPointCommand = command;
      else {
        variables.Roles ??= [{}];
        if (!Array.isArray(variables.Roles)) throw new Error('Roles 必须是数组');
        variables.Roles[0] ??= {};
        assertCreateObject(variables.Roles[0], 'Roles[0]');
        variables.Roles[0].RunCommand = command;
      }
    }
    if (options.region) variables.Region = options.region;
    await applySetOverrides(variables, options.set);
    variables.Region ||= this.config.region;
    variables = normalizeCreateVariables(kind, variables);
    validateCreateVariables(kind, variables);
    return variables;
  }

  /** @param {ResourceKind} kind @param {unknown} variables */
  validateCreateVariables(kind, variables) { return validateCreateVariables(kind, variables); }

  /** @param {ResourceKind} kind @param {CreateOptions} [options]
   * @returns {Promise<import('../contracts.mjs').PreparedCreate>} */
  async prepareCreate(kind, options = {}) {
    const variables = await this.prepareCreateVariables(kind, options);
    return freeze({ kind, variables });
  }

  /** Execute the confirmed snapshot; never reread a template or variable file.
   * @param {import('../contracts.mjs').PreparedCreate} prepared */
  async executeCreate(prepared) {
    const { kind } = prepared;
    if (!["dev", "train"].includes(kind)) throw new Error(`未知资源类型：${kind}`);
    const variables = clone(prepared.variables);
    this.validateCreateVariables(kind, variables);
    const result = await this.executePayload(kind, variables);
    return { dryRun: false, variables, result };
  }

  /** @param {ResourceKind} kind @param {CreateOptions} [options] */
  async create(kind, options = {}) {
    const prepared = await this.prepareCreate(kind, options);
    if (options.dryRun) return { dryRun: true, variables: prepared.variables };
    return this.executeCreate(prepared);
  }
}

/** Build the execution port once at composition time, including legacy adapter support.
 * @param {Partial<Pick<import('../api.mjs').AicpApi, 'submitCreate'|'createNotebook'|'createTrainJob'>> & Partial<import('../cloud/api.mjs').KsyunApi>} api
 * @returns {import('../contracts.mjs').CreateExecutor}
 */
export function creationExecutor(api) {
  if (!api.submitCreate) return (kind, variables) => {
    const execute = kind === 'dev' ? api.createNotebook : api.createTrainJob;
    if (!execute) throw new TypeError('缺少创建依赖方法');
    return execute.call(api, variables);
  };
  const submitCreate = api.submitCreate.bind(api);
  if (!api.withSession) throw new TypeError('缺少依赖方法：withSession');
  const withSession = api.withSession.bind(api);
  return (kind, variables) => withSession(async () => {
    const payload = await (kind === 'dev' ? prepareNotebookPayload : prepareTrainJobPayload)(api, variables);
    return submitCreate(kind, payload);
  });
}

/** @template T @param {T} value @returns {Readonly<T>} */
function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
