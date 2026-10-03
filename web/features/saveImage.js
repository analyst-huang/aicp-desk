/** saveImage owns its local state and event bindings; cross-feature calls are explicit. */
export function createFeature({ appState, features, ui, signal }) {
  const state = { saveImageDev: null, saveImageOptions: null, saveImageNamespaces: [], saveImageRepositories: [], saveImageRequest: 0 };
  const { $, $$, on, escapeHtml, api, toast, setBusy } = ui;
  const loadDev = (...args) => features.developers.loadDev(...args);

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
      const params = new URLSearchParams({ type, namespace, region: appState.config.region || "" });
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
      const params = new URLSearchParams({ type, instanceId, region: appState.config.region || "" });
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
    const params = new URLSearchParams({ region: appState.config.region || "" });
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

  function dispose() { state.saveImageRequest++; }

  function bind() {
    on($("#save-image-modal"), "close", dispose);
    on(document, "click", async (event) => {
      const saveDevImage = event.target.closest("[data-save-dev-image]");
      if (saveDevImage) return openSaveImage({ id: saveDevImage.dataset.id, name: saveDevImage.dataset.name, resourcePoolType: saveDevImage.dataset.resourcePoolType });
    });
    on($("#save-image-form"), "submit", submitSaveImage);
    $$('input[name="save-image-type"]').forEach((radio) => on(radio, "change", () => updateSaveImageType().catch((error) => toast(error.message, "error"))));
    on($("#save-image-instance"), "change", () => loadSaveImageNamespaces().catch((error) => toast(error.message, "error")));
    on($("#save-image-namespace"), "change", () => {
      updateSaveImageEndpointDetail();
      $("#save-image-repo").value = "";
      loadSaveImageRepositories().catch((error) => toast(error.message, "error"));
    });
    on($("#save-image-repo"), "input", validateSaveImageRepository);
  }

  return { state, bind, dispose, currentSaveImageType, setSaveImageStatus, renderSaveImageInstances, renderSaveImageNamespaces, saveImageRepoName, renderSaveImageRepositories, validateSaveImageRepository, updateSaveImageEndpointDetail, loadSaveImageRepositories, loadSaveImageNamespaces, updateSaveImageType, loadSaveImageOptions, openSaveImage, submitSaveImage };
}
