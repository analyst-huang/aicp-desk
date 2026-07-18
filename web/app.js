const state = {
  token: "",
  config: {},
  session: {},
  templates: [],
  dev: [],
  train: [],
  page: "dev",
  createKind: "dev",
  devOptions: null,
  trainOptions: null,
  devImageRepos: [],
  devImageTags: [],
  trainImageRepos: [],
  trainImageTags: [],
  devResourceRequest: 0,
  devNodeRequest: 0,
  devNodes: [],
  templateRequest: 0,
  createRequest: 0,
  saveImageDev: null,
  saveImageOptions: null,
  saveImageNamespaces: [],
  saveImageRepositories: [],
  saveImageRequest: 0,
  trainDetailCommands: [],
  trainDetailRequest: 0,
  trainDetailSelector: "",
  trainLogEntries: [],
  trainLogRequest: 0,
  trainLogTimer: null,
  devLoading: false,
  trainLoading: false,
  gpuLoading: false,
  gpuCapacity: null,
  autoRefreshTimer: null,
};

const AUTO_REFRESH_MS = 10_000;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-aicp-token": state.token,
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `请求失败：HTTP ${response.status}`);
  return payload;
}

function toast(message, type = "success") {
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = message;
  $("#toast-stack").append(node);
  setTimeout(() => node.remove(), 4200);
}

