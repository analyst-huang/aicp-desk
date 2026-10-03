/** settings owns its local state and event bindings; cross-feature calls are explicit. */
export function createFeature({ appState, features, ui, signal }) {
  const state = {  };
  const { $, $$, on, escapeHtml, api, toast, setBusy } = ui;


  function renderSession() {
    const badge = $("#session-badge");
    const detail = $("#session-detail");
    if (appState.session.authenticated) {
      badge.classList.add("ready");
      badge.innerHTML = `<i></i>已认证 · ${escapeHtml(appState.session.username)}`;
      detail.textContent = `当前用户 ID：${appState.session.userId}。${appState.session.browserRunning ? `独立 Edge 当前打开，调试端口 ${appState.session.debugPort}。` : "登录 Cookie 已通过平台接口验证。"}`;
    } else if (appState.session.profileExists) {
      badge.classList.remove("ready");
      badge.innerHTML = "<i></i>登录资料存在，但未认证";
      detail.textContent = appState.session.authenticationError || "登录 Cookie 已失效，请重新登录。";
    } else {
      badge.classList.remove("ready");
      badge.innerHTML = "<i></i>尚未登录";
      detail.textContent = "尚未建立登录会话。点击登录后，按专用 Edge 页面实际要求完成首次登录。";
    }
  }

  async function refreshSession() {
    appState.session = await api("/api/session");
    renderSession();
    features.shell.startAutoRefresh();
  }

  async function login(button) {
    setBusy(button, true, "正在恢复登录…");
    try {
      const result = await api("/api/login", { method: "POST", body: "{}" });
      toast(result.authenticated ? "登录已验证，可以继续使用" : result.authenticationError || "请在专用 Edge 中完成剩余登录步骤", result.authenticated ? "success" : "info");
      await refreshSession();
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setBusy(button, false);
    }
  }

  function fillSettings() {
    $("#config-region").value = appState.config.region || "";
    $("#config-username").value = appState.config.username || "";
    $("#config-gui-port").value = appState.config.guiPort || 17863;
  }

  async function saveSettings(event) {
    event.preventDefault();
    try {
      const previousRegion = appState.config.region;
      appState.config = await api("/api/config", {
        method: "POST",
        body: JSON.stringify({
          region: $("#config-region").value.trim(),
          username: $("#config-username").value.trim(),
          guiPort: Number($("#config-gui-port").value),
        }),
      });
      if (previousRegion !== appState.config.region) {
        features.devForm.resetOptions();
        features.trainForm.resetOptions();
        features.devForm.state.devNodes = [];
      }
      toast("设置已保存；端口变更会在下次启动时生效");
    } catch (error) { toast(error.message, "error"); }
  }

  function bind() {
    on($("#login-button"), "click", (event) => login(event.currentTarget));
    on($("#settings-login"), "click", (event) => login(event.currentTarget));
    on($("#logout-button"), "click", async () => {
      if (!window.confirm("确认清除当前登录会话？Edge 已保存的账号和密码会保留。")) return;
      try { await api("/api/logout", { method: "POST", body: JSON.stringify({ forget: false }) }); await refreshSession(); toast("会话已清除；Edge 已保存的账号和密码仍然保留"); }
      catch (error) { toast(error.message, "error"); }
    });
    on($("#forget-login-button"), "click", async () => {
      if (!window.confirm("确认忘记所有登录资料？这会删除独立 Edge 中保存的账号、密码和会话，且无法撤销。")) return;
      try { await api("/api/logout", { method: "POST", body: JSON.stringify({ forget: true }) }); await refreshSession(); toast("所有登录资料已删除"); }
      catch (error) { toast(error.message, "error"); }
    });
    on($("#config-form"), "submit", saveSettings);
  }

  return { state, bind, renderSession, refreshSession, login, fillSettings, saveSettings };
}
