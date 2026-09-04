import { readFile } from "node:fs/promises";
import { applySetOverrides, clone, readVariablesFile } from "./utils.mjs";
import { notebookDetailToVariables, trainDetailToVariables } from "./templates.mjs";

const DEV_RUNNING_STATES = new Set(["running", "starting", "pending", "deploying"]);
const DEV_STOPPED_STATES = new Set(["stopped", "failed", "succeed"]);
const TRAIN_ACTIVE_STATES = new Set(["running", "submit", "pending", "deploying", "restarting", "succeed_holding", "failed_holding"]);
const TRAIN_TERMINAL_STATES = new Set(["stopped", "succeed", "failed"]);
const TRAIN_LOG_PENDING_STATES = new Set(["submit", "pending", "deploying", "restarting", "starting"]);

function exactMatches(items, selector, idKey, nameKey) {
  const byId = items.filter((item) => item[idKey] === selector);
  if (byId.length) return byId;
  return items.filter((item) => item[nameKey] === selector);
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/%$/, ""));
  return Number.isFinite(number) ? number : null;
}

function rounded(value) {
  return Math.round(value * 100) / 100;
}

function utilizationSummary(values) {
  const numbers = values.filter((value) => value !== null);
  if (!numbers.length) return { mean: null, max: null };
  return {
    mean: rounded(numbers.reduce((sum, value) => sum + value, 0) / numbers.length),
    max: Math.max(...numbers),
  };
}

function weightedUtilization(pools, key) {
  const measured = pools.filter((pool) => pool[key] !== null && pool.totalGpu > 0);
  if (!measured.length) return null;
  const totalGpu = measured.reduce((sum, pool) => sum + pool.totalGpu, 0);
  return rounded(measured.reduce((sum, pool) => sum + pool[key] * pool.totalGpu, 0) / totalGpu);
}

export function trainingMonitor(detail, item, now = Date.now()) {
  const clusterId = detail?.ClusterId;
  const trainJobId = detail?.TrainJobId || item?.TrainJobId;
  const jobStatus = detail?.JobStatus || item?.JobStatus || {};
  const start = Date.parse(jobStatus.StartTime || "");
  if (!clusterId || !trainJobId || !Number.isFinite(start)) {
    return {
      available: false,
      reason: !clusterId ? "任务没有可用的集群监控入口" : "任务尚未产生可监控的运行时间",
    };
  }

  const parsedEnd = Date.parse(jobStatus.EndTime || "");
  const end = Number.isFinite(parsedEnd) ? parsedEnd : now;
  const rebootNumber = numberOrZero(detail?.RebootNumber);
  const monitoredJobId = rebootNumber > 0 ? `${trainJobId}-${rebootNumber}` : trainJobId;
  const namespace = detail?.Namespace || "kaic-job";
  const parameters = new URLSearchParams({
    orgId: "1",
    "var-namespace": namespace,
    "var-job_id": monitoredJobId,
    "var-pod": "All",
    "var-hostname": "All",
    "var-gpu": "All",
    from: String(start),
    to: String(end),
    kiosk: "tv",
  });
  return {
    available: true,
    url: `https://ksp.console.ksyun.com/webide-proxy/grafana/${encodeURIComponent(clusterId)}/kaic-grafana/d/ezyy84dHz/kaic-dashboard?${parameters}`,
    startTime: new Date(start).toISOString(),
    endTime: new Date(end).toISOString(),
    live: !Number.isFinite(parsedEnd),
  };
}

function metricNumber(raw) {
  const text = String(raw ?? "").replace(/\u00a0/g, " ").trim();
  const match = /^([-+]?\d+(?:\.\d+)?)\s*(.*)$/.exec(text);
  if (!match) return { value: null, unit: null, raw: text || null };
  return {
    value: Number(match[1]),
    unit: match[2].trim() || null,
    raw: text,
  };
}

