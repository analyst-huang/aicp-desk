// @ts-check
/** @param {unknown} [value] @returns {'reclaim'|'delete'} */
export function volumeReclaimPolicy(value = 'reclaim') {
  if (value !== 'reclaim' && value !== 'delete') throw new Error('volumeReclaimPolicy 必须是 reclaim（保留云盘）或 delete（删除云盘）');
  return value;
}
