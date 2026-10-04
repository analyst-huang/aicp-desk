import { fromVariables, toVariables } from '../models/train-form.js';
import { renderRepeater } from '../core/repeaters.js';
import { retainSelectValue, validateSelectValue } from '../core/select-value.js';
/** trainForm owns its local state and event bindings; cross-feature calls are explicit. */
export function createFeature({ appState, refreshOptions, ui, signal }) {
  let generation = 0;
  const state = { trainOptions: null, trainImageRepos: [], trainImageTags: [], trainOptionsRequest: 0, trainImageRepoRequest: 0, trainImageTagRequest: 0, otherRolesUseGpu: false };
  const { $, $$, on, escapeHtml, api, toast } = ui;

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
    retainSelectValue(select, selectedType, `GPU 型号“${selectedType}”在当前队列中不可用，请重新选择`);
    if (!select.value) $("#train-gpu-number").value = 0;
  }

  function renderTrainImages(selectedId = $("#train-image-select").value) {
    const source = $("#train-image-source").value;
    const thirdParty = source === "ThirdParty";
    $("#train-aicp-image-field").classList.toggle("hidden", thirdParty);
    $("#train-image-detail").classList.toggle("hidden", thirdParty);
    $("#train-third-image-fields").classList.toggle("hidden", !thirdParty);
    $("#train-third-image-fields").disabled = !thirdParty;
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
    const current = generation;
    const request = ++state.trainImageTagRequest;
    const select = $("#train-image-tag");
    state.trainImageTags = [];
    select.innerHTML = '<option value="">正在加载版本……</option>';
    retainSelectValue(select, selectedTag, '镜像版本尚未检查，请等待加载完成', '待检查');
    if (!registryId || !repoId) {
      select.options[0].textContent = '请先选择镜像仓库';
      return;
    }
    const isCurrent = () => current === generation && request === state.trainImageTagRequest && !signal.aborted
      && $('#train-image-registry').value === registryId && $('#train-image-repo').value === repoId;
    try {
      const tags = await api(`/api/dev/image-tags?registryId=${encodeURIComponent(registryId)}&repoId=${encodeURIComponent(repoId)}`);
      if (!isCurrent()) return;
      state.trainImageTags = tags;
      select.innerHTML = '<option value="">请选择镜像版本</option>' + tags.map((item) => `<option value="${escapeHtml(item.TagId)}">${escapeHtml(item.TagName)}</option>`).join("");
      retainSelectValue(select, selectedTag, '镜像版本当前不可用，请重新选择');
    } catch (error) {
      if (!isCurrent()) return;
      select.innerHTML = '<option value="">版本加载失败，请重新选择仓库或刷新选项</option>';
      retainSelectValue(select, selectedTag, '镜像版本检查失败，请重新选择仓库或刷新选项', '检查失败');
      toast(`镜像版本加载失败：${error.message}`, 'error');
    }
  }

  async function loadTrainImageRepos(registryId, selectedRepo = "", selectedTag = "") {
    const current = generation;
    const request = ++state.trainImageRepoRequest;
    state.trainImageTagRequest++;
    state.trainImageRepos = [];
    state.trainImageTags = [];
    $('#train-image-tag').innerHTML = '<option value="">请先选择镜像仓库</option>';
    retainSelectValue($('#train-image-tag'), selectedTag, '请先选择可用的镜像仓库', '待检查');
    const select = $("#train-image-repo");
    select.innerHTML = '<option value="">正在加载仓库……</option>';
    retainSelectValue(select, selectedRepo, '镜像仓库尚未检查，请等待加载完成', '待检查');
    if (!registryId) {
      select.options[0].textContent = '请先选择镜像配置';
      return;
    }
    const isCurrent = () => current === generation && request === state.trainImageRepoRequest && !signal.aborted
      && $('#train-image-registry').value === registryId;
    try {
      const repos = await api(`/api/dev/image-repos?registryId=${encodeURIComponent(registryId)}`);
      if (!isCurrent()) return;
      state.trainImageRepos = repos;
      select.innerHTML = '<option value="">请选择镜像仓库</option>' + repos.map((item) => `<option value="${escapeHtml(item.RepoId)}">${escapeHtml(item.RepoName)}</option>`).join("");
      retainSelectValue(select, selectedRepo, '镜像仓库当前不可用，请重新选择');
      if (select.validity.customError) return;
      await loadTrainImageTags(registryId, select.value, selectedTag);
    } catch (error) {
      if (!isCurrent()) return;
      select.innerHTML = '<option value="">仓库加载失败，请重新选择镜像配置或刷新选项</option>';
      retainSelectValue(select, selectedRepo, '镜像仓库检查失败，请重新选择镜像配置或刷新选项', '检查失败');
      toast(`镜像仓库加载失败：${error.message}`, 'error');
    }
  }

  function trainStorageOptions(selectedId = "") {
    return '<option value="">请选择存储配置</option>' + (state.trainOptions?.storageConfigs ?? []).map((item) => `<option value="${escapeHtml(item.StorageConfigId)}" ${item.StorageConfigId === selectedId ? "selected" : ""}>${escapeHtml(item.StorageConfigName)} · ${escapeHtml(item.Type)}</option>`).join("");
  }

  function renderTrainStorageRows(items = []) {
    const container = $("#train-storage-rows");
    renderRepeater(container, items, (item) => `<div class="repeater-row storage train-storage"><label>存储配置<select data-train-storage-id>${trainStorageOptions(item.StorageConfigId)}</select></label><label>挂载用途<select data-train-storage-type><option value="DataSet" ${item.MountType === "DataSet" ? "selected" : ""}>数据集</option><option value="Output" ${item.MountType === "Output" ? "selected" : ""}>输出</option></select></label><label>挂载路径<input data-train-storage-path value="${escapeHtml(item.MountPath || "")}" placeholder="/data"></label><label>子路径<input data-train-storage-subpath value="${escapeHtml(item.StorageSubPath || "")}" placeholder="可留空"></label><label>协议<input data-train-storage-protocol value="${escapeHtml(item.MountProtocol || "")}" placeholder="自动"></label><button type="button" class="icon-button" data-remove-row aria-label="删除">×</button></div>`, "暂未配置挂载");
    $$('[data-train-storage-id]', container).forEach((select, index) => {
      const id = items[index].StorageConfigId;
      retainSelectValue(select, id, `挂载配置“${id}”当前不可用，请重新选择或删除此挂载`);
    });
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

  function renderOptionsStatus() {
    const status = $('#train-options-status');
    status.className = 'create-loading ready';
    status.textContent = `已加载：${state.trainOptions.images?.official?.length ?? 0} 个训练官方镜像、${state.trainOptions.images?.personal?.length ?? 0} 个自定义镜像、${state.trainOptions.queues?.length ?? 0} 个训练队列、${state.trainOptions.storageConfigs?.length ?? 0} 项存储配置`;
  }

  async function loadTrainCreateOptions({ force = false } = {}) {
    const current = generation;
    const status = $("#train-options-status");
    if (state.trainOptions && !force) {
      renderOptionsStatus();
      return state.trainOptions;
    }
    const request = ++state.trainOptionsRequest;
    status.className = "create-loading";
    status.textContent = "正在从金山云加载训练镜像、资源组、训练队列和存储配置……";
    try {
      const response = await api(`/api/train/create-options?region=${encodeURIComponent(appState.config.region)}`);
      if (current !== generation || request !== state.trainOptionsRequest || signal.aborted) return;
      state.trainOptions = response;
      renderOptionsStatus();
      return state.trainOptions;
    } catch (error) {
      if (current !== generation || request !== state.trainOptionsRequest || signal.aborted) return;
      status.className = "create-loading error";
      status.textContent = `训练创建选项加载失败：${error.message}`;
      throw error;
    }
  }

  function fillTrainFields(variables) {
    const fields = fromVariables(variables);
    state.otherRolesUseGpu = (variables.Roles ?? []).slice(1).some(role => role.ResourceConfig?.GPUType);
    renderTrainPoolOptions(fields.resourcePool);
    renderTrainQueues(fields.queue);
    $("#train-framework").value = fields.framework;
    $("#train-priority").value = fields.priority;
    $("#train-role-name").value = fields.roleName;
    $("#train-replicas").value = fields.replicas;
    $("#train-job-cpu").checked = fields.jobCpu;
    $("#train-queue-share").checked = fields.queueShare;
    $("#train-image-source").value = fields.imageSource;
    renderTrainImages(fields.imageSelect);
    renderTrainRegistries(fields.imageRegistry);
    renderTrainGpuTypes(fields.gpuType);
    $("#train-gpu-number").value = fields.gpuNumber;
    $("#train-cpu").value = fields.cpu;
    $("#train-memory").value = fields.memory;
    renderTrainStorageRows(fields.storageConfigs);
    $("#train-command-label").textContent = String(fields.framework).toLowerCase() === "ray" ? "入口命令" : "运行命令";
    $("#train-command").value = fields.command;
    if (fields.imageSource === "ThirdParty") return loadTrainImageRepos(fields.imageRegistry, fields.imageRepo, fields.imageTag);
  }

  function invalidate() {
    generation++;
    state.trainOptionsRequest++; state.trainImageRepoRequest++; state.trainImageTagRequest++;
  }

  function resetOptions() { invalidate(); state.trainOptions = null; }

  function readVariables(base) {
    return toVariables({
      region: appState.config.region, name: $("#create-name").value,
      resourcePool: $("#train-resource-pool").value,
      queue: $("#train-queue").value,
      framework: $("#train-framework").value,
      priority: $("#train-priority").value,
      queueShare: $("#train-queue-share").checked,
      roleName: $("#train-role-name").value,
      replicas: $("#train-replicas").value,
      imageSource: $("#train-image-source").value,
      imageRegistry: $("#train-image-registry").value,
      imageRepo: $("#train-image-repo").value,
      imageTag: $("#train-image-tag").value,
      imageSelect: $("#train-image-select").value,
      gpuType: $("#train-gpu-type").value,
      gpuNumber: $("#train-gpu-number").value,
      cpu: $("#train-cpu").value,
      memory: $("#train-memory").value,
      jobCpu: $("#train-job-cpu").checked,
      command: $("#train-command").value,
      storageConfigs: readTrainStorageRows(),
    }, base);
  }

  function addRow(kind) {
    if (kind !== 'train-storage') return;
    const items = readTrainStorageRows();
    if (items.length >= 20) return toast('最多添加 20 项挂载配置', 'error');
    const first = state.trainOptions?.storageConfigs?.[0];
    renderTrainStorageRows([...items, { StorageConfigId: first?.StorageConfigId || '', MountType: 'DataSet', MountPath: first?.KpfsInfo?.MountPath || first?.Ks3Info?.MountPath || '', MountProtocol: first?.KpfsInfo?.MntProtocol || null }]);
  }

  function applyDefaults(input, { selectResourcePool = false } = {}) {
    const variables = structuredClone(input);
    if (selectResourcePool && !variables.ResourcePoolId && state.trainOptions?.resourcePools?.length) {
      variables.ResourcePoolId = state.trainOptions.resourcePools[0].ResourcePoolId;
      variables.QueueName = state.trainOptions.queues.find(item => item.ResourcePoolId === variables.ResourcePoolId)?.Name || '';
      const role = variables.Roles?.[0];
      const personal = state.trainOptions.images?.personal?.[0];
      const image = personal || state.trainOptions.images?.official?.[0];
      if (role && image && !role.ImageConfig?.ImageId && role.ImageConfig?.ImageSource !== 'ThirdParty') {
        role.ImageConfig = { ...role.ImageConfig, ImageId: image.ImageId, ImageSource: personal ? 'Personal' : 'Official' };
      }
    }
    return variables;
  }

  function handleInput() { return false; }

  async function handleChange(event) {
    if (event.target.id === "train-resource-pool") renderTrainQueues();
    if (event.target.id === "train-queue") renderTrainGpuTypes();
    if (event.target.id === "train-gpu-type") {
      if (event.target.value && Number($("#train-gpu-number").value) < 1) $("#train-gpu-number").value = 1;
      if (!event.target.value) $("#train-gpu-number").value = 0;
      $("#train-job-cpu").checked = !event.target.value && !state.otherRolesUseGpu;
    }
    if (event.target.id === "train-image-source") renderTrainImages();
    if (event.target.id === "train-image-select") renderTrainImageDetail();
    if (event.target.id === "train-image-registry") await loadTrainImageRepos(event.target.value);
    if (event.target.id === "train-image-repo") await loadTrainImageTags($("#train-image-registry").value, event.target.value);
    if (event.target.id === "train-framework") $("#train-command-label").textContent = event.target.value === "ray" ? "入口命令" : "运行命令";
    if (event.target.matches("[data-train-storage-id]")) {
      validateSelectValue(event.target);
      const item = state.trainOptions?.storageConfigs?.find((entry) => entry.StorageConfigId === event.target.value);
      const row = event.target.closest(".repeater-row");
      const path = $("[data-train-storage-path]", row);
      const protocol = $("[data-train-storage-protocol]", row);
      if (item && !path.value) path.value = item.KpfsInfo?.MountPath || item.Ks3Info?.MountPath || "";
      if (item?.KpfsInfo?.MntProtocol) protocol.value = item.KpfsInfo.MntProtocol;
    }
  }

  function bind() {
    on($("#refresh-train-options"), "click", refreshOptions);
    for (const id of ['train-gpu-type', 'train-image-repo', 'train-image-tag']) {
      on($(`#${id}`), 'change', event => validateSelectValue(event.currentTarget));
    }
  }

  return { bind, invalidate, resetOptions, dispose: invalidate, readVariables, applyDefaults, addRow, handleInput, handleChange,
    fillFields: fillTrainFields, loadOptions: loadTrainCreateOptions };
}
