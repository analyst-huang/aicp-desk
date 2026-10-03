export const DESCRIBE_TRAIN_JOBS = `
  query DescribeTrainJobs(
    $Region: String!
    $TrainJobIds: [String!]
    $TrainJobName: String
    $Page: Int
    $PageSize: Int
    $TrainJobStatus: [String!]
    $SkipUserPermissionCheck: Boolean
    $CreateUser: String
    $QueueId: String
    $GpuType: [String!]
    $Priority: [String!]
    $Framework: [String!]
    $UseIdleResource: Boolean
  ) {
    DescribeTrainJobs(
      Region: $Region
      TrainJobIds: $TrainJobIds
      TrainJobName: $TrainJobName
      Page: $Page
      PageSize: $PageSize
      TrainJobStatus: $TrainJobStatus
      SkipUserPermissionCheck: $SkipUserPermissionCheck
      CreateUser: $CreateUser
      QueueId: $QueueId
      GpuType: $GpuType
      Priority: $Priority
      Framework: $Framework
      UseIdleResource: $UseIdleResource
    ) {
      RequestId
      TotalCount
      Page
      PageSize
      TrainJobSet {
        TrainJobId
        TrainJobName
        ResourcePoolId
        ResourcePoolName
        ResourcePoolType
        QueueName
        Framework
        RuntimeEnv
        EntryPointCommand
        Priority
        AccessType
        UseIdleResource
        JobRunOnCPU
        CreateUserId
        CreateUserName
        JobStatus {
          Status
          SubmitTime
          StartTime
          EndTime
          Message
          ExecutionTime
        }
        Roles {
          RoleName
          Replicas
          ResourceConfig { GPUType GPUNumber CPUNum Memory }
        }
      }
    }
  }
`;

export const DESCRIBE_TRAIN_JOB_DETAIL = `
  query DescribeTrainJobDetail($Region: String!, $TrainJobId: String!) {
    DescribeTrainJobDetail(Region: $Region, TrainJobId: $TrainJobId) {
      RequestId
      TrainJob {
        ResourcePoolName
        CreateUserName
        TrainJobName
        TrainJobId
        ResourcePoolId
        ResourcePoolType
        ClusterId
        Namespace
        RebootNumber
        QueueName
        Description
        Priority
        Framework
        RuntimeEnv
        EntryPointCommand
        AccessType
        JobStatus {
          Status
          SubmitTime
          StartTime
          EndTime
          Message
          ExecutionTime
        }
        SelfHealing
        UseIdleResource
        MaxRuntimeHour
        HoldingTimeMinutes
        JobRunOnCPU
        SupportTensorboard
        StorageConfigs {
          StorageConfigId
          StorageConfigName
          Type
          MountType
          MountPath
          MountProtocol
          StorageSubPath
        }
        Roles {
          RoleName
          Replicas
          IsChiefRole
          DefaultPort
          AdditionalPort
          ImageConfig {
            ImageId
            ImageSource
            ImageName
            ImageRegistryId
            ImageRepoId
            ImageTagId
            ImageRegistryName
            ImageRepoName
            ImageTagName
          }
          Envs { Name Value }
          RunCommand
          ResourceConfig { GPUType GPUNumber CPUNum Memory }
          RestartPolicy
        }
        EnableDeviceHealthCheck
        DeviceHealthCheckConfig { CheckTiming MaxCheckTime }
        NodeAffinity {
          RunOnCPU
          RunOnGPU
          RequiredNodeIp
          RequiredNodeLabels { LabelKey LabelValue }
        }
      }
    }
  }
`;

export const DESCRIBE_QUEUE_JOB_PODS = `
  query DescribeQueueJobPod(
    $Region: String!
    $ClusterId: String
    $ResourcePoolId: String
    $JobName: String!
    $Role: String
    $Name: String
    $State: String
    $Marker: Float
    $MaxResults: Float
  ) {
    DescribeQueueJobPod(
      Region: $Region
      ClusterId: $ClusterId
      ResourcePoolId: $ResourcePoolId
      JobName: $JobName
      Role: $Role
      Name: $Name
      State: $State
      Marker: $Marker
      MaxResults: $MaxResults
    ) {
      RequestId
      TotalCount
      Marker
      MaxResults
      Pods {
        JobName
        Role
        Name
        NameSpace
        Kind
        ContainerName
        StartTimes
        Status {
          State
          ContainerState
          SubmitTime
          StartTime
          EndTime
          Ip
          RestartCount
          ResultCode
          ResultMsg
          DeviceHealthCheckState
        }
      }
    }
  }
`;

