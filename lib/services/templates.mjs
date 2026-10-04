import { notebookDetailToVariables, trainDetailToVariables } from '../templates.mjs';
import { readVariablesFile } from '../utils.mjs';

export class TemplatesService {
  list() { return this.templates.list(); }
  get(kind, name) { return this.templates.get(kind, name); }
  save(kind, name, variables, source) { return this.templates.save(kind, name, variables, source); }
  delete(kind, name) { return this.templates.delete(kind, name); }
  constructor({ api, templates, config, resolveDeveloper, resolveTraining }) {
    Object.assign(this, { api, templates, config, resolveDeveloper, resolveTraining });
  }

  async saveTemplateFromResource(kind, name, selector, options = {}) {
    if (kind === "dev") {
      const item = await this.resolveDeveloper(selector, options);
      const detail = await this.api.notebookDetail(item.NotebookId, options.region);
      return this.templates.save("dev", name, notebookDetailToVariables(detail, options.region || this.config.region), {
        id: item.NotebookId,
        name: item.Name,
      });
    }
    if (kind === "train") {
      const item = await this.resolveTraining(selector, options);
      const detail = await this.api.trainJobDetail(item.TrainJobId, options.region);
      return this.templates.save("train", name, trainDetailToVariables(detail, options.region || this.config.region), {
        id: item.TrainJobId,
        name: item.TrainJobName,
      });
    }
    throw new Error(`未知模板类型：${kind}`);
  }

  async importTemplate(kind, name, filePath) {
    const variables = await readVariablesFile(filePath);
    return this.templates.save(kind, name, variables, { file: filePath });
  }
}