function setBusy(button, busy, label = "处理中…") {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = label;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

function statusLabel(status) {
  const labels = {
    running: "运行中", stopped: "已停止", starting: "启动中", pending: "排队中",
    deploying: "部署中", submit: "创建中", succeed: "成功", failed: "失败",
    stopping: "停止中", restarting: "重启中", image_saving: "镜像保存中", succeed_holding: "成功·保留中",
    failed_holding: "失败·保留中",
  };
  return labels[String(status).toLowerCase()] || status || "未知";
}

function statusPill(status) {
  const normalized = String(status || "unknown").toLowerCase();
  return `<span class="status ${escapeHtml(normalized)}">${escapeHtml(statusLabel(normalized))}</span>`;
}

function metric(label, value, note = "") {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${note ? `<small>${escapeHtml(note)}</small>` : ""}</div>`;
}

function renderSession() {
  const badge = $("#session-badge");
  const detail = $("#session-detail");
  if (state.session.profileExists) {
    badge.classList.add("ready");
    badge.innerHTML = "<i></i>已有独立 Edge 登录资料";
    detail.textContent = state.session.browserRunning
      ? `独立 Edge 当前打开，调试端口 ${state.session.debugPort}。`
      : "独立 Edge 资料已保留；其中的已保存密码由 Edge 管理，并受当前操作系统账户保护。";
  } else {
    badge.classList.remove("ready");
    badge.innerHTML = "<i></i>尚未登录";
    detail.textContent = "尚未建立登录会话。点击登录后，请在独立 Edge 中完成手机验证码。";
  }
}

async function refreshSession() {
  state.session = await api("/api/session");
  renderSession();
}

async function login(button) {
  if (!window.confirm("将打开一个仅监听本机的独立 Edge 登录窗口。请只在窗口中输入账号和验证码。继续吗？")) return;
  setBusy(button, true, "正在打开…");
  try {
    await api("/api/login", { method: "POST", body: "{}" });
    toast("登录窗口已打开。首次登录可让 Edge 保存密码；完成 MFA 后可关闭窗口。", "success");
    await refreshSession();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

function setPage(page) {
  state.page = page;
  $$(".nav-item").forEach((node) => node.classList.toggle("active", node.dataset.page === page));
  $$(".page").forEach((node) => node.classList.toggle("active", node.id === `page-${page}`));
  const titles = { dev: "开发机", train: "训练任务", gpu: "GPU 容量", templates: "模板库", settings: "设置" };
  $("#page-title").textContent = titles[page];
  if (page === "dev") loadDev();
  if (page === "train") loadTrain();
  if (page === "gpu") loadGpu();
  if (page === "templates") loadTemplates();
}

function tableLoading(target, columns) {
  target.innerHTML = `<tr>${Array.from({ length: columns }, () => '<td><div class="skeleton"></div></td>').join("")}</tr>`;
}

function markResourceRefresh() {
  const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date());
  $("#auto-refresh-status").textContent = `每 10 秒自动刷新 · 最近 ${time}`;
}

async function loadDev({ background = false } = {}) {
  if (state.devLoading) return;
  state.devLoading = true;
  const table = $("#dev-table");
  if (!state.session.profileExists) {
    state.dev = [];
    $("#dev-count").textContent = "登录后加载";
    $("#dev-metrics").innerHTML = metric("开发机总数", "—") + metric("运行 / 启动中", "—") + metric("GPU 配额视图", "—") + metric("配置 CPU 合计", "—");
    table.innerHTML = '<tr><td colspan="6" class="empty">请先点击右上角“登录 / 更新会话”</td></tr>';
    state.devLoading = false;
    return;
  }
  if (!background) {
    $("#dev-metrics").innerHTML = metric("开发机总数", "…") + metric("运行 / 启动中", "…") + metric("GPU 配额视图", "…") + metric("配置 CPU 合计", "…");
    tableLoading(table, 6);
  }
  try {
    const mine = $("#dev-mine").checked ? "1" : "0";
    const payload = await api(`/api/dev?mine=${mine}`);
    state.dev = payload.Notebooks || [];
    $("#dev-count").textContent = `共 ${payload.TotalCount ?? state.dev.length} 台`;
    const running = state.dev.filter((item) => ["running", "starting", "pending"].includes(String(item.State).toLowerCase())).length;
    const gpu = state.dev.reduce((sum, item) => sum + Number(item.GPUNumber || 0), 0);
    const cpu = state.dev.reduce((sum, item) => sum + Number(item.CpuNum || 0), 0);
    $("#dev-metrics").innerHTML = metric("开发机总数", state.dev.length, "台") + metric("运行 / 启动中", running, "台") + metric("GPU 配额视图", gpu, "卡") + metric("配置 CPU 合计", cpu, "核");
    if (!state.dev.length) {
      table.innerHTML = '<tr><td colspan="6" class="empty">没有找到开发机</td></tr>';
      markResourceRefresh();
      return;
    }
    table.innerHTML = state.dev.map((item) => {
      const developerState = String(item.State).toLowerCase();
      const canStop = ["running", "starting", "pending", "deploying"].includes(developerState);
      const canStart = ["stopped", "failed", "succeed"].includes(developerState);
      const canDelete = ["stopped", "failed", "succeed"].includes(developerState);
      const compute = item.GPUNumber ? `${item.GPUNumber} × ${item.GPUType}` : "CPU only";
      const canCopyPublicSsh = item.EnableSsh && item.EnablePublicNetworkSsh && item.ExternalIp;
      const canSaveImage = developerState === "running";
      return `<tr>
        <td class="name-cell"><strong>${escapeHtml(item.Name)}</strong><small>${escapeHtml(item.NotebookId)}</small></td>
        <td>${statusPill(item.State)}</td><td>${escapeHtml(compute)}</td>
        <td>${escapeHtml(item.CpuNum)} 核 / ${escapeHtml(item.Memory)} GiB</td><td>${escapeHtml(item.QueueName || "-")}</td>
        <td><div class="actions"><button class="link-action" data-dev-action="start" data-id="${escapeHtml(item.NotebookId)}" data-name="${escapeHtml(item.Name)}" ${canStart ? "" : "disabled"}>启动</button><button class="link-action stop" data-dev-action="stop" data-id="${escapeHtml(item.NotebookId)}" data-name="${escapeHtml(item.Name)}" ${canStop ? "" : "disabled"}>停止</button><button class="link-action" data-save-dev-image data-id="${escapeHtml(item.NotebookId)}" data-name="${escapeHtml(item.Name)}" data-resource-pool-type="${escapeHtml(item.ResourcePoolType || "")}" ${canSaveImage ? "" : "disabled"}>保存镜像</button>${canCopyPublicSsh ? `<button class="link-action" data-copy-ssh data-external-ip="${escapeHtml(item.ExternalIp)}" data-ssh-port="${escapeHtml(item.SshPort || 22)}">复制 SSH</button>` : ""}<button class="link-action" data-save-resource="dev" data-id="${escapeHtml(item.NotebookId)}" data-name="${escapeHtml(item.Name)}">存为模板</button><button class="link-action danger" data-dev-action="delete" data-id="${escapeHtml(item.NotebookId)}" data-name="${escapeHtml(item.Name)}" ${canDelete ? "" : "disabled"} title="运行中的开发机需先停止">删除</button></div></td>
      </tr>`;
    }).join("");
    markResourceRefresh();
  } catch (error) {
    if (!background) table.innerHTML = `<tr><td colspan="6" class="empty">${escapeHtml(error.message)}</td></tr>`;
    if (!background) toast(error.message, "error");
  } finally {
    state.devLoading = false;
  }
}

async function loadTrain({ background = false } = {}) {
  if (state.trainLoading) return;
  state.trainLoading = true;
  const table = $("#train-table");
  if (!state.session.profileExists) {
    state.train = [];
    $("#train-count").textContent = "登录后加载";
    $("#train-metrics").innerHTML = metric("当前结果", "—") + metric("活动任务", "—") + metric("成功", "—") + metric("失败", "—");
    table.innerHTML = '<tr><td colspan="7" class="empty">请先点击右上角“登录 / 更新会话”</td></tr>';
    state.trainLoading = false;
    return;
  }
  if (!background) {
    $("#train-metrics").innerHTML = metric("当前结果", "…") + metric("活动任务", "…") + metric("成功", "…") + metric("失败", "…");
    tableLoading(table, 7);
  }
  try {
    const params = new URLSearchParams({
      mine: $("#train-mine").checked ? "1" : "0",
      status: $("#train-status").value,
      limit: "50",
    });
    const payload = await api(`/api/train?${params}`);
    state.train = payload.TrainJobSet || [];
    $("#train-count").textContent = `匹配 ${payload.TotalCount ?? state.train.length} 条，当前显示 ${state.train.length} 条`;
    const activeStates = new Set(["running", "pending", "deploying", "submit", "restarting", "succeed_holding", "failed_holding"]);
    const active = state.train.filter((item) => activeStates.has(String(item.JobStatus?.Status).toLowerCase())).length;
    const success = state.train.filter((item) => item.JobStatus?.Status === "succeed").length;
    const failed = state.train.filter((item) => item.JobStatus?.Status === "failed").length;
    $("#train-metrics").innerHTML = metric("当前结果", state.train.length, "条") + metric("活动任务", active, "条") + metric("成功", success, "条") + metric("失败", failed, "条");
    if (!state.train.length) {
      table.innerHTML = '<tr><td colspan="7" class="empty">没有找到训练任务</td></tr>';
      markResourceRefresh();
      return;
    }
    table.innerHTML = state.train.map((item) => {
      const status = String(item.JobStatus?.Status || "").toLowerCase();
      const canStop = activeStates.has(status);
      const canStart = ["stopped", "failed", "succeed"].includes(status);
      const canDelete = ["stopped", "failed", "succeed"].includes(status);
      const resource = item.Roles?.[0]?.ResourceConfig || {};
      const compute = resource.GPUNumber ? `${resource.GPUNumber} × ${resource.GPUType}` : "CPU";
      return `<tr>
        <td class="name-cell"><strong>${escapeHtml(item.TrainJobName)}</strong><small>${escapeHtml(item.TrainJobId)}</small></td>
        <td>${statusPill(status)}</td><td>${escapeHtml(item.Framework || "-")}</td><td>${escapeHtml(compute)}</td><td>${escapeHtml(item.QueueName || "-")}</td><td>${escapeHtml(item.JobStatus?.SubmitTime || "-")}</td>
        <td><div class="actions"><button class="link-action" data-train-detail data-id="${escapeHtml(item.TrainJobId)}" data-name="${escapeHtml(item.TrainJobName)}">详情</button><button class="link-action" data-train-action="start" data-id="${escapeHtml(item.TrainJobId)}" data-name="${escapeHtml(item.TrainJobName)}" ${canStart ? "" : "disabled"}>启动</button><button class="link-action stop" data-train-action="stop" data-id="${escapeHtml(item.TrainJobId)}" data-name="${escapeHtml(item.TrainJobName)}" ${canStop ? "" : "disabled"}>停止</button><button class="link-action" data-save-resource="train" data-id="${escapeHtml(item.TrainJobId)}" data-name="${escapeHtml(item.TrainJobName)}">存为模板</button><button class="link-action danger" data-train-action="delete" data-id="${escapeHtml(item.TrainJobId)}" data-name="${escapeHtml(item.TrainJobName)}" ${canDelete ? "" : "disabled"} title="活动中的训练任务需先停止">删除</button></div></td>
      </tr>`;
    }).join("");
    markResourceRefresh();
  } catch (error) {
    if (!background) table.innerHTML = `<tr><td colspan="7" class="empty">${escapeHtml(error.message)}</td></tr>`;
    if (!background) toast(error.message, "error");
  } finally {
    state.trainLoading = false;
  }
}

function workloadLabel(types = []) {
  if (!types.length) return "通用";
  return types.map((type) => ({ notebook: "开发机", trainjob: "训练任务", queuejob: "队列任务" })[type] || type).join(" / ");
}

function orderedGpuNodes(nodes = []) {
  const onlyFree = Boolean($("#gpu-only-free")?.checked);
  const direction = $("#gpu-node-sort")?.value || "desc";
  return [...nodes]
    .filter((node) => !onlyFree || (node.schedulable && Number(node.remainingGpu) > 0))
    .sort((left, right) => (
      (direction === "asc" ? 1 : -1) * (Number(left.remainingGpu) - Number(right.remainingGpu))
      || Number(right.remainingMemoryGiB) - Number(left.remainingMemoryGiB)
      || String(left.name || left.ip).localeCompare(String(right.name || right.ip), "zh-CN")
    ));
}

function renderGpuFilterSummary(pools = []) {
  const total = pools.reduce((sum, pool) => sum + pool.nodes.length, 0);
  const visible = pools.reduce((sum, pool) => sum + orderedGpuNodes(pool.nodes).length, 0);
  const direction = $("#gpu-node-sort")?.value === "asc" ? "从少到多" : "从多到少";
  $("#gpu-node-filter-summary").textContent = `显示 ${visible} / ${total} 台 · 剩余卡数${direction}`;
}

function rerenderGpuCapacity() {
  if (!state.gpuCapacity) return;
  $("#gpu-pools").innerHTML = renderGpuPools(state.gpuCapacity.pools);
  renderGpuFilterSummary(state.gpuCapacity.pools);
}

function renderGpuPools(pools) {
  if (!pools.length) return '<div class="panel capacity-empty">当前区域没有可用资源组</div>';
  return pools.map((pool) => {
    const max = Math.max(1, Number(pool.totalGpu || 0));
    const queueRows = pool.queues.map((queue) => {
      const modelText = queue.models.length
        ? queue.models.map((item) => `<span class="capacity-model">${escapeHtml(item.model || "GPU")} · ${escapeHtml(item.quotaGpu)} 卡</span>`).join("")
        : '<span class="capacity-model cpu">CPU 队列</span>';
      const quota = queue.quotaGpu === null ? "—" : queue.quotaGpu;
      const allocated = queue.allocatedGpu === null ? "—" : queue.allocatedGpu;
      const remaining = queue.remainingGpu === null ? "—" : queue.remainingGpu;
      const borrowed = Number(queue.borrowedGpu || 0) > 0 ? `<small class="borrowed">已借用 ${escapeHtml(queue.borrowedGpu)} 卡</small>` : "";
      return `<tr>
        <td class="name-cell"><strong>${escapeHtml(queue.name || "-")}</strong><small>${escapeHtml(workloadLabel(queue.workloadTypes))}</small></td>
        <td><div class="capacity-models">${modelText}</div></td>
        <td>${escapeHtml(quota)}</td><td>${escapeHtml(allocated)}</td>
        <td><strong class="capacity-remaining">${escapeHtml(remaining)}</strong>${borrowed}</td>
        <td>${queue.allowBorrowing ? '<span class="capacity-yes">允许</span>' : "否"}</td>
        <td>${statusPill(queue.state || "unknown")}</td>
      </tr>`;
    }).join("");
    const visibleNodes = orderedGpuNodes(pool.nodes);
    const nodeCards = visibleNodes.map((node) => {
      const nodeStatus = node.schedulable
        ? `<span class="status running">${escapeHtml(node.statusName || node.status || "正常")}</span>`
        : '<span class="status failed">不可调度</span>';
      const gpuModel = node.gpuModel
        ? `<span class="capacity-model">${escapeHtml(node.gpuModel)}</span>`
        : '<span class="capacity-model cpu">CPU 节点</span>';
      return `<article class="capacity-node-card">
        <header><div><strong>${escapeHtml(node.name || "-")}</strong><code class="node-ip">${escapeHtml(node.ip || "-")}</code></div>${nodeStatus}</header>
        <div class="capacity-node-meta">${gpuModel}<small title="${escapeHtml(node.id)}">${escapeHtml(node.id)}</small></div>
        <dl class="capacity-node-stats">
          <div><dt>GPU 剩余</dt><dd>${escapeHtml(node.remainingGpu)}<small> / ${escapeHtml(node.allocatableGpu)} 卡</small></dd></div>
          <div><dt>内存剩余</dt><dd>${escapeHtml(node.remainingMemoryGiB)}<small> / ${escapeHtml(node.allocatableMemoryGiB)} GiB</small></dd></div>
          <div><dt>CPU 剩余</dt><dd>${escapeHtml(node.remainingCpu)}<small> / ${escapeHtml(node.allocatableCpu)} 核</small></dd></div>
        </dl>
      </article>`;
    }).join("");
    return `<article class="panel capacity-pool">
      <header class="capacity-pool-head">
        <div><p class="eyebrow">Resource pool · ${escapeHtml(pool.type || "-")}</p><h3>${escapeHtml(pool.name || pool.id)}</h3><small>${escapeHtml(pool.id)}</small></div>
        <div class="capacity-pool-total"><span>物理 GPU 剩余</span><strong>${escapeHtml(pool.freeGpu)}<small> / ${escapeHtml(pool.totalGpu)} 卡</small></strong><progress max="${escapeHtml(max)}" value="${escapeHtml(pool.freeGpu)}"></progress><p>已分配 ${escapeHtml(pool.assignedGpu)} · 不可用 ${escapeHtml(pool.unavailableGpu)}</p></div>
      </header>
      <div class="capacity-section-head"><div><h4>节点实时容量</h4><p>优先按剩余 GPU 卡数排序；适合 Agent 在启动实验前选机。</p></div><span>${escapeHtml(visibleNodes.length)} / ${escapeHtml(pool.nodes.length)} 台</span></div>
      <div class="capacity-node-table capacity-node-grid">${nodeCards || '<div class="empty">没有符合筛选条件的节点</div>'}</div>
      <div class="capacity-section-head queue"><div><h4>队列配额</h4><p>配额口径与物理节点容量分开显示。</p></div><span>${escapeHtml(pool.queues.length)} 个</span></div>
      <div class="table-wrap"><table><thead><tr><th>队列</th><th>型号与配额</th><th>总配额</th><th>已分配</th><th>配额剩余</th><th>借用</th><th>状态</th></tr></thead><tbody>${queueRows || '<tr><td colspan="7" class="empty">该资源组没有队列</td></tr>'}</tbody></table></div>
      <p class="capacity-note">节点剩余 = 可分配 - 已分配，内存单位为 GiB。队列“配额剩余”不等于当前一定可调度的物理卡数；允许借用时，最终可申请量仍受资源组物理剩余、GPU 型号和单节点碎片影响。</p>
    </article>`;
  }).join("");
}

async function loadGpu({ background = false } = {}) {
  if (state.gpuLoading) return;
  state.gpuLoading = true;
  const container = $("#gpu-pools");
  if (!state.session.profileExists) {
    state.gpuCapacity = null;
    $("#gpu-metrics").innerHTML = metric("资源组", "—") + metric("物理 GPU 剩余", "—") + metric("物理 GPU 总量", "—") + metric("节点", "—");
    container.innerHTML = '<div class="panel capacity-empty">请先点击右上角“登录 / 更新会话”</div>';
    state.gpuLoading = false;
    return;
  }
  if (!background) {
    $("#gpu-metrics").innerHTML = metric("资源组", "…") + metric("物理 GPU 剩余", "…") + metric("物理 GPU 总量", "…") + metric("节点", "…");
    container.innerHTML = '<div class="panel capacity-empty"><div class="skeleton"></div>正在读取资源组、队列和节点容量……</div>';
  }
  try {
    state.gpuCapacity = await api("/api/gpu");
    const summary = state.gpuCapacity.summary;
    $("#gpu-metrics").innerHTML = metric("资源组", summary.poolCount, "个") + metric("物理 GPU 剩余", summary.freeGpu, "卡") + metric("物理 GPU 总量", summary.totalGpu, "卡") + metric("节点", summary.nodeCount, `台 · ${summary.gpuNodeCount} 台 GPU`);
    container.innerHTML = renderGpuPools(state.gpuCapacity.pools);
    renderGpuFilterSummary(state.gpuCapacity.pools);
    markResourceRefresh();
  } catch (error) {
    if (!background) container.innerHTML = `<div class="panel capacity-empty error">${escapeHtml(error.message)}</div>`;
    if (!background) toast(error.message, "error");
  } finally {
    state.gpuLoading = false;
  }
}

async function refreshActiveResourcePage({ background = false } = {}) {
  if (document.hidden || !state.session.profileExists) return;
  if (state.page === "dev") await loadDev({ background });
  if (state.page === "train") await loadTrain({ background });
  if (state.page === "gpu") await loadGpu({ background });
  if (!background && state.page === "templates") await loadTemplates();
  if (!background && state.page === "settings") await refreshSession();
}

function startAutoRefresh() {
  if (state.autoRefreshTimer) clearInterval(state.autoRefreshTimer);
  state.autoRefreshTimer = setInterval(() => refreshActiveResourcePage({ background: true }), AUTO_REFRESH_MS);
}

async function performResourceAction(kind, action, selector, name, button) {
  const verb = { start: "启动", stop: "停止", delete: "永久删除" }[action];
  const resourceLabel = kind === "dev" ? "开发机" : "训练任务";
  const warning = action === "delete" ? "此操作无法撤销，且不会删除已挂载存储中的数据。" : "";
  if (!window.confirm(`确认${verb}${resourceLabel}“${name}”吗？${warning}`)) return;
  if (action === "delete") {
    const typed = window.prompt(`为避免误删，请输入${resourceLabel}名称：${name}`);
    if (typed !== name) return toast("名称不匹配，已取消删除", "error");
  }
  setBusy(button, true);
  try {
    const result = await api(`/api/${kind}/action`, {
      method: "POST",
      body: JSON.stringify({ selector, action }),
    });
    toast(result.noop ? result.message : action === "delete" ? `${resourceLabel}已删除` : `${verb}请求已提交`, "success");
    if (kind === "dev") await loadDev(); else await loadTrain();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

function trainCommandBlocks(detail) {
  const commands = [];
  if (detail.EntryPointCommand) commands.push({ label: "任务入口命令", command: detail.EntryPointCommand });
  for (const role of detail.Roles ?? []) {
    if (role.RunCommand) commands.push({ label: `角色 ${role.RoleName || "未命名"}`, command: role.RunCommand });
  }
  return commands;
}

function renderTrainDetail(payload) {
  const { item, detail } = payload;
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
  clearTimeout(state.trainLogTimer);
  state.trainLogTimer = null;
}

function scheduleTrainLogRefresh() {
  stopTrainLogRefresh();
  if (!$("#train-detail-modal")?.open || !document.getElementById("train-log-auto")?.checked) return;
  state.trainLogTimer = setTimeout(() => loadTrainLogs({ background: true }), 3000);
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

const devDefaults = () => ({
  Region: state.config.region,
  DisplayName: "",
  Description: "",
  ImageSource: 0,
  ImageId: "",
  AutoSave: true,
  AutoSaveConfig: { ImageType: "Personal" },
  ResourcePoolId: "",
  QueueName: "",
  GPUType: "",
  GPUNumber: 0,
  CpuNum: 8,
  Memory: 16,
  AccessType: "Creator",
  StorageConfigs: [],
  EnableSsh: false,
  ServiceConfigs: [],
  Envs: [],
  NodeAffinity: { RunOnCPU: false, RunOnGPU: false },
});

const trainDefaults = () => ({
  Region: state.config.region,
  TrainJobName: "",
  Description: "",
  ResourcePoolId: "",
  Priority: "kaic-normal",
  QueueName: "",
  Framework: "pytorch",
  AccessType: "Creator",
  SelfHealing: false,
  UseIdleResource: false,
  MaxRuntimeHour: 720,
  HoldingTimeMinutes: 0,
  JobRunOnCPU: true,
  SupportTensorboard: false,
  StorageConfigs: [],
  Roles: [{
    RoleName: "Master",
    Replicas: 1,
    ImageConfig: { ImageId: "", ImageSource: "Personal" },
    ResourceConfig: { GPUType: "", GPUNumber: 0, CPUNum: 8, Memory: 16 },
    RunCommand: "",
    RestartPolicy: "Never",
    Envs: [],
    IsChiefRole: false,
  }],
  EnableDeviceHealthCheck: false,
});

function parseCreateJson() {
  try {
    return JSON.parse($("#create-json").value);
  } catch (error) {
    throw new Error(`高级 JSON 格式错误：${error.message}`);
  }
}

function updateJson(variables) {
  $("#create-json").value = JSON.stringify(variables, null, 2);
  $("#create-validation").textContent = "参数已载入，创建前会再次检查";
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const input = document.createElement("textarea");
    input.value = value;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
}

function currentDevImageSource() {
  return Number($('input[name="dev-image-source"]:checked')?.value ?? 0);
}

function imageListForSource(source = currentDevImageSource()) {
  if (!state.devOptions) return [];
  return source === 1 ? state.devOptions.images?.personal ?? [] : state.devOptions.images?.official ?? [];
}

function selectedImage() {
  const id = $("#dev-image-select").value;
  return imageListForSource().find((item) => item.ImageId === id);
}

function selectedPool() {
  return state.devOptions?.resourcePools?.find((item) => item.ResourcePoolId === $("#dev-resource-pool").value);
}

function selectedQueue() {
  const poolId = $("#dev-resource-pool").value;
  return state.devOptions?.queues?.find((item) => item.ResourcePoolId === poolId && item.Name === $("#dev-queue").value);
}

function renderImageDetail() {
  const image = selectedImage();
  $("#dev-image-detail").innerHTML = image
    ? `<strong>${escapeHtml(image.ImageName)}</strong> · ${escapeHtml(image.ImageRepo || "-")}:${escapeHtml(image.ImageVersion || "-")} · Python ${escapeHtml(image.PythonVersion || "-")} · CUDA ${escapeHtml(image.CudaVersion || "-")} · ${escapeHtml(image.ImageSize || "-")} GiB<br>${escapeHtml(image.Description || "暂无描述")}`
    : "尚未选择镜像";
}

function renderDevImageOptions(selectedId = $("#dev-image-select").value) {
  const select = $("#dev-image-select");
  const source = currentDevImageSource();
  const search = $("#dev-image-search").value.trim().toLowerCase();
  const all = imageListForSource(source);
  const filtered = all.filter((item) => [item.ImageName, item.ImageRepo, item.ImageVersion, item.ImageFrame?.join(" "), item.CudaVersion]
    .some((value) => String(value || "").toLowerCase().includes(search)));
  const visible = [...filtered];
  const selected = all.find((item) => item.ImageId === selectedId);
  if (selected && !visible.some((item) => item.ImageId === selectedId)) visible.unshift(selected);
  select.innerHTML = `<option value="">请选择${source === 1 ? "自定义" : "官方"}镜像（${filtered.length}）</option>` + visible
    .map((item) => `<option value="${escapeHtml(item.ImageId)}">${escapeHtml(item.ImageName)} · ${escapeHtml(item.ImageRepo || "-")}:${escapeHtml(item.ImageVersion || "-")} · CUDA ${escapeHtml(item.CudaVersion || "-")}</option>`).join("");
  select.value = selectedId || "";
  renderImageDetail();
}

function renderDevImageMode() {
  const thirdParty = currentDevImageSource() === 2;
  $("#dev-aicp-image-fields").classList.toggle("hidden", thirdParty);
  $("#dev-third-image-fields").classList.toggle("hidden", !thirdParty);
  if (!thirdParty) renderDevImageOptions();
}

function renderPoolOptions(selectedId = $("#dev-resource-pool").value) {
  const pools = state.devOptions?.resourcePools ?? [];
  const select = $("#dev-resource-pool");
  select.innerHTML = '<option value="">请选择资源组</option>' + pools.map((item) => `<option value="${escapeHtml(item.ResourcePoolId)}">${escapeHtml(item.ResourcePoolName)} · ${escapeHtml(item.ResourcePoolType)}</option>`).join("");
  select.value = selectedId || "";
}

function renderRegistryOptions(selectedId = $("#dev-image-registry").value) {
  const registries = state.devOptions?.imageRegistries ?? [];
  const select = $("#dev-image-registry");
  select.innerHTML = '<option value="">请选择镜像配置</option>' + registries.map((item) => `<option value="${escapeHtml(item.Id)}">${escapeHtml(item.Name)} · ${escapeHtml(item.RegistryDomain || "-")}</option>`).join("");
  select.value = selectedId || "";
}

function renderDevQueues(selectedName = $("#dev-queue").value) {
  const poolId = $("#dev-resource-pool").value;
  const queues = (state.devOptions?.queues ?? []).filter((item) => item.ResourcePoolId === poolId);
  const select = $("#dev-queue");
  select.innerHTML = '<option value="">请选择队列</option>' + queues.map((item) => `<option value="${escapeHtml(item.Name)}">${escapeHtml(item.Name)}${item.Desc ? ` · ${escapeHtml(item.Desc)}` : ""}</option>`).join("");
  select.value = selectedName || "";
  renderGpuTypes();
}

function renderGpuTypes(selectedType = $("#dev-gpu-type").value) {
  const queue = selectedQueue();
  const types = [...new Set([...(queue?.GpuModels ?? []).map((item) => item.Model), ...(queue?.IntanceModels ?? [])].filter(Boolean))];
  const select = $("#dev-gpu-type");
  select.innerHTML = '<option value="">不使用 GPU</option>' + types.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("");
  select.value = types.includes(selectedType) ? selectedType : "";
  if (!select.value) $("#dev-gpu-number").value = 0;
}

function storageOptions(selectedId = "") {
  return '<option value="">请选择存储配置</option>' + (state.devOptions?.storageConfigs ?? []).map((item) => `<option value="${escapeHtml(item.StorageConfigId)}" ${item.StorageConfigId === selectedId ? "selected" : ""}>${escapeHtml(item.StorageConfigName)} · ${escapeHtml(item.Type)}</option>`).join("");
}

function renderEnvRows(items = []) {
  const container = $("#dev-env-rows");
  container.innerHTML = items.length ? items.map((item) => `<div class="repeater-row env"><label>变量名<input data-env-name value="${escapeHtml(item.Name || "")}" placeholder="例如 MODE"></label><label>变量值<input data-env-value value="${escapeHtml(item.Value || "")}"></label><button type="button" class="icon-button" data-remove-row aria-label="删除">×</button></div>`).join("") : '<div class="repeater-empty">暂未配置环境变量</div>';
}

function renderStorageRows(items = []) {
  const container = $("#dev-storage-rows");
  container.innerHTML = items.length ? items.map((item) => `<div class="repeater-row storage"><label>存储配置<select data-storage-id>${storageOptions(item.StorageConfigId)}</select></label><label>挂载用途<select data-storage-kind><option value="DataSet" ${item.StorageConfigType === "DataSet" ? "selected" : ""}>数据集</option><option value="Output" ${item.StorageConfigType === "Output" ? "selected" : ""}>输出存储</option></select></label><label>容器挂载路径<input data-storage-path value="${escapeHtml(item.MountPath || "")}" placeholder="/share/data"></label><label>协议<select data-storage-protocol><option value="" ${!item.MountProtocol ? "selected" : ""}>自动</option><option value="NFS" ${item.MountProtocol === "NFS" ? "selected" : ""}>NFS</option><option value="POSIX" ${item.MountProtocol === "POSIX" ? "selected" : ""}>POSIX</option></select></label><button type="button" class="icon-button" data-remove-row aria-label="删除">×</button></div>`).join("") : '<div class="repeater-empty">暂未挂载存储配置</div>';
}

function renderServiceRows(items = []) {
  const allowPublic = Boolean(state.devOptions?.publicNetworkByPool?.[$("#dev-resource-pool").value]);
  const container = $("#dev-service-rows");
  container.innerHTML = items.length ? items.map((item) => `<div class="repeater-row service"><label>服务名称<input data-service-name value="${escapeHtml(item.Service || "")}" placeholder="例如 tensorboard"></label><label>端口<input data-service-port type="number" min="1" max="65535" value="${escapeHtml(item.Port || "")}"></label><label>访问范围<select data-service-public><option value="false">仅内网</option><option value="true" ${allowPublic && item.EnablePublicNetwork ? "selected" : ""} ${allowPublic ? "" : "disabled"}>公网与内网</option></select></label><button type="button" class="icon-button" data-remove-row aria-label="删除">×</button></div>`).join("") : '<div class="repeater-empty">暂未配置自定义服务</div>';
  updateEipVisibility();
}

function renderEipOptions(selectedValue = $("#dev-allocation-id").value) {
  const addresses = state.devOptions?.availableAddresses ?? [];
  const selected = addresses.find((item) => item.AllocationId === selectedValue || item.PublicIp === selectedValue);
  const select = $("#dev-allocation-id");
  select.innerHTML = '<option value="">请选择当前可用的公网 EIP</option>' + addresses.map((item) => `<option value="${escapeHtml(item.AllocationId)}">${escapeHtml(item.PublicIp)} · ${escapeHtml(item.BandWidth || "-")} Mbps</option>`).join("");
  select.value = selected?.AllocationId || "";
  select.dataset.unavailableValue = selectedValue && !selected ? selectedValue : "";
}

function updateEipVisibility() {
  const needsAllocation = Boolean($("#dev-public-ssh")?.checked)
    || $$("[data-service-public]", $("#dev-service-rows")).some((input) => input.value === "true");
  $("#dev-eip-fields")?.classList.toggle("hidden", !needsAllocation);
}

function addRepeaterRow(kind) {
  if (kind === "env") {
    const items = $$(".repeater-row", $("#dev-env-rows")).map((row) => ({ Name: $("[data-env-name]", row).value, Value: $("[data-env-value]", row).value }));
    renderEnvRows([...items, { Name: "", Value: "" }]);
  }
  if (kind === "storage") {
    const current = readStorageRows();
    if (current.length >= 20) return toast("最多添加 20 项存储配置", "error");
    const first = state.devOptions?.storageConfigs?.[0];
    renderStorageRows([...current, { StorageConfigId: first?.StorageConfigId || "", StorageConfigType: "DataSet", MountPath: first?.KpfsInfo?.MountPath || first?.Ks3Info?.MountPath || "", MountProtocol: first?.KpfsInfo?.MntProtocol || "" }]);
  }
  if (kind === "service") {
    const items = readServiceRows();
    if (items.length >= 40) return toast("最多添加 40 项自定义服务", "error");
    renderServiceRows([...items, { Service: "", Port: "", EnablePublicNetwork: false }]);
  }
  if (kind === "train-storage") {
    const current = readTrainStorageRows();
    if (current.length >= 20) return toast("最多添加 20 项挂载配置", "error");
    const first = state.trainOptions?.storageConfigs?.[0];
    renderTrainStorageRows([...current, {
      StorageConfigId: first?.StorageConfigId || "",
      MountType: "DataSet",
      MountPath: first?.KpfsInfo?.MountPath || first?.Ks3Info?.MountPath || "",
      MountProtocol: first?.KpfsInfo?.MntProtocol || null,
    }]);
  }
  syncQuickFields();
}

function readStorageRows() {
  return $$(".repeater-row", $("#dev-storage-rows")).map((row) => ({
    StorageConfigId: $("[data-storage-id]", row).value,
    StorageConfigType: $("[data-storage-kind]", row).value,
    MountPath: $("[data-storage-path]", row).value.trim(),
    MountProtocol: $("[data-storage-protocol]", row).value || null,
  })).filter((item) => item.StorageConfigId || item.MountPath);
}

function readServiceRows() {
  return $$(".repeater-row", $("#dev-service-rows")).map((row) => ({
    Service: $("[data-service-name]", row).value.trim(),
    Port: Number($("[data-service-port]", row).value || 0),
    EnablePublicNetwork: $("[data-service-public]", row).value === "true",
  })).filter((item) => item.Service || item.Port);
}

function updateAutosaveFields() {
  const enabled = $("#dev-autosave").checked;
  $("#dev-autosave-config").classList.toggle("hidden", !enabled);
  $("#dev-autosave-official").classList.toggle("hidden", !enabled || $("#dev-autosave-type").value !== "Official");
}

function updateSshFields() {
  $("#dev-ssh-fields").classList.toggle("hidden", !$("#dev-enable-ssh").checked);
  updateEipVisibility();
}

function updatePublicNetworkStatus() {
  const poolId = $("#dev-resource-pool").value;
  const known = poolId && Object.hasOwn(state.devOptions?.publicNetworkByPool ?? {}, poolId);
  const allowed = known && Boolean(state.devOptions.publicNetworkByPool[poolId]);
  $("#dev-public-network-status").textContent = !poolId ? "选择资源组后检查公网能力" : allowed ? "此资源组允许公网访问" : "此资源组未开放公网访问";
  $("#dev-public-ssh").disabled = !allowed;
  if (!allowed) $("#dev-public-ssh").checked = false;
  renderServiceRows(readServiceRows());
  updateEipVisibility();
}

async function refreshDevResourceInfo() {
  const requestId = ++state.devResourceRequest;
  const queue = selectedQueue();
  if (!queue) {
    $("#dev-resource-hint").textContent = "选择队列后显示可用资源与推荐规格";
    return;
  }
  $("#dev-resource-hint").textContent = "正在读取队列可用资源……";
  try {
    const params = new URLSearchParams({ queueId: queue.Id });
    if ($("#dev-gpu-type").value) {
      params.set("gpuType", $("#dev-gpu-type").value);
      params.set("gpuNumber", $("#dev-gpu-number").value || "1");
    }
    const payload = await api(`/api/dev/resource-info?${params}`);
    if (requestId !== state.devResourceRequest) return;
    const infos = payload.Data?.ResourceInfos ?? [];
    const matching = $("#dev-gpu-type").value ? infos.filter((item) => item.GpuModel === $("#dev-gpu-type").value) : infos;
    const maximum = (key) => Math.max(0, ...matching.map((item) => Number(item[key]?.TotalUserAllocatable || 0)));
    const recommendation = matching.find((item) => item.CpuRecommendNum || item.MemoryRecommendNum || item.GpuRecommendNum);
    $("#dev-resource-hint").textContent = `队列 ${queue.Name} · 可分配上限（单节点视图）：GPU ${maximum("Gpu")} 卡，CPU ${maximum("Cpu")} 核，内存 ${maximum("Memory")} GiB${recommendation ? ` · 推荐：GPU ${recommendation.GpuRecommendNum ?? "-"} / CPU ${recommendation.CpuRecommendNum ?? "-"} / 内存 ${recommendation.MemoryRecommendNum ?? "-"}` : ""}`;
  } catch (error) {
    if (requestId === state.devResourceRequest) $("#dev-resource-hint").textContent = `暂时无法读取资源余量：${error.message}`;
  }
}

async function refreshDevNodes(selectedIp = $("#dev-affinity-ip").value) {
  const requestId = ++state.devNodeRequest;
  const queue = selectedQueue();
  const select = $("#dev-affinity-ip");
  const status = $("#dev-affinity-status");
  if (!queue) {
    state.devNodes = [];
    select.innerHTML = '<option value="">不指定节点</option>';
    status.textContent = "选择队列后加载可用节点";
    return;
  }
  select.innerHTML = `<option value="">正在检查可用节点……</option>${selectedIp ? `<option value="${escapeHtml(selectedIp)}" selected>${escapeHtml(selectedIp)} · 正在检查</option>` : ""}`;
  status.textContent = "正在按当前队列和资源规格检查节点……";
  try {
    const params = new URLSearchParams({
      queueId: queue.Id,
      cpu: $("#dev-cpu").value || "0",
      gpuNumber: $("#dev-gpu-number").value || "0",
      memory: $("#dev-memory").value || "0",
      region: state.config.region,
    });
    if ($("#dev-gpu-type").value) params.set("gpuType", $("#dev-gpu-type").value);
    const nodes = await api(`/api/dev/nodes?${params}`);
    if (requestId !== state.devNodeRequest) return;
    state.devNodes = nodes;
    const selectedNode = nodes.find((item) => item.InstanceIp === selectedIp);
    select.innerHTML = '<option value="">不指定节点</option>' + nodes.map((item) => `<option value="${escapeHtml(item.InstanceIp)}">${escapeHtml(item.InstanceName || "节点")} · ${escapeHtml(item.InstanceIp)}</option>`).join("");
    select.value = selectedNode?.InstanceIp || "";
    if (selectedIp && !selectedNode) {
      status.textContent = `模板节点 ${selectedIp} 不满足当前规格，已改为不指定节点`;
      toast(`模板中的固定节点 ${selectedIp} 当前不可用，已自动改为“不指定节点”`);
      try { syncQuickFields(); } catch {}
    } else {
      status.textContent = nodes.length ? `当前规格有 ${nodes.length} 个可用节点；不选择则由平台自动调度` : "当前规格没有可指定节点；将由平台自动调度";
    }
  } catch (error) {
    if (requestId !== state.devNodeRequest) return;
    select.innerHTML = '<option value="">不指定节点</option>';
    status.textContent = `节点列表加载失败：${error.message}`;
  }
}

async function loadImageTags(registryId, repoId, selectedTag = "") {
  const select = $("#dev-image-tag");
  if (!registryId || !repoId) {
    state.devImageTags = [];
    select.innerHTML = '<option value="">请先选择镜像仓库</option>';
    return;
  }
  select.innerHTML = '<option value="">正在加载版本……</option>';
  state.devImageTags = await api(`/api/dev/image-tags?registryId=${encodeURIComponent(registryId)}&repoId=${encodeURIComponent(repoId)}`);
  select.innerHTML = '<option value="">请选择镜像版本</option>' + state.devImageTags.map((item) => `<option value="${escapeHtml(item.TagId)}">${escapeHtml(item.TagName)}</option>`).join("");
  select.value = selectedTag || "";
}

async function loadImageRepos(registryId, selectedRepo = "", selectedTag = "") {
  const select = $("#dev-image-repo");
  if (!registryId) {
    state.devImageRepos = [];
    select.innerHTML = '<option value="">请先选择镜像配置</option>';
    await loadImageTags("", "");
    return;
  }
  select.innerHTML = '<option value="">正在加载仓库……</option>';
  state.devImageRepos = await api(`/api/dev/image-repos?registryId=${encodeURIComponent(registryId)}`);
  select.innerHTML = '<option value="">请选择镜像仓库</option>' + state.devImageRepos.map((item) => `<option value="${escapeHtml(item.RepoId)}">${escapeHtml(item.RepoName)}</option>`).join("");
  select.value = selectedRepo || "";
  await loadImageTags(registryId, select.value, selectedTag);
}

async function loadDevCreateOptions({ force = false } = {}) {
  const status = $("#dev-options-status");
  if (state.devOptions && !force) return state.devOptions;
  status.className = "create-loading";
  status.textContent = "正在从金山云加载镜像、资源组、队列和存储配置……";
  try {
    state.devOptions = await api(`/api/dev/create-options?region=${encodeURIComponent(state.config.region)}`);
    status.className = "create-loading ready";
    status.textContent = `已加载：${state.devOptions.images?.official?.length ?? 0} 个官方镜像、${state.devOptions.images?.personal?.length ?? 0} 个自定义镜像、${state.devOptions.queues?.length ?? 0} 个队列、${state.devOptions.storageConfigs?.length ?? 0} 项存储配置、${state.devOptions.availableAddresses?.length ?? 0} 个可用公网 EIP`;
    renderPoolOptions();
    renderRegistryOptions();
    renderDevImageOptions();
    renderEipOptions();
    return state.devOptions;
  } catch (error) {
    status.className = "create-loading error";
    status.textContent = `创建选项加载失败：${error.message}`;
    throw error;
  }
}

function trainImageList(source = $("#train-image-source").value) {
  if (!state.trainOptions) return [];
  return source === "Personal" ? state.trainOptions.images?.personal ?? [] : state.trainOptions.images?.official ?? [];
}

function selectedTrainQueue() {
  const poolId = $("#train-resource-pool").value;
  return state.trainOptions?.queues?.find((item) => item.ResourcePoolId === poolId && item.Name === $("#train-queue").value);
}

function renderTrainPoolOptions(selectedId = $("#train-resource-pool").value) {
  const select = $("#train-resource-pool");
  const pools = state.trainOptions?.resourcePools ?? [];
  select.innerHTML = '<option value="">请选择资源组</option>' + pools.map((item) => `<option value="${escapeHtml(item.ResourcePoolId)}">${escapeHtml(item.ResourcePoolName)} · ${escapeHtml(item.ResourcePoolType)}</option>`).join("");
  select.value = selectedId || "";
}

function renderTrainQueues(selectedName = $("#train-queue").value) {
  const poolId = $("#train-resource-pool").value;
  const queues = (state.trainOptions?.queues ?? []).filter((item) => item.ResourcePoolId === poolId);
  const select = $("#train-queue");
  select.innerHTML = '<option value="">请选择训练队列</option>' + queues.map((item) => `<option value="${escapeHtml(item.Name)}">${escapeHtml(item.Name)}${item.Desc ? ` · ${escapeHtml(item.Desc)}` : ""}</option>`).join("");
  select.value = selectedName || "";
  renderTrainGpuTypes();
}

function renderTrainGpuTypes(selectedType = $("#train-gpu-type").value) {
  const queue = selectedTrainQueue();
  const types = [...new Set([...(queue?.GpuModels ?? []).map((item) => item.Model), ...(queue?.IntanceModels ?? [])].filter(Boolean))];
  const select = $("#train-gpu-type");
  select.innerHTML = '<option value="">不使用 GPU</option>' + types.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("");
  select.value = types.includes(selectedType) ? selectedType : "";
  if (!select.value) $("#train-gpu-number").value = 0;
}

function renderTrainImages(selectedId = $("#train-image-select").value) {
  const source = $("#train-image-source").value;
  const thirdParty = source === "ThirdParty";
  $("#train-aicp-image-field").classList.toggle("hidden", thirdParty);
  $("#train-image-detail").classList.toggle("hidden", thirdParty);
  $("#train-third-image-fields").classList.toggle("hidden", !thirdParty);
  if (thirdParty) return;
  const images = trainImageList(source);
  const select = $("#train-image-select");
  select.innerHTML = `<option value="">请选择${source === "Official" ? "官方" : "自定义"}镜像</option>` + images.map((item) => `<option value="${escapeHtml(item.ImageId)}">${escapeHtml(item.ImageName)} · ${escapeHtml(item.ImageRepo || "-")}:${escapeHtml(item.ImageVersion || "-")}</option>`).join("");
  select.value = images.some((item) => item.ImageId === selectedId) ? selectedId : "";
  select.dataset.unavailableValue = selectedId && !select.value ? selectedId : "";
  renderTrainImageDetail();
}

function renderTrainImageDetail() {
  const image = trainImageList().find((item) => item.ImageId === $("#train-image-select").value);
  $("#train-image-detail").innerHTML = image
    ? `<strong>${escapeHtml(image.ImageName)}</strong> · ${escapeHtml(image.ImageRepo || "-")}:${escapeHtml(image.ImageVersion || "-")} · Python ${escapeHtml(image.PythonVersion || "-")} · CUDA ${escapeHtml(image.CudaVersion || "-")}<br>${escapeHtml(image.Description || "暂无描述")}`
    : "尚未选择镜像";
}

function renderTrainRegistries(selectedId = $("#train-image-registry").value) {
  const select = $("#train-image-registry");
  const registries = state.trainOptions?.imageRegistries ?? [];
  select.innerHTML = '<option value="">请选择镜像配置</option>' + registries.map((item) => `<option value="${escapeHtml(item.Id)}">${escapeHtml(item.Name)} · ${escapeHtml(item.RegistryDomain || "-")}</option>`).join("");
  select.value = selectedId || "";
}

async function loadTrainImageTags(registryId, repoId, selectedTag = "") {
  const select = $("#train-image-tag");
  if (!registryId || !repoId) {
    state.trainImageTags = [];
    select.innerHTML = '<option value="">请先选择镜像仓库</option>';
    return;
  }
  select.innerHTML = '<option value="">正在加载版本……</option>';
  const tags = await api(`/api/dev/image-tags?registryId=${encodeURIComponent(registryId)}&repoId=${encodeURIComponent(repoId)}`);
  if ($("#train-image-registry").value !== registryId || $("#train-image-repo").value !== repoId) return;
  state.trainImageTags = tags;
  select.innerHTML = '<option value="">请选择镜像版本</option>' + tags.map((item) => `<option value="${escapeHtml(item.TagId)}">${escapeHtml(item.TagName)}</option>`).join("");
  select.value = selectedTag || "";
}

async function loadTrainImageRepos(registryId, selectedRepo = "", selectedTag = "") {
  const select = $("#train-image-repo");
  if (!registryId) {
    state.trainImageRepos = [];
    select.innerHTML = '<option value="">请先选择镜像配置</option>';
    await loadTrainImageTags("", "");
    return;
  }
  select.innerHTML = '<option value="">正在加载仓库……</option>';
  const repos = await api(`/api/dev/image-repos?registryId=${encodeURIComponent(registryId)}`);
  if ($("#train-image-registry").value !== registryId) return;
  state.trainImageRepos = repos;
  select.innerHTML = '<option value="">请选择镜像仓库</option>' + repos.map((item) => `<option value="${escapeHtml(item.RepoId)}">${escapeHtml(item.RepoName)}</option>`).join("");
  select.value = selectedRepo || "";
  await loadTrainImageTags(registryId, select.value, selectedTag);
}

function trainStorageOptions(selectedId = "") {
  return '<option value="">请选择存储配置</option>' + (state.trainOptions?.storageConfigs ?? []).map((item) => `<option value="${escapeHtml(item.StorageConfigId)}" ${item.StorageConfigId === selectedId ? "selected" : ""}>${escapeHtml(item.StorageConfigName)} · ${escapeHtml(item.Type)}</option>`).join("");
}

function renderTrainStorageRows(items = []) {
  const container = $("#train-storage-rows");
  container.innerHTML = items.length ? items.map((item) => `<div class="repeater-row storage train-storage"><label>存储配置<select data-train-storage-id>${trainStorageOptions(item.StorageConfigId)}</select></label><label>挂载用途<select data-train-storage-type><option value="DataSet" ${item.MountType === "DataSet" ? "selected" : ""}>数据集</option><option value="Output" ${item.MountType === "Output" ? "selected" : ""}>输出</option></select></label><label>挂载路径<input data-train-storage-path value="${escapeHtml(item.MountPath || "")}" placeholder="/data"></label><label>子路径<input data-train-storage-subpath value="${escapeHtml(item.StorageSubPath || "")}" placeholder="可留空"></label><label>协议<input data-train-storage-protocol value="${escapeHtml(item.MountProtocol || "")}" placeholder="自动"></label><button type="button" class="icon-button" data-remove-row aria-label="删除">×</button></div>`).join("") : '<div class="repeater-empty">暂未配置挂载</div>';
}

function readTrainStorageRows() {
  return $$(".repeater-row", $("#train-storage-rows")).map((row) => ({
    StorageConfigId: $("[data-train-storage-id]", row).value,
    MountType: $("[data-train-storage-type]", row).value,
    MountPath: $("[data-train-storage-path]", row).value.trim(),
    MountProtocol: $("[data-train-storage-protocol]", row).value || null,
    StorageSubPath: $("[data-train-storage-subpath]", row).value.trim() || undefined,
  })).filter((item) => item.StorageConfigId || item.MountPath);
}

async function loadTrainCreateOptions({ force = false } = {}) {
  const status = $("#train-options-status");
  if (state.trainOptions && !force) return state.trainOptions;
  status.className = "create-loading";
  status.textContent = "正在从金山云加载训练镜像、资源组、训练队列和存储配置……";
  try {
    state.trainOptions = await api(`/api/train/create-options?region=${encodeURIComponent(state.config.region)}`);
    status.className = "create-loading ready";
    status.textContent = `已加载：${state.trainOptions.images?.official?.length ?? 0} 个训练官方镜像、${state.trainOptions.images?.personal?.length ?? 0} 个自定义镜像、${state.trainOptions.queues?.length ?? 0} 个训练队列、${state.trainOptions.storageConfigs?.length ?? 0} 项存储配置`;
    renderTrainPoolOptions();
    renderTrainRegistries();
    renderTrainImages();
    return state.trainOptions;
  } catch (error) {
    status.className = "create-loading error";
    status.textContent = `训练创建选项加载失败：${error.message}`;
    throw error;
  }
}

function fillTrainFields(variables) {
  const role = variables.Roles?.[0] || {};
  const image = role.ImageConfig || {};
  renderTrainPoolOptions(variables.ResourcePoolId || "");
  renderTrainQueues(variables.QueueName || "");
  $("#train-framework").value = variables.Framework || "pytorch";
  $("#train-priority").value = variables.Priority || "kaic-normal";
  $("#train-role-name").value = role.RoleName || "Master";
  $("#train-replicas").value = Number(role.Replicas || 1);
  $("#train-job-cpu").checked = Boolean(variables.JobRunOnCPU || !role.ResourceConfig?.GPUType);
  $("#train-queue-share").checked = variables.AccessType === "QueueMember";
  $("#train-image-source").value = ["Official", "Personal", "ThirdParty"].includes(image.ImageSource) ? image.ImageSource : "Personal";
  renderTrainImages(image.ImageId || "");
  renderTrainRegistries(image.ImageRegistryId || "");
  if (image.ImageSource === "ThirdParty") loadTrainImageRepos(image.ImageRegistryId || "", image.ImageRepoId || "", image.ImageTagId || "").catch((error) => toast(error.message, "error"));
  renderTrainGpuTypes(role.ResourceConfig?.GPUType || "");
  $("#train-gpu-number").value = Number(role.ResourceConfig?.GPUNumber || 0);
  $("#train-cpu").value = Number(role.ResourceConfig?.CPUNum || 8);
  $("#train-memory").value = Number(role.ResourceConfig?.Memory || 16);
  renderTrainStorageRows(variables.StorageConfigs || []);
  $("#train-command-label").textContent = String(variables.Framework).toLowerCase() === "ray" ? "入口命令" : "运行命令";
  $("#train-command").value = String(variables.Framework).toLowerCase() === "ray" ? variables.EntryPointCommand || "" : role.RunCommand || "";
}

function fillDevFields(variables) {
  $("#dev-description").value = variables.Description || "";
  const imageSource = [0, 1, 2].includes(Number(variables.ImageSource)) ? Number(variables.ImageSource) : 0;
  const radio = $(`input[name="dev-image-source"][value="${imageSource}"]`);
  if (radio) radio.checked = true;
  $("#dev-image-search").value = "";
  renderDevImageMode();
  if (imageSource !== 2) renderDevImageOptions(variables.ImageId || "");
  renderRegistryOptions(variables.ImageRegistryId || "");
  if (imageSource === 2) loadImageRepos(variables.ImageRegistryId || "", variables.ImageRepoId || "", variables.ImageTagId || "").catch((error) => toast(error.message, "error"));
  $("#dev-autosave").checked = Boolean(variables.AutoSave);
  $("#dev-autosave-type").value = variables.AutoSaveConfig?.ImageType || "Personal";
  $("#dev-autosave-instance").value = variables.AutoSaveConfig?.OfficialInstance || "";
  $("#dev-autosave-username").value = variables.AutoSaveConfig?.UserName || "";
  $("#dev-autosave-password").value = variables.AutoSaveConfig?.Password || "";
  updateAutosaveFields();
  renderEnvRows(variables.Envs || []);
  renderPoolOptions(variables.ResourcePoolId || "");
  renderDevQueues(variables.QueueName || "");
  renderGpuTypes(variables.GPUType || "");
  $("#dev-gpu-number").value = Number(variables.GPUNumber || 0);
  $("#dev-cpu").value = Number(variables.CpuNum || 8);
  $("#dev-memory").value = Number(variables.Memory || 16);
  $("#dev-affinity-cpu").checked = Boolean(variables.NodeAffinity?.RunOnCPU);
  $("#dev-affinity-gpu").checked = Boolean(variables.NodeAffinity?.RunOnGPU);
  const affinityIp = variables.NodeAffinity?.RequiredNodeIp || "";
  if (affinityIp) {
    $("#dev-affinity-cpu").checked = false;
    $("#dev-affinity-gpu").checked = false;
  }
  renderStorageRows(variables.StorageConfigs || []);
  $("#dev-enable-ssh").checked = Boolean(variables.EnableSsh);
  $("#dev-ssh-port").value = Number(variables.SshPort || 22);
  $("#dev-ssh-keys").value = variables.SshAuthorizedKeys || "";
  $("#dev-public-ssh").checked = Boolean(variables.EnablePublicNetworkSsh);
  renderEipOptions(variables.AllocationId || "");
  updateSshFields();
  renderServiceRows(variables.ServiceConfigs || []);
  $("#dev-queue-share").checked = variables.AccessType === "QueueMember";
  updatePublicNetworkStatus();
  refreshDevResourceInfo();
  refreshDevNodes(affinityIp);
}

function fillQuickFields(variables) {
  const kind = state.createKind;
  $("#create-name").value = variables[kind === "dev" ? "DisplayName" : "TrainJobName"] || "";
  if (kind === "dev") {
    fillDevFields(variables);
  } else {
    fillTrainFields(variables);
  }
}

function syncQuickFields() {
  const variables = parseCreateJson();
  const kind = state.createKind;
  variables[kind === "dev" ? "DisplayName" : "TrainJobName"] = $("#create-name").value.trim();
  if (kind === "dev") {
    variables.Region = state.config.region;
    variables.Description = $("#dev-description").value.trim();
    variables.ImageSource = currentDevImageSource();
    delete variables.ImageId;
    delete variables.ImageRegistryId;
    delete variables.ImageRepoId;
    delete variables.ImageTagId;
    if (variables.ImageSource === 2) {
      variables.ImageRegistryId = $("#dev-image-registry").value;
      variables.ImageRepoId = $("#dev-image-repo").value;
      variables.ImageTagId = $("#dev-image-tag").value;
    } else {
      variables.ImageId = $("#dev-image-select").value;
    }
    variables.AutoSave = $("#dev-autosave").checked;
    if (variables.AutoSave && $("#dev-autosave-type").value === "Official") {
      variables.AutoSaveConfig = { ImageType: "Official" };
      Object.assign(variables.AutoSaveConfig, {
          OfficialInstance: $("#dev-autosave-instance").value.trim(),
          UserName: $("#dev-autosave-username").value.trim(),
          Password: $("#dev-autosave-password").value,
      });
    } else delete variables.AutoSaveConfig;
    variables.ResourcePoolId = $("#dev-resource-pool").value;
    variables.QueueName = $("#dev-queue").value;
    variables.GPUType = $("#dev-gpu-type").value;
    variables.GPUNumber = variables.GPUType ? Number($("#dev-gpu-number").value || 0) : 0;
    variables.CpuNum = Number($("#dev-cpu").value || 0);
    variables.Memory = Number($("#dev-memory").value || 0);
    variables.AccessType = $("#dev-queue-share").checked ? "QueueMember" : "Creator";
    variables.Envs = $$(".repeater-row", $("#dev-env-rows")).map((row) => ({ Name: $("[data-env-name]", row).value.trim(), Value: $("[data-env-value]", row).value })).filter((item) => item.Name);
    variables.StorageConfigs = readStorageRows();
    variables.EnableSsh = $("#dev-enable-ssh").checked;
    if (variables.EnableSsh) {
      variables.SshPort = Number($("#dev-ssh-port").value || 22);
      variables.SshAuthorizedKeys = $("#dev-ssh-keys").value.trim();
      variables.EnablePublicNetworkSsh = $("#dev-public-ssh").checked;
    } else {
      delete variables.SshPort;
      delete variables.SshAuthorizedKeys;
      delete variables.EnablePublicNetworkSsh;
    }
    variables.ServiceConfigs = readServiceRows();
    const needsAllocation = variables.EnablePublicNetworkSsh || variables.ServiceConfigs.some((item) => item.EnablePublicNetwork);
    if (needsAllocation) {
      if (!$("#dev-allocation-id").value) {
        const unavailable = $("#dev-allocation-id").dataset.unavailableValue;
        throw new Error(unavailable
          ? `模板中的公网 EIP“${unavailable}”当前不可用，请重新选择`
          : "已开启公网访问，请选择一个当前可用的公网 EIP");
      }
      variables.AllocationId = $("#dev-allocation-id").value;
    } else delete variables.AllocationId;
    variables.NodeAffinity = {
      RunOnCPU: $("#dev-affinity-cpu").checked,
      RunOnGPU: $("#dev-affinity-gpu").checked,
    };
    if ($("#dev-affinity-ip").value.trim()) variables.NodeAffinity.RequiredNodeIp = $("#dev-affinity-ip").value.trim();
  } else {
    variables.Region = state.config.region;
    variables.ResourcePoolId = $("#train-resource-pool").value;
    variables.QueueName = $("#train-queue").value;
    variables.Framework = $("#train-framework").value;
    variables.Priority = $("#train-priority").value;
    variables.AccessType = $("#train-queue-share").checked ? "QueueMember" : "Creator";
    variables.Roles ||= [{}];
    variables.Roles[0] ||= {};
    variables.Roles[0].RoleName = $("#train-role-name").value.trim();
    variables.Roles[0].Replicas = Number($("#train-replicas").value || 0);
    variables.Roles[0].ImageConfig ||= {};
    variables.Roles[0].ImageConfig.ImageSource = $("#train-image-source").value;
    delete variables.Roles[0].ImageConfig.ImageId;
    delete variables.Roles[0].ImageConfig.ImageRegistryId;
    delete variables.Roles[0].ImageConfig.ImageRepoId;
    delete variables.Roles[0].ImageConfig.ImageTagId;
    if (variables.Roles[0].ImageConfig.ImageSource === "ThirdParty") {
      variables.Roles[0].ImageConfig.ImageRegistryId = $("#train-image-registry").value;
      variables.Roles[0].ImageConfig.ImageRepoId = $("#train-image-repo").value;
      variables.Roles[0].ImageConfig.ImageTagId = $("#train-image-tag").value;
    } else {
      variables.Roles[0].ImageConfig.ImageId = $("#train-image-select").value;
    }
    variables.Roles[0].ResourceConfig ||= {};
    variables.Roles[0].ResourceConfig.GPUType = $("#train-gpu-type").value;
    variables.Roles[0].ResourceConfig.GPUNumber = variables.Roles[0].ResourceConfig.GPUType ? Number($("#train-gpu-number").value || 0) : 0;
    variables.Roles[0].ResourceConfig.CPUNum = Number($("#train-cpu").value || 0);
    variables.Roles[0].ResourceConfig.Memory = Number($("#train-memory").value || 0);
    variables.JobRunOnCPU = $("#train-job-cpu").checked || !variables.Roles[0].ResourceConfig.GPUType;
    variables.StorageConfigs = readTrainStorageRows();
    if (String(variables.Framework).toLowerCase() === "ray") {
      variables.EntryPointCommand = $("#train-command").value;
      delete variables.Roles[0].RunCommand;
    } else {
      variables.Roles[0].RunCommand = $("#train-command").value;
      delete variables.EntryPointCommand;
    }
  }
  updateJson(variables);
  return variables;
}

function populateTemplateSelect(kind) {
  const select = $("#create-template");
  select.innerHTML = '<option value="">不使用模板</option>' + state.templates
    .filter((item) => item.kind === kind)
    .map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`).join("");
}

