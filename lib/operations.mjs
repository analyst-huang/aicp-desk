export const DESCRIBE_NOTEBOOKS = `
  query DescribeNotebook(
    $Region: String!
    $NotebookId: String
    $Name: String
    $QueueId: String
    $State: String
    $UserName: String
    $Marker: Float
    $MaxResults: Float
    $SkipUserPermissionCheck: Boolean
  ) {
    DescribeNotebook(
      Region: $Region
      NotebookId: $NotebookId
      Name: $Name
      QueueId: $QueueId
      State: $State
      UserName: $UserName
      Marker: $Marker
      MaxResults: $MaxResults
      SkipUserPermissionCheck: $SkipUserPermissionCheck
    ) {
      RequestId
      TotalCount
      Marker
      MaxResults
      Notebooks {
        NotebookId
        Name
        State
        ImageSaveStatus
        GPUType
        GPUNumber
        CpuNum
        Memory
        ResourcePoolId
        ResourcePoolName
        ResourcePoolType
        QueueId
        QueueName
        AccessType
        AutoSave
        RunOnCpu
        AllocationId
        EnableSsh
        SshPort
        EnablePublicNetworkSsh
        PodIp
        ExternalIp
        CreateUser
        CreateTime
        StartTime
        EndTime
      }
    }
  }
`;

export const DESCRIBE_NOTEBOOK_DETAIL = `
  query DescribeNotebookDetail($Region: String!, $NotebookId: String) {
    DescribeNotebookDetail(Region: $Region, NotebookId: $NotebookId) {
      RequestId
      NotebookDetail {
        NotebookId
        Name
        Type
        Description
        State
        AutoSave
        ResourcePoolId
        ResourcePoolName
        ResourcePoolType
        ClusterId
        ImageSource
        ImageRegistryId
        ImageRepoId
        ImageTagId
        ImageUrl
        ImageId
        ImageName
        GPUType
        GPUNumber
        QueueName
        QueueId
        AccessType
        AllocationId
        EnableSsh
        SshPort
        SshAuthorizedKeys
        EnablePublicNetworkSsh
        CpuNum
        Memory
        RunOnCpu
        StorageConfigs {
          StorageType
          StorageConfigId
          StorageConfigName
          MountPath
          StorageConfigType
          MountProtocol
        }
        VolumeConfigs {
          StorageType
          StorageConfigId
          StorageConfigName
          MountPath
          StorageConfigType
          MountProtocol
        }
        DataSetConfigs {
          StorageType
          StorageConfigId
          StorageConfigName
          MountPath
          StorageConfigType
          MountProtocol
        }
        Envs { Name Value }
        ServiceConfigs { Service Port EnablePublicNetwork }
        AutoSaveConfig {
          ImageType
          OfficialInstance
          OfficialInstanceName
          Namespace
          ImageRepo
          UserName
          Password
        }
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

export const DESCRIBE_ALL_RESOURCE_POOLS = `
  query DescribeAllResourcePool($Region: String!, $ResourcePoolType: String, $Status: String) {
    DescribeAllResourcePool(Region: $Region, ResourcePoolType: $ResourcePoolType, Status: $Status) {
      RequestId
      TotalCount
      ResourcePoolSet {
        ResourcePoolId
        ResourcePoolName
        ResourcePoolType
        ClusterId
        Purpose
        VpcId
        EnableKPFS
        Components
      }
    }
  }
`;

export const DESCRIBE_CLUSTER_QUEUES = `
  query DescribeClusterQueue(
    $Region: String!
    $ResourcePoolId: String
    $Marker: Float
    $MaxResults: Float
    $State: String
    $WorkloadType: String
  ) {
    DescribeClusterQueue(
      Region: $Region
      ResourcePoolId: $ResourcePoolId
      Marker: $Marker
      MaxResults: $MaxResults
      State: $State
      WorkloadType: $WorkloadType
    ) {
      RequestId
      TotalCount
      Queues {
        Id
        ResourcePoolId
        ResourcePoolName
        Name
        Desc
        AllowBorrowing
        IntanceModels
        IntanceQuotas
        GpuModels { Model Quota }
        WorkloadType
        QueueType
        NodeCount
        NodeSelectType
        Status { State Running Inqueue }
      }
    }
  }
