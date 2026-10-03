import { createPoller } from '../core/polling.js';
/** detail owns its local state and event bindings; cross-feature calls are explicit. */
export function createFeature({ appState, features, ui, signal }) {
  const state = { trainDetailCommands: [], trainDetailRequest: 0, trainDetailSelector: "", trainLogEntries: [], trainLogRequest: 0, trainLogTimer: null };
  const { $, $$, on, escapeHtml, api, toast, statusPill, copyText } = ui;
  const poller = createPoller(() => loadTrainLogs({ background: true }), {
    delay: 3000, repeat: false,
    enabled: () => !signal.aborted && !document.hidden && $("#train-detail-modal")?.open && document.getElementById("train-log-auto")?.checked,
  });


  function trainCommandBlocks(detail) {
    const commands = [];
    if (detail.EntryPointCommand) commands.push({ label: "任务入口命令", command: detail.EntryPointCommand });
    for (const role of detail.Roles ?? []) {
      if (role.RunCommand) commands.push({ label: `角色 ${role.RoleName || "未命名"}`, command: role.RunCommand });
    }
    return commands;
  }

  function trainMonitorHtml(monitor) {
    if (!monitor?.available) {
      return `<section class="detail-section monitor-section"><div class="detail-section-head"><div><h3>GPU 监控</h3><p>任务级 GPU 利用率、显存和其他硬件指标</p></div></div><div class="detail-empty">${escapeHtml(monitor?.reason || "该任务暂无监控数据")}</div></section>`;
    }
    return `
      <section class="detail-section monitor-section">
        <div class="detail-section-head">
          <div><h3>GPU 监控</h3><p>Global-AVG 行的 Mean 是当前任务时间窗口内的 GPU 平均利用率</p></div>
          <a class="button ghost small" href="${escapeHtml(monitor.url)}" target="_blank" rel="noreferrer">新窗口打开</a>
        </div>
        <iframe class="train-monitor-frame" src="${escapeHtml(monitor.url)}" title="训练任务 GPU 监控" loading="lazy" referrerpolicy="no-referrer"></iframe>
        <p class="monitor-note">${monitor.live ? "运行中的任务以打开监控时刻作为窗口终点；重新打开详情可更新窗口。" : "该任务已结束，监控窗口固定为本次任务的开始至结束时间。"} 若内嵌区域要求重新登录，请使用右上角“新窗口打开”。</p>
      </section>`;
  }

  function renderTrainDetail(payload) {
    const { item, detail, monitor } = payload;
    const status = item.JobStatus?.Status || "unknown";
    const commands = trainCommandBlocks(detail);
    state.trainDetailCommands = commands.map((entry) => entry.command);
    const commandHtml = commands.length
      ? commands.map((entry, index) => `<section class="command-card"><header><strong>${escapeHtml(entry.label)}</strong><button type="button" class="button ghost small" data-copy-train-command="${index}">复制命令</button></header><pre><code>${escapeHtml(entry.command)}</code></pre></section>`).join("")
      : '<div class="detail-empty">没有配置显式命令，任务可能使用镜像的默认启动命令。</div>';
    const roleRows = (detail.Roles ?? []).map((role) => {
      const resource = role.ResourceConfig ?? {};
      const compute = resource.GPUNumber ? `${resource.GPUNumber} × ${resource.GPUType}` : "CPU";
      const image = role.ImageConfig ?? {};
      return `<tr><td>${escapeHtml(role.RoleName || "-")}</td><td>${escapeHtml(role.Replicas ?? 1)}</td><td>${escapeHtml(compute)}</td><td>${escapeHtml(resource.CPUNum ?? "-")} 核 / ${escapeHtml(resource.Memory ?? "-")} GiB</td><td>${escapeHtml(image.ImageName || image.ImageRepoName || image.ImageId || "-")}</td></tr>`;
    }).join("");
    const storageRows = (detail.StorageConfigs ?? []).map((storage) => `<li><strong>${escapeHtml(storage.StorageConfigName || storage.StorageConfigId || "-")}</strong><span>${escapeHtml(storage.MountPath || "-")} · ${escapeHtml(storage.MountProtocol || storage.Type || "-")}</span></li>`).join("");
    $("#train-detail-title").textContent = detail.TrainJobName || item.TrainJobName;
    $("#train-detail-subtitle").textContent = detail.TrainJobId || item.TrainJobId;
    $("#train-detail-content").innerHTML = `
      <div class="detail-summary">
        <div><span>状态</span>${statusPill(status)}</div><div><span>框架</span><strong>${escapeHtml(detail.Framework || "-")}</strong></div><div><span>队列</span><strong>${escapeHtml(detail.QueueName || "-")}</strong></div><div><span>资源组</span><strong>${escapeHtml(detail.ResourcePoolName || "-")}</strong></div>
      </div>
      ${trainMonitorHtml(monitor)}
      <section class="detail-section command-section"><div class="detail-section-head"><div><h3>运行命令</h3><p>任务级入口命令与每个角色实际配置的启动命令</p></div></div>${commandHtml}</section>
      <section class="detail-section log-section">
        <div class="detail-section-head log-section-head"><div><h3>命令行输出</h3><p>读取金山云当前保留的 Pod stdout / stderr</p></div><div class="log-actions"><button type="button" class="button ghost small" data-copy-train-log>复制日志</button><button type="button" class="button ghost small" data-refresh-train-log>刷新</button></div></div>
        <div class="log-toolbar">
          <label>Pod<select id="train-log-pod"><option value="">全部 Pod</option></select></label>
          <label>最近行数<select id="train-log-tail"><option value="100">100 行</option><option value="200" selected>200 行</option><option value="500">500 行</option><option value="1000">1000 行</option></select></label>
          <label class="checkbox log-auto"><input type="checkbox" id="train-log-auto" checked>每 3 秒刷新</label>
        </div>
        <div class="log-status" id="train-log-status">正在读取训练输出……</div>
        <div class="train-log-output" id="train-log-output"><div class="detail-empty">正在读取训练输出……</div></div>
      </section>
      <section class="detail-section"><div class="detail-section-head"><div><h3>基本信息</h3></div></div><dl class="detail-list"><div><dt>描述</dt><dd>${escapeHtml(detail.Description || "-")}</dd></div><div><dt>优先级</dt><dd>${escapeHtml(detail.Priority || "-")}</dd></div><div><dt>运行环境</dt><dd>${escapeHtml(detail.RuntimeEnv || "-")}</dd></div><div><dt>最长运行</dt><dd>${escapeHtml(detail.MaxRuntimeHour ?? "-")} 小时</dd></div><div><dt>提交时间</dt><dd>${escapeHtml(item.JobStatus?.SubmitTime || "-")}</dd></div><div><dt>开始时间</dt><dd>${escapeHtml(item.JobStatus?.StartTime || "-")}</dd></div></dl></section>
      <section class="detail-section"><div class="detail-section-head"><div><h3>角色与算力</h3></div></div><div class="detail-table-wrap"><table class="detail-table"><thead><tr><th>角色</th><th>副本</th><th>GPU</th><th>CPU / 内存</th><th>镜像</th></tr></thead><tbody>${roleRows || '<tr><td colspan="5">暂无角色信息</td></tr>'}</tbody></table></div></section>
      <section class="detail-section"><div class="detail-section-head"><div><h3>挂载配置</h3></div></div>${storageRows ? `<ul class="detail-storage">${storageRows}</ul>` : '<div class="detail-empty">未配置挂载存储</div>'}</section>
    `;
  }

  function stopTrainLogRefresh() {
    poller.stop();
  }

  function scheduleTrainLogRefresh() {
    stopTrainLogRefresh();
    if (!$("#train-detail-modal")?.open || !document.getElementById("train-log-auto")?.checked) return;
    poller.schedule();
  }

  function renderTrainLogs(payload) {
    state.trainLogEntries = payload.logs ?? [];
    const podSelect = document.getElementById("train-log-pod");
    const selectedPod = podSelect?.value || "";
    if (podSelect) {
      podSelect.innerHTML = `<option value="">全部 Pod</option>${(payload.pods ?? []).map((pod) => `<option value="${escapeHtml(pod.Name)}">${escapeHtml(pod.Name)} · ${escapeHtml(pod.Role || "未命名角色")}</option>`).join("")}`;
      if ([...podSelect.options].some((option) => option.value === selectedPod)) podSelect.value = selectedPod;
    }
    const status = document.getElementById("train-log-status");
    if (status) status.textContent = payload.logs?.length
      ? `已读取 ${payload.logs.length} 个 Pod · ${new Date().toLocaleTimeString()}`
      : payload.pods?.length ? "没有符合筛选条件的 Pod" : "任务尚无 Pod，可能仍在排队或尚未启动";
    const output = document.getElementById("train-log-output");
    if (!output) return;
    output.innerHTML = payload.logs?.length
      ? payload.logs.map(({ pod, content }) => `<section class="train-log-card"><header><strong>${escapeHtml(pod.Name)}</strong><span>${escapeHtml(pod.Role || "未命名角色")} · ${escapeHtml(pod.Status?.State || pod.Status?.ContainerState || "unknown")}</span></header><pre><code>${escapeHtml(String(content ?? "").trimEnd() || "（暂无输出）")}</code></pre></section>`).join("")
      : '<div class="detail-empty">暂无命令行输出</div>';
  }

  async function loadTrainLogs({ background = false } = {}) {
    if (!state.trainDetailSelector || !$("#train-detail-modal")?.open) return;
    const request = ++state.trainLogRequest;
    stopTrainLogRefresh();
    const pod = document.getElementById("train-log-pod")?.value || "";
    const tail = document.getElementById("train-log-tail")?.value || "200";
    const status = document.getElementById("train-log-status");
    if (status && !background) status.textContent = "正在读取训练输出……";
    try {
      const params = new URLSearchParams({ selector: state.trainDetailSelector, tail });
      if (pod) params.set("pod", pod);
      const payload = await api(`/api/train/logs?${params}`);
      if (request !== state.trainLogRequest || !$("#train-detail-modal")?.open) return;
      renderTrainLogs(payload);
    } catch (error) {
      if (request !== state.trainLogRequest || !$("#train-detail-modal")?.open) return;
      if (status) status.textContent = `日志读取失败：${error.message}`;
      if (!background) document.getElementById("train-log-output").innerHTML = `<div class="detail-empty error">${escapeHtml(error.message)}</div>`;
    } finally {
      if (request === state.trainLogRequest) scheduleTrainLogRefresh();
    }
  }

  async function openTrainDetail(selector, name) {
    const request = ++state.trainDetailRequest;
    state.trainDetailCommands = [];
    state.trainDetailSelector = selector;
    state.trainLogEntries = [];
    state.trainLogRequest += 1;
    stopTrainLogRefresh();
    $("#train-detail-title").textContent = name || "训练任务详情";
    $("#train-detail-subtitle").textContent = selector;
    $("#train-detail-content").innerHTML = '<div class="create-loading">正在读取训练任务详情与运行命令……</div>';
    $("#train-detail-modal").showModal();
    try {
      const payload = await api(`/api/train/detail?selector=${encodeURIComponent(selector)}`);
      if (request !== state.trainDetailRequest) return;
      renderTrainDetail(payload);
      await loadTrainLogs();
    } catch (error) {
      if (request !== state.trainDetailRequest) return;
      $("#train-detail-content").innerHTML = `<div class="create-loading error">${escapeHtml(error.message)}</div>`;
    }
  }

  function dispose() {
    state.trainDetailRequest++;
    state.trainLogRequest++;
    state.trainDetailSelector = "";
    stopTrainLogRefresh();
  }

  function bind() {
    on(document, "visibilitychange", () => document.hidden ? stopTrainLogRefresh() : loadTrainLogs({ background: true }));
    on(document, "click", async (event) => {
      const trainDetail = event.target.closest("[data-train-detail]");
      if (trainDetail) return openTrainDetail(trainDetail.dataset.id, trainDetail.dataset.name);
    });
    on(document, "click", async (event) => {
      const copyTrainCommand = event.target.closest("[data-copy-train-command]");
      if (copyTrainCommand) {
        const command = state.trainDetailCommands[Number(copyTrainCommand.dataset.copyTrainCommand)];
        if (command === undefined) return;
        try { await copyText(command); toast("运行命令已复制"); }
        catch (error) { toast(`复制失败：${error.message}`, "error"); }
        return;
      }
    });
    on(document, "click", async (event) => {
      const refreshTrainLog = event.target.closest("[data-refresh-train-log]");
      if (refreshTrainLog) return loadTrainLogs();
    });
    on(document, "click", async (event) => {
      const copyTrainLog = event.target.closest("[data-copy-train-log]");
      if (copyTrainLog) {
        const text = state.trainLogEntries.map(({ pod, content }) => `===== ${pod.Name} · ${pod.Role || "未命名角色"} =====\n${String(content ?? "").trimEnd()}`).join("\n\n");
        if (!text) return toast("当前没有可复制的训练日志", "error");
        try { await copyText(text); toast("训练日志已复制"); }
        catch (error) { toast(`复制失败：${error.message}`, "error"); }
        return;
      }
    });
    on(document, "change", (event) => {
      if (["train-log-pod", "train-log-tail"].includes(event.target.id)) loadTrainLogs();
      if (event.target.id === "train-log-auto") {
        if (event.target.checked) loadTrainLogs({ background: true });
        else stopTrainLogRefresh();
      }
    });
    on($("#train-detail-modal"), "close", () => {
      dispose();
    });
  }

  return { state, bind, dispose, trainCommandBlocks, trainMonitorHtml, renderTrainDetail, stopTrainLogRefresh, scheduleTrainLogRefresh, renderTrainLogs, loadTrainLogs, openTrainDetail };
}
