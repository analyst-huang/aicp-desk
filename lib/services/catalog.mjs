function hasActiveImageConfig(config) {
  const info = config?.ImageServiceInfo;
  const entries = Array.isArray(info) ? info : info ? [info] : [];
  return entries.some((item) => !item.Deleted);
}

/** Combines read-only cloud lookups into the options used by business workflows. */
export class CatalogService {
  constructor({ api }) { this.api = api; }

  async gpuCapacity(region) {
    return this.api.withSession(async () => {
      const resourcePools = await this.api.listResourcePools(region);
      const groups = await Promise.all(resourcePools.map(async (pool) => {
        const [gpu, queues, nodes] = await Promise.all([
          this.api.resourcePoolGpuInfo(pool.ResourcePoolId, region),
          this.api.listClusterQueues(pool.ResourcePoolId, region, { workloadType: null }),
          this.api.listResourcePoolInstances(pool.ResourcePoolId, region),
        ]);
        return { pool, gpu, queues, nodes };
      }));
      return { region: this.api.region(region), groups };
    });
  }

  async developerCreateOptions(region) {
    return this.api.withSession(async () => {
      const [projects, resourcePools, officialImages, personalImages, ks3Storage, kpfsStorage, imageRegistries, availableAddresses] = await Promise.all([
        this.api.listProjects(region),
        this.api.listResourcePools(region),
        this.api.listImages("Official", region),
        this.api.listImages("Personal", region),
        this.api.listStorageConfigs("KS3", region),
        this.api.listStorageConfigs("KPFS", region),
        this.api.listImageRegistries(region),
        this.api.listAvailableAddresses(region),
      ]);
      const queueGroups = await Promise.all(resourcePools.map(async (pool) => ({
        resourcePoolId: pool.ResourcePoolId,
        queues: await this.api.listClusterQueues(pool.ResourcePoolId, region),
        publicNetwork: await this.api.publicNetworkCondition(pool.ResourcePoolId, region),
      })));
      return {
        region: this.api.region(region),
        projects,
        resourcePools,
        queues: queueGroups.flatMap((group) => group.queues),
        publicNetworkByPool: Object.fromEntries(queueGroups.map((group) => [group.resourcePoolId, Boolean(group.publicNetwork?.IsAllow)])),
        images: { official: officialImages, personal: personalImages },
        storageConfigs: [...ks3Storage, ...kpfsStorage],
        imageRegistries: imageRegistries.filter((item) => ["Active", "4"].includes(item.RegistryStatus)),
        availableAddresses,
      };
    });
  }

  async trainingCreateOptions(region) {
    return this.api.withSession(async () => {
      const [resourcePools, officialImages, personalImages, ks3Storage, kpfsStorage, imageRegistries] = await Promise.all([
        this.api.listResourcePools(region),
        this.api.listImages("Official", region, { applicationScenario: "训练任务" }),
        this.api.listImages("Personal", region),
        this.api.listStorageConfigs("KS3", region),
        this.api.listStorageConfigs("KPFS", region),
        this.api.listImageRegistries(region),
      ]);
      const queueGroups = await Promise.all(resourcePools.map(async (pool) => ({
        resourcePoolId: pool.ResourcePoolId,
        queues: await this.api.listClusterQueues(pool.ResourcePoolId, region, { workloadType: "trainjob" }),
      })));
      return {
        region: this.api.region(region),
        resourcePools,
        queues: queueGroups.flatMap((group) => group.queues),
        images: { official: officialImages, personal: personalImages },
        storageConfigs: [...ks3Storage, ...kpfsStorage],
        imageRegistries: imageRegistries.filter((item) => ["Active", "4"].includes(item.RegistryStatus)),
      };
    });
  }

  async saveImageOptions(region) {
    return this.api.withSession(async () => {
      const [config, personalNamespaces, officialInstances] = await Promise.all([
        this.api.imageConfig(region),
        this.api.listSaveImageNamespaces("Personal", { region }),
        this.api.listKcrInstances(region),
      ]);
      return {
        region: this.api.region(region),
        personalConfigured: hasActiveImageConfig(config),
        personalNamespaces,
        officialInstances,
      };
    });
  }
}

export { hasActiveImageConfig };
