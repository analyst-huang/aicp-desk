import { DevelopersService } from './services/developers.mjs';
import { TrainingService } from './services/training.mjs';
import { CapacityService } from './services/capacity.mjs';
import { ImagesService } from './services/images.mjs';
import { IdentityService } from './services/identity.mjs';
import { TemplatesService } from './services/templates.mjs';
import { CreationService } from './services/creation.mjs';
import { assertBatchSuccess } from './services/results.mjs';
export { trainingMonitor, normalizeTrainingGpuSnapshot } from './services/helpers.mjs';

/** Compatibility facade; new callers can address the named business services. */
export class AicpService {
  constructor(api, templates, config, { now = Date.now } = {}) {
    Object.assign(this, { api, templates, config });
    const services = {};
    const dependencies = { api, templates, config, services, now };
    services.developers = new DevelopersService(dependencies);
    services.training = new TrainingService(dependencies);
    services.capacity = new CapacityService(dependencies);
    services.images = new ImagesService(dependencies);
    services.identity = new IdentityService(dependencies);
    services.templates = new TemplatesService(dependencies);
    services.creation = new CreationService(dependencies);
    this.services = services;
  }

  listDevelopers(...args) { return this.services.developers.listDevelopers(...args); }
  resolveDeveloper(...args) { return this.services.developers.resolveDeveloper(...args); }
  startDeveloper(...args) { return this.services.developers.startDeveloper(...args); }
  stopDeveloper(...args) { return this.services.developers.stopDeveloper(...args); }
  deleteDeveloper(...args) { return this.services.developers.deleteDeveloper(...args); }
  saveDeveloperImage(...args) { return this.services.developers.saveDeveloperImage(...args); }
  listTraining(...args) { return this.services.training.listTraining(...args); }
  resolveTraining(...args) { return this.services.training.resolveTraining(...args); }
  trainingDetail(...args) { return this.services.training.trainingDetail(...args); }
  trainingGpu(...args) { return this.services.training.trainingGpu(...args); }
  trainingLogs(...args) { return this.services.training.trainingLogs(...args); }
  startTraining(...args) { return this.services.training.startTraining(...args); }
  stopTraining(...args) { return this.services.training.stopTraining(...args); }
  deleteTraining(...args) { return this.services.training.deleteTraining(...args); }
  gpuCapacity(...args) { return this.services.capacity.gpuCapacity(...args); }
  listImages(...args) { return this.services.images.listImages(...args); }
  currentUser(...args) { return this.services.identity.currentUser(...args); }
  creatorUsername(...args) { return this.services.identity.creatorUsername(...args); }
  trainingCreator(...args) { return this.services.identity.trainingCreator(...args); }
  saveTemplateFromResource(...args) { return this.services.templates.saveTemplateFromResource(...args); }
  importTemplate(...args) { return this.services.templates.importTemplate(...args); }
  prepareCreateVariables(...args) { return this.services.creation.prepareCreateVariables(...args); }
  validateCreateVariables(...args) { return this.services.creation.validateCreateVariables(...args); }
  create(...args) { return this.services.creation.create(...args); }
  prepareCreate(...args) { return this.services.creation.prepareCreate(...args); }
  executeCreate(...args) { return this.services.creation.executeCreate(...args); }
  listTemplates(...args) { return this.services.templates.list(...args); }
  getTemplate(...args) { return this.services.templates.get(...args); }
  saveTemplate(...args) { return this.services.templates.save(...args); }
  deleteTemplate(...args) { return this.services.templates.delete(...args); }
  assertBatchSuccess(...args) { return assertBatchSuccess(...args); }
  developerCreateOptions(...args) { return this.services.developers.developerCreateOptions(...args); }
  queueResourceInfo(...args) { return this.services.developers.queueResourceInfo(...args); }
  listAvailableNodes(...args) { return this.services.developers.listAvailableNodes(...args); }
  trainingCreateOptions(...args) { return this.services.training.trainingCreateOptions(...args); }
  saveImageOptions(...args) { return this.services.images.saveImageOptions(...args); }
  listSaveImageNamespaces(...args) { return this.services.images.listSaveImageNamespaces(...args); }
  listSaveImageRepositories(...args) { return this.services.images.listSaveImageRepositories(...args); }
  listImageRepos(...args) { return this.services.images.listImageRepos(...args); }
  listImageTags(...args) { return this.services.images.listImageTags(...args); }
}
