import { renderRepeater } from '../core/repeaters.js';
/** devForm owns its local state and event bindings; cross-feature calls are explicit. */
export function createFeature({ appState, features, ui, signal }) {
  let generation = 0;
  const state = { devOptions: null, devImageRepos: [], devImageTags: [], devResourceRequest: 0, devNodeRequest: 0, devNodes: [] };
  const { $, $$, on, escapeHtml, api, toast } = ui;
  const syncQuickFields = (...args) => features.create.syncQuickFields(...args);

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

  function renderProjectOptions(selectedId = $("#dev-project").value) {
    const projects = state.devOptions?.projects ?? [];
    const select = $("#dev-project");
    select.innerHTML = '<option value="">请选择项目</option>' + projects
      .map((item) => `<option value="${escapeHtml(item.ProjectId)}">${escapeHtml(item.ProjectName || `项目 ${item.ProjectId}`)} · ID ${escapeHtml(item.ProjectId)}</option>`).join("");
    const requested = selectedId === undefined || selectedId === null ? "" : String(selectedId);
    select.value = projects.some((item) => String(item.ProjectId) === requested) ? requested : "";
    if (select.value === "" && projects.length) select.value = String(projects[0].ProjectId);
  }

  function normalizeDevProject(variables) {
    const projects = state.devOptions?.projects ?? [];
    if (!projects.length) return variables;
    const selected = projects.find((item) => String(item.ProjectId) === String(variables.ProjectId));
    variables.ProjectId = Number((selected ?? projects[0]).ProjectId);
    return variables;
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
    renderRepeater(container, items, (item) => `<div class="repeater-row env"><label>变量名<input data-env-name value="${escapeHtml(item.Name || "")}" placeholder="例如 MODE"></label><label>变量值<input data-env-value value="${escapeHtml(item.Value || "")}"></label><button type="button" class="icon-button" data-remove-row aria-label="删除">×</button></div>`, "暂未配置环境变量");
  }

  function renderStorageRows(items = []) {
    const container = $("#dev-storage-rows");
    renderRepeater(container, items, (item) => `<div class="repeater-row storage"><label>存储配置<select data-storage-id>${storageOptions(item.StorageConfigId)}</select></label><label>挂载用途<select data-storage-kind><option value="DataSet" ${item.StorageConfigType === "DataSet" ? "selected" : ""}>数据集</option><option value="Output" ${item.StorageConfigType === "Output" ? "selected" : ""}>输出存储</option></select></label><label>容器挂载路径<input data-storage-path value="${escapeHtml(item.MountPath || "")}" placeholder="/share/data"></label><label>协议<select data-storage-protocol><option value="" ${!item.MountProtocol ? "selected" : ""}>自动</option><option value="NFS" ${item.MountProtocol === "NFS" ? "selected" : ""}>NFS</option><option value="POSIX" ${item.MountProtocol === "POSIX" ? "selected" : ""}>POSIX</option></select></label><button type="button" class="icon-button" data-remove-row aria-label="删除">×</button></div>`, "暂未挂载存储配置");
  }

  function renderServiceRows(items = []) {
    const allowPublic = Boolean(state.devOptions?.publicNetworkByPool?.[$("#dev-resource-pool").value]);
    const container = $("#dev-service-rows");
    renderRepeater(container, items, (item) => `<div class="repeater-row service"><label>服务名称<input data-service-name value="${escapeHtml(item.Service || "")}" placeholder="例如 tensorboard"></label><label>端口<input data-service-port type="number" min="1" max="65535" value="${escapeHtml(item.Port || "")}"></label><label>访问范围<select data-service-public><option value="false">仅内网</option><option value="true" ${allowPublic && item.EnablePublicNetwork ? "selected" : ""} ${allowPublic ? "" : "disabled"}>公网与内网</option></select></label><button type="button" class="icon-button" data-remove-row aria-label="删除">×</button></div>`, "暂未配置自定义服务");
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
        region: appState.config.region,
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
    const current = generation;
    const select = $("#dev-image-tag");
    if (!registryId || !repoId) {
      state.devImageTags = [];
      select.innerHTML = '<option value="">请先选择镜像仓库</option>';
      return;
    }
    select.innerHTML = '<option value="">正在加载版本……</option>';
    const response = await api(`/api/dev/image-tags?registryId=${encodeURIComponent(registryId)}&repoId=${encodeURIComponent(repoId)}`);
    if (current !== generation || signal.aborted) return;
    if ($("#dev-image-registry").value !== registryId || $("#dev-image-repo").value !== repoId) return;
    state.devImageTags = response;
    select.innerHTML = '<option value="">请选择镜像版本</option>' + state.devImageTags.map((item) => `<option value="${escapeHtml(item.TagId)}">${escapeHtml(item.TagName)}</option>`).join("");
    select.value = selectedTag || "";
  }

  async function loadImageRepos(registryId, selectedRepo = "", selectedTag = "") {
    const current = generation;
    const select = $("#dev-image-repo");
    if (!registryId) {
      state.devImageRepos = [];
      select.innerHTML = '<option value="">请先选择镜像配置</option>';
      await loadImageTags("", "");
      return;
    }
    select.innerHTML = '<option value="">正在加载仓库……</option>';
    const response = await api(`/api/dev/image-repos?registryId=${encodeURIComponent(registryId)}`);
    if (current !== generation || signal.aborted) return;
    if ($("#dev-image-registry").value !== registryId) return;
    state.devImageRepos = response;
    select.innerHTML = '<option value="">请选择镜像仓库</option>' + state.devImageRepos.map((item) => `<option value="${escapeHtml(item.RepoId)}">${escapeHtml(item.RepoName)}</option>`).join("");
    select.value = selectedRepo || "";
    await loadImageTags(registryId, select.value, selectedTag);
  }

  async function loadDevCreateOptions({ force = false } = {}) {
    const current = generation;
    const status = $("#dev-options-status");
    if (state.devOptions && !force) return state.devOptions;
    status.className = "create-loading";
    status.textContent = "正在从金山云加载镜像、资源组、队列和存储配置……";
    try {
      const response = await api(`/api/dev/create-options?region=${encodeURIComponent(appState.config.region)}`);
      if (current !== generation || signal.aborted) return;
      state.devOptions = response;
      status.className = "create-loading ready";
      status.textContent = `已加载：${state.devOptions.projects?.length ?? 0} 个项目、${state.devOptions.images?.official?.length ?? 0} 个官方镜像、${state.devOptions.images?.personal?.length ?? 0} 个自定义镜像、${state.devOptions.queues?.length ?? 0} 个队列、${state.devOptions.storageConfigs?.length ?? 0} 项存储配置、${state.devOptions.availableAddresses?.length ?? 0} 个可用公网 EIP`;
      renderProjectOptions();
      renderPoolOptions();
      renderRegistryOptions();
      renderDevImageOptions();
      renderEipOptions();
      return state.devOptions;
    } catch (error) {
      if (current !== generation || signal.aborted) return;
      status.className = "create-loading error";
      status.textContent = `创建选项加载失败：${error.message}`;
      throw error;
    }
  }

  function fillDevFields(variables) {
    renderProjectOptions(variables.ProjectId);
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

  function invalidate() {
    generation++;
    state.devResourceRequest++; state.devNodeRequest++;
  }

  function resetOptions() { invalidate(); state.devOptions = null; }

  function bind() {
    on($("#refresh-dev-options"), "click", async () => {
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
  }

  return { state, bind, invalidate, resetOptions, dispose: invalidate, currentDevImageSource, imageListForSource, selectedImage, selectedPool, selectedQueue, renderImageDetail, renderDevImageOptions, renderDevImageMode, renderPoolOptions, renderProjectOptions, normalizeDevProject, renderRegistryOptions, renderDevQueues, renderGpuTypes, storageOptions, renderEnvRows, renderStorageRows, renderServiceRows, renderEipOptions, updateEipVisibility, readStorageRows, readServiceRows, updateAutosaveFields, updateSshFields, updatePublicNetworkStatus, refreshDevResourceInfo, refreshDevNodes, loadImageTags, loadImageRepos, loadDevCreateOptions, fillDevFields };
}
