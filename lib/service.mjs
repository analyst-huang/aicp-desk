// @ts-check
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
  /** @param {Omit<import('./cloud/api.mjs').KsyunApi, 'submitCreate'|'submitNotebookImage'> & Partial<import('./api.mjs').AicpApi>} api
   * @param {import('./templates.mjs').TemplateStore} templates
   * @param {import('./contracts.mjs').AppConfig} config
   * @param {{now?: () => number}} [options] */
  constructor(api, templates, config, { now = Date.now } = {}) {
    this.api = api; this.templates = templates; this.config = config;
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
      saveNotebookImage: /** @param {Parameters<ImagesService['saveNotebookImage']>} args */ (...args) => {
        if (api.submitNotebookImage) return services.images.saveNotebookImage(...args);
        if (!api.saveNotebookImage) throw new TypeError('缺少依赖方法：saveNotebookImage');
        return api.saveNotebookImage(...args);
      },
    });
    services.training = new TrainingService({
      api: methodPort(api, ['listTrainJobs', 'trainJobDetail', 'trainJobGpuMetrics', 'trainJobPods', 'trainJobLog', 'startTrainJobs', 'stopTrainJobs', 'deleteTrainJobs']),
      identity: methodPort(services.identity, ['currentUser', 'trainingCreator']),
      catalog: methodPort(catalog, ['trainingCreateOptions']), now,
    });
    services.capacity = new CapacityService({ catalog: methodPort(catalog, ['gpuCapacity']), config, now });
    services.templates = new TemplatesService({
      api: methodPort(api, ['notebookDetail', 'trainJobDetail']), templates: methodPort(templates, ['list', 'get', 'save', 'delete']), config,
      resolveDeveloper: /** @param {Parameters<DevelopersService['resolveDeveloper']>} args */ (...args) => services.developers.resolveDeveloper(...args),
      resolveTraining: /** @param {Parameters<TrainingService['resolveTraining']>} args */ (...args) => services.training.resolveTraining(...args),
    });
    const createApi = methodPort(api, api.submitCreate ? [
      'withSession', 'submitCreate', 'region', 'listResourcePools', 'listProjects', 'listClusterQueues', 'listImages',
      'listImageRepos', 'listImageTags', 'listStorageConfigs', 'listAvailableAddresses', 'listAvailableNodes',
    ] : ['createNotebook', 'createTrainJob']);
    services.creation = new CreationService({ executePayload: creationExecutor(createApi), templates: methodPort(templates, ['get']), config });
    this.services = Object.freeze(services);
  }

  /** @param {Parameters<typeof this.services.developers.listDevelopers>} args */
  listDevelopers(...args) { return this.services.developers.listDevelopers(...args); }
  /** @param {Parameters<typeof this.services.developers.resolveDeveloper>} args */
  resolveDeveloper(...args) { return this.services.developers.resolveDeveloper(...args); }
  /** @param {Parameters<typeof this.services.developers.startDeveloper>} args */
  startDeveloper(...args) { return this.services.developers.startDeveloper(...args); }
  /** @param {Parameters<typeof this.services.developers.stopDeveloper>} args */
  stopDeveloper(...args) { return this.services.developers.stopDeveloper(...args); }
  /** @param {Parameters<typeof this.services.developers.deleteDeveloper>} args */
  deleteDeveloper(...args) { return this.services.developers.deleteDeveloper(...args); }
  /** @param {Parameters<typeof this.services.developers.saveDeveloperImage>} args */
  saveDeveloperImage(...args) { return this.services.developers.saveDeveloperImage(...args); }
  /** @param {Parameters<typeof this.services.training.listTraining>} args */
  listTraining(...args) { return this.services.training.listTraining(...args); }
  /** @param {Parameters<typeof this.services.training.resolveTraining>} args */
  resolveTraining(...args) { return this.services.training.resolveTraining(...args); }
  /** @param {Parameters<typeof this.services.training.trainingDetail>} args */
  trainingDetail(...args) { return this.services.training.trainingDetail(...args); }
  /** @param {Parameters<typeof this.services.training.trainingGpu>} args */
  trainingGpu(...args) { return this.services.training.trainingGpu(...args); }
  /** @param {Parameters<typeof this.services.training.trainingLogs>} args */
  trainingLogs(...args) { return this.services.training.trainingLogs(...args); }
  /** @param {Parameters<typeof this.services.training.startTraining>} args */
  startTraining(...args) { return this.services.training.startTraining(...args); }
  /** @param {Parameters<typeof this.services.training.stopTraining>} args */
  stopTraining(...args) { return this.services.training.stopTraining(...args); }
  /** @param {Parameters<typeof this.services.training.deleteTraining>} args */
  deleteTraining(...args) { return this.services.training.deleteTraining(...args); }
  /** @param {Parameters<typeof this.services.capacity.gpuCapacity>} args */
  gpuCapacity(...args) { return this.services.capacity.gpuCapacity(...args); }
  /** @param {Parameters<typeof this.services.images.listImages>} args */
  listImages(...args) { return this.services.images.listImages(...args); }
  /** @param {Parameters<typeof this.services.identity.currentUser>} args */
  currentUser(...args) { return this.services.identity.currentUser(...args); }
  /** @param {Parameters<typeof this.services.identity.creatorUsername>} args */
  creatorUsername(...args) { return this.services.identity.creatorUsername(...args); }
  /** @param {Parameters<typeof this.services.identity.trainingCreator>} args */
  trainingCreator(...args) { return this.services.identity.trainingCreator(...args); }
  /** @param {Parameters<typeof this.services.templates.saveTemplateFromResource>} args */
  saveTemplateFromResource(...args) { return this.services.templates.saveTemplateFromResource(...args); }
  /** @param {Parameters<typeof this.services.templates.importTemplate>} args */
  importTemplate(...args) { return this.services.templates.importTemplate(...args); }
  /** @param {Parameters<typeof this.services.creation.prepareCreateVariables>} args */
  prepareCreateVariables(...args) { return this.services.creation.prepareCreateVariables(...args); }
  /** @param {Parameters<typeof this.services.creation.validateCreateVariables>} args */
  validateCreateVariables(...args) { return this.services.creation.validateCreateVariables(...args); }
  /** @param {Parameters<typeof this.services.creation.create>} args */
  create(...args) { return this.services.creation.create(...args); }
  /** @param {Parameters<typeof this.services.creation.prepareCreate>} args */
  prepareCreate(...args) { return this.services.creation.prepareCreate(...args); }
  /** @param {Parameters<typeof this.services.creation.executeCreate>} args */
  executeCreate(...args) { return this.services.creation.executeCreate(...args); }
  /** @param {Parameters<typeof this.services.templates.list>} args */
  listTemplates(...args) { return this.services.templates.list(...args); }
  /** @param {Parameters<typeof this.services.templates.get>} args */
  getTemplate(...args) { return this.services.templates.get(...args); }
  /** @param {Parameters<typeof this.services.templates.save>} args */
  saveTemplate(...args) { return this.services.templates.save(...args); }
  /** @param {Parameters<typeof this.services.templates.delete>} args */
  deleteTemplate(...args) { return this.services.templates.delete(...args); }
  /** @param {Parameters<typeof assertBatchSuccess>} args */
  assertBatchSuccess(...args) { return assertBatchSuccess(...args); }
  /** @param {Parameters<typeof this.services.developers.developerCreateOptions>} args */
  developerCreateOptions(...args) { return this.services.developers.developerCreateOptions(...args); }
  /** @param {Parameters<typeof this.services.developers.queueResourceInfo>} args */
  queueResourceInfo(...args) { return this.services.developers.queueResourceInfo(...args); }
  /** @param {Parameters<typeof this.services.developers.listAvailableNodes>} args */
  listAvailableNodes(...args) { return this.services.developers.listAvailableNodes(...args); }
  /** @param {Parameters<typeof this.services.training.trainingCreateOptions>} args */
  trainingCreateOptions(...args) { return this.services.training.trainingCreateOptions(...args); }
  /** @param {Parameters<typeof this.services.images.saveImageOptions>} args */
  saveImageOptions(...args) { return this.services.images.saveImageOptions(...args); }
  /** @param {Parameters<typeof this.services.images.listSaveImageNamespaces>} args */
  listSaveImageNamespaces(...args) { return this.services.images.listSaveImageNamespaces(...args); }
  /** @param {Parameters<typeof this.services.images.listSaveImageRepositories>} args */
  listSaveImageRepositories(...args) { return this.services.images.listSaveImageRepositories(...args); }
  /** @param {Parameters<typeof this.services.images.listImageRepos>} args */
  listImageRepos(...args) { return this.services.images.listImageRepos(...args); }
  /** @param {Parameters<typeof this.services.images.listImageTags>} args */
  listImageTags(...args) { return this.services.images.listImageTags(...args); }
}
