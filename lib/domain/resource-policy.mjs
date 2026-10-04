// @ts-check
/** Pure policy shared by services and the UI; unknown states permit no writes. */
export const RESOURCE_STATES = Object.freeze({
  dev: Object.freeze({
    active: Object.freeze(['running', 'starting', 'pending', 'deploying']),
    terminal: Object.freeze(['stopped', 'failed', 'succeed']),
  }),
  train: Object.freeze({
    active: Object.freeze(['running', 'submit', 'pending', 'deploying', 'restarting', 'succeed_holding', 'failed_holding']),
    terminal: Object.freeze(['stopped', 'succeed', 'failed']),
  }),
});

/** @param {'dev'|'train'} kind @param {unknown} rawState */
export function resourceCapabilities(kind, rawState) {
  const state = String(rawState ?? '').toLowerCase();
  const policy = RESOURCE_STATES[kind];
  const active = policy.active.includes(state), terminal = policy.terminal.includes(state);
  return { state, active, terminal, canStart: terminal, canStop: active, canDelete: terminal,
    canSaveImage: kind === 'dev' && state === 'running' };
}
