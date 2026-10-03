export const DEV_RUNNING_STATES = new Set(["running", "starting", "pending", "deploying"]);
export const DEV_STOPPED_STATES = new Set(["stopped", "failed", "succeed"]);
export const TRAIN_ACTIVE_STATES = new Set(["running", "submit", "pending", "deploying", "restarting", "succeed_holding", "failed_holding"]);
export const TRAIN_TERMINAL_STATES = new Set(["stopped", "succeed", "failed"]);
export const TRAIN_LOG_PENDING_STATES = new Set(["submit", "pending", "deploying", "restarting", "starting"]);

export function exactMatches(items, selector, idKey, nameKey) {
  const byId = items.filter((item) => item[idKey] === selector);
  if (byId.length) return byId;
  return items.filter((item) => item[nameKey] === selector);
}

export function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/%$/, ""));
  return Number.isFinite(number) ? number : null;
}

export function rounded(value) {
  return Math.round(value * 100) / 100;
}

export function utilizationSummary(values) {
  const numbers = values.filter((value) => value !== null);
  if (!numbers.length) return { mean: null, max: null };
  return {
    mean: rounded(numbers.reduce((sum, value) => sum + value, 0) / numbers.length),
    max: Math.max(...numbers),
  };
}

export function weightedUtilization(pools, key) {
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

export function metricNumber(raw) {
  const text = String(raw ?? "").replace(/\u00a0/g, " ").trim();
  const match = /^([-+]?\d+(?:\.\d+)?)\s*(.*)$/.exec(text);
  if (!match) return { value: null, unit: null, raw: text || null };
  return {
    value: Number(match[1]),
    unit: match[2].trim() || null,
    raw: text,
  };
}

export const TRAIN_GPU_PANEL_DEFINITIONS = Object.freeze({
  "GPU 利用率": { key: "utilization", unit: "%" },
  "GPU 平均温度": { key: "temperature", unit: "°C" },
  "GPU 总功率": { key: "power", unit: "kW" },
  "GPU 显存": { key: "memory", unit: "GiB" },
  "Tensor Core 利用率": { key: "tensorCore", unit: "%" },
});

export function metricValueInUnit(metric, unit) {
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

export function trainingLogState(item, pod) {
  return String(
    pod?.Status?.State
    ?? pod?.Status?.ContainerState
    ?? item?.JobStatus?.Status
    ?? "",
  ).trim();
}

export function isTrainingLogPending(item, pod) {
  const state = trainingLogState(item, pod).toLowerCase();
  return TRAIN_LOG_PENDING_STATES.has(state)
    || /pending|deploying|creating|initializing|waiting|starting/.test(state);
}

export function rethrowTrainingLogError(error, item, pod) {
  if (/Kaic-K8sAccessFault/i.test(String(error?.message ?? error)) && isTrainingLogPending(item, pod)) {
    const state = trainingLogState(item, pod);
    const suffix = state ? `（当前状态：${state}）` : "";
    throw new Error(`Pod 尚未就绪${suffix}，请稍后重试`, { cause: error });
  }
  throw error;
}
