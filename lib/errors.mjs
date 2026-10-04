/** Preserve the HTTP error string and expose only public, machine-readable metadata.
 * @param {unknown} error
 * @returns {import('./contracts.mjs').ErrorPayload}
 */
export function errorPayload(error) {
  const value = error && typeof error === 'object' ? error : {};
  const payload = { error: 'message' in value ? String(value.message) : String(error) };
  if ('code' in value && typeof value.code === 'string') Object.assign(payload, { code: value.code });
  if ('requiresUserAction' in value && typeof value.requiresUserAction === 'boolean') {
    Object.assign(payload, { requiresUserAction: value.requiresUserAction });
  }
  return payload;
}
