# AICP Desk

AICP Desk 是一个运行在本机的金山云星流（AICP）控制工具，同时提供：

- 可视化控制台：适合人工创建、检查和管理开发机、训练任务与模板。
- 命令行工具 `aicp`：适合脚本和 Agent 自动化，可输出结构化 JSON。
- 本地模板：保存一套配置后仍可在下次创建前修改镜像、规格、挂载和访问配置。

项目支持 Windows、macOS 和 Linux。它复用金山云网页当前使用的登录会话及内部 GraphQL 接口，不需要在本地保存 AccessKey。

> 本项目不是金山云官方 SDK。控制台接口升级后，部分字段可能需要同步更新。创建、启动、停止、删除和保存镜像都会真实影响云端资源。

## 功能

- 开发机：查询、创建、启动、停止、删除、保存镜像、复制公网 SSH 命令、存为模板。
- 训练任务：查询、创建、查看运行命令、启动、停止、删除、存为模板。
- GPU 容量：只读查看每个资源组的物理 GPU 总量/剩余量，以及每个队列的 GPU 配额、已分配和配额剩余。
- 状态自动刷新：开发机、训练任务和 GPU 容量页面每 10 秒后台刷新当前可见页面，切回页面时立即补刷；手动刷新仍然保留。
- 原生创建选项：实时读取当前区域的镜像、资源组、开发/训练队列、GPU、存储、EIP 和 KCR 配置。
- 可编辑模板：选择模板后会回填完整创建页面，可继续做少量或大幅修改；只有明确点击保存时才会更新模板。
- 登录资料复用：使用独立 Microsoft Edge 配置；会话过期后通常只需重新输入手机验证码。
- 安全防护：写操作需要确认，CLI 支持先用 `--dry-run` 检查最终参数；敏感字段默认隐藏。

## 系统要求

| 系统 | 支持情况 | 安装入口 |
| --- | --- | --- |
| Windows（仍受 Node.js 22 与 Edge 支持的版本） | 支持 | `install.ps1` |
| macOS（Intel / Apple Silicon） | 支持 | `install.sh` |
| Linux（发行版需能安装 Microsoft Edge） | 支持 | `install.sh` |
| Linux 无桌面环境 | 支持 CLI；GUI 用 `--no-open` 后通过本地端口访问 | `install.sh` |

所有平台均需要：

