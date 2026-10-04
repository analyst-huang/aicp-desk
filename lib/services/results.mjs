export function assertOperationSuccess(result, operation) {
  if (result?.Return === true) return;
  if (result?.Return === false) throw new Error(`${operation}失败：平台未接受该操作`);
  throw new Error(`平台未返回${operation}的成功结果，操作结果未知，请先查询资源状态`);
}

export function assertBatchSuccess(results) {
  if (!Array.isArray(results) || !results.length) throw new Error("平台未返回任务操作结果，无法确认操作是否成功");
  const failed = results.filter((item) => !item.Return);
  if (failed.length) throw new Error(failed.map((item) => `${item.JobName || item.NotebookId || "未知资源"}: ${item.ErrorMessage || "操作失败"}`).join("；"));
}
