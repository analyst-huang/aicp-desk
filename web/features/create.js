import { createRequestScope } from '../core/request-scope.js';
import { defaults as developerDefaults } from '../models/dev-form.js';
import { defaults as trainingDefaults } from '../models/train-form.js';
/** create owns its local state and event bindings; cross-feature calls are explicit. */
export function createFeature({ appState, forms, templates, onCreated, ui, signal }) {
  const state = { createKind: "dev", draftLoading: false, draftReady: false, submitting: false };
  let retryDraft = null;
  const scope = createRequestScope(signal), templateScope = createRequestScope(signal);
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

  async function fillQuickFields(variables) {
    $('#create-name').value = variables[state.createKind === 'dev' ? 'DisplayName' : 'TrainJobName'] || '';
    await forms[state.createKind].fillFields(variables);
  }

  function syncQuickFields(options) {
    if (state.draftLoading || !state.draftReady) throw new Error('创建参数尚未加载完成，请稍后重试');
    const variables = forms[state.createKind].readVariables(parseCreateJson(), options);
    updateJson(variables);
    return variables;
  }

  function populateTemplateSelect(kind) {
    const select = $("#create-template");
    select.innerHTML = '<option value="">不使用模板</option>' + templates.list()
      .filter((item) => item.kind === kind)
      .map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`).join("");
  }

  function updateControls() {
    for (const kind of ['dev', 'train']) {
      $(`#${kind}-quick-fields`).disabled = kind !== state.createKind || state.draftLoading;
    }
    $('#create-name').disabled = state.draftLoading;
    $('#create-json').disabled = state.draftLoading;
    $('#save-create-template').disabled = state.draftLoading || !state.draftReady;
    $('#submit-create').disabled = state.draftLoading || !state.draftReady || state.submitting;
  }

  async function loadDraft(readVariables, { selectResourcePool = false, applyDefaults = true } = {}) {
    const selection = templateScope.next();
    const kind = state.createKind;
    retryDraft = () => loadDraft(readVariables, { selectResourcePool, applyDefaults });
    forms[kind].invalidate();
    state.draftReady = false;
    state.draftLoading = true;
    updateControls();
    $('#create-validation').textContent = '正在加载创建参数……';
    try {
      await forms[kind].loadOptions();
      if (!templateScope.isCurrent(selection)) return;
      let variables = await readVariables();
      if (!templateScope.isCurrent(selection)) return;
      if (applyDefaults) variables = forms[kind].applyDefaults(variables, { selectResourcePool });
      updateJson(variables);
      await fillQuickFields(variables);
      if (templateScope.isCurrent(selection)) {
        state.draftReady = true;
        return true;
      }
    } catch (error) {
      if (templateScope.isCurrent(selection)) {
        $('#create-validation').textContent = `参数加载失败：${error.message}`;
        toast(error.message, 'error');
      }
    } finally {
      if (templateScope.isCurrent(selection)) {
        state.draftLoading = false;
        updateControls();
      }
    }
  }

  function templateVariables(kind, name) {
    return name
      ? api(`/api/template?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(name)}`).then(record => record.variables)
      : kind === 'dev' ? devDefaults() : trainDefaults();
  }

  async function openCreate(kind, templateName = "") {
    dispose();
    scope.next();
    state.createKind = kind;
    state.submitting = false;
    setBusy($('#submit-create'), false);
    $("#create-title").textContent = kind === "dev" ? "新建开发机" : "新建训练任务";
    $("#create-kind-label").textContent = kind === "dev" ? "Development machine" : "Training job";
    $("#dev-quick-fields").classList.toggle("hidden", kind !== "dev");
    $("#train-quick-fields").classList.toggle("hidden", kind !== "train");
    populateTemplateSelect(kind);
    $('#create-template').value = templateName;
    $('#create-name').value = '';
    updateJson(kind === 'dev' ? devDefaults() : trainDefaults());
    $("#create-modal").showModal();
    await loadDraft(() => templateVariables(kind, templateName), { selectResourcePool: true });
  }

  async function loadSelectedTemplate() {
    const name = $("#create-template").value;
    const kind = state.createKind;
    await loadDraft(() => templateVariables(kind, name));
  }

  async function refreshOptions(kind) {
    if (!$('#create-modal').open || state.createKind !== kind || state.draftLoading) return;
    const selection = templateScope.current();
    try {
      const options = await forms[kind].loadOptions({ force: true });
      if (!options || !templateScope.isCurrent(selection)) return;
      let loaded;
      if (state.draftReady) {
        // Capture even incomplete edits before rebuilding the selectors; submission still validates.
        const variables = syncQuickFields({ allowIncomplete: true });
        loaded = await loadDraft(() => variables, { applyDefaults: false });
      } else {
        loaded = await retryDraft?.();
      }
      if (loaded) toast(`金山云${kind === 'train' ? '训练' : ''}创建选项已刷新`);
    } catch (error) {
      if (templateScope.isCurrent(selection)) toast(error.message, 'error');
    }
  }

  async function saveCurrentCreateTemplate() {
    if (state.draftLoading || !state.draftReady) return;
    const request = scope.current();
    const selection = templateScope.current();
    const kind = state.createKind;
    let variables;
    try { variables = syncQuickFields(); }
    catch (error) { return toast(error.message, "error"); }
    const suggested = $("#create-template").value || $("#create-name").value.trim() || `${state.createKind}-template`;
    const name = window.prompt("模板名称（保存的是当前表单配置，之后载入仍可继续修改）", suggested);
    if (!name) return;
    if (templates.list().some((item) => item.kind === state.createKind && item.name === name) && !window.confirm(`模板“${name}”已存在，确认覆盖吗？`)) return;
    try {
      await api("/api/template", { method: "POST", body: JSON.stringify({ kind, name, variables, source: { basedOn: $("#create-template").value || undefined } }) });
      await templates.loadTemplates();
      if (scope.isCurrent(request) && templateScope.isCurrent(selection)) {
        populateTemplateSelect(kind);
        $("#create-template").value = name;
      }
      toast(`当前配置已另存为模板“${name}”`);
    } catch (error) { toast(error.message, "error"); }
  }

  async function submitCreate(event) {
    event.preventDefault();
    if (event.submitter?.value === "cancel") {
      $("#create-modal").close();
      return;
    }
    if (state.submitting || state.draftLoading || !state.draftReady) return;
    if (!$('#create-form').reportValidity()) return;
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
    const requestId = scope.current();
    state.submitting = true;
    setBusy(button, true, "正在创建…");
    try {
      await api(`/api/${kind}/create`, { method: "POST", body: JSON.stringify({ variables }) });
      if (scope.isCurrent(requestId)) $("#create-modal").close();
      toast(`${name} 创建请求已提交`);
      await onCreated(kind);
    } catch (error) {
      toast(error.message, "error");
    } finally {
      if (scope.isCurrent(requestId)) {
        state.submitting = false;
        setBusy(button, false);
        updateControls();
      }
    }
  }

  function dispose() {
    scope.invalidate();
    templateScope.invalidate();
    forms.dev.invalidate();
    forms.train.invalidate();
    retryDraft = null;
    state.draftReady = false;
    state.draftLoading = false;
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
    on($("#create-json"), "blur", async () => {
      if (state.draftLoading || !$('#create-modal').open) return;
      try {
        const variables = parseCreateJson();
        await loadDraft(() => variables, { applyDefaults: false });
      }
      catch (error) { $("#create-validation").textContent = error.message; }
    });
    on($("#create-form"), "input", (event) => {
      if (state.draftLoading || !state.draftReady) return;
      if (event.target.id === "create-json" || event.target.id === "create-template") return;
      if (forms[state.createKind].handleInput(event)) return;
      try { syncQuickFields(); } catch {}
    });
    on($("#create-form"), "change", async (event) => {
      if (event.target.id === "create-json" || event.target.id === "create-template") return;
      if (state.draftLoading || !state.draftReady) return;
      const request = scope.current();
      const selection = templateScope.current();
      try {
        await forms[state.createKind].handleChange(event);
        if (scope.isCurrent(request) && templateScope.isCurrent(selection)) syncQuickFields();
      } catch (error) { if (scope.isCurrent(request) && templateScope.isCurrent(selection)) toast(error.message, 'error'); }
    });
    on($("#create-form"), "submit", submitCreate);
  }

  return { bind, dispose, syncQuickFields, openCreate, refreshOptions };
}
