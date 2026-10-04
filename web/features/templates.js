import { defaults as developerDefaults } from '../models/dev-form.js';
import { defaults as trainingDefaults } from '../models/train-form.js';
/** templates owns its local state and event bindings; cross-feature calls are explicit. */
export function createFeature({ appState, openCreate, ui, signal }) {
  const state = { templates: [] };
  const { $, $$, on, escapeHtml, api, toast, setBusy } = ui;
  const devDefaults = () => developerDefaults(appState.config.region);
  const trainDefaults = () => trainingDefaults(appState.config.region);

  async function loadTemplates() {
    try {
      state.templates = await api("/api/templates");
      renderTemplates();
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function renderTemplates() {
    const grid = $("#template-grid");
    if (!state.templates.length) {
      grid.innerHTML = '<div class="panel empty">还没有模板。可以从现有资源生成，或新建 JSON 模板。</div>';
      return;
    }
    grid.innerHTML = state.templates.map((item) => `<article class="template-card">
      <div class="template-top"><span class="template-type">${item.kind === "dev" ? "开发机" : "训练任务"}</span><button class="icon-button" data-delete-template="${escapeHtml(item.name)}" data-kind="${item.kind}" title="删除">×</button></div>
      <h3>${escapeHtml(item.name)}</h3><p>${item.source?.name ? `来自 ${escapeHtml(item.source.name)}` : "手动维护的完整参数模板"}</p>
      <footer><small>${escapeHtml(item.updatedAt?.slice(0, 19).replace("T", " ") || "-")}</small><div class="actions"><button class="link-action" data-edit-template="${escapeHtml(item.name)}" data-kind="${item.kind}">编辑</button><button class="link-action" data-use-template="${escapeHtml(item.name)}" data-kind="${item.kind}">用于创建</button></div></footer>
    </article>`).join("");
  }

  async function saveFromResource(kind, name, selector, latest = false) {
    if (!name || !selector) return toast("请填写资源名称/ID和模板名称", "error");
    try {
      await api("/api/template/from", { method: "POST", body: JSON.stringify({ kind, name, selector, latest }) });
      toast(`模板 ${name} 已保存`);
      await loadTemplates();
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function openTemplateEditor(kind = "dev", name = "", variables = undefined) {
    $("#template-kind").value = kind;
    $("#template-kind").disabled = Boolean(name);
    $("#template-name").value = name;
    $("#template-name").disabled = Boolean(name);
    $("#template-json").value = JSON.stringify(variables || (kind === "dev" ? devDefaults() : trainDefaults()), null, 2);
    $("#template-modal").showModal();
  }

  async function editTemplate(kind, name) {
    try {
      const record = await api(`/api/template?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(name)}`);
      openTemplateEditor(kind, name, record.variables);
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function saveTemplateEditor(event) {
    event.preventDefault();
    if (event.submitter?.value === "cancel") {
      $("#template-modal").close();
      return;
    }
    const kind = $("#template-kind").value;
    const name = $("#template-name").value.trim();
    if (!name) return toast("请填写模板名称", "error");
    let variables;
    try { variables = JSON.parse($("#template-json").value); }
    catch (error) { return toast(`JSON 格式错误：${error.message}`, "error"); }
    const button = $("#save-template-button");
    setBusy(button, true);
    try {
      await api("/api/template", { method: "POST", body: JSON.stringify({ kind, name, variables }) });
      $("#template-modal").close();
      toast(`模板 ${name} 已保存`);
      await loadTemplates();
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function deleteTemplate(kind, name) {
    if (!window.confirm(`确认删除模板 ${kind}/${name}？`)) return;
    try {
      await api(`/api/template?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(name)}`, { method: "DELETE" });
      toast("模板已删除");
      await loadTemplates();
    } catch (error) { toast(error.message, "error"); }
  }

  function bind() {
    on(document, "click", async (event) => {
      const saveResource = event.target.closest("[data-save-resource]");
      if (saveResource) {
        const name = window.prompt("模板名称", `${saveResource.dataset.name}-template`);
        if (name) return saveFromResource(saveResource.dataset.saveResource, name, saveResource.dataset.id, true);
      }
    });
    on(document, "click", async (event) => {
      const useTemplate = event.target.closest("[data-use-template]");
      if (useTemplate) return openCreate(useTemplate.dataset.kind, useTemplate.dataset.useTemplate);
    });
    on(document, "click", async (event) => {
      const edit = event.target.closest("[data-edit-template]");
      if (edit) return editTemplate(edit.dataset.kind, edit.dataset.editTemplate);
    });
    on(document, "click", async (event) => {
      const remove = event.target.closest("[data-delete-template]");
      if (remove) return deleteTemplate(remove.dataset.kind, remove.dataset.deleteTemplate);
    });
    on($("#new-template-button"), "click", () => openTemplateEditor());
    on($("#template-kind"), "change", () => {
      if (!$("#template-name").disabled) $("#template-json").value = JSON.stringify($("#template-kind").value === "dev" ? devDefaults() : trainDefaults(), null, 2);
    });
    on($("#template-form"), "submit", saveTemplateEditor);
    on($("#save-from-resource"), "click", () => saveFromResource(
      $("#source-kind").value,
      $("#source-template-name").value.trim(),
      $("#source-selector").value.trim(),
      $("#source-latest").checked,
    ));
  }

  return { bind, loadTemplates, renderTemplates,
    list: () => structuredClone(state.templates),
    replace: records => { state.templates = structuredClone(records); },
  };
}
