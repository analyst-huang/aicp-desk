import { AicpApi } from "./api.mjs";
import { BrowserSession } from "./browser.mjs";
import { loadConfig } from "./config.mjs";
import { AicpService } from "./service.mjs";
import { TemplateStore } from "./templates.mjs";

export async function createContext() {
  const config = await loadConfig();
  const browser = new BrowserSession(config);
  const api = new AicpApi(browser, config);
  const templates = new TemplateStore();
  const service = new AicpService(api, templates, config);
  return { config, browser, api, templates, service };
}
