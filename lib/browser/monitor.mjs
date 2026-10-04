
/** Monitor access uses only page operations, authentication readiness and a clock. */
export class GpuMonitor {
  /** @param {{runtime: Pick<import('./runtime.mjs').BrowserRuntime, 'withBrowser'|'createTarget'|'activateTarget'|'targets'|'evaluate'|'closeTarget'>,
   * waitForAicpTarget: import('./authentication.mjs').SessionAuthentication['waitForAicpTarget'], clock: import('../contracts.mjs').Clock}} dependencies */
  constructor({ runtime, waitForAicpTarget, clock }) { this.runtime = runtime; this.waitForAicpTarget = waitForAicpTarget; this.clock = clock; }

  async grafanaGpuMetrics(monitorUrl, { timeout = 60000 } = {}) {
    const parsedUrl = new URL(monitorUrl);
    if (
      parsedUrl.protocol !== "https:"
      || parsedUrl.hostname !== "ksp.console.ksyun.com"
      || !parsedUrl.pathname.includes("/webide-proxy/grafana/")
      || !parsedUrl.pathname.endsWith("/kaic-dashboard")
    ) {
      throw new Error("无效的训练任务 Grafana 监控地址");
    }

    return this.runtime.withBrowser(async () => {
      await this.waitForAicpTarget();
      const created = await this.runtime.createTarget(parsedUrl.href);
      if (!created?.id) throw new Error("无法打开训练任务 Grafana 监控页面");
      try {
        await this.runtime.activateTarget(created.id);
        const startedAt = this.clock.now();
        while (this.clock.now() - startedAt < timeout) {
          const target = (await this.runtime.targets()).find((item) => item.id === created.id);
          if (!target) throw new Error("训练任务 Grafana 监控页面已关闭");
          if (target.url.includes("passport.ksyun.com")) {
            throw new Error("登录状态已过期，请先运行 aicp login");
          }
          const snapshot = await this.runtime.evaluate(target, `
            (() => {
              const wantedTitles = new Set([
                "GPU 利用率",
                "GPU 平均温度",
                "GPU 总功率",
                "GPU 显存",
                "Tensor Core 利用率"
              ]);
              const panels = Array.from(document.querySelectorAll('[data-testid^="data-testid Panel header "]'))
                .map((panel) => {
                  const title = panel.querySelector('h6[title]')?.getAttribute("title")
                    || panel.getAttribute("data-testid")?.replace(/^data-testid Panel header /, "")
                    || "";
                  if (!wantedTitles.has(title)) return null;
                  const headers = Array.from(panel.querySelectorAll("thead th"))
                    .map((cell) => cell.innerText.trim())
                    .filter(Boolean);
                  const rows = Array.from(panel.querySelectorAll("tbody tr"))
                    .map((row) => Array.from(row.querySelectorAll("td"))
                      .map((cell) => cell.innerText.trim())
                      .filter(Boolean))
                    .filter((row) => row.length);
                  const lines = panel.innerText.split("\\n").map((line) => line.trim()).filter(Boolean);
                  const value = rows.length
                    ? null
                    : lines.find((line) => line !== title && /^[-+]?\\d/.test(line)) || null;
                  return { title, headers, rows, value, text: lines.join("\\n") };
                })
                .filter(Boolean);
              const utilization = panels.find((panel) => panel.title === "GPU 利用率");
              return {
                url: location.href,
                title: document.title,
                ready: Boolean(utilization && (utilization.rows.length || /No data|暂无数据/i.test(utilization.text))),
                panels
              };
            })()
          `, 20000);
          if (snapshot?.url?.includes("passport.ksyun.com")) {
            throw new Error("登录状态已过期，请先运行 aicp login");
          }
          if (snapshot?.ready) return snapshot;
          await this.clock.sleep(500);
        }
        throw new Error("读取训练任务 GPU 监控超时，请稍后重试");
      } finally {
        await this.runtime.closeTarget(created.id).catch(() => {});
      }
    });
  }
}
