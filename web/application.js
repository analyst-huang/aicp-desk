import { createFeature as ui } from './core/ui.js';
import { createFeature as shell } from './features/shell.js';
import { createFeature as settings } from './features/settings.js';
import { createFeature as developers } from './features/developers.js';
import { createFeature as training } from './features/training.js';
import { createFeature as gpu } from './features/gpu.js';
import { createFeature as detail } from './features/detail.js';
import { createFeature as create } from './features/create.js';
import { createFeature as devForm } from './features/devForm.js';
import { createFeature as trainForm } from './features/trainForm.js';
import { createFeature as templates } from './features/templates.js';
import { createFeature as saveImage } from './features/saveImage.js';

export async function mountApplication() {
  const appState = { token: '', config: {}, session: {}, page: 'dev' };
  const controller = new AbortController();
  const sharedUi = ui({ appState, signal: controller.signal });
  const common = { appState, signal: controller.signal, ui: sharedUi };
  // Deferred callbacks break initialization cycles without exposing a mutable registry.
  let shellController, creation;
  const refresh = {
    markResourceRefresh: () => shellController.markResourceRefresh(),
    performResourceAction: (...args) => shellController.performResourceAction(...args),
  };
  const developerPage = developers({ ...common, ...refresh });
  const trainingPage = training({ ...common, ...refresh });
  const capacityPage = gpu({ ...common, markResourceRefresh: refresh.markResourceRefresh });
  const resources = Object.freeze({
    dev: { load: developerPage.loadDev, deactivate: developerPage.deactivate },
    train: { load: trainingPage.loadTrain, deactivate: trainingPage.deactivate },
    gpu: { load: capacityPage.loadGpu, deactivate: capacityPage.deactivate },
  });
  const syncQuickFields = () => creation.syncQuickFields();
  const dev = devForm({ ...common, syncQuickFields });
  const train = trainForm({ ...common, syncQuickFields });
  const templateLibrary = templates({ ...common, openCreate: (...args) => creation.openCreate(...args) });
  creation = create({ ...common, forms: Object.freeze({ dev, train }),
    templates: { list: templateLibrary.list, loadTemplates: templateLibrary.loadTemplates },
    onCreated: kind => resources[kind].load(),
  });
  const preferences = settings({ ...common,
    onSessionChange: () => shellController.startAutoRefresh(),
    onRegionChange: () => { dev.resetOptions(); train.resetOptions(); },
  });
  shellController = shell({ ...common, resources,
    templates: { replace: templateLibrary.replace, renderTemplates: templateLibrary.renderTemplates, loadTemplates: templateLibrary.loadTemplates },
    settings: { renderSession: preferences.renderSession, refreshSession: preferences.refreshSession, fillSettings: preferences.fillSettings },
  });
  const features = [shellController, preferences, developerPage, trainingPage, capacityPage,
    detail(common), creation, dev, train, templateLibrary, saveImage({ ...common, loadDev: developerPage.loadDev })];
  for (const feature of features) feature.bind();
  const dispose = () => {
    controller.abort();
    for (const feature of features) feature.dispose?.();
  };
  window.addEventListener('pagehide', dispose, { signal: controller.signal });
  try { await shellController.bootstrap(); }
  catch (error) { sharedUi.toast(error.message, 'error'); }
  return { dispose };
}
