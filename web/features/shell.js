import { createPoller } from '../core/polling.js';
/** shell owns navigation and resource refresh scheduling. */
export function createFeature({ appState, resources, templates, settings, ui, signal }) {
  const { $, $$, on, api, toast, setBusy } = ui;
  const renderSession = (...args) => settings.renderSession(...args);
  const refreshSession = (...args) => settings.refreshSession(...args);
  const loadDev = (...args) => resources.dev.load(...args);
  const loadTrain = (...args) => resources.train.load(...args);
  const loadGpu = (...args) => resources.gpu.load(...args);
  const loadTemplates = (...args) => templates.loadTemplates(...args);
  const renderTemplates = (...args) => templates.renderTemplates(...args);
  const fillSettings = (...args) => settings.fillSettings(...args);
  const AUTO_REFRESH_MS = 10_000;
  const poller = createPoller(() => refreshActiveResourcePage({ background: true }), {
    delay: AUTO_REFRESH_MS,
    enabled: () => !signal.aborted && !document.hidden && appState.session.authenticated && ["dev", "train", "gpu"].includes(appState.page),
  });

  function setPage(page) {
    const previous = resources[appState.page];
    previous?.deactivate();
    if (appState.page === "templates" && page !== "templates") templates.deactivate();
    appState.page = page;
    $$(".nav-item").forEach((node) => node.classList.toggle("active", node.dataset.page === page));
    $$(".page").forEach((node) => node.classList.toggle("active", node.id === `page-${page}`));
    const titles = { dev: "开发机", train: "训练任务", gpu: "GPU 容量", templates: "模板库", settings: "设置" };
    $("#page-title").textContent = titles[page];
    if (page === "dev") loadDev();
    if (page === "train") loadTrain();
    if (page === "gpu") loadGpu();
    if (page === "templates") loadTemplates();
    startAutoRefresh();
  }

  function markResourceRefresh() {
    const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date());
    $("#auto-refresh-status").textContent = `每 10 秒自动刷新 · 最近 ${time}`;
  }

  async function refreshActiveResourcePage({ background = false } = {}) {
    if (document.hidden || !appState.session.authenticated) return;
    if (appState.page === "dev") await loadDev({ background });
    if (appState.page === "train") await loadTrain({ background });
    if (appState.page === "gpu") await loadGpu({ background });
    if (!background && appState.page === "templates") await loadTemplates();
    if (!background && appState.page === "settings") await refreshSession();
  }

  function startAutoRefresh() {
    poller.schedule();
  }

  async function performResourceAction(kind, action, selector, name, button) {
    const verb = { start: "启动", stop: "停止", delete: "永久删除" }[action];
    const resourceLabel = kind === "dev" ? "开发机" : "训练任务";
    const warning = action === "delete" ? "此操作无法撤销，且不会删除已挂载存储中的数据。" : "";
    if (!window.confirm(`确认${verb}${resourceLabel}“${name}”吗？${warning}`)) return;
    if (action === "delete") {
      const typed = window.prompt(`为避免误删，请输入${resourceLabel}名称：${name}`);
      if (typed !== name) return toast("名称不匹配，已取消删除", "error");
    }
    setBusy(button, true);
    try {
      const result = await api(`/api/${kind}/action`, {
        method: "POST",
        body: JSON.stringify({ selector, action }),
      });
      toast(result.noop ? result.message : action === "delete" ? `${resourceLabel}已删除` : `${verb}请求已提交`, "success");
      if (kind === "dev") await loadDev(); else await loadTrain();
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function bootstrap() {
    const payload = await api("/api/bootstrap");
    Object.assign(appState, { token: payload.token, config: payload.config, session: payload.session });
    templates.replace(payload.templates);
    renderSession();
    fillSettings();
    renderTemplates();
    setPage("dev");
    startAutoRefresh();
  }

  function bind() {
    on(document, "click", async (event) => {
      const closer = event.target.closest("[data-close-modal]");
      if (closer) {
        const modal = document.getElementById(closer.dataset.closeModal);
        if (modal?.open) modal.close();
        return;
      }
    });
    on(document, "click", async (event) => {
      const nav = event.target.closest("[data-page]");
      if (nav) return setPage(nav.dataset.page);
    });
    on($("#refresh-button"), "click", () => refreshActiveResourcePage());
    on(document, "visibilitychange", () => {
      if (!document.hidden) refreshActiveResourcePage({ background: true });
      startAutoRefresh();
    });
    $$("dialog.modal").forEach((modal) => on(modal, "click", (event) => {
      if (event.target === modal) modal.close();
    }));
  }

  return { bind, dispose: poller.stop, setPage, markResourceRefresh, refreshActiveResourcePage, startAutoRefresh, performResourceAction, bootstrap };
}
