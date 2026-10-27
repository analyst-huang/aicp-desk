// @ts-check
export const CONSOLE_ORIGINS = Object.freeze([
  'https://ksp.console.ksyun.com',
  'https://aicp.console.ksyun.com',
]);
export const DEFAULT_CONSOLE_URL = `${CONSOLE_ORIGINS[0]}/#/taskDev`;

/** @param {unknown} value */
export function isConsoleUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return !url.username && !url.password && CONSOLE_ORIGINS.includes(url.origin)
      && !url.pathname.startsWith('/webide-proxy/');
  } catch { return false; }
}

/** Upgrade only the previous default; explicit custom routes stay intact.
 * @param {string} value
 */
export function migrateConsoleUrl(value) {
  return value === `${CONSOLE_ORIGINS[1]}/#/taskDev` ? DEFAULT_CONSOLE_URL : value;
}
