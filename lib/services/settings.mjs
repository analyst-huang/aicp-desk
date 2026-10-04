import { loadConfig, saveConfig, setConfigValue } from "../config.mjs";

export { loadConfig, setConfigValue };

export class SettingsService {
  constructor(config, save = saveConfig) { Object.assign(this, { config, save }); }
  async update(patch) {
    const updated = await this.save({ ...this.config, ...patch });
    Object.assign(this.config, updated);
    return updated;
  }
}