const TRAIN_GPU_PANEL_DEFINITIONS = Object.freeze({
  "GPU 利用率": { key: "utilization", unit: "%" },
  "GPU 平均温度": { key: "temperature", unit: "°C" },
  "GPU 总功率": { key: "power", unit: "kW" },
  "GPU 显存": { key: "memory", unit: "GiB" },
  "Tensor Core 利用率": { key: "tensorCore", unit: "%" },
});

function metricValueInUnit(metric, unit) {
  if (metric.value === null || !metric.unit || metric.unit === unit) return metric.value;
  if (metric.unit === "MiB" && unit === "GiB") return rounded(metric.value / 1024);
  if (metric.unit === "GiB" && unit === "MiB") return rounded(metric.value * 1024);
  if (metric.unit === "W" && unit === "kW") return rounded(metric.value / 1000);
  if (metric.unit === "kW" && unit === "W") return rounded(metric.value * 1000);
  return metric.value;
}

export function normalizeTrainingGpuSnapshot(snapshot) {
  const panels = {};
  for (const panel of snapshot?.panels ?? []) {
    const definition = TRAIN_GPU_PANEL_DEFINITIONS[panel.title];
    if (!definition) continue;
    const { key, unit } = definition;
    if (panel.rows?.length) {
      const rows = panel.rows.map((row) => {
        const last = metricNumber(row[1]);
        const mean = metricNumber(row[2]);
        const max = metricNumber(row[3]);
        return {
          name: String(row[0] ?? "").trim(),
          last: metricValueInUnit(last, unit),
          mean: metricValueInUnit(mean, unit),
          max: metricValueInUnit(max, unit),
          raw: {
            last: last.raw,
            mean: mean.raw,
            max: max.raw,
          },
          unit,
        };
      }).filter((row) => row.name);
      panels[key] = {
        title: panel.title,
        unit,
        rows,
      };
      continue;
    }
    const metric = metricNumber(panel.value);
    panels[key] = {
      title: panel.title,
      value: metricValueInUnit(metric, unit),
      unit,
      raw: metric.raw,
    };
  }
  return panels;
}

function trainingLogState(item, pod) {
  return String(
    pod?.Status?.State
    ?? pod?.Status?.ContainerState
    ?? item?.JobStatus?.Status
    ?? "",
  ).trim();
}

function isTrainingLogPending(item, pod) {
  const state = trainingLogState(item, pod).toLowerCase();
  return TRAIN_LOG_PENDING_STATES.has(state)
    || /pending|deploying|creating|initializing|waiting|starting/.test(state);
}

function rethrowTrainingLogError(error, item, pod) {
  if (/Kaic-K8sAccessFault/i.test(String(error?.message ?? error)) && isTrainingLogPending(item, pod)) {
    const state = trainingLogState(item, pod);
    const suffix = state ? `（当前状态：${state}）` : "";
    throw new Error(`Pod 尚未就绪${suffix}，请稍后重试`, { cause: error });
  }
  throw error;
}

export class AicpService {
  constructor(api, templates, config) {
    this.api = api;
    this.templates = templates;
    this.config = config;
  }

  async listDevelopers(options = {}) {
    const identity = options.mine ? await this.currentUser() : null;
    return this.api.listNotebooks({
      limit: options.limit ?? 100,
      username: options.mine ? this.creatorUsername(identity) : options.username,
      state: options.state,
      region: options.region,
    });
  }

  async resolveDeveloper(selector, options = {}) {
    const response = await this.api.listNotebooks({
      id: selector.startsWith("kaic-") ? selector : undefined,
      name: selector.startsWith("kaic-") ? undefined : selector,
      limit: 100,
      region: options.region,
    });
    const matches = exactMatches(response.Notebooks ?? [], selector, "NotebookId", "Name");
    if (!matches.length) throw new Error(`找不到开发机：${selector}`);
    if (matches.length > 1) throw new Error(`开发机名称不唯一，请改用 ID：${selector}`);
    return matches[0];
  }