async function openCreate(kind, templateName = "") {
  const requestId = ++state.createRequest;
  state.createKind = kind;
  $("#create-title").textContent = kind === "dev" ? "新建开发机" : "新建训练任务";
  $("#create-kind-label").textContent = kind === "dev" ? "Development machine" : "Training job";
  $("#dev-quick-fields").classList.toggle("hidden", kind !== "dev");
  $("#train-quick-fields").classList.toggle("hidden", kind !== "train");
  populateTemplateSelect(kind);
  let variables = kind === "dev" ? devDefaults() : trainDefaults();
  updateJson(variables);
  $("#create-modal").showModal();
  try {
    if (kind === "dev") await loadDevCreateOptions();
    else await loadTrainCreateOptions();
    if (requestId !== state.createRequest || state.createKind !== kind) return;
    if (templateName) {
      variables = (await api(`/api/template?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(templateName)}`)).variables;
      if (requestId !== state.createRequest || state.createKind !== kind) return;
      $("#create-template").value = templateName;
    }
    if (kind === "dev" && !variables.ResourcePoolId && state.devOptions?.resourcePools?.length) {
      variables.ResourcePoolId = state.devOptions.resourcePools[0].ResourcePoolId;
      variables.QueueName = state.devOptions.queues.find((item) => item.ResourcePoolId === variables.ResourcePoolId)?.Name || "";
    }
    if (kind === "train" && !variables.ResourcePoolId && state.trainOptions?.resourcePools?.length) {
      variables.ResourcePoolId = state.trainOptions.resourcePools[0].ResourcePoolId;
      variables.QueueName = state.trainOptions.queues.find((item) => item.ResourcePoolId === variables.ResourcePoolId)?.Name || "";
      const role = variables.Roles?.[0];
      const personal = state.trainOptions.images?.personal?.[0];
      const official = state.trainOptions.images?.official?.[0];
      const defaultImage = personal || official;
      if (role && defaultImage && !role.ImageConfig?.ImageId) {
        role.ImageConfig = { ImageId: defaultImage.ImageId, ImageSource: personal ? "Personal" : "Official" };
      }
    }
    updateJson(variables);
    fillQuickFields(variables);
  } catch (error) {
    toast(error.message, "error");
  }
}

