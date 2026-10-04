import { KsyunApi } from './cloud/api.mjs';
import { CatalogService } from './services/catalog.mjs';
import { ImagesService } from './services/images.mjs';
import { prepareNotebookPayload, prepareTrainJobPayload } from './domain/creation.mjs';

/** Original integration API; application workflows use KsyunApi and business services. */
export class AicpApi extends KsyunApi {
  gpuCapacity(...args) { return new CatalogService({ api: this }).gpuCapacity(...args); }
  developerCreateOptions(...args) { return new CatalogService({ api: this }).developerCreateOptions(...args); }
  trainingCreateOptions(...args) { return new CatalogService({ api: this }).trainingCreateOptions(...args); }
  saveImageOptions(...args) { return new CatalogService({ api: this }).saveImageOptions(...args); }
  saveNotebookImage(...args) { return new ImagesService({ api: this, config: this.config }).saveNotebookImage(...args); }
  createNotebook(variables) {
    return this.withSession(async () => this.submitCreate('dev', await prepareNotebookPayload(this, variables)));
  }
  createTrainJob(variables) {
    return this.withSession(async () => this.submitCreate('train', await prepareTrainJobPayload(this, variables)));
  }
}
