import { DevelopersService } from './services/developers.mjs';
import { TrainingService } from './services/training.mjs';
import { CapacityService } from './services/capacity.mjs';
import { ImagesService } from './services/images.mjs';
import { IdentityService } from './services/identity.mjs';
import { TemplatesService } from './services/templates.mjs';
import { CreationService, creationExecutor } from './services/creation.mjs';
import { assertBatchSuccess } from './services/results.mjs';
import { CatalogService } from './services/catalog.mjs';
import { methodPort } from './ports.mjs';
export { trainingMonitor, normalizeTrainingGpuSnapshot } from './services/helpers.mjs';

/** Compatibility facade; new callers can address the named business services. */
export class AicpService {
  constructor(api, templates, config, { now = Date.now } = {}) {
    Object.assign(this, { api, templates, config });
    const services = {};
    // The old aggregate-only adapter interface is supported at this boundary.
    const catalog = typeof api.listResourcePools === 'function' ? new CatalogService({ api: methodPort(api, [
      'withSession', 'region', 'listResourcePools', 'resourcePoolGpuInfo', 'listClusterQueues', 'listResourcePoolInstances',
      'listProjects', 'listImages', 'listStorageConfigs', 'listImageRegistries', 'listAvailableAddresses',
      'publicNetworkCondition', 'imageConfig', 'listSaveImageNamespaces', 'listKcrInstances',
    ]) }) : api;
    services.identity = new IdentityService({ api: methodPort(api, ['currentUser']) });
    services.images = new ImagesService({ api: methodPort(api, [
      'withSession', 'region', 'listImages', 'listSaveImageNamespaces', 'listSaveImageRepositories',
      'listImageRepos', 'listImageTags', 'imageConfig', 'listKcrInstances', 'submitNotebookImage',
    ]), config, catalog: methodPort(catalog, ['saveImageOptions']) });
    services.developers = new DevelopersService({
      api: methodPort(api, ['listNotebooks', 'setNotebookStatus', 'deleteNotebooks', 'queueResourceInfo', 'listAvailableNodes']),
      identity: methodPort(services.identity, ['currentUser', 'creatorUsername']),
      catalog: methodPort(catalog, ['developerCreateOptions']),
      saveNotebookImage: (...args) => (api.submitNotebookImage ? services.images : api).saveNotebookImage(...args),
    });
    services.training = new TrainingService({
      api: methodPort(api, ['listTrainJobs', 'trainJobDetail', 'trainJobGpuMetrics', 'trainJobPods', 'trainJobLog', 'startTrainJobs', 'stopTrainJobs', 'deleteTrainJobs']),
      identity: methodPort(services.identity, ['currentUser', 'trainingCreator']),
      catalog: methodPort(catalog, ['trainingCreateOptions']), now,
    });
    services.capacity = new CapacityService({ catalog: methodPort(catalog, ['gpuCapacity']), config, now });
    services.templates = new TemplatesService({
      api: methodPort(api, ['notebookDetail', 'trainJobDetail']), templates: methodPort(templates, ['list', 'get', 'save', 'delete']), config,
      resolveDeveloper: (...args) => services.developers.resolveDeveloper(...args),
      resolveTraining: (...args) => services.training.resolveTraining(...args),
    });
    const createApi = methodPort(api, api.submitCreate ? [
      'withSession', 'submitCreate', 'region', 'listResourcePools', 'listProjects', 'listClusterQueues', 'listImages',
      'listImageRepos', 'listImageTags', 'listStorageConfigs', 'listAvailableAddresses', 'listAvailableNodes',
    ] : ['createNotebook', 'createTrainJob']);
    services.creation = new CreationService({ executePayload: creationExecutor(createApi), templates: methodPort(templates, ['get']), config });
    this.services = Object.freeze(services);
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
