/** Bind only named operations. Late lookup preserves existing integration overrides.
 * The returned port contains no state or unrelated methods from its owner.
 */
export function methodPort(owner, names) {
  return Object.freeze(Object.fromEntries(names.map(name => [name, (...args) => owner[name](...args)])));
}
