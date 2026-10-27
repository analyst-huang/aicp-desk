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
        EnableVolume
        VolumeConfig { VolumeType VolumeSize VolumeId }
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
        ProjectId
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
        ShareMemory
        EnableCustomShareMemory
        EnableVolume
        VolumeConfig { VolumeType VolumeSize AvailabilityZone VolumeId VolumeName VolumeStatus ErrorCode }
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
    $ShareMemory: Float
    $EnableCustomShareMemory: Boolean
    $EnableVolume: Boolean
    $VolumeConfig: VolumeConfigReqParam
    $ServiceConfigs: [ServiceConfigReqItem!]
    $UserName: String
    $Password: String
    $CreateImageConfig: Boolean
    $AutoSaveConfig: AutoSaveConfigInput
    $RunOnCpu: Boolean
    $Envs: [Envs!]
    $NodeAffinity: InputNodeAffinity
    $ProjectId: Float!
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
      ShareMemory: $ShareMemory
      EnableCustomShareMemory: $EnableCustomShareMemory
      EnableVolume: $EnableVolume
      VolumeConfig: $VolumeConfig
      ServiceConfigs: $ServiceConfigs
      UserName: $UserName
      Password: $Password
      CreateImageConfig: $CreateImageConfig
      AutoSaveConfig: $AutoSaveConfig
      RunOnCpu: $RunOnCpu
      Envs: $Envs
      NodeAffinity: $NodeAffinity
      ProjectId: $ProjectId
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
  mutation BatchDeleteNotebook($Region: String!, $DeleteNotebookReqs: [DeleteNotebookItem!]!) {
    BatchDeleteNotebook(Region: $Region, DeleteNotebookReqs: $DeleteNotebookReqs) {
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
