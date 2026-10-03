export function assertBatchSuccess(results) {
  if (!Array.isArray(results) || !results.length) throw new Error("平台未返回任务操作结果，无法确认操作是否成功");
  const failed = results.filter((item) => !item.Return);
  if (failed.length) throw new Error(failed.map((item) => `${item.JobName || item.NotebookId || "未知资源"}: ${item.ErrorMessage || "操作失败"}`).join("；"));
}
