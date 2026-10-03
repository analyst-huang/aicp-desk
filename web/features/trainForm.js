import { renderRepeater } from '../core/repeaters.js';
/** trainForm owns its local state and event bindings; cross-feature calls are explicit. */
export function createFeature({ appState, features, ui, signal }) {
  let generation = 0;
  const state = { trainOptions: null, trainImageRepos: [], trainImageTags: [] };
  const { $, $$, on, escapeHtml, api, toast } = ui;
  const syncQuickFields = (...args) => features.create.syncQuickFields(...args);

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
    const current = generation;
    const select = $("#train-image-tag");
    if (!registryId || !repoId) {
      state.trainImageTags = [];
      select.innerHTML = '<option value="">请先选择镜像仓库</option>';
      return;
    }
    select.innerHTML = '<option value="">正在加载版本……</option>';
    const tags = await api(`/api/dev/image-tags?registryId=${encodeURIComponent(registryId)}&repoId=${encodeURIComponent(repoId)}`);
    if (current !== generation || signal.aborted) return;
    if ($("#train-image-registry").value !== registryId || $("#train-image-repo").value !== repoId) return;
    state.trainImageTags = tags;
    select.innerHTML = '<option value="">请选择镜像版本</option>' + tags.map((item) => `<option value="${escapeHtml(item.TagId)}">${escapeHtml(item.TagName)}</option>`).join("");
    select.value = selectedTag || "";
  }

  async function loadTrainImageRepos(registryId, selectedRepo = "", selectedTag = "") {
    const current = generation;
    const select = $("#train-image-repo");
    if (!registryId) {
      state.trainImageRepos = [];
      select.innerHTML = '<option value="">请先选择镜像配置</option>';
      await loadTrainImageTags("", "");
      return;
    }
    select.innerHTML = '<option value="">正在加载仓库……</option>';
    const repos = await api(`/api/dev/image-repos?registryId=${encodeURIComponent(registryId)}`);
    if (current !== generation || signal.aborted) return;
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
    renderRepeater(container, items, (item) => `<div class="repeater-row storage train-storage"><label>存储配置<select data-train-storage-id>${trainStorageOptions(item.StorageConfigId)}</select></label><label>挂载用途<select data-train-storage-type><option value="DataSet" ${item.MountType === "DataSet" ? "selected" : ""}>数据集</option><option value="Output" ${item.MountType === "Output" ? "selected" : ""}>输出</option></select></label><label>挂载路径<input data-train-storage-path value="${escapeHtml(item.MountPath || "")}" placeholder="/data"></label><label>子路径<input data-train-storage-subpath value="${escapeHtml(item.StorageSubPath || "")}" placeholder="可留空"></label><label>协议<input data-train-storage-protocol value="${escapeHtml(item.MountProtocol || "")}" placeholder="自动"></label><button type="button" class="icon-button" data-remove-row aria-label="删除">×</button></div>`, "暂未配置挂载");
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
    const current = generation;
    const status = $("#train-options-status");
    if (state.trainOptions && !force) return state.trainOptions;
    status.className = "create-loading";
    status.textContent = "正在从金山云加载训练镜像、资源组、训练队列和存储配置……";
    try {
      const response = await api(`/api/train/create-options?region=${encodeURIComponent(appState.config.region)}`);
      if (current !== generation || signal.aborted) return;
      state.trainOptions = response;
      status.className = "create-loading ready";
      status.textContent = `已加载：${state.trainOptions.images?.official?.length ?? 0} 个训练官方镜像、${state.trainOptions.images?.personal?.length ?? 0} 个自定义镜像、${state.trainOptions.queues?.length ?? 0} 个训练队列、${state.trainOptions.storageConfigs?.length ?? 0} 项存储配置`;
      renderTrainPoolOptions();
      renderTrainRegistries();
      renderTrainImages();
      return state.trainOptions;
    } catch (error) {
      if (current !== generation || signal.aborted) return;
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

  function invalidate() {
    generation++;

  }

  function resetOptions() { invalidate(); state.trainOptions = null; }

  function bind() {
    on($("#refresh-train-options"), "click", async () => {
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
  }

  return { state, bind, invalidate, resetOptions, dispose: invalidate, trainImageList, selectedTrainQueue, renderTrainPoolOptions, renderTrainQueues, renderTrainGpuTypes, renderTrainImages, renderTrainImageDetail, renderTrainRegistries, loadTrainImageTags, loadTrainImageRepos, trainStorageOptions, renderTrainStorageRows, readTrainStorageRows, loadTrainCreateOptions, fillTrainFields };
}
