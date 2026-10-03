/** ui owns its local state and event bindings; cross-feature calls are explicit. */
export function createFeature({ appState, features, ui, signal }) {
  const state = {  };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const on = (target, type, listener) => target.addEventListener(type, listener, { signal });


  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      signal,
      ...options,
      headers: {
        "content-type": "application/json",
        "x-aicp-token": appState.token,
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `请求失败：HTTP ${response.status}`);
    return payload;
  }

  function toast(message, type = "success") {
    const node = document.createElement("div");
    node.className = `toast ${type}`;
    node.textContent = message;
    $("#toast-stack").append(node);
    setTimeout(() => node.remove(), 4200);
  }

  function setBusy(button, busy, label = "处理中…") {
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.textContent = label;
      button.disabled = true;
    } else {
      button.textContent = button.dataset.originalText || button.textContent;
      button.disabled = false;
    }
  }

  function statusLabel(status) {
    const labels = {
      running: "运行中", stopped: "已停止", starting: "启动中", pending: "排队中",
      deploying: "部署中", submit: "创建中", succeed: "成功", failed: "失败",
      stopping: "停止中", restarting: "重启中", image_saving: "镜像保存中", succeed_holding: "成功·保留中",
      failed_holding: "失败·保留中",
    };
    return labels[String(status).toLowerCase()] || status || "未知";
  }

  function statusPill(status) {
    const normalized = String(status || "unknown").toLowerCase();
    return `<span class="status ${escapeHtml(normalized)}">${escapeHtml(statusLabel(normalized))}</span>`;
  }

  function metric(label, value, note = "") {
    return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${note ? `<small>${escapeHtml(note)}</small>` : ""}</div>`;
  }

  function percentLabel(value) {
    const number = Number(value);
    return value === null || value === undefined || !Number.isFinite(number)
      ? "—"
      : `${Math.round(number * 100) / 100}%`;
  }

  function tableLoading(target, columns) {
    target.innerHTML = `<tr>${Array.from({ length: columns }, () => '<td><div class="skeleton"></div></td>').join("")}</tr>`;
  }

  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const input = document.createElement("textarea");
      input.value = value;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.append(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
  }

  function bind() {

  }

  return { state, bind, $, $$, on, escapeHtml, api, toast, setBusy, statusLabel, statusPill, metric, percentLabel, tableLoading, copyText };
}
