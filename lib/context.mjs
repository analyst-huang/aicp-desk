import { AicpApi } from "./api.mjs";
import { BrowserSession } from "./browser.mjs";
import { loadConfig } from "./config.mjs";
import { AicpService } from "./service.mjs";
import { TemplateStore } from "./templates.mjs";
import { SessionService } from "./services/session.mjs";
import { SettingsService } from "./services/settings.mjs";

/** Composition root. Overrides let tests run without Edge, cloud access or user data. */
export async function createContext(overrides = {}) {
  const config = overrides.config ?? await loadConfig();
  const browser = overrides.browser ?? new BrowserSession(config, overrides.browserOptions);
  const api = overrides.api ?? new AicpApi(browser, config);
  const templates = overrides.templates ?? new TemplateStore();
  const service = overrides.service ?? new AicpService(api, templates, config, { now: overrides.now });
  const session = overrides.session ?? new SessionService(browser, config, overrides.remoteUi);
  const settings = overrides.settings ?? new SettingsService(config, overrides.saveConfig);
  return { config, browser, api, templates, service, session, settings };
}
