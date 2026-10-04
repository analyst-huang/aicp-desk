// @ts-check
import { DESCRIBE_NOTEBOOKS, DESCRIBE_TRAIN_JOBS, DESCRIBE_ALL_RESOURCE_POOLS, LIST_AICP_PROJECTS, DESCRIBE_AICP_IMAGES } from '../operations.mjs';

/** @typedef {import('./contract-types.mjs').Schema} Schema */
/** Only fields consumed by the application. Additional provider fields are allowed.
 * @type {Record<string, {query: string, variables: Record<string, unknown>, schema: Schema}>}
 */
export const READ_CONTRACTS = Object.freeze({
  DescribeNotebook: { query: DESCRIBE_NOTEBOOKS, variables: { Marker: 1, MaxResults: 5, SkipUserPermissionCheck: false },
    schema: { DescribeNotebook: { Notebooks: [{ NotebookId: 'string', Name: 'string', State: 'string' }], TotalCount: 'number' } } },
  DescribeTrainJobs: { query: DESCRIBE_TRAIN_JOBS, variables: { Page: 1, PageSize: 5, SkipUserPermissionCheck: false },
    schema: { DescribeTrainJobs: { TrainJobSet: [{ TrainJobId: 'string', TrainJobName: 'string', JobStatus: { Status: 'string' } }], TotalCount: 'number' } } },
  DescribeAllResourcePool: { query: DESCRIBE_ALL_RESOURCE_POOLS, variables: { ResourcePoolType: '', Status: 'normal' },
    schema: { DescribeAllResourcePool: { ResourcePoolSet: [{ ResourcePoolId: 'string', ResourcePoolName: 'string' }] } } },
  AicpGetAccountAllProjectList: { query: LIST_AICP_PROJECTS, variables: {},
    schema: { AicpGetAccountAllProjectList: { ListProjectResult: { ProjectList: [{ ProjectId: 'number', ProjectName: 'string' }] } } } },
  DescribeAicpImages: { query: DESCRIBE_AICP_IMAGES, variables: { ImageSource: 'Personal', ImageStatuses: 'active', Page: 1, PageSize: 5 },
    schema: { DescribeAicpImages: { ImageSet: [{ ImageId: 'string', ImageName: 'string' }] } } },
});

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Validate a response and make a minimal shareable projection without names, IDs, tokens or commands.
 * @param {Schema} schema @param {unknown} value @param {string} location
 * @returns {unknown}
 */
function inspect(schema, value, location) {
  if (typeof schema === 'string') {
    if (typeof value !== schema || (schema === 'number' && !Number.isFinite(value))) throw new Error(`云接口契约不匹配：${location} 应为 ${schema}`);
    if (typeof value === 'number') return /\.ProjectId$/.test(location) ? 0 : value;
    // Status strings are also scrubbed: an unexpected provider message must not leak data.
    return '<redacted>';
  }
  if (Array.isArray(schema)) {
    if (!Array.isArray(value)) throw new Error(`云接口契约不匹配：${location} 应为数组`);
    // Check every item, but retain no more than three structural examples.
    return value.map((item, index) => inspect(schema[0], item, `${location}[${index}]`)).slice(0, 3);
  }
  if (!isRecord(value)) throw new Error(`云接口契约不匹配：${location} 应为对象`);
  return Object.fromEntries(Object.entries(schema).map(([key, child]) => [key, inspect(child, value[key], `${location}.${key}`)]));
}

/** @param {string} operation @param {unknown} data @returns {unknown} */
export function checkReadContract(operation, data) {
  if (!Object.hasOwn(READ_CONTRACTS, operation)) throw new Error(`未允许的只读契约操作：${operation}`);
  return inspect(READ_CONTRACTS[operation].schema, data, operation);
}

/** @param {{graphql: (operation: string, query: string, variables: Record<string, unknown>) => Promise<unknown>}} transport
 * @param {string} region
 */
export async function captureReadContracts(transport, region) {
  const responses = [];
  for (const [operation, contract] of Object.entries(READ_CONTRACTS)) {
    if (!/^\s*query\b/.test(contract.query) || /\b(mutation|subscription)\b/.test(contract.query)) throw new Error('契约采集只允许查询');
    const data = await transport.graphql(operation, contract.query, { ...contract.variables, Region: region });
    responses.push({ operation, data: checkReadContract(operation, data) });
  }
  return { formatVersion: 1, source: 'live-sanitized', capturedAt: new Date().toISOString(), responses };
}
