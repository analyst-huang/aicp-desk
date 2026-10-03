import { TRAIN_ACTIVE_STATES, TRAIN_TERMINAL_STATES, exactMatches, numberOrZero, trainingMonitor, normalizeTrainingGpuSnapshot, rethrowTrainingLogError } from './helpers.mjs';
import { assertBatchSuccess } from './results.mjs';

export class TrainingService {
  trainingCreateOptions(...args) { return this.api.trainingCreateOptions(...args); }
  constructor({ api, templates, config, services, now = Date.now }) {
    Object.assign(this, { api, templates, config, services, now });
  }

  async listTraining(options = {}) {
    if (options.mine && options.creatorId) throw new Error("--mine 不能与 --creator-id 同时使用");
    const identity = options.mine ? await this.services.identity.currentUser() : null;
    return this.api.listTrainJobs({
      page: options.page ?? 1,
      limit: options.limit ?? 50,
      creatorId: options.mine ? this.services.identity.trainingCreator(identity) : options.creatorId,
      username: options.username,
      statuses: options.statuses,
      frameworks: options.frameworks,
      priorities: options.priorities,
      region: options.region,
    });
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
    return { item, detail, monitor: trainingMonitor(detail, item, this.now()) };
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
      fetchedAt: new Date(this.now()).toISOString(),
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
    assertBatchSuccess(result?.Results);
    return { noop: false, item, result };
  }

  async stopTraining(selector, options = {}) {
    const item = await this.resolveTraining(selector, options);
    const state = String(item.JobStatus?.Status ?? "").toLowerCase();
    if (TRAIN_TERMINAL_STATES.has(state)) return { noop: true, item, message: "训练任务已经结束" };
    if (state === "stopping") return { noop: true, item, message: "训练任务正在停止" };
    if (!TRAIN_ACTIVE_STATES.has(state)) return { noop: true, item, message: `训练任务当前状态“${item.JobStatus?.Status || "未知"}”不能停止` };
    const result = await this.api.stopTrainJobs([item], options.region);
    assertBatchSuccess(result?.Results);
    return { noop: false, item, result };
  }

  async deleteTraining(selector, options = {}) {
    const item = await this.resolveTraining(selector, options);
    const state = String(item.JobStatus?.Status ?? "").toLowerCase();
    if (!TRAIN_TERMINAL_STATES.has(state)) throw new Error(`训练任务当前状态“${item.JobStatus?.Status || "未知"}”不能删除，请先停止任务`);
    const result = await this.api.deleteTrainJobs([item], options.region);
    assertBatchSuccess(result?.Results);
    return { item, result };
  }
}
