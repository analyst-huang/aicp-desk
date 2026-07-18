#!/usr/bin/env node
import process from "node:process";
import { createContext } from "../lib/context.mjs";
import { loadConfig, setConfigValue } from "../lib/config.mjs";
import {
  confirmAction,
  formatTable,
  jsonOutput,
  optionList,
  parseArgs,
  redact,
} from "../lib/utils.mjs";

const HELP = `
AICP 本地控制工具

登录与界面
  aicp login [--yes]                   打开独立 Edge，手动完成 MFA
  aicp logout [--yes]                  清除会话，保留 Edge 已保存的账号密码
  aicp logout --forget [--yes]         删除全部登录资料（包括已保存密码）
  aicp session                         查看会话状态
  aicp gui [--no-open] [--port 17863]  启动可视化控制台

GPU 容量
  aicp gpu [--only-free] [--sort-gpu desc|asc] [--json] [--region REGION]
                                        查看并筛选逐节点剩余资源

开发机
  aicp dev list [--mine] [--json]
  aicp dev create (--file FILE | --template NAME) [--name NAME]
                  [--set PATH=VALUE ...] [--dry-run] [--yes]
  aicp dev start NAME_OR_ID [--yes]
  aicp dev stop NAME_OR_ID [--force] [--yes]
  aicp dev delete NAME_OR_ID [--yes]

训练任务
  aicp train list [--mine] [--status running,stopped] [--json]
  aicp train create (--file FILE | --template NAME) [--name NAME]
                    [--command TEXT | --command-file FILE]
                    [--set PATH=VALUE ...] [--dry-run] [--yes]
  aicp train start NAME_OR_ID [--latest] [--yes]
  aicp train stop NAME_OR_ID [--latest] [--yes]
  aicp train delete NAME_OR_ID [--latest] [--yes]
  aicp train detail NAME_OR_ID [--latest] [--json]
  aicp train logs NAME_OR_ID [--latest] [--pod POD] [--role ROLE]
                  [--tail 200] [--since SECONDS] [--follow] [--interval 3] [--json]

模板
  aicp template list [--json]
  aicp template show <dev|train> NAME [--show-sensitive]
  aicp template save <dev|train> NAME --from NAME_OR_ID [--latest]
  aicp template import <dev|train> NAME FILE
  aicp template delete <dev|train> NAME [--yes]

配置
  aicp config show
  aicp config set <region|username|debugPort|guiPort|edgePath|apiEndpoint|consoleUrl> VALUE

参数覆盖示例
  --set GPUNumber=2
  --set Roles[0].ResourceConfig.GPUNumber=8
  --set Roles[0].RunCommand=@run.sh
  --set Envs='[{"Name":"MODE","Value":"test"}]'

创建命令接受完整 GraphQL variables JSON；--set 可以覆盖任意嵌套字段。
`;

function csv(value) {
  return optionList(value).flatMap((item) => String(item).split(",")).filter(Boolean);
}

