/** gpu owns its local state and event bindings; cross-feature calls are explicit. */
export function createFeature({ appState, features, ui, signal }) {
  let requestId = 0;
  const state = { gpuLoading: false, gpuCapacity: null };
  const { $, $$, on, escapeHtml, api, toast, statusPill, metric, percentLabel } = ui;
  const markResourceRefresh = (...args) => features.shell.markResourceRefresh(...args);

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
    const matched = pools.reduce((sum, pool) => sum + orderedGpuNodes(pool.nodes).length, 0);
    const direction = $("#gpu-node-sort")?.value === "asc" ? "从少到多" : "从多到少";
    $("#gpu-node-filter-summary").textContent = `匹配 ${matched} / 总计 ${total} 台 · 剩余卡数${direction}`;
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
        const remaining = queue.quotaRemainingGpu === null ? "—" : queue.quotaRemainingGpu;
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
            <div><dt>GPU 利用率</dt><dd>${escapeHtml(percentLabel(node.gpuUtilization))}</dd></div>
            <div><dt>GPU 剩余</dt><dd>${escapeHtml(node.remainingGpu)}<small> / ${escapeHtml(node.allocatableGpu)} 卡</small></dd></div>
            <div><dt>内存剩余</dt><dd>${escapeHtml(node.remainingMemoryGiB)}<small> / ${escapeHtml(node.allocatableMemoryGiB)} GiB</small></dd></div>
            <div><dt>CPU 剩余</dt><dd>${escapeHtml(node.remainingCpu)}<small> / ${escapeHtml(node.allocatableCpu)} 核</small></dd></div>
          </dl>
        </article>`;
      }).join("");
      return `<article class="panel capacity-pool">
        <header class="capacity-pool-head">
          <div><p class="eyebrow">Resource pool · ${escapeHtml(pool.type || "-")}</p><h3>${escapeHtml(pool.name || pool.id)}</h3><small>${escapeHtml(pool.id)}</small></div>
          <div class="capacity-pool-total"><span>物理 GPU 剩余</span><strong>${escapeHtml(pool.physicalFreeGpu)}<small> / ${escapeHtml(pool.totalGpu)} 卡</small></strong><progress max="${escapeHtml(max)}" value="${escapeHtml(pool.physicalFreeGpu)}"></progress><p>已分配 ${escapeHtml(pool.assignedGpu)} · 不可用 ${escapeHtml(pool.unavailableGpu)} · 平均利用率 ${escapeHtml(percentLabel(pool.averageGpuUtilization))}</p></div>
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
    const current = ++requestId;
    const container = $("#gpu-pools");
    if (!appState.session.authenticated) {
      state.gpuCapacity = null;
      $("#gpu-metrics").innerHTML = metric("资源组", "—") + metric("物理 GPU 剩余", "—") + metric("物理 GPU 总量", "—") + metric("GPU 平均利用率", "—") + metric("节点", "—");
      container.innerHTML = '<div class="panel capacity-empty">请先点击右上角“登录 / 更新会话”</div>';
      state.gpuLoading = false;
      return;
    }
    if (!background) {
      $("#gpu-metrics").innerHTML = metric("资源组", "…") + metric("物理 GPU 剩余", "…") + metric("物理 GPU 总量", "…") + metric("GPU 平均利用率", "…") + metric("节点", "…");
      container.innerHTML = '<div class="panel capacity-empty"><div class="skeleton"></div>正在读取资源组、队列和节点容量……</div>';
    }
    try {
      const payload = await api("/api/gpu");
    if (current !== requestId || signal.aborted) return;
    state.gpuCapacity = payload;
      const summary = state.gpuCapacity.summary;
      $("#gpu-metrics").innerHTML = metric("资源组", summary.poolCount, "个") + metric("物理 GPU 剩余", summary.physicalFreeGpu, "卡") + metric("物理 GPU 总量", summary.totalGpu, "卡") + metric("GPU 平均利用率", percentLabel(summary.averageGpuUtilization), summary.meanGpuUtilization === null ? "当前" : `趋势均值 ${percentLabel(summary.meanGpuUtilization)}`) + metric("节点", summary.nodeCount, `台 · ${summary.gpuNodeCount} 台 GPU`);
      container.innerHTML = renderGpuPools(state.gpuCapacity.pools);
      renderGpuFilterSummary(state.gpuCapacity.pools);
      markResourceRefresh();
    } catch (error) {
      if (current !== requestId || signal.aborted) return;
      if (!background) container.innerHTML = `<div class="panel capacity-empty error">${escapeHtml(error.message)}</div>`;
      if (!background) toast(error.message, "error");
    } finally {
      if (current === requestId) state.gpuLoading = false;
    }
  }

  function deactivate() { requestId++; state.gpuLoading = false; }

  function bind() {
    on($("#gpu-only-free"), "change", rerenderGpuCapacity);
    on($("#gpu-node-sort"), "change", rerenderGpuCapacity);
  }

  return { state, bind, deactivate, dispose: deactivate, workloadLabel, orderedGpuNodes, renderGpuFilterSummary, rerenderGpuCapacity, renderGpuPools, loadGpu };
}