async function loadSelectedTemplate() {
  const requestId = ++state.templateRequest;
  const name = $("#create-template").value;
  if (!name) {
    const variables = state.createKind === "dev" ? devDefaults() : trainDefaults();
    if (state.createKind === "dev") await loadDevCreateOptions(); else await loadTrainCreateOptions();
    if (requestId !== state.templateRequest || $("#create-template").value) return;
    updateJson(variables);
    fillQuickFields(variables);
    return;
  }
  try {
    const kind = state.createKind;
    const record = await api(`/api/template?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(name)}`);
    if (kind === "dev") await loadDevCreateOptions(); else await loadTrainCreateOptions();
    if (requestId !== state.templateRequest || state.createKind !== kind || $("#create-template").value !== name) return;
    updateJson(record.variables);
    fillQuickFields(record.variables);
  } catch (error) {
    toast(error.message, "error");
  }
}

async function saveCurrentCreateTemplate() {
  let variables;
  try { variables = syncQuickFields(); }
  catch (error) { return toast(error.message, "error"); }
  const suggested = $("#create-template").value || $("#create-name").value.trim() || `${state.createKind}-template`;
  const name = window.prompt("模板名称（保存的是当前表单配置，之后载入仍可继续修改）", suggested);
  if (!name) return;
  if (state.templates.some((item) => item.kind === state.createKind && item.name === name) && !window.confirm(`模板“${name}”已存在，确认覆盖吗？`)) return;
  try {
    await api("/api/template", { method: "POST", body: JSON.stringify({ kind: state.createKind, name, variables, source: { basedOn: $("#create-template").value || undefined } }) });
    await loadTemplates();
    populateTemplateSelect(state.createKind);
    $("#create-template").value = name;
    toast(`当前配置已另存为模板“${name}”`);
  } catch (error) { toast(error.message, "error"); }
}