  async startDeveloper(selector, options = {}) {
    const item = await this.resolveDeveloper(selector, options);
    const state = String(item.State).toLowerCase();
    if (DEV_RUNNING_STATES.has(state)) return { noop: true, item, message: "开发机已在运行或启动中" };
    if (state === "stopping") return { noop: true, item, message: "开发机正在停止，请停止完成后再启动" };
    if (!DEV_STOPPED_STATES.has(state)) return { noop: true, item, message: `开发机当前状态“${item.State || "未知"}”不能启动` };
    const result = await this.api.setNotebookStatus(item.NotebookId, "start", options);
    return { noop: false, item, result };
  }

  async stopDeveloper(selector, options = {}) {
    const item = await this.resolveDeveloper(selector, options);
    const state = String(item.State).toLowerCase();
    if (DEV_STOPPED_STATES.has(state)) return { noop: true, item, message: "开发机已经停止" };
    if (state === "stopping") return { noop: true, item, message: "开发机正在停止" };
    if (!DEV_RUNNING_STATES.has(state)) return { noop: true, item, message: `开发机当前状态“${item.State || "未知"}”不能停止` };
    const result = await this.api.setNotebookStatus(item.NotebookId, "stop", options);
    return { noop: false, item, result };
  }

  async deleteDeveloper(selector, options = {}) {
    const item = await this.resolveDeveloper(selector, options);
    const state = String(item.State).toLowerCase();
    if (!DEV_STOPPED_STATES.has(state)) throw new Error(`开发机当前状态“${item.State || "未知"}”不能删除，请先停止开发机`);
    const result = await this.api.deleteNotebooks([item.NotebookId], options.region);
    this.assertBatchSuccess(result?.Results);
    return { item, result };
  }

  async saveDeveloperImage(selector, variables, options = {}) {
    const item = await this.resolveDeveloper(selector, options);
    if (String(item.State).toLowerCase() !== "running") throw new Error("只有运行中的开发机可以保存镜像");
    const payload = { ...variables };
    const required = ["ImageName", "ImageType", "Namespace", "ImageRepo", "ImageVersion"];
    const missing = required.filter((key) => !String(payload[key] || "").trim());
    if (missing.length) throw new Error(`保存镜像缺少参数：${missing.join(", ")}`);
    if (!["Personal", "Official"].includes(payload.ImageType)) throw new Error("ImageType 必须是 Personal 或 Official");
    if (payload.ImageType === "Official" && !payload.OfficialInstance) throw new Error("保存到企业版实例时必须填写 OfficialInstance");
    if (payload.ImagePermission && !["Public", "Private"].includes(payload.ImagePermission)) throw new Error("ImagePermission 必须是 Public 或 Private");
    const result = await this.api.saveNotebookImage(item.NotebookId, payload, options.region);
    return { item, result };
  }