`;

export const DESCRIBE_AICP_IMAGES = `
  query DescribeAicpImages(
    $Region: String!
    $ImageSource: String!
    $ImageId: String
    $ImageName: String
    $ImageStatuses: String
    $ApplicationScenario: String
    $Page: Float
    $PageSize: Float
  ) {
    DescribeAicpImages(
      Region: $Region
      ImageSource: $ImageSource
      ImageId: $ImageId
      ImageName: $ImageName
      ImageStatuses: $ImageStatuses
      ApplicationScenario: $ApplicationScenario
      Page: $Page
      PageSize: $PageSize
    ) {
      RequestId
      TotalCount
      ImageSet {
        ImageId
        ImageName
        ImageSource
        Description
        ImageType
        ImageFrame
        PythonVersion
        CudaVersion
        ImageSize
        ImageStatus
        ImageRepo
        ImageVersion
        ImagePermission
        CreateUserName
        HubUrl
        SaveMethod
      }
    }
  }
`;

export const DATA_SET_LIST = `
  query DataSetList($Region: String!, $Type: String, $Page: Float, $PageSize: Float) {
    DataSetList(Region: $Region, Type: $Type, Page: $Page, PageSize: $PageSize) {
      RequestId
      TotalCount
      StorageConfigSet {
        StorageConfigName
        StorageConfigId
        Description
        Type
        Purpose
        KpfsInfo { MountPath MntProtocol StoreClass }
        Ks3Info { MountPath Endpoint }
      }
    }
  }
`;

export const DESCRIBE_IMAGE_REGISTRIES = `
  query DescribeImageRegistry($Region: String!, $Marker: Float, $MaxResults: Float) {
    DescribeImageRegistry(Region: $Region, Marker: $Marker, MaxResults: $MaxResults) {
      RequestId
      TotalCount
      ImageRegistryInfo { Id Name RegistryDomain RegistryStatus RegistryModel RegistryConfigType }
    }
  }
`;

export const DESCRIBE_REGISTRY_REPOS = `
  query DescribeRegistryRepo($Region: String!, $ImageRegistryId: String, $Marker: Float, $MaxResults: Float) {
    DescribeRegistryRepo(Region: $Region, ImageRegistryId: $ImageRegistryId, Marker: $Marker, MaxResults: $MaxResults) {
      RequestId
      TotalCount
      ImageRegistryRepoInfo { RegistryId RepoName RepoId TagNum }
    }
  }
`;

export const DESCRIBE_REPO_TAGS = `
  query DescribeRepoTag($Region: String!, $ImageRegistryId: String, $RepoId: String, $Marker: Float, $MaxResults: Float) {
    DescribeRepoTag(Region: $Region, ImageRegistryId: $ImageRegistryId, RepoId: $RepoId, Marker: $Marker, MaxResults: $MaxResults) {
      RequestId
      TotalCount
      ImageRegistryTagInfo { TagId RepoId TagName }
    }
  }
`;

export const DESCRIBE_QUEUE_RESOURCE_CONFIG = `
  query DescribeQueueResourceConfigInfo(
    $Region: String!
    $QueueId: String!
    $OnlyCpuNode: Boolean
    $GpuModel: String
    $GpuNum: Float
  ) {
    DescribeQueueResourceConfigInfo(
      Region: $Region
      QueueId: $QueueId
      OnlyCpuNode: $OnlyCpuNode
      GpuModel: $GpuModel
      GpuNum: $GpuNum
    ) {
      Msg
      Data {
        RequestId
        ResourceInfos {
          Memory { TotalUserAllocatable UserAllocatable }
          Cpu { TotalUserAllocatable UserAllocatable }
          Gpu { TotalUserAllocatable UserAllocatable }
          MntProtocols
          GpuType
          GpuModel
          IsGpuNode
          GpuRatio
          GpuRecommendNum
          CpuRecommendNum
          MemoryRecommendNum
        }
      }
    }
  }
