import { defaults as developerDefaults } from '../models/dev-form.js';
import { defaults as trainingDefaults } from '../models/train-form.js';
/** create owns its local state and event bindings; cross-feature calls are explicit. */
export function createFeature({ appState, forms, templates, onCreated, ui, signal }) {
  const state = { createKind: "dev", templateRequest: 0, createRequest: 0 };
  const { $, $$, on, escapeHtml, api, toast, setBusy } = ui;
  const devDefaults = () => developerDefaults(appState.config.region);
  const trainDefaults = () => trainingDefaults(appState.config.region);

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

  function fillQuickFields(variables) {
    $('#create-name').value = variables[state.createKind === 'dev' ? 'DisplayName' : 'TrainJobName'] || '';
    forms[state.createKind].fillFields(variables);
  }

  function syncQuickFields() {
    const variables = forms[state.createKind].readVariables(parseCreateJson());
    updateJson(variables);
    return variables;
  }

  function populateTemplateSelect(kind) {
    const select = $("#create-template");
    select.innerHTML = '<option value="">不使用模板</option>' + templates.list()
      .filter((item) => item.kind === kind)
      .map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`).join("");
  }

  async function openCreate(kind, templateName = "") {
    dispose();
    const requestId = ++state.createRequest;
    state.createKind = kind;
    setBusy($('#submit-create'), false);
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
      await forms[kind].loadOptions();
      if (requestId !== state.createRequest || state.createKind !== kind) return;
      if (templateName) {
        variables = (await api(`/api/template?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(templateName)}`)).variables;
        if (requestId !== state.createRequest || state.createKind !== kind) return;
        $("#create-template").value = templateName;
      }
      variables = forms[kind].applyDefaults(variables, { selectResourcePool: true });
      updateJson(variables);
      fillQuickFields(variables);
    } catch (error) {
      if (requestId === state.createRequest) toast(error.message, "error");
    }
  }

  async function loadSelectedTemplate() {
    state.createRequest++;
    const requestId = ++state.templateRequest;
    const name = $("#create-template").value;
    const kind = state.createKind;
    try {
      const variables = name
        ? (await api(`/api/template?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(name)}`)).variables
        : kind === 'dev' ? devDefaults() : trainDefaults();
      if (requestId !== state.templateRequest) return;
      await forms[kind].loadOptions();
      if (requestId !== state.templateRequest || state.createKind !== kind || $("#create-template").value !== name) return;
      const prepared = forms[kind].applyDefaults(variables);
      updateJson(prepared);
      fillQuickFields(prepared);
    } catch (error) {
      if (requestId === state.templateRequest) toast(error.message, "error");
    }
  }

  async function saveCurrentCreateTemplate() {
    let variables;
    try { variables = syncQuickFields(); }
    catch (error) { return toast(error.message, "error"); }
    const suggested = $("#create-template").value || $("#create-name").value.trim() || `${state.createKind}-template`;
    const name = window.prompt("模板名称（保存的是当前表单配置，之后载入仍可继续修改）", suggested);
    if (!name) return;
    if (templates.list().some((item) => item.kind === state.createKind && item.name === name) && !window.confirm(`模板“${name}”已存在，确认覆盖吗？`)) return;
    try {
      await api("/api/template", { method: "POST", body: JSON.stringify({ kind: state.createKind, name, variables, source: { basedOn: $("#create-template").value || undefined } }) });
      await templates.loadTemplates();
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
    const kind = state.createKind;
    const requestId = state.createRequest;
    setBusy(button, true, "正在创建…");
    try {
      await api(`/api/${kind}/create`, { method: "POST", body: JSON.stringify({ variables }) });
      if (requestId === state.createRequest) $("#create-modal").close();
      toast(`${name} 创建请求已提交`);
      await onCreated(kind);
    } catch (error) {
      toast(error.message, "error");
    } finally {
      if (requestId === state.createRequest || !$('#create-modal').open) setBusy(button, false);
    }
  }

  function dispose() {
    state.createRequest++;
    state.templateRequest++;
    forms.dev.invalidate();
    forms.train.invalidate();
  }

  function bind() {
    on($("#create-modal"), "close", dispose);
    on(document, "click", async (event) => {
      const addRow = event.target.closest("[data-add-row]");
      if (addRow) {
        forms[state.createKind].addRow(addRow.dataset.addRow);
        try { syncQuickFields(); } catch {}
      }
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
      if (forms[state.createKind].handleInput(event)) return;
      try { syncQuickFields(); } catch {}
    });
    on($("#create-form"), "change", async (event) => {
      if (event.target.id === "create-template") return;
      const request = state.createRequest;
      try {
        await forms[state.createKind].handleChange(event);
        if (request === state.createRequest) syncQuickFields();
      } catch (error) { if (request === state.createRequest) toast(error.message, 'error'); }
    });
    on($("#create-form"), "submit", submitCreate);
  }

  return { bind, dispose, syncQuickFields, openCreate };
}