function print(value, json = false) {
  process.stdout.write(json ? jsonOutput(value) : `${value}\n`);
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function trainingLogsText(payload) {
  if (!payload.pods?.length) return `任务 ${payload.item.TrainJobName} 暂无 Pod，可能仍在排队或尚未启动。`;
  if (!payload.logs?.length) return "没有符合筛选条件的训练 Pod。";
  return payload.logs.map(({ pod, content }) => {
    const status = pod.Status?.State || pod.Status?.ContainerState || "unknown";
    const body = String(content ?? "").trimEnd() || "（暂无输出）";
    return `===== ${pod.Name} · ${pod.Role || "未命名角色"} · ${status} =====\n${body}`;
  }).join("\n\n");
}

function appendedLogText(previous, current) {
  const before = String(previous ?? "");
  const after = String(current ?? "");
  if (!after || after === before) return "";
  if (!before) return after;
  if (after.startsWith(before)) return after.slice(before.length);
  for (const size of [4096, 2048, 1024, 512, 256, 128, 64, 32]) {
    if (before.length < size) continue;
    const marker = before.slice(-size);
    const index = after.lastIndexOf(marker);
    if (index >= 0) return after.slice(index + marker.length);
  }
  return after;
}

async function handleConfig(positionals) {
  const [action, key, value] = positionals;
  if (!action || action === "show") {
    print(await loadConfig(), true);
    return;
  }
  if (action !== "set" || !key || value === undefined) throw new Error("用法：aicp config set <key> <value>");
  print(await setConfigValue(key, value), true);
}

async function handleGpu(context, args) {
  const { positionals, options } = parseArgs(args);
  if (positionals.length) throw new Error("用法：aicp gpu [--only-free] [--sort-gpu desc|asc] [--json] [--region REGION]");
  const capacity = await context.service.gpuCapacity({
    region: options.region,
    onlyFree: Boolean(options["only-free"]),
    sortGpu: options["sort-gpu"] || "desc",
  });
  if (options.json) return print(capacity, true);
  const poolRows = capacity.pools.map((pool) => ({
    name: pool.name,
    type: pool.type || "-",
    free: pool.freeGpu,
    total: pool.totalGpu,
    assigned: pool.assignedGpu,
    unavailable: pool.unavailableGpu,
  }));
  const queueRows = capacity.pools.flatMap((pool) => pool.queues.map((queue) => ({
    pool: pool.name,
    queue: queue.name,
    models: queue.models.length ? queue.models.map((item) => `${item.model}:${item.quotaGpu}`).join(",") : "CPU",
    quota: queue.quotaGpu ?? "-",
    allocated: queue.allocatedGpu ?? "-",
    remaining: queue.remainingGpu ?? "-",
    borrowing: queue.allowBorrowing ? "是" : "否",
  })));
  const nodeRows = capacity.pools.flatMap((pool) => pool.nodes.map((node) => ({
    pool: pool.name,
    node: node.name || "-",
    ip: node.ip || "-",
    status: node.schedulable ? (node.statusName || node.status || "正常") : "不可调度",
    model: node.gpuModel || "CPU",
    gpu: `${node.remainingGpu}/${node.allocatableGpu}`,
    memory: `${node.remainingMemoryGiB}/${node.allocatableMemoryGiB}`,
    cpu: `${node.remainingCpu}/${node.allocatableCpu}`,
  })));
  const lines = [
    `区域: ${capacity.region}`,
    `资源组物理 GPU: 剩余 ${capacity.summary.freeGpu} / 总计 ${capacity.summary.totalGpu}`,
    "",
    "资源组",
    formatTable(poolRows, [
      { key: "name", label: "名称" },
      { key: "type", label: "类型" },
      { key: "free", label: "剩余GPU" },
      { key: "total", label: "总GPU" },
      { key: "assigned", label: "已分配" },
      { key: "unavailable", label: "不可用" },
    ]),
    "",
    "队列（剩余 = 配额 - 已分配；允许借用时实际可申请量还受资源组实时空闲量影响）",
    formatTable(queueRows, [
      { key: "pool", label: "资源组" },
      { key: "queue", label: "队列" },
      { key: "models", label: "型号:配额" },
      { key: "quota", label: "GPU配额" },
      { key: "allocated", label: "已分配" },
      { key: "remaining", label: "配额剩余" },
      { key: "borrowing", label: "允许借用" },
    ]),
    "",
    `节点（显示 ${capacity.summary.visibleNodeCount} / ${capacity.summary.nodeCount} 台；剩余 = 可分配 - 已分配；内存单位为 GiB）`,
    formatTable(nodeRows, [
      { key: "pool", label: "资源组" },
      { key: "node", label: "机器" },
      { key: "ip", label: "节点IP" },
      { key: "status", label: "调度状态" },
      { key: "model", label: "GPU型号" },
      { key: "gpu", label: "GPU剩余/可分配" },
      { key: "memory", label: "内存剩余/可分配" },
      { key: "cpu", label: "CPU剩余/可分配" },
    ]),
  ];
  return print(lines.join("\n"));
}

async function handleDev(context, action, args) {
  const { positionals, options } = parseArgs(args);
  if (action === "list") {
    const response = await context.service.listDevelopers({
      mine: Boolean(options.mine),
      state: options.state,
      limit: options.limit,
      region: options.region,
    });
    if (options.json) return print(response, true);
    const rows = (response.Notebooks ?? []).map((item) => ({
      name: item.Name,
      state: item.State,
      gpu: item.GPUNumber ? `${item.GPUNumber}×${item.GPUType}` : "CPU",
      cpu: item.CpuNum,
      memory: item.Memory,
      queue: item.QueueName,
      id: item.NotebookId,
    }));
    return print(formatTable(rows, [
      { key: "name", label: "名称" },
      { key: "state", label: "状态" },
      { key: "gpu", label: "GPU" },
      { key: "cpu", label: "CPU" },
      { key: "memory", label: "内存" },
      { key: "queue", label: "队列" },
      { key: "id", label: "ID" },
    ]));
  }

  if (action === "create") {
    const variables = await context.service.prepareCreateVariables("dev", {
      file: options.file,
      template: options.template,
      name: options.name,
      region: options.region,
      set: options.set,
    });
    if (options["dry-run"]) return print(redact(variables, { showSensitive: options["show-sensitive"] }), true);
    const approved = await confirmAction(`确认创建开发机 ${variables.DisplayName}？`, { yes: Boolean(options.yes) });
    if (!approved) return print("已取消");
    const result = await context.api.createNotebook(variables);
    return print({ result, variables: redact(variables) }, true);
  }

  const selector = positionals[0];
  if (!["start", "stop", "delete"].includes(action) || !selector) throw new Error(`未知开发机命令：${action || "（空）"}`);
  const item = await context.service.resolveDeveloper(selector, { region: options.region });
  const verb = { start: "启动", stop: "停止", delete: "永久删除" }[action];
  const approved = await confirmAction(`确认${verb}开发机 ${item.Name}？`, { yes: Boolean(options.yes) });
  if (!approved) return print("已取消");
  const result = action === "start"
    ? await context.service.startDeveloper(item.NotebookId, { region: options.region })
    : action === "stop"
      ? await context.service.stopDeveloper(item.NotebookId, { region: options.region, force: Boolean(options.force) })
      : await context.service.deleteDeveloper(item.NotebookId, { region: options.region });
  return print(result, true);
}

async function handleTrain(context, action, args) {
  const { positionals, options } = parseArgs(args);
  if (action === "list") {
    const response = await context.service.listTraining({
      mine: Boolean(options.mine),
      statuses: csv(options.status),
      frameworks: csv(options.framework),
      priorities: csv(options.priority),
      limit: options.limit,
      region: options.region,
    });
    if (options.json) return print(response, true);
    const rows = (response.TrainJobSet ?? []).map((item) => {
      const resource = item.Roles?.[0]?.ResourceConfig ?? {};
      return {
        name: item.TrainJobName,
        state: item.JobStatus?.Status,
        framework: item.Framework,
        gpu: resource.GPUNumber ? `${resource.GPUNumber}×${resource.GPUType}` : "CPU",
        queue: item.QueueName,
        submitted: item.JobStatus?.SubmitTime,
        id: item.TrainJobId,
      };
    });
    return print(formatTable(rows, [
      { key: "name", label: "名称" },
      { key: "state", label: "状态" },
      { key: "framework", label: "框架" },
      { key: "gpu", label: "GPU" },
      { key: "queue", label: "队列" },
      { key: "submitted", label: "提交时间" },
      { key: "id", label: "ID" },
    ]));
  }

  if (action === "create") {
    const variables = await context.service.prepareCreateVariables("train", {
      file: options.file,
      template: options.template,
      name: options.name,
      command: options.command,
      commandFile: options["command-file"],
      region: options.region,
      set: options.set,
    });
    if (options["dry-run"]) return print(redact(variables, { showSensitive: options["show-sensitive"] }), true);
    const approved = await confirmAction(`确认创建训练任务 ${variables.TrainJobName}？`, { yes: Boolean(options.yes) });
    if (!approved) return print("已取消");
    const result = await context.api.createTrainJob(variables);
    return print({ result, variables: redact(variables) }, true);
  }

  const selector = positionals[0];
  if (action === "detail" && selector) {
    const payload = await context.service.trainingDetail(selector, { latest: Boolean(options.latest), region: options.region });
    if (options.json) return print(redact(payload), true);
    const detail = payload.detail;
    const commands = [];
    if (detail.EntryPointCommand) commands.push({ label: "任务入口命令", value: detail.EntryPointCommand });
    for (const role of detail.Roles ?? []) {
      if (role.RunCommand) commands.push({ label: `角色 ${role.RoleName || "未命名"}`, value: role.RunCommand });
    }
    const lines = [
      `名称: ${detail.TrainJobName}`,
      `ID: ${detail.TrainJobId}`,
      `框架: ${detail.Framework || "-"}`,
      `队列: ${detail.QueueName || "-"}`,
      "",
      "运行命令:",
      ...(commands.length ? commands.flatMap((command) => [`[${command.label}]`, command.value, ""]) : ["未配置显式命令（可能使用镜像默认启动命令）"]),
    ];
    return print(lines.join("\n"));
  }
  if (action === "logs" && selector) {
    if (options.follow && options.json) throw new Error("--follow 不能与 --json 同时使用；持续输出请使用纯文本模式");
    const interval = Number(options.interval ?? 3);
    if (!Number.isFinite(interval) || interval < 1 || interval > 60) throw new Error("--interval 必须是 1 到 60 之间的秒数");
    const logOptions = {
      latest: Boolean(options.latest),
      region: options.region,
      pod: options.pod,
      role: options.role,
      tailLines: options.tail,
      sinceSeconds: options.since,
    };
    const run = async () => {
      let payload = await context.service.trainingLogs(selector, logOptions);
      if (options.json) return print(redact(payload), true);
      print(trainingLogsText(payload));
      if (!options.follow) return;
      const previous = new Map(payload.logs.map((entry) => [entry.pod.Name, String(entry.content ?? "")]));
      let following = true;
      const stopFollowing = () => { following = false; };
      process.once("SIGINT", stopFollowing);
      try {
        while (following) {
          await delay(interval * 1000);
          if (!following) break;
          payload = await context.service.trainingLogs(selector, logOptions);
          for (const entry of payload.logs) {
            const current = String(entry.content ?? "");
            const addition = appendedLogText(previous.get(entry.pod.Name), current).replace(/^\r?\n/, "");
            previous.set(entry.pod.Name, current);
            if (addition) print(`\n===== ${entry.pod.Name} · ${entry.pod.Role || "未命名角色"} =====\n${addition.trimEnd()}`);
          }
        }
      } finally {
        process.off("SIGINT", stopFollowing);
      }
    };
    return options.follow ? context.browser.withBrowser(run) : run();
  }
  if (!["start", "stop", "delete"].includes(action) || !selector) throw new Error(`未知训练命令：${action || "（空）"}`);
  const resolveOptions = { latest: Boolean(options.latest), region: options.region };
  const item = await context.service.resolveTraining(selector, resolveOptions);
  const verb = { start: "启动", stop: "停止", delete: "永久删除" }[action];
  const approved = await confirmAction(`确认${verb}训练任务 ${item.TrainJobName}？`, { yes: Boolean(options.yes) });
  if (!approved) return print("已取消");
  const result = action === "start"
    ? await context.service.startTraining(item.TrainJobId, resolveOptions)
    : action === "stop"
      ? await context.service.stopTraining(item.TrainJobId, resolveOptions)
      : await context.service.deleteTraining(item.TrainJobId, resolveOptions);
  return print(result, true);
}

async function handleTemplate(context, action, args) {
  const { positionals, options } = parseArgs(args);
  if (action === "list") {
    const records = await context.templates.list();
    if (options.json) return print(records.map((item) => redact(item)), true);
    const rows = records.map((item) => ({
      kind: item.kind,
      name: item.name,
      source: item.source?.name || item.source?.file || "-",
      updated: item.updatedAt || "-",
    }));
    return print(formatTable(rows, [
      { key: "kind", label: "类型" },
      { key: "name", label: "名称" },
      { key: "source", label: "来源" },
      { key: "updated", label: "更新时间" },
    ]));
  }
  const [kind, name, extra] = positionals;
  if (!kind || !name) throw new Error(`模板命令 ${action} 需要 <dev|train> NAME`);
  if (action === "show") return print(redact(await context.templates.get(kind, name), { showSensitive: options["show-sensitive"] }), true);
  if (action === "save") {
    if (!options.from) throw new Error("template save 需要 --from NAME_OR_ID");
    const record = await context.service.saveTemplateFromResource(kind, name, options.from, {
      latest: Boolean(options.latest),
      region: options.region,
    });
    return print(redact(record), true);
  }
  if (action === "import") {
    if (!extra) throw new Error("template import 需要 JSON 文件路径");
    return print(redact(await context.service.importTemplate(kind, name, extra)), true);
  }
  if (action === "delete") {
    const approved = await confirmAction(`确认删除模板 ${kind}/${name}？`, { yes: Boolean(options.yes) });
    if (!approved) return print("已取消");
    return print(await context.templates.delete(kind, name), true);
  }
  throw new Error(`未知模板命令：${action}`);
}

async function main() {
  const [group, action, ...rest] = process.argv.slice(2);
  if (!group || ["help", "--help", "-h"].includes(group)) return print(HELP.trim());
  if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("需要 Node.js 22 或更高版本");
  if (group === "config") return handleConfig([action, ...rest].filter((item) => item !== undefined));

  const context = await createContext();
  if (group === "login") {
    const { options } = parseArgs([action, ...rest].filter((item) => item !== undefined));
    const approved = await confirmAction("将开启仅监听本机的独立 Edge 调试会话；继续？", { yes: Boolean(options.yes) });
    if (!approved) return print("已取消");
    const result = await context.browser.launchLogin();
    print(result, true);
    return print("请在独立 Edge 中完成 MFA；首次登录可选择让 Edge 保存密码，之后通常只需输入新的手机验证码。", false);
  }
  if (group === "logout") {
    const { options } = parseArgs([action, ...rest].filter((item) => item !== undefined));
    const forget = Boolean(options.forget);
    const message = forget
      ? "确认删除全部 AICP 登录资料，包括 Edge 已保存的账号和密码？"
      : "确认清除 AICP 登录会话？Edge 已保存的账号和密码会保留。";
    const approved = await confirmAction(message, { yes: Boolean(options.yes) });
    if (!approved) return print("已取消");
    return print(await context.browser.logout({ forget }), true);
  }
  if (group === "session") return print(await context.browser.status(), true);
  if (group === "gpu") return handleGpu(context, [action, ...rest].filter((item) => item !== undefined));
  if (group === "dev") return handleDev(context, action, rest);
  if (group === "train") return handleTrain(context, action, rest);
  if (group === "template") return handleTemplate(context, action, rest);
  if (group === "gui") {
    const { options } = parseArgs([action, ...rest].filter((item) => item !== undefined));
    const { startGui } = await import("../lib/gui-server.mjs");
    return startGui(context, {
      port: Number(options.port || context.config.guiPort),
      open: options.open !== false,
    });
  }
  throw new Error(`未知命令：${group}\n\n${HELP}`);
}

main().catch((error) => {
  process.stderr.write(`错误：${error.message}\n`);
  process.exitCode = 1;
});
