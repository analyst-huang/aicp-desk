/** training owns its local state and event bindings; cross-feature calls are explicit. */
export function createFeature({ appState, markResourceRefresh, performResourceAction, ui, signal }) {
  let requestId = 0;
  const state = { train: [], trainLoading: false };
  const { $, $$, on, escapeHtml, api, toast, statusPill, metric, tableLoading } = ui;

  async function loadTrain({ background = false } = {}) {
    if (state.trainLoading) return;
    state.trainLoading = true;
    const current = ++requestId;
    const table = $("#train-table");
    if (!appState.session.authenticated) {
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
      if (current !== requestId || signal.aborted) return;
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
      if (current !== requestId || signal.aborted) return;
      if (!background) table.innerHTML = `<tr><td colspan="7" class="empty">${escapeHtml(error.message)}</td></tr>`;
      if (!background) toast(error.message, "error");
    } finally {
      if (current === requestId) state.trainLoading = false;
    }
  }

  function deactivate() { requestId++; state.trainLoading = false; }

  function bind() {
    on(document, "click", async (event) => {
      const trainAction = event.target.closest("[data-train-action]");
      if (trainAction) return performResourceAction("train", trainAction.dataset.trainAction, trainAction.dataset.id, trainAction.dataset.name, trainAction);
    });
    on($("#train-mine"), "change", () => { deactivate(); loadTrain(); });
    on($("#train-status"), "change", loadTrain);
  }

  return { bind, deactivate, dispose: deactivate, loadTrain };
}
