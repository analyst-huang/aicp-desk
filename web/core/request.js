// @ts-check
export class ApiError extends Error {
  /** @param {import('../../lib/contracts.mjs').ErrorPayload} payload @param {number} status */
  constructor(payload, status) {
    super(payload.error || `请求失败：HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = payload.code;
    this.requiresUserAction = payload.requiresUserAction;
  }
}

/** @param {{getToken: () => string, signal?: AbortSignal, fetchImpl?: typeof fetch}} dependencies */
export function createApi({ getToken, signal, fetchImpl = globalThis.fetch }) {
  /** @param {string} path @param {RequestInit} [options] */
  return async function api(path, options = {}) {
    const headers = new Headers(options.headers);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    if (!headers.has('x-aicp-token')) headers.set('x-aicp-token', getToken());
    const response = await fetchImpl(path, { signal, ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(payload, response.status);
    return payload;
  };
}
