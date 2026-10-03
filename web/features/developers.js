/** developers owns its local state and event bindings; cross-feature calls are explicit. */
export function createFeature({ appState, features, ui, signal }) {
  let requestId = 0;
  const state = { dev: [], devLoading: false };
  const { $, $$, on, escapeHtml, api, toast, statusPill, metric, tableLoading, copyText } = ui;
  const markResourceRefresh = (...args) => features.shell.markResourceRefresh(...args);
  const performResourceAction = (...args) => features.shell.performResourceAction(...args);

  async function loadDev({ background = false } = {}) {
    if (state.devLoading) return;
    state.devLoading = true;
    const current = ++requestId;
    const table = $("#dev-table");
    if (!appState.session.authenticated) {
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
      if (current !== requestId || signal.aborted) return;
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
      if (current !== requestId || signal.aborted) return;
      if (!background) table.innerHTML = `<tr><td colspan="6" class="empty">${escapeHtml(error.message)}</td></tr>`;
      if (!background) toast(error.message, "error");
    } finally {
      if (current === requestId) state.devLoading = false;
    }
  }

  function deactivate() { requestId++; state.devLoading = false; }

  function bind() {
    on(document, "click", async (event) => {
      const devAction = event.target.closest("[data-dev-action]");
      if (devAction) return performResourceAction("dev", devAction.dataset.devAction, devAction.dataset.id, devAction.dataset.name, devAction);
    });
    on(document, "click", async (event) => {
      const copySsh = event.target.closest("[data-copy-ssh]");
      if (copySsh) {
        const command = `ssh -p ${copySsh.dataset.sshPort || 22} root@${copySsh.dataset.externalIp}`;
        try { await copyText(command); toast(`已复制：${command}`); }
        catch (error) { toast(`复制失败：${error.message}`, "error"); }
        return;
      }
    });
    on($("#dev-mine"), "change", () => { deactivate(); loadDev(); });
  }

  return { state, bind, deactivate, dispose: deactivate, loadDev };
}
