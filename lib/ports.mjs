// @ts-check
/** @template T @typedef {{[K in keyof T]-?: NonNullable<T[K]> extends (...args: any[]) => any ? K : never}[keyof T]} MethodKey */
/** Bind only named operations. Late lookup preserves existing integration overrides.
 * The returned port contains no state or unrelated methods from its owner.
 * @template {object} T
 * @template {MethodKey<T>} K
 * @param {T} owner
 * @param {readonly K[]} names
 * @returns {Readonly<Required<Pick<T, K>>>}
 */
export function methodPort(owner, names) {
  // Object.fromEntries loses mapped keys. Keep the assertion local to this adapter.
  return /** @type {Readonly<Required<Pick<T, K>>>} */ (Object.freeze(Object.fromEntries(names.map(name => [name,
    /** @param {any[]} args */ (...args) => {
      const method = owner[name];
      if (typeof method !== 'function') throw new TypeError(`缺少依赖方法：${String(name)}`);
      return method.apply(owner, args);
    },
  ]))));
}
