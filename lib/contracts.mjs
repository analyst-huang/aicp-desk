/**
 * Internal contracts. External cloud field names and JSON formats stay unchanged.
 * @typedef {'dev'|'train'} ResourceKind
 * @typedef {Object<string, any> & {Region?: string, ResourcePoolId?: string, QueueName?: string, DisplayName?: string, TrainJobName?: string}} CreateVariables
 * @typedef {{kind: ResourceKind, variables: Readonly<CreateVariables>}} PreparedCreate
 * @typedef {{authenticated: boolean, authenticationCode?: string, requiresUserAction?: boolean}} SessionResult
 * @typedef {{noop?: boolean, item?: object, result?: object, message?: string}} ResourceResult
 * @typedef {{now: () => number}} Clock
 * @typedef {{graphql: (operation: string, query: string, variables: object) => Promise<object>, withBrowser: (callback: Function) => Promise<any>, currentUser: () => Promise<object>}} CloudTransport
 */
export {};
