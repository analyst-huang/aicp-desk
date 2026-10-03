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
  const features = {};
  const controller = new AbortController();
  const dependencies = { appState, features, signal: controller.signal };
  const sharedUi = ui(dependencies);
  dependencies.ui = sharedUi;
  features.shell = shell(dependencies);
  features.settings = settings(dependencies);
  features.developers = developers(dependencies);
  features.training = training(dependencies);
  features.gpu = gpu(dependencies);
  features.detail = detail(dependencies);
  features.create = create(dependencies);
  features.devForm = devForm(dependencies);
  features.trainForm = trainForm(dependencies);
  features.templates = templates(dependencies);
  features.saveImage = saveImage(dependencies);
  for (const feature of Object.values(features)) feature.bind();
  const dispose = () => {
    controller.abort();
    for (const feature of Object.values(features)) feature.dispose?.();
  };
  window.addEventListener('pagehide', dispose, { signal: controller.signal });
  try { await features.shell.bootstrap(); }
  catch (error) { sharedUi.toast(error.message, 'error'); }
  return { dispose };
}
