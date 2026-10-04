// @ts-check
/** A view's generation. Invalidating a view never retries or cancels a cloud write.
 * @param {AbortSignal} [signal]
 */
export function createRequestScope(signal) {
  let generation = 0;
  return {
    next: () => ++generation,
    current: () => generation,
    invalidate: () => { generation++; },
    /** @param {number} request */
    isCurrent: request => request === generation && !signal?.aborted,
  };
}