1. [Node.js](https://nodejs.org/) 22 或更高版本。
2. [Microsoft Edge](https://www.microsoft.com/edge/download)。
3. 可访问金山云登录页和星流控制台的网络。

检查 Node.js：

```text
node --version
```

## 安装

先下载 Release 压缩包并解压，或克隆仓库：

```bash
git clone https://github.com/analyst-huang/aicp-desk.git
cd aicp-desk
```

### Windows

在 PowerShell 中运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

安装器会：

- 将程序复制到 `%LOCALAPPDATA%\aicp-cli\app`。
- 创建 `%LOCALAPPDATA%\aicp-cli\bin\aicp.cmd` 并加入当前用户的 `PATH`。
- 默认在桌面创建 `AICP Desk` 快捷方式。

不创建桌面快捷方式：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -NoShortcut
```

安装后请打开一个新的终端。

### macOS

在 Terminal 中运行：

```bash
chmod +x install.sh uninstall.sh aicp start-gui.sh
./install.sh
```

程序安装到 `~/Library/Application Support/aicp-cli/app`，命令安装到 `~/.local/bin/aicp`，并默认创建 `~/Applications/AICP Desk.command`。

如果 `~/.local/bin` 尚未在 `PATH` 中，将下面一行加入 `~/.zshrc`，然后重新打开 Terminal：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

### Linux

```bash
chmod +x install.sh uninstall.sh aicp start-gui.sh
./install.sh
```

程序默认安装到 `${XDG_DATA_HOME:-$HOME/.local/share}/aicp-cli/app`，命令安装到 `~/.local/bin/aicp`。桌面环境下会创建 `aicp-desk.desktop`。

如有需要，将命令目录加入 shell 配置：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

macOS/Linux 不创建桌面入口：

```bash
./install.sh --no-shortcut
```

### 不安装，直接运行

在仓库根目录中：

```bash
node ./bin/aicp.mjs --help
node ./bin/aicp.mjs gui
```

Windows 也可使用：

```powershell
.\aicp.cmd --help
.\start-gui.cmd
```

macOS/Linux 可使用：

```bash
./aicp --help
./start-gui.sh
```

## 首次登录

```bash
aicp login
```

命令会打开一个仅供 AICP Desk 使用的独立 Edge 窗口。请在金山云页面中输入账号、密码和手机验证码；工具本身不会读取这些内容。

首次登录时可以接受 Edge 的“保存密码”提示。账号和密码由 Edge 密码管理器保存，并受 Windows 账户、macOS 钥匙串或 Linux 桌面密钥环保护。手机验证码不会保存。

查看登录状态：

```bash
aicp session
```

清除 Cookie、保留 Edge 已保存的账号密码：

```bash
aicp logout
```

删除整个独立 Edge 配置，包括其中保存的账号密码：

```bash
aicp logout --forget
```

如果 Edge 未被自动找到，可以指定可执行文件：

```bash
aicp config set edgePath "/path/to/Microsoft Edge"
```

Windows 示例：

```powershell
aicp config set edgePath "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
```

## GUI 用法

启动可视化控制台：

```bash
aicp gui
```

默认地址为 `http://127.0.0.1:17863`，服务只监听本机回环地址。关闭启动它的终端即可停止本地控制台。

不自动打开浏览器：

```bash
aicp gui --no-open
```

指定端口：

```bash
aicp gui --port 18080
```

### 开发机页面

开发机列表提供独立的“启动”和“停止”按钮。已停止、失败或成功结束的开发机可删除；删除前需要确认并输入开发机名称。运行中的开发机还可以：

- 保存镜像：使用与金山云原页一致的右侧抽屉，实时选择个人/企业 KCR、命名空间、仓库、版本和可见性。
- 复制 SSH：仅对已配置公网 SSH 的开发机显示，复制完整 `ssh` 命令。
- 存为模板：从当前云端开发机生成可复用模板。

点击“新建开发机”后，可配置：

- 基本信息与描述。
- 官方、自定义或第三方镜像。
- 资源组、开发队列、CPU、内存、GPU 与固定节点。
- KPFS/KS3 挂载、容器内路径和协议。
- SSH、公网 EIP、自定义服务端口。
- 环境变量、权限和自动保存镜像。

### 训练任务页面

点击“新建训练任务”后，可配置训练专用资源组/队列、镜像、GPU、挂载、运行命令、运行时长、自愈与保留策略。列表提供详情、启动、停止、删除和存为模板按钮。详情抽屉优先显示任务入口命令和各角色运行命令，并可一键复制；已停止、失败或成功结束的任务可在输入任务名称二次确认后删除。

### GPU 容量页面

“GPU 容量”页面使用金山云原生只读接口显示两种不同口径：

- 资源组物理剩余：资源组当前未分配的物理 GPU 卡数，同时显示总量、已分配和不可用卡数。
- 队列配额剩余：队列 GPU 配额减去当前已分配量，并按 GPU 型号展示配置的配额。

队列配额剩余不等于当前一定可调度的物理卡数。如果队列允许借用，最终可申请量还会受资源组实时物理剩余、GPU 型号和单节点碎片影响。

开发机、训练任务和 GPU 容量页面默认每 10 秒在后台刷新当前可见页面，不会因定时刷新清空整张表格；页面顶部会显示最近刷新时间。切回浏览器标签时会立即补刷一次，也可以随时点击“刷新”。

### 模板页面

模板保存在本机。选择模板创建开发机或训练任务时，模板只是配置起点：表单回填后仍可修改任何字段，不会自动覆盖原模板。需要保存修改时，使用“将当前配置另存为模板”。

## CLI 用法

显示帮助：

```bash
aicp --help
```

### 配置

```bash
aicp config show
aicp config set region cn-northwest-3
aicp config set username your-user-name
aicp config set guiPort 17863
```

常用配置键：`region`、`username`、`debugPort`、`guiPort`、`edgePath`、`apiEndpoint`、`consoleUrl`。

### GPU 容量

查看资源组和队列的 GPU 容量：

```bash
aicp gpu
```

供 Agent 或脚本读取结构化结果：

```bash
aicp gpu --json
aicp gpu --region cn-northwest-3 --json
```

人类可读输出会分别列出资源组物理剩余和队列配额剩余，并标记队列是否允许借用。

### 开发机

查询：

```bash
aicp dev list
aicp dev list --mine
aicp dev list --mine --json
```

从完整 JSON 参数文件创建。建议先检查，再提交：

```bash
aicp dev create --file ./examples/dev-create.json --dry-run
aicp dev create --file ./examples/dev-create.json --yes
```

从模板创建并临时覆盖字段：

```bash
aicp dev create --template my-dev --name agent-dev-01 \
  --set GPUNumber=1 \
  --set CpuNum=16 \
  --set Memory=64 \
  --dry-run
```

启动、停止或删除：

```bash
aicp dev start DEV_NAME_OR_ID --yes
aicp dev stop DEV_NAME_OR_ID --yes
aicp dev stop DEV_NAME_OR_ID --force --yes
aicp dev delete DEV_NAME_OR_ID --yes
```

### 训练任务

查询：

```bash
aicp train list --mine
aicp train list --status running,stopped --json
```

创建：

```bash
aicp train create --file ./examples/train-create.json --dry-run
aicp train create --file ./examples/train-create.json --yes
```

从模板创建并覆盖嵌套字段：

```bash
aicp train create --template baseline --name experiment-001 \
  --set Roles[0].ResourceConfig.GPUNumber=4 \
  --set Roles[0].ResourceConfig.CPUNum=32 \
  --set Roles[0].ResourceConfig.Memory=128 \
  --dry-run
```

运行命令可以直接传入，或从文件读取：

```bash
aicp train create --template baseline --name experiment-002 \
  --command "python train.py --epochs 10" --dry-run

aicp train create --template baseline --name experiment-003 \
  --command-file ./run.sh --yes
```

查看详情中的任务命令：

```bash
aicp train detail TRAIN_NAME_OR_ID
aicp train detail TRAIN_NAME_OR_ID --latest --json
```

启动、停止或删除：

```bash
aicp train start TRAIN_NAME_OR_ID --yes
aicp train stop TRAIN_NAME_OR_ID --yes
aicp train delete TRAIN_NAME_OR_ID --latest --yes
```

训练任务重名时，使用 ID，或明确选择最新一条：

```bash
aicp train start repeated-name --latest --yes
```

### 模板

```bash
aicp template list
aicp template list --json
aicp template show dev my-dev
aicp template show train baseline
```

从已有云端资源保存：

```bash
aicp template save dev my-dev --from DEV_NAME_OR_ID
aicp template save train baseline --from TRAIN_NAME_OR_ID --latest
```

导入本地 JSON：

```bash
aicp template import dev my-dev ./examples/dev-create.json
aicp template import train baseline ./examples/train-create.json
```

删除：

```bash
aicp template delete dev my-dev --yes
```

### `--set` 参数规则

`--set PATH=VALUE` 可重复使用，并支持嵌套对象和数组路径：

```bash
--set AutoSave=true
--set Roles[0].Replicas=2
--set Roles[0].Envs='[{"Name":"MODE","Value":"train"}]'
--set Roles[0].RunCommand=@run.sh
```

值会自动识别布尔值、数字、`null`、JSON 数组/对象；`@文件` 表示读取文件内容。

## 数据目录

| 系统 | 默认配置、模板和独立 Edge 登录资料目录 |
| --- | --- |
| Windows | `%LOCALAPPDATA%\aicp-cli` |
| macOS | `~/Library/Application Support/aicp-cli` |
| Linux | `${XDG_STATE_HOME:-$HOME/.local/state}/aicp-cli` |

可通过 `AICP_HOME` 改写数据目录：

```bash
AICP_HOME=/secure/path/aicp aicp session
```

重要文件：

- `config.json`：区域、用户名、端口等本地设置。
- `templates/`：开发机和训练任务模板。
- `edge-profile/`：独立 Edge 登录资料和 Edge 保存的密码。

不要将这些数据目录加入 Git，也不要共享给其他人。

## 更新

拉取新版本后重新运行对应安装脚本即可。安装器只替换 `app` 与命令入口，不会删除模板、配置或独立 Edge 登录资料。

Windows：

```powershell
git pull
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

macOS/Linux：

```bash
git pull
./install.sh
```

## 卸载

Windows，删除程序和全部本地数据：

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
```

Windows，只删除程序并保留模板和登录资料：

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -KeepData
```

macOS/Linux，删除程序和全部本地数据：

```bash
./uninstall.sh
```

macOS/Linux，只删除程序并保留模板和登录资料：

```bash
./uninstall.sh --keep-data
```

自动化卸载可添加 `-Yes`（PowerShell）或 `--yes`（shell）。

## 开发与测试

本项目没有运行时 npm 依赖：

```bash
git clone https://github.com/analyst-huang/aicp-desk.git
cd aicp-desk
npm test
npm run gui
```

测试不会创建、启动或停止云端资源。涉及真实账号的联调应仅执行只读查询，写操作必须由操作者明确确认。

仓库主要目录：

```text
bin/        CLI 入口
lib/        浏览器会话、平台 API、业务服务和模板逻辑
web/        本地可视化控制台
test/       Node.js 自动化测试
examples/   开发机与训练任务 JSON 示例
```

## 安全说明

- 本地 GUI 仅监听 `127.0.0.1`，并使用随机请求令牌保护写接口。
- Edge 调试端口同样仅监听 `127.0.0.1`。
- AICP Desk 不明文保存账号密码或手机验证码。
- `--json` 与模板输出默认隐藏密码、Token、Secret 和环境变量值。
- `template show --show-sensitive` 会显示完整模板，请谨慎使用。
- 模板可能包含环境变量或仓库凭据；不要提交到 Git。
- 删除开发机或训练任务不可撤销，且不会删除其挂载的外部存储；运行中的资源需要先停止。GUI 使用确认框和名称输入双重确认，CLI 需要 `--yes`。
- `aicp gpu` 和 GUI 的 GPU 容量页只执行查询，不会创建、启动、停止或修改任何云端资源。