async function submitCreate(event) {
  event.preventDefault();
  if (event.submitter?.value === "cancel") {
    $("#create-modal").close();
    return;
  }
  let variables;
  try {
    variables = syncQuickFields();
  } catch (error) {
    toast(error.message, "error");
    return;
  }
  const name = variables[state.createKind === "dev" ? "DisplayName" : "TrainJobName"];
  if (!name) return toast("请填写新名称", "error");
  if (!window.confirm(`确认创建“${name}”吗？这会向星流平台提交真实任务。`)) return;
  const button = $("#submit-create");
  setBusy(button, true, "正在创建…");
  try {
    await api(`/api/${state.createKind}/create`, { method: "POST", body: JSON.stringify({ variables }) });
    $("#create-modal").close();
    toast(`${name} 创建请求已提交`);
    if (state.createKind === "dev") await loadDev(); else await loadTrain();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

async function loadTemplates() {
  try {
    state.templates = await api("/api/templates");
    renderTemplates();
  } catch (error) {
    toast(error.message, "error");
  }
}

function renderTemplates() {
  const grid = $("#template-grid");
  if (!state.templates.length) {
    grid.innerHTML = '<div class="panel empty">还没有模板。可以从现有资源生成，或新建 JSON 模板。</div>';
    return;
  }
  grid.innerHTML = state.templates.map((item) => `<article class="template-card">
    <div class="template-top"><span class="template-type">${item.kind === "dev" ? "开发机" : "训练任务"}</span><button class="icon-button" data-delete-template="${escapeHtml(item.name)}" data-kind="${item.kind}" title="删除">×</button></div>
    <h3>${escapeHtml(item.name)}</h3><p>${item.source?.name ? `来自 ${escapeHtml(item.source.name)}` : "手动维护的完整参数模板"}</p>
    <footer><small>${escapeHtml(item.updatedAt?.slice(0, 19).replace("T", " ") || "-")}</small><div class="actions"><button class="link-action" data-edit-template="${escapeHtml(item.name)}" data-kind="${item.kind}">编辑</button><button class="link-action" data-use-template="${escapeHtml(item.name)}" data-kind="${item.kind}">用于创建</button></div></footer>
  </article>`).join("");
}

async function saveFromResource(kind, name, selector, latest = false) {
  if (!name || !selector) return toast("请填写资源名称/ID和模板名称", "error");
  try {
    await api("/api/template/from", { method: "POST", body: JSON.stringify({ kind, name, selector, latest }) });
    toast(`模板 ${name} 已保存`);
    await loadTemplates();
  } catch (error) {
    toast(error.message, "error");
  }
}

function openTemplateEditor(kind = "dev", name = "", variables = undefined) {
  $("#template-kind").value = kind;
  $("#template-kind").disabled = Boolean(name);
  $("#template-name").value = name;
  $("#template-name").disabled = Boolean(name);
  $("#template-json").value = JSON.stringify(variables || (kind === "dev" ? devDefaults() : trainDefaults()), null, 2);
  $("#template-modal").showModal();
}

async function editTemplate(kind, name) {
  try {
    const record = await api(`/api/template?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(name)}`);
    openTemplateEditor(kind, name, record.variables);
  } catch (error) {
    toast(error.message, "error");
  }
}

async function saveTemplateEditor(event) {
  event.preventDefault();
  if (event.submitter?.value === "cancel") {
    $("#template-modal").close();
    return;
  }
  const kind = $("#template-kind").value;
  const name = $("#template-name").value.trim();
  if (!name) return toast("请填写模板名称", "error");
  let variables;
  try { variables = JSON.parse($("#template-json").value); }
  catch (error) { return toast(`JSON 格式错误：${error.message}`, "error"); }
  const button = $("#save-template-button");
  setBusy(button, true);
  try {
    await api("/api/template", { method: "POST", body: JSON.stringify({ kind, name, variables }) });
    $("#template-modal").close();
    toast(`模板 ${name} 已保存`);
    await loadTemplates();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

async function deleteTemplate(kind, name) {
  if (!window.confirm(`确认删除模板 ${kind}/${name}？`)) return;
  try {
    await api(`/api/template?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(name)}`, { method: "DELETE" });
    toast("模板已删除");
    await loadTemplates();
  } catch (error) { toast(error.message, "error"); }
}

function fillSettings() {
  $("#config-region").value = state.config.region || "";
  $("#config-username").value = state.config.username || "";
  $("#config-gui-port").value = state.config.guiPort || 17863;
}

async function saveSettings(event) {
  event.preventDefault();
  try {
    const previousRegion = state.config.region;
    state.config = await api("/api/config", {
      method: "POST",
      body: JSON.stringify({
        region: $("#config-region").value.trim(),
        username: $("#config-username").value.trim(),
        guiPort: Number($("#config-gui-port").value),
      }),
    });
    if (previousRegion !== state.config.region) {
      state.devOptions = null;
      state.trainOptions = null;
      state.devNodes = [];
    }
    toast("设置已保存；端口变更会在下次启动时生效");
  } catch (error) { toast(error.message, "error"); }
}

function currentSaveImageType() {
  return $('input[name="save-image-type"]:checked')?.value || "Personal";
}

function setSaveImageStatus(message, type = "") {
  const node = $("#save-image-options-status");
  node.textContent = message;
  node.classList.toggle("ready", type === "ready");
  node.classList.toggle("error", type === "error");
}

function renderSaveImageInstances(selected = "") {
  const instances = state.saveImageOptions?.officialInstances ?? [];
  const select = $("#save-image-instance");
  select.innerHTML = '<option value="">请选择镜像实例</option>' + instances.map((item) => {
    const status = item.InstanceStatus ? ` · ${item.InstanceStatus}` : "";
    return `<option value="${escapeHtml(item.InstanceId)}">${escapeHtml(item.InstanceName || item.InstanceId)}${escapeHtml(status)}</option>`;
  }).join("");
  select.value = selected;
}

function renderSaveImageNamespaces(items, selected = "") {
  state.saveImageNamespaces = items;
  const select = $("#save-image-namespace");
  select.innerHTML = '<option value="">请选择命名空间</option>' + items.map((item) =>
    `<option value="${escapeHtml(item.Namespace)}">${escapeHtml(item.Namespace)} · ${item.Public ? "公开" : "私有"} · ${escapeHtml(item.RepoCount ?? 0)} 个仓库</option>`
  ).join("");
  select.value = selected;
  updateSaveImageEndpointDetail();
}

function saveImageRepoName(item, type = currentSaveImageType()) {
  const name = String(item?.RepoName || "");
  return type === "Personal" && name.includes("/") ? name.slice(name.indexOf("/") + 1) : name;
}

function renderSaveImageRepositories(items) {
  state.saveImageRepositories = items;
  const type = currentSaveImageType();
  $("#save-image-repo-list").innerHTML = items.map((item) => {
    const name = saveImageRepoName(item, type);
    const detail = [item.Public === true ? "公开" : item.Public === false ? "私有" : "", item.Description].filter(Boolean).join(" · ");
    return `<option value="${escapeHtml(name)}" label="${escapeHtml(detail)}"></option>`;
  }).join("");
  validateSaveImageRepository();
}

function validateSaveImageRepository() {
  const input = $("#save-image-repo");
  const value = input.value.trim();
  const validOfficialRepo = state.saveImageRepositories.some((item) => saveImageRepoName(item, "Official") === value);
  input.setCustomValidity(currentSaveImageType() === "Official" && value && !validOfficialRepo ? "企业版实例只能选择已有镜像仓库" : "");
}

function updateSaveImageEndpointDetail() {
  const namespace = state.saveImageNamespaces.find((item) => item.Namespace === $("#save-image-namespace").value);
  const instance = state.saveImageOptions?.officialInstances?.find((item) => item.InstanceId === $("#save-image-instance").value);
  const endpoint = namespace?.InternalEndpoint || instance?.InternalEndpoint;
  $("#save-image-endpoint-detail").innerHTML = namespace
    ? `<strong>${namespace.Public ? "公开" : "私有"}命名空间</strong> · 内网上传地址：${escapeHtml(endpoint || "平台未返回，请检查 KCR 内网访问配置")}`
    : "选择命名空间后自动确定权限与内网上传地址";
}

async function loadSaveImageRepositories() {
  const request = ++state.saveImageRequest;
  const type = currentSaveImageType();
  const namespace = $("#save-image-namespace").value;
  const instanceId = $("#save-image-instance").value;
  renderSaveImageRepositories([]);
  if (!namespace || (type === "Official" && !instanceId)) return;
  try {
    const params = new URLSearchParams({ type, namespace, region: state.config.region || "" });
    if (instanceId) params.set("instanceId", instanceId);
    const items = await api(`/api/dev/save-image-repositories?${params}`);
    if (request !== state.saveImageRequest) return;
    renderSaveImageRepositories(items);
  } catch (error) {
    if (request === state.saveImageRequest) toast(`读取镜像仓库失败：${error.message}`, "error");
  }
}

async function loadSaveImageNamespaces() {
  const type = currentSaveImageType();
  const instanceId = $("#save-image-instance").value;
  $("#save-image-repo").value = "";
  renderSaveImageRepositories([]);
  if (type === "Personal") {
    renderSaveImageNamespaces(state.saveImageOptions?.personalNamespaces ?? []);
    await loadSaveImageRepositories();
    return;
  }
  const request = ++state.saveImageRequest;
  renderSaveImageNamespaces([]);
  if (!instanceId) return;
  try {
    const params = new URLSearchParams({ type, instanceId, region: state.config.region || "" });
    const items = await api(`/api/dev/save-image-namespaces?${params}`);
    if (request !== state.saveImageRequest) return;
    renderSaveImageNamespaces(items);
    await loadSaveImageRepositories();
  } catch (error) {
    if (request === state.saveImageRequest) toast(`读取命名空间失败：${error.message}`, "error");
  }
}

async function updateSaveImageType() {
  let official = currentSaveImageType() === "Official";
  const officialRadio = $('input[name="save-image-type"][value="Official"]');
  const instances = state.saveImageOptions?.officialInstances ?? [];
  officialRadio.disabled = instances.length === 0;
  officialRadio.closest(".choice-card").classList.toggle("disabled", officialRadio.disabled);
  if (official && officialRadio.disabled) {
    $('input[name="save-image-type"][value="Personal"]').checked = true;
    official = false;
  }
  $("#save-image-official-instance-fields").classList.toggle("hidden", !official);
  $("#save-image-official-credential-fields").classList.toggle("hidden", !official);
  $("#save-image-instance").required = official;
  $("#save-image-username").required = official;
  $("#save-image-official-password").required = official;
  const needsPersonalPassword = !official && state.saveImageOptions && !state.saveImageOptions.personalConfigured;
  $("#save-image-kcr-password-field").classList.toggle("hidden", !needsPersonalPassword);
  $("#save-image-password").required = Boolean(needsPersonalPassword);
  $("#save-image-repo").placeholder = official
    ? "请选择已有镜像仓库"
    : "选择或填写；不存在的仓库会自动新建";
  validateSaveImageRepository();
  renderSaveImageInstances(official ? $("#save-image-instance").value : "");
  await loadSaveImageNamespaces();
}

async function loadSaveImageOptions() {
  const request = ++state.saveImageRequest;
  state.saveImageOptions = null;
  state.saveImageNamespaces = [];
  state.saveImageRepositories = [];
  setSaveImageStatus("正在读取镜像服务配置……");
  const params = new URLSearchParams({ region: state.config.region || "" });
  try {
    const options = await api(`/api/dev/save-image-options?${params}`);
    if (request !== state.saveImageRequest) return;
    state.saveImageOptions = options;
    renderSaveImageInstances();
    const namespaceCount = options.personalNamespaces?.length ?? 0;
    const instanceCount = options.officialInstances?.length ?? 0;
    const configText = options.personalConfigured ? "个人版镜像服务已配置" : "首次使用个人版时需设置 KCR 密码";
    setSaveImageStatus(`${configText} · ${namespaceCount} 个个人命名空间 · ${instanceCount} 个企业版实例`, "ready");
    await updateSaveImageType();
  } catch (error) {
    if (request !== state.saveImageRequest) return;
    setSaveImageStatus(`读取失败：${error.message}`, "error");
    throw error;
  }
}

async function openSaveImage(item) {
  state.saveImageDev = item;
  $("#save-image-dev-name").textContent = item.name;
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12);
  $("#save-image-name").value = `${item.name}-image-${stamp}`.slice(0, 64);
  $('input[name="save-image-type"][value="Personal"]').checked = true;
  $('input[name="save-image-permission"][value="Public"]').checked = true;
  $("#save-image-repo").value = "";
  $("#save-image-version").value = "latest";
  $("#save-image-instance").value = "";
  $("#save-image-username").value = "";
  $("#save-image-password").value = "";
  $("#save-image-official-password").value = "";
  $("#save-image-description").value = "";
  $("#save-image-modal").showModal();
  try { await loadSaveImageOptions(); }
  catch (error) { toast(error.message, "error"); }
}

async function submitSaveImage(event) {
  event.preventDefault();
  if (!state.saveImageDev) return toast("未选择开发机", "error");
  const imageType = currentSaveImageType();
  const repoInput = $("#save-image-repo").value.trim();
  const variables = {
    ImageName: $("#save-image-name").value.trim(),
    Description: $("#save-image-description").value.trim() || undefined,
    ImageType: imageType,
    Namespace: $("#save-image-namespace").value.trim(),
    ImageRepo: imageType === "Personal" && repoInput.includes("/") ? repoInput.slice(repoInput.indexOf("/") + 1) : repoInput,
    ImageVersion: $("#save-image-version").value.trim() || "latest",
    ImagePermission: $('input[name="save-image-permission"]:checked')?.value || "Public",
  };
  if (imageType === "Official") {
    variables.OfficialInstance = $("#save-image-instance").value.trim();
    variables.UserName = $("#save-image-username").value.trim() || undefined;
    variables.Password = $("#save-image-official-password").value || undefined;
  } else if (!state.saveImageOptions?.personalConfigured) {
    variables.Password = $("#save-image-password").value;
  }
  if (!window.confirm(`确认从运行中的开发机“${state.saveImageDev.name}”保存镜像“${variables.ImageName}”吗？保存期间请勿写入数据。`)) return;
  const button = $("#submit-save-image");
  setBusy(button, true, "正在提交…");
  try {
    const payload = await api("/api/dev/save-image", { method: "POST", body: JSON.stringify({ selector: state.saveImageDev.id, variables }) });
    $("#save-image-modal").close();
    state.saveImageOptions = null;
    toast(`镜像保存请求已提交${payload.result?.ImageId ? `：${payload.result.ImageId}` : ""}`);
    await loadDev();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

async function bootstrap() {
  const payload = await fetch("/api/bootstrap").then((response) => response.json());
  Object.assign(state, payload);
  renderSession();
  fillSettings();
  renderTemplates();
  setPage("dev");
  startAutoRefresh();
}

document.addEventListener("click", async (event) => {
  const closer = event.target.closest("[data-close-modal]");
  if (closer) {
    const modal = document.getElementById(closer.dataset.closeModal);
    if (modal?.open) modal.close();
    return;
  }
  const addRow = event.target.closest("[data-add-row]");
  if (addRow) return addRepeaterRow(addRow.dataset.addRow);
  const removeRow = event.target.closest("[data-remove-row]");
  if (removeRow) {
    const repeater = removeRow.closest(".repeater");
    removeRow.closest(".repeater-row")?.remove();
    if (repeater && !$(".repeater-row", repeater)) repeater.innerHTML = '<div class="repeater-empty">暂未配置</div>';
    try { syncQuickFields(); } catch {}
    return;
  }
  const nav = event.target.closest("[data-page]");
  if (nav) return setPage(nav.dataset.page);
  const opener = event.target.closest("[data-open-create]");
  if (opener) return openCreate(opener.dataset.openCreate);
  const devAction = event.target.closest("[data-dev-action]");
  if (devAction) return performResourceAction("dev", devAction.dataset.devAction, devAction.dataset.id, devAction.dataset.name, devAction);
  const saveDevImage = event.target.closest("[data-save-dev-image]");
  if (saveDevImage) return openSaveImage({ id: saveDevImage.dataset.id, name: saveDevImage.dataset.name, resourcePoolType: saveDevImage.dataset.resourcePoolType });
  const copySsh = event.target.closest("[data-copy-ssh]");
  if (copySsh) {
    const command = `ssh -p ${copySsh.dataset.sshPort || 22} root@${copySsh.dataset.externalIp}`;
    try { await copyText(command); toast(`已复制：${command}`); }
    catch (error) { toast(`复制失败：${error.message}`, "error"); }
    return;
  }
  const trainAction = event.target.closest("[data-train-action]");
  if (trainAction) return performResourceAction("train", trainAction.dataset.trainAction, trainAction.dataset.id, trainAction.dataset.name, trainAction);
  const trainDetail = event.target.closest("[data-train-detail]");
  if (trainDetail) return openTrainDetail(trainDetail.dataset.id, trainDetail.dataset.name);
  const copyTrainCommand = event.target.closest("[data-copy-train-command]");
  if (copyTrainCommand) {
    const command = state.trainDetailCommands[Number(copyTrainCommand.dataset.copyTrainCommand)];
    if (command === undefined) return;
    try { await copyText(command); toast("运行命令已复制"); }
    catch (error) { toast(`复制失败：${error.message}`, "error"); }
    return;
  }
  const refreshTrainLog = event.target.closest("[data-refresh-train-log]");
  if (refreshTrainLog) return loadTrainLogs();
  const copyTrainLog = event.target.closest("[data-copy-train-log]");
  if (copyTrainLog) {
    const text = state.trainLogEntries.map(({ pod, content }) => `===== ${pod.Name} · ${pod.Role || "未命名角色"} =====\n${String(content ?? "").trimEnd()}`).join("\n\n");
    if (!text) return toast("当前没有可复制的训练日志", "error");
    try { await copyText(text); toast("训练日志已复制"); }
    catch (error) { toast(`复制失败：${error.message}`, "error"); }
    return;
  }
  const saveResource = event.target.closest("[data-save-resource]");
  if (saveResource) {
    const name = window.prompt("模板名称", `${saveResource.dataset.name}-template`);
    if (name) return saveFromResource(saveResource.dataset.saveResource, name, saveResource.dataset.id, true);
  }
  const useTemplate = event.target.closest("[data-use-template]");
  if (useTemplate) return openCreate(useTemplate.dataset.kind, useTemplate.dataset.useTemplate);
  const edit = event.target.closest("[data-edit-template]");
  if (edit) return editTemplate(edit.dataset.kind, edit.dataset.editTemplate);
  const remove = event.target.closest("[data-delete-template]");
  if (remove) return deleteTemplate(remove.dataset.kind, remove.dataset.deleteTemplate);
});

$("#refresh-button").addEventListener("click", () => refreshActiveResourcePage());
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshActiveResourcePage({ background: true });
});
$("#login-button").addEventListener("click", (event) => login(event.currentTarget));
$("#settings-login").addEventListener("click", (event) => login(event.currentTarget));
$("#logout-button").addEventListener("click", async () => {
  if (!window.confirm("确认清除当前登录会话？Edge 已保存的账号和密码会保留。")) return;
  try { await api("/api/logout", { method: "POST", body: JSON.stringify({ forget: false }) }); await refreshSession(); toast("会话已清除；Edge 已保存的账号和密码仍然保留"); }
  catch (error) { toast(error.message, "error"); }
});
$("#forget-login-button").addEventListener("click", async () => {
  if (!window.confirm("确认忘记所有登录资料？这会删除独立 Edge 中保存的账号、密码和会话，且无法撤销。")) return;
  try { await api("/api/logout", { method: "POST", body: JSON.stringify({ forget: true }) }); await refreshSession(); toast("所有登录资料已删除"); }
  catch (error) { toast(error.message, "error"); }
});
$("#dev-mine").addEventListener("change", loadDev);
$("#train-mine").addEventListener("change", loadTrain);
$("#train-status").addEventListener("change", loadTrain);
document.addEventListener("change", (event) => {
  if (["train-log-pod", "train-log-tail"].includes(event.target.id)) loadTrainLogs();
  if (event.target.id === "train-log-auto") {
    if (event.target.checked) loadTrainLogs({ background: true });
    else stopTrainLogRefresh();
  }
});
$("#gpu-only-free").addEventListener("change", rerenderGpuCapacity);
$("#gpu-node-sort").addEventListener("change", rerenderGpuCapacity);
$("#create-template").addEventListener("change", loadSelectedTemplate);
$("#save-create-template").addEventListener("click", saveCurrentCreateTemplate);
$("#refresh-dev-options").addEventListener("click", async () => {
  let variables;
  try { variables = syncQuickFields(); }
  catch (error) { return toast(error.message, "error"); }
  try {
    state.devOptions = null;
    await loadDevCreateOptions({ force: true });
    fillDevFields(variables);
    toast("金山云创建选项已刷新");
  } catch (error) { toast(error.message, "error"); }
});
$("#refresh-train-options").addEventListener("click", async () => {
  let variables;
  try { variables = syncQuickFields(); }
  catch (error) { return toast(error.message, "error"); }
  try {
    state.trainOptions = null;
    await loadTrainCreateOptions({ force: true });
    fillTrainFields(variables);
    toast("金山云训练创建选项已刷新");
  } catch (error) { toast(error.message, "error"); }
});
$("#create-json").addEventListener("blur", () => {
  try { fillQuickFields(parseCreateJson()); $("#create-validation").textContent = "JSON 格式正确"; }
  catch (error) { $("#create-validation").textContent = error.message; }
});
$("#create-form").addEventListener("input", (event) => {
  if (event.target.id === "create-json" || event.target.id === "create-template") return;
  if (event.target.id === "dev-image-search") return renderDevImageOptions();
  try { syncQuickFields(); } catch {}
});
$("#create-form").addEventListener("change", async (event) => {
  if (event.target.id === "create-template") return;
  if (state.createKind === "train") {
    try {
      if (event.target.id === "train-resource-pool") renderTrainQueues();
      if (event.target.id === "train-queue") renderTrainGpuTypes();
      if (event.target.id === "train-gpu-type") {
        if (event.target.value && Number($("#train-gpu-number").value) < 1) $("#train-gpu-number").value = 1;
        if (!event.target.value) $("#train-gpu-number").value = 0;
        $("#train-job-cpu").checked = !event.target.value;
      }
      if (event.target.id === "train-image-source") renderTrainImages();
      if (event.target.id === "train-image-select") renderTrainImageDetail();
      if (event.target.id === "train-image-registry") await loadTrainImageRepos(event.target.value);
      if (event.target.id === "train-image-repo") await loadTrainImageTags($("#train-image-registry").value, event.target.value);
      if (event.target.id === "train-framework") $("#train-command-label").textContent = event.target.value === "ray" ? "入口命令" : "运行命令";
      if (event.target.matches("[data-train-storage-id]")) {
        const item = state.trainOptions?.storageConfigs?.find((entry) => entry.StorageConfigId === event.target.value);
        const row = event.target.closest(".repeater-row");
        const path = $("[data-train-storage-path]", row);
        const protocol = $("[data-train-storage-protocol]", row);
        if (item && !path.value) path.value = item.KpfsInfo?.MountPath || item.Ks3Info?.MountPath || "";
        if (item?.KpfsInfo?.MntProtocol) protocol.value = item.KpfsInfo.MntProtocol;
      }
      syncQuickFields();
    } catch (error) { toast(error.message, "error"); }
    return;
  }
  try {
    if (event.target.name === "dev-image-source") renderDevImageMode();
    if (event.target.id === "dev-image-select") renderImageDetail();
    if (event.target.id === "dev-image-registry") await loadImageRepos(event.target.value);
    if (event.target.id === "dev-image-repo") await loadImageTags($("#dev-image-registry").value, event.target.value);
    if (event.target.id === "dev-autosave" || event.target.id === "dev-autosave-type") updateAutosaveFields();
    if (event.target.id === "dev-enable-ssh") updateSshFields();
    if (event.target.id === "dev-public-ssh" || event.target.matches("[data-service-public]")) updateEipVisibility();
    if (event.target.id === "dev-resource-pool") {
      renderDevQueues();
      updatePublicNetworkStatus();
      await refreshDevResourceInfo();
    }
    if (event.target.id === "dev-queue") {
      renderGpuTypes();
      await refreshDevResourceInfo();
    }
    if (event.target.id === "dev-gpu-type") {
      if (event.target.value && Number($("#dev-gpu-number").value) < 1) $("#dev-gpu-number").value = 1;
      if (!event.target.value) $("#dev-gpu-number").value = 0;
      await refreshDevResourceInfo();
    }
    if (event.target.id === "dev-gpu-number") await refreshDevResourceInfo();
    if (["dev-resource-pool", "dev-queue", "dev-gpu-type", "dev-gpu-number", "dev-cpu", "dev-memory"].includes(event.target.id)) await refreshDevNodes();
    if (event.target.id === "dev-affinity-cpu" && event.target.checked) {
      $("#dev-affinity-gpu").checked = false;
      $("#dev-affinity-ip").value = "";
    }
    if (event.target.id === "dev-affinity-gpu" && event.target.checked) {
      $("#dev-affinity-cpu").checked = false;
      $("#dev-affinity-ip").value = "";
    }
    if (event.target.id === "dev-affinity-ip" && event.target.value) {
      $("#dev-affinity-cpu").checked = false;
      $("#dev-affinity-gpu").checked = false;
    }
    if (event.target.matches("[data-storage-id]")) {
      const item = state.devOptions?.storageConfigs?.find((entry) => entry.StorageConfigId === event.target.value);
      const row = event.target.closest(".repeater-row");
      const path = $("[data-storage-path]", row);
      const protocol = $("[data-storage-protocol]", row);
      if (item && !path.value) path.value = item.KpfsInfo?.MountPath || item.Ks3Info?.MountPath || "";
      if (item?.KpfsInfo?.MntProtocol) protocol.value = item.KpfsInfo.MntProtocol;
    }
    syncQuickFields();
  } catch (error) { toast(error.message, "error"); }
});
$("#create-form").addEventListener("submit", submitCreate);
$("#new-template-button").addEventListener("click", () => openTemplateEditor());
$("#template-kind").addEventListener("change", () => {
  if (!$("#template-name").disabled) $("#template-json").value = JSON.stringify($("#template-kind").value === "dev" ? devDefaults() : trainDefaults(), null, 2);
});
$("#template-form").addEventListener("submit", saveTemplateEditor);
$("#save-image-form").addEventListener("submit", submitSaveImage);
$$('input[name="save-image-type"]').forEach((radio) => radio.addEventListener("change", () => updateSaveImageType().catch((error) => toast(error.message, "error"))));
$("#save-image-instance").addEventListener("change", () => loadSaveImageNamespaces().catch((error) => toast(error.message, "error")));
$("#save-image-namespace").addEventListener("change", () => {
  updateSaveImageEndpointDetail();
  $("#save-image-repo").value = "";
  loadSaveImageRepositories().catch((error) => toast(error.message, "error"));
});
$("#save-image-repo").addEventListener("input", validateSaveImageRepository);
$$("dialog.modal").forEach((modal) => modal.addEventListener("click", (event) => {
  if (event.target === modal) modal.close();
}));
$("#train-detail-modal").addEventListener("close", () => {
  state.trainDetailSelector = "";
  state.trainLogRequest += 1;
  stopTrainLogRefresh();
});
$("#save-from-resource").addEventListener("click", () => saveFromResource(
  $("#source-kind").value,
  $("#source-template-name").value.trim(),
  $("#source-selector").value.trim(),
  $("#source-latest").checked,
));
$("#config-form").addEventListener("submit", saveSettings);

bootstrap().catch((error) => toast(error.message, "error"));