export const DESCRIBE_QUEUE_JOB_LOG = `
  query DescribeQueueJobLog(
    $Region: String!
    $ClusterId: String
    $PodName: String!
    $ResourcePoolId: String
    $JobName: String!
    $SinceSeconds: Float
    $TailLines: Float
  ) {
    DescribeQueueJobLog(
      Region: $Region
      PodName: $PodName
      ClusterId: $ClusterId
      ResourcePoolId: $ResourcePoolId
      JobName: $JobName
      SinceSeconds: $SinceSeconds
      TailLines: $TailLines
    ) {
      RequestId
      PodLogs
    }
  }
`;

export const CREATE_TRAIN_JOB = `
  mutation CreateTrainJob(
    $Region: String!
    $TrainJobName: String!
    $Description: String
    $ResourcePoolId: String!
    $Priority: String
    $QueueName: String!
    $Framework: String!
    $AccessType: String
    $SelfHealing: Boolean
    $UseIdleResource: Boolean
    $MaxRuntimeHour: Float
    $HoldingTimeMinutes: Float
    $JobRunOnCPU: Boolean
    $SupportTensorboard: Boolean
    $StorageConfigs: [TrainJobStorageConfigs!]!
    $Roles: [TrainJobRoles!]!
    $EnableDeviceHealthCheck: Boolean
    $DeviceHealthCheckConfig: DeviceHealthCheckConfigInput
    $NodeAffinity: InputNodeAffinity
    $RuntimeEnv: String
    $EntryPointCommand: String
  ) {
    CreateTrainJob(
      Region: $Region
      TrainJobName: $TrainJobName
      Description: $Description
      ResourcePoolId: $ResourcePoolId
      Priority: $Priority
      QueueName: $QueueName
      Framework: $Framework
      AccessType: $AccessType
      SelfHealing: $SelfHealing
      UseIdleResource: $UseIdleResource
      MaxRuntimeHour: $MaxRuntimeHour
      HoldingTimeMinutes: $HoldingTimeMinutes
      JobRunOnCPU: $JobRunOnCPU
      SupportTensorboard: $SupportTensorboard
      StorageConfigs: $StorageConfigs
      Roles: $Roles
      EnableDeviceHealthCheck: $EnableDeviceHealthCheck
      DeviceHealthCheckConfig: $DeviceHealthCheckConfig
      NodeAffinity: $NodeAffinity
      RuntimeEnv: $RuntimeEnv
      EntryPointCommand: $EntryPointCommand
    ) {
      RequestId
      TrainJobId
    }
  }
`;

export const BATCH_START_TRAIN_JOBS = `
  mutation BatchStartQueueJobs($Region: String!, $StartQueueJobRequests: [StartQueueJobRequests!]!) {
    BatchStartQueueJobs(Region: $Region, StartQueueJobRequests: $StartQueueJobRequests) {
      RequestId
      Results { JobName Return ErrorMessage }
    }
  }
`;

export const BATCH_STOP_TRAIN_JOBS = `
  mutation BatchStopQueueJobs($Region: String!, $StopQueueJobRequests: [StopQueueJobRequests!]!) {
    BatchStopQueueJobs(Region: $Region, StopQueueJobRequests: $StopQueueJobRequests) {
      RequestId
      Results { JobName Return ErrorMessage }
    }
  }
`;

export const BATCH_DELETE_TRAIN_JOBS = `
  mutation BatchDeleteQueueJobs($Region: String!, $DeleteQueueJobRequests: [DeleteQueueJobRequests!]!) {
    BatchDeleteQueueJobs(Region: $Region, DeleteQueueJobRequests: $DeleteQueueJobRequests) {
      RequestId
      Results { JobName Return ErrorMessage }
    }
  }
`;
