export const AGENT_INSTRUCTIONS = `
AICP Agent 总体说明

用途与边界
- AICP Desk 用于查询和管理金山云星流的 GPU 容量、开发机、训练任务与本地模板。
- 先运行 aicp --help 查看完整命令；自动化时优先使用 --json，并按退出码判断成功或失败。
- session、gpu、list、detail、logs、template list/show 属于只读操作，可以用于收集上下文。
- 用户可以一次授权一个实验周期。授权后，Agent 可以在该实验目标和硬上限内自主创建、启动、停止、重启、删除本周期任务，修改代码与配置，调参、调试、重试并创建替代实验，不需要逐次请求确认。
- login/logout、remote-ui install/stop、config set，以及本实验周期之外的模板或资源写操作不包含在实验授权中；除非用户已明确要求，否则不要执行。
- 不读取、索取、复制或输出密码、MFA 验证码、Cookie、Token、Secret 或 AICP_HOME/edge-profile。登录和 MFA 必须由用户本人在 Edge 页面中完成。

推荐工作流
1. 运行 aicp session，确认 authenticated 为 true、当前 IAM 用户和区域符合预期；未登录时请用户完成 aicp login。
2. 用 aicp gpu --only-free --sort-gpu desc --json 检查实时容量。队列配额剩余不等于物理 GPU 一定可调度，还要核对 GPU 型号、单节点余量和 schedulable。
3. 用 aicp image list --kind train --json 核对可用镜像的名称、版本和 Image ID；再用 aicp template list --json、aicp template show train NAME 或用户提供的完整 JSON 作为配置起点，不猜测资源 ID、镜像 ID、存储 ID 或敏感值。
4. 第一次执行前确认实验目标、允许使用的代码与数据范围、总资源或费用硬上限，以及停止条件。用户对这些边界的批准即为整个实验周期的授权。
5. 每次创建或重新提交前运行带 --dry-run 的完整命令检查最终参数。默认保持敏感字段隐藏，不使用 --show-sensitive。只要没有越界，Agent 可自行判断并使用 --yes，无需等待逐次确认。
6. 提交后记录任务名称、ID、参数变化、判断依据和结果；持续使用 train detail、train logs 或 train logs --follow 监控，并根据证据自主修复、调参、停止无效任务或开始下一轮。

实验周期授权
开始自主实验前，只需要用户批准以下边界：
- 实验目标，以及允许操作的代码仓库、数据和输出范围。
- 总资源或费用硬上限；可以用总 GPU 时、最大并发 GPU、累计运行时长或用户指定的其他可核验指标表达。
- 成功标准、停止条件；如果用户未指定具体调参策略，Agent 可以自行选择。

在这些边界内，Agent 可以自主决定任务名称、命令、框架、代码版本、镜像、区域、资源组、队列、优先级、副本数、GPU/CPU/内存、运行时长、挂载方式、输出路径、超参数、重试次数和实验顺序；也可以停止、重启、删除本周期创建的任务，或创建替代实验。参数发生变化不需要重新向用户确认。

授权规则
- aicp train create 会创建并提交真实训练任务；aicp train start 会启动已有任务，两者都视为 launch。
- --dry-run 只检查最终参数，不创建资源。每次提交前必须先 dry-run，但实验周期已获授权时不需要再次请求批准。
- --yes 仅跳过 CLI 的交互提示；Agent 只能在实验周期已经获得用户授权且当前操作没有越界时使用它。
- 用户只同意调研、准备配置、估算容量或 dry-run 时，不得启动实验周期。
- 名称重复时优先使用明确的任务 ID。可以对本周期创建的任务使用 --latest；不要用它操作用户原有或其他周期的同名任务。
- 只有三类情况必须暂停并重新请求用户授权：预计超过已批准的总资源或费用硬上限；将覆盖、删除或操作本实验周期之外的既有资源或持久数据；需要读取或修改凭据、权限、安全设置或系统级环境。
- 在未越界的前提下，stop、delete、重新 start、扩大或缩小单个任务资源、修改参数、改换镜像以及创建替代实验均不需要单独授权。永久删除仅限本周期创建的任务，并应先记录准确名称和 ID。

常用命令
  aicp session
  aicp gpu --only-free --sort-gpu desc --json
  aicp image list --kind train --json
  aicp template list --json
  aicp template show train TEMPLATE
  aicp train create --template TEMPLATE --name NAME [--set PATH=VALUE ...] --dry-run
  aicp train create --template TEMPLATE --name NAME [--set PATH=VALUE ...] --yes
  aicp train list --mine --json
  aicp train detail NAME_OR_ID --json
  aicp train logs NAME_OR_ID --tail 200 --json
  aicp train logs NAME_OR_ID --follow

遇到登录失效或权限不足时停止写操作并请用户处理；遇到容量不足、配置错误、任务失败或平台暂时错误时，保留证据并在授权边界内自主选择队列、资源、参数、镜像、重试或替代方案。
`;
