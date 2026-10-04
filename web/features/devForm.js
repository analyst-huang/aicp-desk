import { fromVariables, toVariables } from '../models/dev-form.js';
import { renderRepeater } from '../core/repeaters.js';
import { retainSelectValue, validateSelectValue } from '../core/select-value.js';
/** devForm owns its local state and event bindings; cross-feature calls are explicit. */
export function createFeature({ appState, refreshOptions, ui, signal }) {
  let generation = 0;
  const state = { devOptions: null, devImageRepos: [], devImageTags: [], devOptionsRequest: 0, devImageRepoRequest: 0, devImageTagRequest: 0, devResourceRequest: 0, devNodeRequest: 0, devNodes: [] };
  const { $, $$, on, escapeHtml, api, toast } = ui;

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
    $("#dev-third-image-fields").disabled = !thirdParty;
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
    retainSelectValue(select, selectedId, `项目“${selectedId}”当前不可用，请重新选择`);
  }

  function normalizeDevProject(variables) {
    const projects = state.devOptions?.projects ?? [];
    if (projects.length && (variables.ProjectId == null || variables.ProjectId === '')) {
      variables.ProjectId = Number(projects[0].ProjectId);
    }
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
    retainSelectValue(select, selectedType, `GPU 型号“${selectedType}”在当前队列中不可用，请重新选择`);
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
    $$('[data-storage-id]', container).forEach((select, index) => {
      const id = items[index].StorageConfigId;
      retainSelectValue(select, id, `挂载配置“${id}”当前不可用，请重新选择或删除此挂载`);
    });
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
    const enabled = $("#dev-enable-ssh").checked;
    $("#dev-ssh-fields").classList.toggle("hidden", !enabled);
    $("#dev-ssh-fields").disabled = !enabled;
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

  function renderDevNodes(nodes, selectedIp, message, label) {
    const select = $('#dev-affinity-ip');
    select.innerHTML = '<option value="">不指定节点</option>' + nodes.map((item) => `<option value="${escapeHtml(item.InstanceIp)}">${escapeHtml(item.InstanceName || "节点")} · ${escapeHtml(item.InstanceIp)}</option>`).join('');
    retainSelectValue(select, selectedIp, message, label);
    if (selectedIp) select.closest('details').open = true;
  }

  async function refreshDevNodes(selectedIp = $("#dev-affinity-ip").value) {
    const requestId = ++state.devNodeRequest;
    const queue = selectedQueue();
    const select = $("#dev-affinity-ip");
    const status = $("#dev-affinity-status");
    state.devNodes = [];
    if (!queue) {
      renderDevNodes([], selectedIp, '请先选择队列以检查固定节点', '待检查');
      status.textContent = "选择队列后加载可用节点";
      return;
    }
    renderDevNodes([], selectedIp, '固定节点正在检查，请稍后重试', '正在检查');
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
      // A user can explicitly clear the fixed node while its lookup is pending.
      const currentIp = select.value;
      const unavailable = `固定节点 ${currentIp} 不满足当前规格，请重新选择或取消固定节点`;
      renderDevNodes(nodes, currentIp, unavailable);
      if (currentIp && !nodes.some(item => item.InstanceIp === currentIp)) {
        status.textContent = unavailable;
      } else {
        status.textContent = nodes.length ? `当前规格有 ${nodes.length} 个可用节点；不选择则由平台自动调度` : "当前规格没有可指定节点；将由平台自动调度";
      }
    } catch (error) {
      if (requestId !== state.devNodeRequest) return;
      renderDevNodes([], select.value, '固定节点检查失败，请刷新选项重试或取消固定节点', '检查失败');
      status.textContent = `节点列表加载失败：${error.message}`;
    }
  }

  async function loadImageTags(registryId, repoId, selectedTag = "") {
    const current = generation;
    const request = ++state.devImageTagRequest;
    const select = $("#dev-image-tag");
    state.devImageTags = [];
    select.innerHTML = '<option value="">正在加载版本……</option>';
    retainSelectValue(select, selectedTag, '镜像版本尚未检查，请等待加载完成', '待检查');
    if (!registryId || !repoId) {
      select.options[0].textContent = '请先选择镜像仓库';
      return;
    }
    const isCurrent = () => current === generation && request === state.devImageTagRequest && !signal.aborted
      && $('#dev-image-registry').value === registryId && $('#dev-image-repo').value === repoId;
    try {
      const response = await api(`/api/dev/image-tags?registryId=${encodeURIComponent(registryId)}&repoId=${encodeURIComponent(repoId)}`);
      if (!isCurrent()) return;
      state.devImageTags = response;
      select.innerHTML = '<option value="">请选择镜像版本</option>' + state.devImageTags.map((item) => `<option value="${escapeHtml(item.TagId)}">${escapeHtml(item.TagName)}</option>`).join("");
      retainSelectValue(select, selectedTag, '镜像版本当前不可用，请重新选择');
    } catch (error) {
      if (!isCurrent()) return;
      select.innerHTML = '<option value="">版本加载失败，请重新选择仓库或刷新选项</option>';
      retainSelectValue(select, selectedTag, '镜像版本检查失败，请重新选择仓库或刷新选项', '检查失败');
      toast(`镜像版本加载失败：${error.message}`, 'error');
    }
  }

  async function loadImageRepos(registryId, selectedRepo = "", selectedTag = "") {
    const current = generation;
    const request = ++state.devImageRepoRequest;
    state.devImageTagRequest++;
    state.devImageRepos = [];
    state.devImageTags = [];
    $('#dev-image-tag').innerHTML = '<option value="">请先选择镜像仓库</option>';
    retainSelectValue($('#dev-image-tag'), selectedTag, '请先选择可用的镜像仓库', '待检查');
    const select = $("#dev-image-repo");
    select.innerHTML = '<option value="">正在加载仓库……</option>';
    retainSelectValue(select, selectedRepo, '镜像仓库尚未检查，请等待加载完成', '待检查');
    if (!registryId) {
      select.options[0].textContent = '请先选择镜像配置';
      return;
    }
    const isCurrent = () => current === generation && request === state.devImageRepoRequest && !signal.aborted
      && $('#dev-image-registry').value === registryId;
    try {
      const response = await api(`/api/dev/image-repos?registryId=${encodeURIComponent(registryId)}`);
      if (!isCurrent()) return;
      state.devImageRepos = response;
      select.innerHTML = '<option value="">请选择镜像仓库</option>' + state.devImageRepos.map((item) => `<option value="${escapeHtml(item.RepoId)}">${escapeHtml(item.RepoName)}</option>`).join("");
      retainSelectValue(select, selectedRepo, '镜像仓库当前不可用，请重新选择');
      if (select.validity.customError) return;
      await loadImageTags(registryId, select.value, selectedTag);
    } catch (error) {
      if (!isCurrent()) return;
      select.innerHTML = '<option value="">仓库加载失败，请重新选择镜像配置或刷新选项</option>';
      retainSelectValue(select, selectedRepo, '镜像仓库检查失败，请重新选择镜像配置或刷新选项', '检查失败');
      toast(`镜像仓库加载失败：${error.message}`, 'error');
    }
  }

  function renderOptionsStatus() {
    const status = $('#dev-options-status');
    status.className = 'create-loading ready';
    status.textContent = `已加载：${state.devOptions.projects?.length ?? 0} 个项目、${state.devOptions.images?.official?.length ?? 0} 个官方镜像、${state.devOptions.images?.personal?.length ?? 0} 个自定义镜像、${state.devOptions.queues?.length ?? 0} 个队列、${state.devOptions.storageConfigs?.length ?? 0} 项存储配置、${state.devOptions.availableAddresses?.length ?? 0} 个可用公网 EIP`;
  }

  async function loadDevCreateOptions({ force = false } = {}) {
    const current = generation;
    const status = $("#dev-options-status");
    if (state.devOptions && !force) {
      renderOptionsStatus();
      return state.devOptions;
    }
    const request = ++state.devOptionsRequest;
    status.className = "create-loading";
    status.textContent = "正在从金山云加载镜像、资源组、队列和存储配置……";
    try {
      const response = await api(`/api/dev/create-options?region=${encodeURIComponent(appState.config.region)}`);
      if (current !== generation || request !== state.devOptionsRequest || signal.aborted) return;
      state.devOptions = response;
      renderOptionsStatus();
      return state.devOptions;
    } catch (error) {
      if (current !== generation || request !== state.devOptionsRequest || signal.aborted) return;
      status.className = "create-loading error";
      status.textContent = `创建选项加载失败：${error.message}`;
      throw error;
    }
  }

  function fillDevFields(variables) {
    const fields = fromVariables(variables);
    renderProjectOptions(fields.project);
    $("#dev-description").value = fields.description;
    const imageSource = fields.imageSource;
    const radio = $(`input[name="dev-image-source"][value="${imageSource}"]`);
    if (radio) radio.checked = true;
    $("#dev-image-search").value = "";
    renderDevImageMode();
    if (imageSource !== 2) renderDevImageOptions(fields.imageSelect);
    renderRegistryOptions(fields.imageRegistry);
    $("#dev-autosave").checked = fields.autosave;
    $("#dev-autosave-type").value = fields.autosaveType;
    $("#dev-autosave-instance").value = fields.autosaveInstance;
    $("#dev-autosave-username").value = fields.autosaveUsername;
    $("#dev-autosave-password").value = fields.autosavePassword;
    updateAutosaveFields();
    renderEnvRows(fields.envs);
    renderPoolOptions(fields.resourcePool);
    renderDevQueues(fields.queue);
    renderGpuTypes(fields.gpuType);
    $("#dev-gpu-number").value = fields.gpuNumber;
    $("#dev-cpu").value = fields.cpu;
    $("#dev-memory").value = fields.memory;
    $("#dev-affinity-cpu").checked = fields.affinityCpu;
    $("#dev-affinity-gpu").checked = fields.affinityGpu;
    const affinityIp = fields.affinityIp;
    if (affinityIp) {
      $("#dev-affinity-cpu").checked = false;
      $("#dev-affinity-gpu").checked = false;
    }
    renderStorageRows(fields.storageConfigs);
    $("#dev-enable-ssh").checked = fields.enableSsh;
    $("#dev-ssh-port").value = fields.sshPort;
    $("#dev-ssh-keys").value = fields.sshKeys;
    $("#dev-public-ssh").checked = fields.publicSsh;
    renderEipOptions(fields.allocationId);
    updateSshFields();
    renderServiceRows(fields.serviceConfigs);
    $("#dev-queue-share").checked = fields.queueShare;
    updatePublicNetworkStatus();
    refreshDevResourceInfo();
    refreshDevNodes(affinityIp);
    if (imageSource === 2) return loadImageRepos(fields.imageRegistry, fields.imageRepo, fields.imageTag);
  }

  function invalidate() {
    generation++;
    state.devOptionsRequest++; state.devImageRepoRequest++; state.devImageTagRequest++;
    state.devResourceRequest++; state.devNodeRequest++;
  }

  function resetOptions() { invalidate(); state.devOptions = null; state.devNodes = []; }

  function readVariables(base, options) {
    return toVariables({
      region: appState.config.region, name: $("#create-name").value,
      project: $("#dev-project").value,
      description: $("#dev-description").value,
      imageRegistry: $("#dev-image-registry").value,
      imageRepo: $("#dev-image-repo").value,
      imageTag: $("#dev-image-tag").value,
      imageSelect: $("#dev-image-select").value,
      autosave: $("#dev-autosave").checked,
      autosaveType: $("#dev-autosave-type").value,
      autosaveInstance: $("#dev-autosave-instance").value,
      autosaveUsername: $("#dev-autosave-username").value,
      autosavePassword: $("#dev-autosave-password").value,
      resourcePool: $("#dev-resource-pool").value,
      queue: $("#dev-queue").value,
      gpuType: $("#dev-gpu-type").value,
      gpuNumber: $("#dev-gpu-number").value,
      cpu: $("#dev-cpu").value,
      memory: $("#dev-memory").value,
      queueShare: $("#dev-queue-share").checked,
      enableSsh: $("#dev-enable-ssh").checked,
      sshPort: $("#dev-ssh-port").value,
      sshKeys: $("#dev-ssh-keys").value,
      publicSsh: $("#dev-public-ssh").checked,
      allocationId: $("#dev-allocation-id").value,
      affinityCpu: $("#dev-affinity-cpu").checked,
      affinityGpu: $("#dev-affinity-gpu").checked,
      affinityIp: $("#dev-affinity-ip").value,
      imageSource: currentDevImageSource(), allocationUnavailable: $("#dev-allocation-id").dataset.unavailableValue || '',
      envs: $$(".repeater-row", $("#dev-env-rows")).map(row => ({ Name: $("[data-env-name]", row).value.trim(), Value: $("[data-env-value]", row).value })).filter(item => item.Name),
      storageConfigs: readStorageRows(), serviceConfigs: readServiceRows(),
    }, base, options);
  }

  function addRow(kind) {
    if (kind === 'env') {
      const items = $$('.repeater-row', $('#dev-env-rows')).map(row => ({ Name: $('[data-env-name]', row).value, Value: $('[data-env-value]', row).value }));
      renderEnvRows([...items, { Name: '', Value: '' }]);
    }
    if (kind === 'storage') {
      const items = readStorageRows();
      if (items.length >= 20) return toast('最多添加 20 项存储配置', 'error');
      const first = state.devOptions?.storageConfigs?.[0];
      renderStorageRows([...items, { StorageConfigId: first?.StorageConfigId || '', StorageConfigType: 'DataSet', MountPath: first?.KpfsInfo?.MountPath || first?.Ks3Info?.MountPath || '', MountProtocol: first?.KpfsInfo?.MntProtocol || '' }]);
    }
    if (kind === 'service') {
      const items = readServiceRows();
      if (items.length >= 40) return toast('最多添加 40 项自定义服务', 'error');
      renderServiceRows([...items, { Service: '', Port: '', EnablePublicNetwork: false }]);
    }
  }

  function applyDefaults(input, { selectResourcePool = false } = {}) {
    const variables = normalizeDevProject(structuredClone(input));
    if (selectResourcePool && !variables.ResourcePoolId && state.devOptions?.resourcePools?.length) {
      variables.ResourcePoolId = state.devOptions.resourcePools[0].ResourcePoolId;
      variables.QueueName = state.devOptions.queues.find(item => item.ResourcePoolId === variables.ResourcePoolId)?.Name || '';
    }
    return variables;
  }

  function handleInput(event) {
    if (event.target.id !== 'dev-image-search') return false;
    renderDevImageOptions();
    return true;
  }

  async function handleChange(event) {
    if (event.target.id === 'dev-allocation-id') event.target.dataset.unavailableValue = '';
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
      validateSelectValue($("#dev-affinity-ip"));
    }
    if (event.target.id === "dev-affinity-gpu" && event.target.checked) {
      $("#dev-affinity-cpu").checked = false;
      $("#dev-affinity-ip").value = "";
      validateSelectValue($("#dev-affinity-ip"));
    }
    if (event.target.id === "dev-affinity-ip" && event.target.value) {
      $("#dev-affinity-cpu").checked = false;
      $("#dev-affinity-gpu").checked = false;
    }
    if (event.target.matches("[data-storage-id]")) {
      validateSelectValue(event.target);
      const item = state.devOptions?.storageConfigs?.find((entry) => entry.StorageConfigId === event.target.value);
      const row = event.target.closest(".repeater-row");
      const path = $("[data-storage-path]", row);
      const protocol = $("[data-storage-protocol]", row);
      if (item && !path.value) path.value = item.KpfsInfo?.MountPath || item.Ks3Info?.MountPath || "";
      if (item?.KpfsInfo?.MntProtocol) protocol.value = item.KpfsInfo.MntProtocol;
    }
  }

  function bind() {
    on($("#refresh-dev-options"), "click", refreshOptions);
    for (const id of ['dev-project', 'dev-gpu-type', 'dev-affinity-ip', 'dev-image-repo', 'dev-image-tag']) {
      on($(`#${id}`), 'change', event => validateSelectValue(event.currentTarget));
    }
  }

  return { bind, invalidate, resetOptions, dispose: invalidate, readVariables, applyDefaults, addRow, handleInput, handleChange,
    fillFields: fillDevFields, loadOptions: loadDevCreateOptions };
}