`;

export const DESCRIBE_INSTANCES_BY_RESOURCE = `
  query DescribeInstancesByResource(
    $Region: String!
    $QueueId: String!
    $CpuNum: Int
    $GpuModel: String
    $GpuNum: String
    $MemNum: Int
  ) {
    DescribeInstancesByResource(
      Region: $Region
      QueueId: $QueueId
      CpuNum: $CpuNum
      GpuModel: $GpuModel
      GpuNum: $GpuNum
      MemNum: $MemNum
    ) {
      RequestId
      InstanceIps { InstanceId InstanceName InstanceIp }
    }
  }
`;

export const QUERY_PUBLIC_NETWORK_CONDITION = `
  query QueryPublicNetworkCondition($Region: String!, $ResourcePoolId: String) {
    QueryPublicNetworkCondition(Region: $Region, ResourcePoolId: $ResourcePoolId) {
      RequestId
      IsAllow
    }
  }
`;

export const DESCRIBE_AVAILABLE_ADDRESSES = `
  query DescribleNoUseAddress(
    $Region: String!
    $MaxResults: Float!
    $IpVersion: String!
    $IamProjectId: String
  ) {
    DescribleNoUseAddress(
      Region: $Region
      MaxResults: $MaxResults
      IpVersion: $IpVersion
      IamProjectId: $IamProjectId
    ) {
      RequestId
      TotalCount
      AddressesSet {
        AllocationId
        PublicIp
        State
        BandWidth
      }
    }
  }
`;

export const CREATE_NOTEBOOK = `
  mutation CreateNotebook(
    $Region: String!
    $DisplayName: String!
    $Description: String
    $Type: String
    $ImageUrl: String
    $ClusterId: String
    $ImageId: String
    $ImageSource: Float
    $ImageRegistryId: String
    $ImageRepoId: String
    $ImageTagId: String
    $AutoSave: Boolean
    $ResourcePoolId: String
    $QueueName: String
    $GPUType: String
    $GPUNumber: Float
    $AccessType: String
    $StorageConfigs: [StorageConfigs!]
    $AllocationId: String
    $EnableSsh: Boolean
    $SshPort: Float
    $SshAuthorizedKeys: String
    $EnablePublicNetworkSsh: Boolean
    $CpuNum: Float
    $Memory: Float
    $ServiceConfigs: [ServiceConfigReqItem!]
    $UserName: String
    $Password: String
    $CreateImageConfig: Boolean
    $AutoSaveConfig: AutoSaveConfigInput
    $RunOnCpu: Boolean
    $Envs: [Envs!]
    $NodeAffinity: InputNodeAffinity
  ) {
    CreateNotebook(
      Region: $Region
      DisplayName: $DisplayName
      Description: $Description
      Type: $Type
      ImageUrl: $ImageUrl
      ClusterId: $ClusterId
      ImageId: $ImageId
      ImageSource: $ImageSource
      ImageRegistryId: $ImageRegistryId
      ImageRepoId: $ImageRepoId
      ImageTagId: $ImageTagId
      AutoSave: $AutoSave
      ResourcePoolId: $ResourcePoolId
      QueueName: $QueueName
      GPUType: $GPUType
      GPUNumber: $GPUNumber
      AccessType: $AccessType
      StorageConfigs: $StorageConfigs
      AllocationId: $AllocationId
      EnableSsh: $EnableSsh
      SshPort: $SshPort
      SshAuthorizedKeys: $SshAuthorizedKeys
      EnablePublicNetworkSsh: $EnablePublicNetworkSsh
      CpuNum: $CpuNum
      Memory: $Memory
      ServiceConfigs: $ServiceConfigs
      UserName: $UserName
      Password: $Password
      CreateImageConfig: $CreateImageConfig
      AutoSaveConfig: $AutoSaveConfig
      RunOnCpu: $RunOnCpu
      Envs: $Envs
      NodeAffinity: $NodeAffinity
    ) {
      RequestId
      NotebookId
    }
  }