  async listTraining(options = {}) {
    if (options.mine && options.creatorId) throw new Error("--mine 不能与 --creator-id 同时使用");
    const identity = options.mine ? await this.currentUser() : null;
    return this.api.listTrainJobs({
      page: options.page ?? 1,
      limit: options.limit ?? 50,
      creatorId: options.mine ? this.trainingCreator(identity) : options.creatorId,
      username: options.username,
      statuses: options.statuses,
      frameworks: options.frameworks,
      priorities: options.priorities,
      region: options.region,
    });
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
      refreshedAt: new Date().toISOString(),
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

  async listImages(options = {}) {
    const kind = String(options.kind ?? "train").toLowerCase();
    if (!["train", "dev"].includes(kind)) throw new Error("--kind 必须是 train 或 dev");
    const source = String(options.source ?? "all").toLowerCase();
    if (!["all", "official", "personal"].includes(source)) {
      throw new Error("--source 必须是 all、official 或 personal；第三方镜像请从镜像仓库和标签中选择");
    }

    const sources = source === "all"
      ? ["Official", "Personal"]
      : [source === "official" ? "Official" : "Personal"];
    const groups = await Promise.all(sources.map(async (imageSource) => ({
      source: imageSource,
      images: await this.api.listImages(imageSource, options.region, {
        applicationScenario: kind === "train" && imageSource === "Official" ? "训练任务" : undefined,
      }),
    })));
    const images = groups.flatMap((group) => group.images.map((item) => ({
      ...item,
      ImageSource: group.source,
    })));
    const search = String(options.search ?? "").trim().toLowerCase();
    const filtered = search
      ? images.filter((item) => [
        item.ImageName,
        item.ImageRepo,
        item.ImageVersion,
        Array.isArray(item.ImageFrame) ? item.ImageFrame.join(" ") : item.ImageFrame,
        item.PythonVersion,
        item.CudaVersion,
        item.Description,
        item.ImageId,
      ].some((value) => String(value ?? "").toLowerCase().includes(search)))
      : images;

    return {
      region: options.region || this.config.region,
      kind,
      sources,
      total: filtered.length,
      images: filtered,
    };
  }

  async resolveTraining(selector, options = {}) {
    const response = await this.api.listTrainJobs({
      ids: selector.startsWith("kaic-") ? [selector] : undefined,
      name: selector.startsWith("kaic-") ? undefined : selector,
      limit: 100,
      region: options.region,
    });
    const matches = exactMatches(response.TrainJobSet ?? [], selector, "TrainJobId", "TrainJobName");
    if (!matches.length) throw new Error(`找不到训练任务：${selector}`);
    if (matches.length > 1 && !options.latest) {
      throw new Error(`训练任务名称对应 ${matches.length} 条记录，请改用 ID 或添加 --latest`);
    }
    return matches.sort((left, right) => String(right.JobStatus?.SubmitTime ?? "").localeCompare(String(left.JobStatus?.SubmitTime ?? "")))[0];
  }

  async trainingDetail(selector, options = {}) {
    const item = await this.resolveTraining(selector, options);
    const detail = await this.api.trainJobDetail(item.TrainJobId, options.region);
    if (!detail) throw new Error(`训练任务详情不存在：${item.TrainJobId}`);
    return { item, detail, monitor: trainingMonitor(detail, item) };
  }

  async trainingGpu(selector, options = {}) {
    const { item, detail, monitor } = await this.trainingDetail(selector, options);
    if (!monitor.available) throw new Error(monitor.reason);
    const snapshot = await this.api.trainJobGpuMetrics(monitor.url);
    const panels = normalizeTrainingGpuSnapshot(snapshot);
    const utilization = panels.utilization;
    if (!utilization?.rows?.length) {
      throw new Error("该训练任务在当前运行时间窗口内没有 GPU 监控数据");
    }
    const global = utilization.rows.find((row) => row.name === "Global-AVG") ?? null;
    const devices = utilization.rows.filter((row) => row.name !== "Global-AVG");
    return {
      task: {
        id: item.TrainJobId,
        name: item.TrainJobName || detail.TrainJobName || item.TrainJobId,
        status: item.JobStatus?.Status || detail.JobStatus?.Status || null,
        rebootNumber: numberOrZero(detail.RebootNumber),
      },
      window: {
        startTime: monitor.startTime,
        endTime: monitor.endTime,
        live: monitor.live,
      },
      global,
      devices,
      panels,
      monitorUrl: monitor.url,
      fetchedAt: new Date().toISOString(),
    };
  }

  async trainingLogs(selector, options = {}) {
    const tailLines = Math.trunc(Number(options.tailLines ?? 200));
    if (!Number.isFinite(tailLines) || tailLines < 1 || tailLines > 10000) {
      throw new Error("tailLines 必须是 1 到 10000 之间的整数");
    }
    const sinceSeconds = options.sinceSeconds === undefined ? undefined : Math.trunc(Number(options.sinceSeconds));
    if (sinceSeconds !== undefined && (!Number.isFinite(sinceSeconds) || sinceSeconds < 1 || sinceSeconds > 604800)) {
      throw new Error("sinceSeconds 必须是 1 到 604800 之间的整数");
    }

    const item = await this.resolveTraining(selector, options);
    const detail = await this.api.trainJobDetail(item.TrainJobId, options.region);
    if (!detail) throw new Error(`训练任务详情不存在：${item.TrainJobId}`);
    const query = {
      region: options.region,
      clusterId: detail.ClusterId,
      resourcePoolId: detail.ResourcePoolId || item.ResourcePoolId,
      jobName: item.TrainJobId,
      tailLines,
      sinceSeconds,
    };
    let response;
    try {
      response = await this.api.trainJobPods(item.TrainJobId, {
        region: query.region,
        clusterId: query.clusterId,
        resourcePoolId: query.resourcePoolId,
        limit: 100,
      });
    } catch (error) {
      rethrowTrainingLogError(error, item);
    }
    const pods = response?.Pods ?? [];
    let selected = pods;
    if (options.role) {
      selected = selected.filter((pod) => String(pod.Role || "").toLowerCase() === String(options.role).toLowerCase());
      if (!selected.length) throw new Error(`找不到角色“${options.role}”的训练 Pod`);
    }
    if (options.pod) {
      selected = selected.filter((pod) => pod.Name === options.pod);
      if (!selected.length) throw new Error(`找不到训练 Pod：${options.pod}`);
    }

    const logs = [];
    for (const pod of selected) {
      let result;
      try {
        result = await this.api.trainJobLog(item.TrainJobId, pod.Name, query);
      } catch (error) {
        rethrowTrainingLogError(error, item, pod);
      }
      logs.push({
        pod,
        content: result?.PodLogs ?? "",
        requestId: result?.RequestId,
      });
    }
    return { item, detail, pods, logs, query };
  }

  async startTraining(selector, options = {}) {
    const item = await this.resolveTraining(selector, options);
    const state = String(item.JobStatus?.Status ?? "").toLowerCase();
    if (TRAIN_ACTIVE_STATES.has(state)) return { noop: true, item, message: "训练任务已在活动状态" };
    if (state === "stopping") return { noop: true, item, message: "训练任务正在停止，请停止完成后再启动" };
    if (!TRAIN_TERMINAL_STATES.has(state)) return { noop: true, item, message: `训练任务当前状态“${item.JobStatus?.Status || "未知"}”不能启动` };
    const result = await this.api.startTrainJobs([item], options.region);
    this.assertBatchSuccess(result?.Results);
    return { noop: false, item, result };
  }

  async stopTraining(selector, options = {}) {
    const item = await this.resolveTraining(selector, options);
    const state = String(item.JobStatus?.Status ?? "").toLowerCase();
    if (TRAIN_TERMINAL_STATES.has(state)) return { noop: true, item, message: "训练任务已经结束" };
    if (state === "stopping") return { noop: true, item, message: "训练任务正在停止" };
    if (!TRAIN_ACTIVE_STATES.has(state)) return { noop: true, item, message: `训练任务当前状态“${item.JobStatus?.Status || "未知"}”不能停止` };
    const result = await this.api.stopTrainJobs([item], options.region);
    this.assertBatchSuccess(result?.Results);
    return { noop: false, item, result };
  }

  async deleteTraining(selector, options = {}) {
    const item = await this.resolveTraining(selector, options);
    const state = String(item.JobStatus?.Status ?? "").toLowerCase();
    if (!TRAIN_TERMINAL_STATES.has(state)) throw new Error(`训练任务当前状态“${item.JobStatus?.Status || "未知"}”不能删除，请先停止任务`);
    const result = await this.api.deleteTrainJobs([item], options.region);
    this.assertBatchSuccess(result?.Results);
    return { item, result };
  }

  assertBatchSuccess(results) {
    if (!Array.isArray(results) || !results.length) throw new Error("平台未返回任务操作结果，无法确认操作是否成功");
    const failed = results.filter((item) => !item.Return);
    if (failed.length) throw new Error(failed.map((item) => `${item.JobName || item.NotebookId || "未知资源"}: ${item.ErrorMessage || "操作失败"}`).join("；"));
  }

  async currentUser() {
    const identity = await this.api.currentUser();
    if (!identity?.username || !identity?.userId) throw new Error("无法从登录态获取当前用户，请重新运行 aicp login");
    return identity;
  }

  creatorUsername(identity) {
    return identity.accountType === "iam" ? identity.username : "root";
  }

  trainingCreator(identity) {
    return identity.accountType === "iam" ? identity.userId : "root";
  }

  async saveTemplateFromResource(kind, name, selector, options = {}) {
    if (kind === "dev") {
      const item = await this.resolveDeveloper(selector, options);
      const detail = await this.api.notebookDetail(item.NotebookId, options.region);
      return this.templates.save("dev", name, notebookDetailToVariables(detail, options.region || this.config.region), {
        id: item.NotebookId,
        name: item.Name,
      });
    }
    if (kind === "train") {
      const item = await this.resolveTraining(selector, options);
      const detail = await this.api.trainJobDetail(item.TrainJobId, options.region);
      return this.templates.save("train", name, trainDetailToVariables(detail, options.region || this.config.region), {
        id: item.TrainJobId,
        name: item.TrainJobName,
      });
    }
    throw new Error(`未知模板类型：${kind}`);
  }

  async importTemplate(kind, name, filePath) {
    const variables = await readVariablesFile(filePath);
    return this.templates.save(kind, name, variables, { file: filePath });
  }

  async prepareCreateVariables(kind, options = {}) {
    if (options.file && options.template) throw new Error("--file 和 --template 不能同时使用");
    if (options.command !== undefined && options.commandFile) throw new Error("--command 和 --command-file 不能同时使用");
    let variables = {};
    if (options.file) variables = await readVariablesFile(options.file);
    if (options.template) variables = clone((await this.templates.get(kind, options.template)).variables);
    if (!options.file && !options.template && options.variables) variables = clone(options.variables);
    if (options.name) variables[kind === "dev" ? "DisplayName" : "TrainJobName"] = options.name;
    if (options.command !== undefined && kind === "train") {
      if (String(variables.Framework).toLowerCase() === "ray") variables.EntryPointCommand = options.command;
      else {
        variables.Roles ??= [{}];
        variables.Roles[0] ??= {};
        variables.Roles[0].RunCommand = options.command;
      }
    }
    if (options.commandFile && kind === "train") {
      const command = await readFile(options.commandFile, "utf8");
      if (String(variables.Framework).toLowerCase() === "ray") variables.EntryPointCommand = command;
      else {
        variables.Roles ??= [{}];
        variables.Roles[0] ??= {};
        variables.Roles[0].RunCommand = command;
      }
    }
    if (options.region) variables.Region = options.region;
    await applySetOverrides(variables, options.set);
    variables.Region ||= this.config.region;
    this.validateCreateVariables(kind, variables);
    return variables;
  }

  validateCreateVariables(kind, variables) {
    const required = kind === "dev"
      ? ["Region", "DisplayName", "ProjectId", "ResourcePoolId", "QueueName"]
      : ["Region", "TrainJobName", "ResourcePoolId", "QueueName", "Framework", "StorageConfigs", "Roles"];
    const missing = required.filter((key) => variables[key] === undefined || variables[key] === null || variables[key] === "");
    if (missing.length) throw new Error(`缺少必填参数：${missing.join(", ")}`);
    if (kind === "train" && (!Array.isArray(variables.Roles) || !variables.Roles.length)) {
      throw new Error("训练任务至少需要一个 Roles 项");
    }
    if (kind === "train") {
      if (!Array.isArray(variables.StorageConfigs)) throw new Error("StorageConfigs 必须是数组");
      if (variables.MaxRuntimeHour !== undefined && Number(variables.MaxRuntimeHour) <= 0) throw new Error("MaxRuntimeHour 必须大于 0");
      variables.Roles.forEach((role, index) => {
        const label = `Roles[${index}]`;
        if (!role || typeof role !== "object") throw new Error(`${label} 必须是对象`);
        if (!String(role.RoleName || "").trim()) throw new Error(`${label}.RoleName 不能为空`);
        if (!Number.isInteger(Number(role.Replicas)) || Number(role.Replicas) <= 0) throw new Error(`${label}.Replicas 必须是大于 0 的整数`);
        const image = role.ImageConfig;
        if (!image || typeof image !== "object") throw new Error(`${label}.ImageConfig 不能为空`);
        if (["Official", "Personal"].includes(image.ImageSource)) {
          if (!image.ImageId) throw new Error(`${label}.ImageConfig.ImageId 不能为空`);
        } else if (image.ImageSource === "ThirdParty") {
          const missingImage = ["ImageRegistryId", "ImageRepoId", "ImageTagId"].filter((key) => !image[key]);
          if (missingImage.length) throw new Error(`${label}.ImageConfig 缺少参数：${missingImage.join(", ")}`);
        } else {
          throw new Error(`${label}.ImageConfig.ImageSource 必须是 Official、Personal 或 ThirdParty`);
        }
        const resource = role.ResourceConfig;
        if (!resource || typeof resource !== "object") throw new Error(`${label}.ResourceConfig 不能为空`);
        if (Number(resource.CPUNum) <= 0 || Number(resource.Memory) <= 0) throw new Error(`${label} 的 CPU 和内存必须大于 0`);
        if (Number(resource.GPUNumber || 0) < 0) throw new Error(`${label}.ResourceConfig.GPUNumber 不能小于 0`);
        if (Number(resource.GPUNumber || 0) > 0 && !resource.GPUType) throw new Error(`${label} 使用 GPU 时必须选择 GPUType`);
        if (!Array.isArray(role.Envs)) throw new Error(`${label}.Envs 必须是数组`);
      });
      variables.StorageConfigs.forEach((item, index) => {
        if (!item?.StorageConfigId) throw new Error(`StorageConfigs[${index}].StorageConfigId 不能为空`);
        if (!item?.MountPath) throw new Error(`StorageConfigs[${index}].MountPath 不能为空`);
        if (!item?.MountType) throw new Error(`StorageConfigs[${index}].MountType 不能为空`);
      });
    }
    if (kind === "dev") {
      if (!Number.isFinite(Number(variables.ProjectId))) throw new Error("ProjectId 必须是有效数字");
      variables.ProjectId = Number(variables.ProjectId);
      const thirdPartyImage = Number(variables.ImageSource) === 2;
      if (thirdPartyImage) {
        const imageFields = ["ImageRegistryId", "ImageRepoId", "ImageTagId"];
        const missingImageFields = imageFields.filter((key) => !variables[key]);
        if (missingImageFields.length) throw new Error(`第三方镜像缺少参数：${missingImageFields.join(", ")}`);
      } else if (!variables.ImageId && !variables.ImageUrl) {
        throw new Error("请选择官方镜像或自定义镜像");
      }
      if (Number(variables.CpuNum) <= 0 || Number(variables.Memory) <= 0) {
        throw new Error("CPU 和内存必须大于 0");
      }
      if (!Array.isArray(variables.StorageConfigs)) throw new Error("StorageConfigs 必须是数组");
      if (!Array.isArray(variables.ServiceConfigs)) throw new Error("ServiceConfigs 必须是数组");
      if (!Array.isArray(variables.Envs)) throw new Error("Envs 必须是数组");
    }
  }

  async create(kind, options = {}) {
    const variables = await this.prepareCreateVariables(kind, options);
    if (options.dryRun) return { dryRun: true, variables };
    const result = kind === "dev"
      ? await this.api.createNotebook(variables)
      : await this.api.createTrainJob(variables);
    return { dryRun: false, variables, result };
  }
}
