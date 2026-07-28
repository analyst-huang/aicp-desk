export const AGENT_INSTRUCTIONS = `
AICP Agent 总体说明

用途与边界
- AICP Desk 用于查询和管理金山云星流的 GPU 容量、开发机、训练任务与本地模板。
- 先运行 aicp --help 查看完整命令；自动化时优先使用 --json，并按退出码判断成功或失败。
- session、gpu、list、detail、logs、template list/show 属于只读操作，可以用于收集上下文。
- create、start、stop、delete 会改变真实云端资源。login/logout、remote-ui install/stop、config set 和模板写操作也会改变本地状态；只有用户的请求已明确授权对应变更时才能执行。
- 不读取、索取、复制或输出密码、MFA 验证码、Cookie、Token、Secret 或 AICP_HOME/edge-profile。登录和 MFA 必须由用户本人在 Edge 页面中完成。

推荐工作流
1. 运行 aicp session，确认 authenticated 为 true、当前 IAM 用户和区域符合预期；未登录时请用户完成 aicp login。
2. 用 aicp gpu --only-free --sort-gpu desc --json 检查实时容量。队列配额剩余不等于物理 GPU 一定可调度，还要核对 GPU 型号、单节点余量和 schedulable。
3. 用 aicp image list --kind train --json 核对可用镜像的名称、版本和 Image ID；再用 aicp template list --json、aicp template show train NAME 或用户提供的完整 JSON 作为配置起点，不猜测资源 ID、镜像 ID、存储 ID 或敏感值。
4. 创建前先运行带 --dry-run 的完整命令，检查最终参数。默认保持敏感字段隐藏，不使用 --show-sensitive。
5. 把 dry-run 的关键配置和实际将执行的命令摘要展示给用户，取得本次 launch 的明确同意后，才可用完全相同的参数去掉 --dry-run 并添加 --yes。
6. 提交后报告任务名称和 ID；按用户约定用 train detail、train logs 或 train logs --follow 监控。发现失败时先报告证据，不擅自重启、扩大资源或改换镜像。

Launch 训练实验前必须确认
执行 aicp train create 或 aicp train start 前，必须向用户集中确认以下信息；不适用的项目也要明确标为不适用，不能自行猜测：
- 实验目标、任务名称，以及使用哪个模板或参数文件。
- 区域、资源组、训练队列和优先级。
- 框架、代码/数据版本、镜像来源与具体镜像版本，以及每个角色的完整运行命令。
- 每个角色的副本数、GPU 型号与卡数、CPU、内存；最大运行时长及可接受的资源/费用上限。
- 数据集、存储挂载路径、输出和 checkpoint 位置，以及覆盖已有输出的风险。
- 环境变量和所需凭据是否已经安全配置；只确认其名称或是否就绪，不要求用户在对话中发送秘密值。
- 创建后是否立即作为真实实验提交、需要监控多久，以及出现排队、失败、超时或异常资源消耗时是停止并询问，还是按已批准策略处理。
- dry-run 展示的最终配置是否获准用于“这一次”提交。

授权规则
- aicp train create 会创建并提交真实训练任务；aicp train start 会启动已有任务，两者都视为 launch。
- --dry-run 只检查最终参数，不创建资源。必须先 dry-run，再请求用户批准。
- --yes 仅跳过 CLI 的交互提示，不代表用户同意。Agent 只能在已经获得明确授权后使用它。
- 用户只同意调研、准备配置、估算容量或 dry-run 时，不得 launch。
- dry-run 后只要名称、命令、镜像、资源、队列、挂载、环境变量或时限有任何实质变化，都要重新 dry-run 并再次确认。
- 名称重复时优先使用明确的任务 ID；除非用户明确同意选择最新任务，否则不要使用 --latest。
- stop、delete、重新 start、扩大资源或创建替代实验需要单独授权。delete 是永久操作，执行前必须复述准确名称和 ID。

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

遇到登录失效、权限不足、容量不足、配置歧义或平台错误时停止写操作，保留原始错误并向用户说明需要其决定的事项。
`;