`;

export const MODIFY_NOTEBOOK_STATUS = `
  mutation ModifyNotebookStatus($Region: String!, $NotebookId: String!, $Status: String!, $Force: Boolean) {
    ModifyNotebookStatus(Region: $Region, NotebookId: $NotebookId, Status: $Status, Force: $Force) {
      RequestId
      Return
    }
  }
`;

export const BATCH_DELETE_NOTEBOOKS = `
  mutation BatchDeleteNotebook($Region: String!, $NotebookIds: [String!]!) {
    BatchDeleteNotebook(Region: $Region, NotebookIds: $NotebookIds) {
      RequestId
      Results { NotebookId Return ErrorMessage }
    }
  }
`;

export const SAVE_NOTEBOOK_IMAGE = `
  mutation SaveNotebookImage(
    $Region: String!
    $NotebookId: String!
    $ImageName: String!
    $Description: String
    $ImageType: String
    $Namespace: String
    $NamespacePermission: String
    $ImageRepo: String
    $ImageVersion: String
    $ImageDomain: String
    $OfficialInstance: String
    $UserName: String
    $Password: String
    $ImagePermission: String
    $RegistryInstanceId: String
    $CreateImageConfig: Boolean
  ) {
    SaveNotebookImage(
      Region: $Region
      NotebookId: $NotebookId
      ImageName: $ImageName
      Description: $Description
      ImageType: $ImageType
      Namespace: $Namespace
      NamespacePermission: $NamespacePermission
      ImageRepo: $ImageRepo
      ImageVersion: $ImageVersion
      ImageDomain: $ImageDomain
      OfficialInstance: $OfficialInstance
      UserName: $UserName
      Password: $Password
      ImagePermission: $ImagePermission
      RegistryInstanceId: $RegistryInstanceId
      CreateImageConfig: $CreateImageConfig
    ) {
      RequestId
      ImageId
    }
  }
`;

export const GET_IMAGE_CONFIG = `
  query GetImageConfig($Region: String!) {
    GetImageConfig(Region: $Region) {
      RequestId
      TotalCount
      ImageServiceInfo { Id CreateUser CreateTime Deleted }
    }
  }
`;

export const DESCRIBE_KCR_INSTANCES = `
  query DescribeKcrInstances($Region: String!) {
    DescribeKcrInstances(Region: $Region) {
      data {
        InstanceId
        InstanceName
        InstanceType
        InstanceStatus
        PublicDomain
        InternalEndpoint
      }
    }
  }
`;

export const DESCRIBE_PERSONAL_NAMESPACES = `
  query DescribePersonalNamespaces($Region: String!) {
    DescribePersonalNamespaces(Region: $Region) {
      data { Namespace Public RepoCount InternalEndpoint }
    }
  }
`;

export const DESCRIBE_NAMESPACES = `
  query DescribeNamespaces($Region: String!, $InstanceId: String!) {
    DescribeNamespaces(Region: $Region, InstanceId: $InstanceId) {
      data { Namespace Public RepoCount InternalEndpoint }
    }
  }
`;

export const DESCRIBE_PERSONAL_REPOSITORIES = `
  query DescribePersonalRepositories($Region: String!, $Namespace: String!) {
    DescribePersonalRepositories(Region: $Region, Namespace: $Namespace) {
      data { RepoName Public Description }
    }
  }
`;

export const DESCRIBE_REPOSITORIES = `
  query DescribeRepositories($Region: String!, $Namespace: String!, $InstanceId: String!) {
    DescribeRepositories(Region: $Region, Namespace: $Namespace, InstanceId: $InstanceId) {
      data { RepoName Public Description }
    }
  }
`;

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
        QueueName
        Description
        Priority
        Framework
        RuntimeEnv
        EntryPointCommand
        AccessType
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
