/**
 * Internal contracts. Unknown platform fields are retained without disabling checks
 * on fields owned by this application. No runtime dependency is required.
 * @typedef {Record<string, unknown>} PlatformFields
 * @typedef {'dev'|'train'} ResourceKind
 * @typedef {{error: string, code?: string, requiresUserAction?: boolean}} ErrorPayload
 * @typedef {{accountType: string, username: string, userId: string}} Identity
 * @typedef {{authenticated: boolean, authenticationCode?: string|null, requiresUserAction?: boolean, username?: string|null, userId?: string|null}} SessionResult
 * @typedef {{noop?: boolean, item?: PlatformFields, result?: PlatformFields, message?: string}} ResourceResult
 * @typedef {{now: () => number, sleep: (milliseconds: number) => Promise<void>}} Clock
 * @typedef {{Name?: string, Value?: string} & PlatformFields} EnvironmentVariable
 * @typedef {{StorageConfigId?: string, MountPath?: string, MountProtocol?: string|null} & PlatformFields} StorageMount
 * @typedef {{Service?: string, Port?: number|string, EnablePublicNetwork?: boolean} & PlatformFields} ServicePort
 * @typedef {{ImageType?: string, OfficialInstance?: string, UserName?: string, Password?: string} & PlatformFields} AutoSaveConfig
 * @typedef {{RunOnCPU?: boolean, RunOnGPU?: boolean, RequiredNodeIp?: string} & PlatformFields} NodeAffinity
 * @typedef {{ImageSource?: string, ImageId?: string, ImageRegistryId?: string, ImageRepoId?: string, ImageTagId?: string} & PlatformFields} TrainingImage
 * @typedef {{GPUType?: string, GPUNumber?: number, CPUNum?: number, Memory?: number} & PlatformFields} TrainingResources
 * @typedef {{RoleName?: string, Replicas?: number, ImageConfig?: TrainingImage, ResourceConfig?: TrainingResources, RunCommand?: string, Envs?: EnvironmentVariable[]} & PlatformFields} TrainingRole
 * @typedef {{Region?: string, ResourcePoolId?: string, QueueName?: string, AccessType?: string, StorageConfigs?: StorageMount[]} & PlatformFields} CommonCreateVariables
 * @typedef {CommonCreateVariables & {
 *   DisplayName?: string, ProjectId?: number|string|null, Description?: string,
 *   ImageSource?: number|string, ImageId?: string, ImageRegistryId?: string, ImageRepoId?: string, ImageTagId?: string,
 *   AutoSave?: boolean, AutoSaveConfig?: AutoSaveConfig, GPUType?: string, GPUNumber?: number, CpuNum?: number, Memory?: number,
 *   Envs?: EnvironmentVariable[], ServiceConfigs?: ServicePort[], EnableSsh?: boolean, SshPort?: number,
 *   SshAuthorizedKeys?: string, EnablePublicNetworkSsh?: boolean, AllocationId?: string, NodeAffinity?: NodeAffinity
 * }} DeveloperCreateVariables
 * @typedef {CommonCreateVariables & {
 *   TrainJobName?: string, Framework?: string, Priority?: string, JobRunOnCPU?: boolean,
 *   Roles?: TrainingRole[], EntryPointCommand?: string
 * }} TrainingCreateVariables
 * @typedef {DeveloperCreateVariables | TrainingCreateVariables} CreateVariables
 * @typedef {{kind: 'dev', variables: Readonly<DeveloperCreateVariables>} | {kind: 'train', variables: Readonly<TrainingCreateVariables>}} PreparedCreate
 * @typedef {{graphql: (operation: string, query: string, variables: PlatformFields) => Promise<PlatformFields>, currentUser: () => Promise<Identity>}} CloudTransport
 * @typedef {(kind: ResourceKind, variables: CreateVariables) => Promise<PlatformFields>} CreateExecutor
 */
/** HTML numeric fields arrive as strings; decoding a model produces numbers.
 * @template T
 * @typedef {{[K in keyof T]: T[K] extends number ? number|string : T[K]}} FormInput
 */
export {};
