/** create owns its local state and event bindings; cross-feature calls are explicit. */
export function createFeature({ appState, features, ui, signal }) {
  const state = { createKind: "dev", templateRequest: 0, createRequest: 0 };
  const { $, $$, on, escapeHtml, api, toast, setBusy } = ui;
  const loadDev = (...args) => features.developers.loadDev(...args);
  const loadTrain = (...args) => features.training.loadTrain(...args);
  const currentDevImageSource = (...args) => features.devForm.currentDevImageSource(...args);
  const renderImageDetail = (...args) => features.devForm.renderImageDetail(...args);
  const renderDevImageOptions = (...args) => features.devForm.renderDevImageOptions(...args);
  const renderDevImageMode = (...args) => features.devForm.renderDevImageMode(...args);
  const normalizeDevProject = (...args) => features.devForm.normalizeDevProject(...args);
  const renderDevQueues = (...args) => features.devForm.renderDevQueues(...args);
  const renderGpuTypes = (...args) => features.devForm.renderGpuTypes(...args);
  const renderEnvRows = (...args) => features.devForm.renderEnvRows(...args);
  const renderStorageRows = (...args) => features.devForm.renderStorageRows(...args);
  const renderServiceRows = (...args) => features.devForm.renderServiceRows(...args);
  const updateEipVisibility = (...args) => features.devForm.updateEipVisibility(...args);
  const readStorageRows = (...args) => features.devForm.readStorageRows(...args);
  const readServiceRows = (...args) => features.devForm.readServiceRows(...args);
  const updateAutosaveFields = (...args) => features.devForm.updateAutosaveFields(...args);
  const updateSshFields = (...args) => features.devForm.updateSshFields(...args);
  const updatePublicNetworkStatus = (...args) => features.devForm.updatePublicNetworkStatus(...args);
  const refreshDevResourceInfo = (...args) => features.devForm.refreshDevResourceInfo(...args);
  const refreshDevNodes = (...args) => features.devForm.refreshDevNodes(...args);
  const loadImageTags = (...args) => features.devForm.loadImageTags(...args);
  const loadImageRepos = (...args) => features.devForm.loadImageRepos(...args);
  const loadDevCreateOptions = (...args) => features.devForm.loadDevCreateOptions(...args);
  const renderTrainQueues = (...args) => features.trainForm.renderTrainQueues(...args);
  const renderTrainGpuTypes = (...args) => features.trainForm.renderTrainGpuTypes(...args);
  const renderTrainImages = (...args) => features.trainForm.renderTrainImages(...args);
  const renderTrainImageDetail = (...args) => features.trainForm.renderTrainImageDetail(...args);
  const loadTrainImageTags = (...args) => features.trainForm.loadTrainImageTags(...args);
  const loadTrainImageRepos = (...args) => features.trainForm.loadTrainImageRepos(...args);
  const renderTrainStorageRows = (...args) => features.trainForm.renderTrainStorageRows(...args);
  const readTrainStorageRows = (...args) => features.trainForm.readTrainStorageRows(...args);
  const loadTrainCreateOptions = (...args) => features.trainForm.loadTrainCreateOptions(...args);
  const fillTrainFields = (...args) => features.trainForm.fillTrainFields(...args);
  const fillDevFields = (...args) => features.devForm.fillDevFields(...args);
  const loadTemplates = (...args) => features.templates.loadTemplates(...args);

  const devDefaults = () => ({
    Region: appState.config.region,
    ProjectId: null,
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
    Region: appState.config.region,
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

  function addRepeaterRow(kind) {
    if (kind === "env") {
      const items = $$(".repeater-row", $("#dev-env-rows")).map((row) => ({ Name: $("[data-env-name]", row).value, Value: $("[data-env-value]", row).value }));
      renderEnvRows([...items, { Name: "", Value: "" }]);
    }
    if (kind === "storage") {
      const current = readStorageRows();
      if (current.length >= 20) return toast("最多添加 20 项存储配置", "error");
      const first = features.devForm.state.devOptions?.storageConfigs?.[0];
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
      const first = features.trainForm.state.trainOptions?.storageConfigs?.[0];
      renderTrainStorageRows([...current, {
        StorageConfigId: first?.StorageConfigId || "",
        MountType: "DataSet",
        MountPath: first?.KpfsInfo?.MountPath || first?.Ks3Info?.MountPath || "",
        MountProtocol: first?.KpfsInfo?.MntProtocol || null,
      }]);
    }
    syncQuickFields();
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
      variables.Region = appState.config.region;
      const projectId = $("#dev-project").value;
      if (projectId === "") throw new Error("请选择系统资源所属项目");
      variables.ProjectId = Number(projectId);
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
      variables.Region = appState.config.region;
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
    select.innerHTML = '<option value="">不使用模板</option>' + features.templates.state.templates
      .filter((item) => item.kind === kind)
      .map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`).join("");
  }

  async function openCreate(kind, templateName = "") {
    dispose();
    const requestId = ++state.createRequest;
    state.createKind = kind;
    // Hidden developer fields must not block native validation of a training form.
    $("#dev-project").disabled = kind !== "dev";
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
      if (kind === "dev") {
        normalizeDevProject(variables);
        if (!variables.ResourcePoolId && features.devForm.state.devOptions?.resourcePools?.length) {
          variables.ResourcePoolId = features.devForm.state.devOptions.resourcePools[0].ResourcePoolId;
          variables.QueueName = features.devForm.state.devOptions.queues.find((item) => item.ResourcePoolId === variables.ResourcePoolId)?.Name || "";
        }
      }
      if (kind === "train" && !variables.ResourcePoolId && features.trainForm.state.trainOptions?.resourcePools?.length) {
        variables.ResourcePoolId = features.trainForm.state.trainOptions.resourcePools[0].ResourcePoolId;
        variables.QueueName = features.trainForm.state.trainOptions.queues.find((item) => item.ResourcePoolId === variables.ResourcePoolId)?.Name || "";
        const role = variables.Roles?.[0];
        const personal = features.trainForm.state.trainOptions.images?.personal?.[0];
        const official = features.trainForm.state.trainOptions.images?.official?.[0];
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
    state.createRequest++;
    const requestId = ++state.templateRequest;
    const name = $("#create-template").value;
    if (!name) {
      const variables = state.createKind === "dev" ? devDefaults() : trainDefaults();
      if (state.createKind === "dev") {
        await loadDevCreateOptions();
        normalizeDevProject(variables);
      } else await loadTrainCreateOptions();
      if (requestId !== state.templateRequest || $("#create-template").value) return;
      updateJson(variables);
      fillQuickFields(variables);
      return;
    }
    try {
      const kind = state.createKind;
      const record = await api(`/api/template?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(name)}`);
      if (kind === "dev") {
        await loadDevCreateOptions();
        normalizeDevProject(record.variables);
      } else await loadTrainCreateOptions();
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
    if (features.templates.state.templates.some((item) => item.kind === state.createKind && item.name === name) && !window.confirm(`模板“${name}”已存在，确认覆盖吗？`)) return;
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

  function dispose() {
    state.createRequest++;
    state.templateRequest++;
    features.devForm.invalidate();
    features.trainForm.invalidate();
  }

  function bind() {
    on($("#create-modal"), "close", dispose);
    on(document, "click", async (event) => {
      const addRow = event.target.closest("[data-add-row]");
      if (addRow) return addRepeaterRow(addRow.dataset.addRow);
    });
    on(document, "click", async (event) => {
      const removeRow = event.target.closest("[data-remove-row]");
      if (removeRow) {
        const repeater = removeRow.closest(".repeater");
        removeRow.closest(".repeater-row")?.remove();
        if (repeater && !$(".repeater-row", repeater)) repeater.innerHTML = '<div class="repeater-empty">暂未配置</div>';
        try { syncQuickFields(); } catch {}
        return;
      }
    });
    on(document, "click", async (event) => {
      const opener = event.target.closest("[data-open-create]");
      if (opener) return openCreate(opener.dataset.openCreate);
    });
    on($("#create-template"), "change", loadSelectedTemplate);
    on($("#save-create-template"), "click", saveCurrentCreateTemplate);
    on($("#create-json"), "blur", () => {
      try { fillQuickFields(parseCreateJson()); $("#create-validation").textContent = "JSON 格式正确"; }
      catch (error) { $("#create-validation").textContent = error.message; }
    });
    on($("#create-form"), "input", (event) => {
      if (event.target.id === "create-json" || event.target.id === "create-template") return;
      if (event.target.id === "dev-image-search") return renderDevImageOptions();
      try { syncQuickFields(); } catch {}
    });
    on($("#create-form"), "change", async (event) => {
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
            const item = features.trainForm.state.trainOptions?.storageConfigs?.find((entry) => entry.StorageConfigId === event.target.value);
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
          const item = features.devForm.state.devOptions?.storageConfigs?.find((entry) => entry.StorageConfigId === event.target.value);
          const row = event.target.closest(".repeater-row");
          const path = $("[data-storage-path]", row);
          const protocol = $("[data-storage-protocol]", row);
          if (item && !path.value) path.value = item.KpfsInfo?.MountPath || item.Ks3Info?.MountPath || "";
          if (item?.KpfsInfo?.MntProtocol) protocol.value = item.KpfsInfo.MntProtocol;
        }
        syncQuickFields();
      } catch (error) { toast(error.message, "error"); }
    });
    on($("#create-form"), "submit", submitCreate);
  }

  return { state, bind, dispose, devDefaults, trainDefaults, parseCreateJson, updateJson, addRepeaterRow, fillQuickFields, syncQuickFields, populateTemplateSelect, openCreate, loadSelectedTemplate, saveCurrentCreateTemplate, submitCreate };
}
