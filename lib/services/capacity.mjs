import { numberOrZero, numberOrNull, utilizationSummary, weightedUtilization } from './helpers.mjs';

export class CapacityService {
  constructor({ api, templates, config, services, now = Date.now }) {
    Object.assign(this, { api, templates, config, services, now });
  }

  async gpuCapacity(options = {}) {
    const sortGpu = options.sortGpu || "desc";
    if (!["asc", "desc"].includes(sortGpu)) throw new Error("sortGpu 必须是 asc 或 desc");
    const onlyFree = Boolean(options.onlyFree);
    const response = await this.api.gpuCapacity(options.region);
    const pools = (response.groups ?? []).map(({ pool, gpu, queues, nodes }) => {
      const totalGpu = numberOrZero(gpu?.Num);
      const assignedGpu = numberOrZero(gpu?.AssignedGpuNum);
      const unavailableGpu = numberOrZero(gpu?.UnavailableGpuNum);
      const averageGpuUtilization = numberOrNull(gpu?.GpuAverUtilization);
      const gpuUtilizationTrend = (gpu?.UsedRatio ?? []).map((point) => ({
        time: point.Time,
        value: numberOrNull(point.Val),
      })).filter((point) => point.value !== null);
      const trendSummary = utilizationSummary(gpuUtilizationTrend.map((point) => point.value));
      const availableValue = gpu?.AvailableGpuNum;
      const physicalFreeGpu = availableValue === null || availableValue === undefined
        ? numberOrZero(gpu?.FreeGpuNum)
        : numberOrZero(availableValue);
      const normalizedQueues = (queues ?? []).map((queue) => {
        const models = (queue.GpuModels ?? []).map((item) => ({
          model: item.Model,
          quotaGpu: numberOrZero(item.Quota),
        })).filter((item) => item.model || item.quotaGpu > 0);
        const quotaGpu = models.reduce((sum, item) => sum + item.quotaGpu, 0);
        const allocatedGpu = numberOrZero(queue.Status?.Allocated?.gpu);
        const hasGpuQuota = models.length > 0 || quotaGpu > 0;
        return {
          id: queue.Id,
          name: queue.Name,
          queueType: queue.QueueType,
          workloadTypes: Array.isArray(queue.WorkloadType) ? queue.WorkloadType : [queue.WorkloadType].filter(Boolean),
          allowBorrowing: Boolean(queue.AllowBorrowing),
          state: queue.Status?.State,
          running: numberOrZero(queue.Status?.Running),
          inqueue: numberOrZero(queue.Status?.Inqueue),
          models,
          quotaGpu: hasGpuQuota ? quotaGpu : null,
          allocatedGpu: hasGpuQuota ? allocatedGpu : null,
          quotaRemainingGpu: hasGpuQuota ? Math.max(0, quotaGpu - allocatedGpu) : null,
          borrowedGpu: hasGpuQuota ? Math.max(0, allocatedGpu - quotaGpu) : null,
        };
      });
      const allNodes = (nodes ?? []).map((node) => {
        const allocatableGpu = numberOrZero(node.Gpu?.Allocatable ?? node.Gpu?.Num);
        const allocatedGpu = numberOrZero(node.Gpu?.Allocated);
        const allocatableMemoryGiB = numberOrZero(node.Memory?.Allocatable ?? node.Memory?.MemorySize ?? node.Memory?.Count);
        const allocatedMemoryGiB = numberOrZero(node.Memory?.Allocated);
        const allocatableCpu = numberOrZero(node.Cpu?.Allocatable ?? node.Cpu?.CoreCount);
        const allocatedCpu = numberOrZero(node.Cpu?.Allocated);
        return {
          id: node.InstanceId,
          name: node.InstanceName,
          ip: node.InstanceIp,
          status: node.InstanceStatus,
          statusName: node.InstanceStatusName,
          schedulable: !Boolean(node.UnSchedulable),
          isGpu: Boolean(node.IsGpu || allocatableGpu > 0),
          gpuModel: node.Gpu?.Model || node.GpuType || null,
          gpuUtilization: numberOrNull(node.Gpu?.GpuUtilization),
          allocatableGpu,
          allocatedGpu,
          remainingGpu: Math.max(0, allocatableGpu - allocatedGpu),
          allocatableMemoryGiB,
          allocatedMemoryGiB,
          remainingMemoryGiB: Math.max(0, allocatableMemoryGiB - allocatedMemoryGiB),
          allocatableCpu,
          allocatedCpu,
          remainingCpu: Math.max(0, allocatableCpu - allocatedCpu),
        };
      });
      const normalizedNodes = allNodes.filter((node) => !onlyFree || (node.schedulable && node.remainingGpu > 0)).sort((left, right) => (
        (sortGpu === "asc" ? 1 : -1) * (left.remainingGpu - right.remainingGpu)
        || right.remainingMemoryGiB - left.remainingMemoryGiB
        || String(left.name || left.ip).localeCompare(String(right.name || right.ip), "zh-CN")
      ));
      return {
        id: pool.ResourcePoolId,
        name: pool.ResourcePoolName,
        type: pool.ResourcePoolType,
        totalGpu,
        assignedGpu,
        physicalFreeGpu,
        unavailableGpu,
        averageGpuUtilization,
        meanGpuUtilization: trendSummary.mean,
        maxGpuUtilization: trendSummary.max,
        gpuUtilizationTrend,
        queues: normalizedQueues,
        nodes: normalizedNodes,
        nodeCount: allNodes.length,
        gpuNodeCount: allNodes.filter((node) => node.isGpu).length,
        matchedNodeCount: normalizedNodes.length,
      };
    });
    return {
      region: response.region || options.region || this.config.region,
      refreshedAt: new Date(this.now()).toISOString(),
      summary: {
        poolCount: pools.length,
        totalGpu: pools.reduce((sum, pool) => sum + pool.totalGpu, 0),
        physicalFreeGpu: pools.reduce((sum, pool) => sum + pool.physicalFreeGpu, 0),
        averageGpuUtilization: weightedUtilization(pools, "averageGpuUtilization"),
        meanGpuUtilization: weightedUtilization(pools, "meanGpuUtilization"),
        maxGpuUtilization: pools.reduce((maximum, pool) => (
          pool.maxGpuUtilization === null ? maximum : Math.max(maximum ?? pool.maxGpuUtilization, pool.maxGpuUtilization)
        ), null),
        gpuQueueCount: pools.reduce((sum, pool) => sum + pool.queues.filter((queue) => queue.quotaGpu !== null).length, 0),
        nodeCount: pools.reduce((sum, pool) => sum + pool.nodeCount, 0),
        gpuNodeCount: pools.reduce((sum, pool) => sum + pool.gpuNodeCount, 0),
        matchedNodeCount: pools.reduce((sum, pool) => sum + pool.matchedNodeCount, 0),
      },
      filters: { onlyFree, sortGpu },
      pools,
    };
  }
}
