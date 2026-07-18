# AICP Desk

AICP Desk 是一个运行在本机的金山云星流（AICP）控制工具，同时提供：

- 可视化控制台：适合人工创建、检查和管理开发机、训练任务与模板。
- 命令行工具 `aicp`：适合脚本和 Agent 自动化，可输出结构化 JSON。
- 本地模板：保存一套配置后仍可在下次创建前修改镜像、规格、挂载和访问配置。

项目支持 Windows、macOS 和 Linux。它复用金山云网页当前使用的登录会话及内部 GraphQL 接口，不需要在本地保存 AccessKey。

> 本项目不是金山云官方 SDK。控制台接口升级后，部分字段可能需要同步更新。创建、启动、停止、删除和保存镜像都会真实影响云端资源。

## 功能

- 开发机：查询、创建、启动、停止、删除、保存镜像、复制公网 SSH 命令、存为模板。
- 训练任务：查询、创建、查看运行命令和 Pod 命令行输出、启动、停止、删除、存为模板。
- GPU 与节点容量：只读查看每个资源组的物理 GPU 总量/剩余量、队列配额，以及每台机器的 GPU 型号、可分配/已分配/剩余卡数、内存和 CPU 余量；可只看有空闲卡且可调度的节点，并按剩余卡数排序。
- 状态自动刷新：开发机、训练任务和 GPU 容量页面每 10 秒后台刷新当前可见页面，切回页面时立即补刷；手动刷新仍然保留。
- 原生创建选项：实时读取当前区域的镜像、资源组、开发/训练队列、GPU、存储、EIP 和 KCR 配置。
- 可编辑模板：选择模板后会回填完整创建页面，可继续做少量或大幅修改；只有明确点击保存时才会更新模板。
- 登录资料复用：使用独立 Microsoft Edge 配置；会话过期后通常只需重新输入手机验证码。
- 无显示器远端登录：Linux 服务器可自动启动 Xvfb、x11vnc 和 noVNC，在本地浏览器完成服务器侧 Edge 的手机验证。
- 安全防护：写操作需要确认，CLI 支持先用 `--dry-run` 检查最终参数；敏感字段默认隐藏。

## 系统要求

| 系统 | 支持情况 | 安装入口 |
| --- | --- | --- |
| Windows（仍受 Node.js 22 与 Edge 支持的版本） | 支持 | `install.ps1` |
| macOS（Intel / Apple Silicon） | 支持 | `install.sh` |
| Linux（发行版需能运行 Microsoft Edge） | 支持 | `install.sh` |
| Linux 无桌面环境 | 支持自动复用、全私有及显式系统安装三种远端登录模式 | `install.sh` |

所有平台均需要：

1. [Node.js](https://nodejs.org/) 22 或更高版本。
2. 桌面环境需要 [Microsoft Edge](https://www.microsoft.com/edge/download)；无显示器服务器会优先使用环境已有组件，并在 Debian/Ubuntu amd64 上把缺失项补到 AICP 私有目录。
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

## Linux 无显示器服务器登录（VS Code Remote）

这是远端服务器推荐的登录方式。Edge 实际运行在服务器上，所以登录后的 Cookie、保存的账号密码和 AICP 会话也留在服务器；本地电脑只通过 VS Code 端口转发查看登录画面。服务器不需要物理显示器，也不需要在本地电脑安装 Edge，本地任意现代浏览器均可打开 noVNC 页面。

远端模式使用以下本机回环链路：

```text
本地浏览器 → VS Code 转发 → 服务器 127.0.0.1:6080 (noVNC)
                                → 127.0.0.1:5900 (x11vnc)
                                → :99 (Xvfb) → 服务器上的 Edge
```

`6080`、`5900` 和 Edge 调试端口都只监听服务器的 `127.0.0.1`，无需开放安全组或防火墙端口。不要把 VS Code 转发端口的可见性改成 Public。

### 1. 远端前置条件

- 如果环境已经提供全部组件，可使用相应的 Linux 环境；自动下载私有缺失项目前要求 Debian/Ubuntu amd64（`dpkg --print-architecture` 输出 `amd64`）。
- Node.js 22 或更高版本。
- 普通服务器优先使用普通用户。Docker、Podman、Kubernetes 或 LXC 容器内如果当前就是 root，安装器会自动识别并使用显式标记的 `root-container` 模式。
- 服务器需要访问金山云登录页和 AICP 控制台；只有缺少 Edge 时才需要访问 `packages.microsoft.com`。
- 只有存在缺失组件时，才需要 Debian/Ubuntu 自带的 `apt-get`、`apt-cache`、`dpkg-deb` 等下载和解包命令；只有缺少 Edge 时才需要 `curl`、`gzip`，只有使用私有 websockify 时才需要 `python3`。脚本不会安装系统软件包。
- `AICP_HOME` 位于该用户的持久、私有磁盘目录。不要放在会被任务结束时清空的临时目录。

从仓库运行一次依赖安装脚本。它会逐项检查 Edge、Xvfb、x11vnc、noVNC、websockify 和 openbox/fluxbox，按以下顺序选择来源：

1. 使用当前环境的 `PATH` 或常见系统目录中已经可用的组件。
2. 环境缺失时，复用 AICP `runtime/` 中上次已经下载的私有副本。
3. 仅下载仍然缺失的组件和依赖，解包到 AICP 私有运行时。

因此，组件齐全时不会访问软件包仓库；混合环境只补缺失项；重复安装也会复用缓存。安装开始时会打印每个组件是环境路径、`private (cached)` 还是 `private (install)`。安装器会从 Microsoft 元数据中按版本选择最新 stable Edge，并把验证过的下载保存在 `runtime/` 同级的 `cache/edge/`；Edge 大文件下载会显示进度、支持断点续传并自动重试。Debian 依赖会跳过主机已经安装的包并分批下载，某批失败时才退回逐包定位。它不会执行 `sudo`、`apt-get install` 或 `dpkg -i`，不会添加系统 APT 源，也不会写入 `/usr`、`/opt`、`/etc` 和系统包数据库：

```bash
chmod +x install.sh
./install.sh --no-shortcut
export PATH="$HOME/.local/bin:$PATH"
aicp remote-ui install --yes
```

如果 AICP Desk 已经安装，只需执行 `aicp remote-ui install --yes`。底层脚本也位于：

```text
${XDG_DATA_HOME:-$HOME/.local/share}/aicp-cli/app/scripts/install-remote-ui-debian.sh
```

`--runtime-mode` 可以明确选择依赖落点：

| 模式 | 行为 | 是否修改系统 |
| --- | --- | --- |
| `auto`（默认） | 优先复用环境组件，缺失项放入 AICP `runtime/` | 否 |
| `private` | Edge、Xvfb、noVNC 等受管组件全部放入 AICP `runtime/` | 否 |
| `system` | 通过 `apt-get` 把组件安装进当前 Debian/Ubuntu 环境，再做完整验证 | 是；仅 root 可用 |

```bash
aicp remote-ui install --runtime-mode private --yes

# 适合希望把依赖固化进当前容器镜像的 root；会修改系统包数据库
aicp remote-ui install --runtime-mode system --yes
```

`system` 不会静默启用，必须显式指定；裸机或共享服务器请先确认系统变更权限。容器中选择它时，改动只属于该容器/镜像的隔离边界，但 Edge 仍因 root 身份使用 `--no-sandbox`。

私有补齐目录和安装清单默认位于：

```text
${XDG_DATA_HOME:-$HOME/.local/share}/aicp-cli/runtime/
├── bin/       # 仅缺失组件需要的私有启动包装器
├── rootfs/    # 已下载的缺失组件、noVNC 网页和共享库
├── xdg-config/ # 私有 Edge 可写的配置/Crashpad 目录
├── manifest.txt  # 记录每个组件实际选择的来源
└── root-model / allow-no-sandbox  # 仅 root-container 模式存在
```

如果设置了 `AICP_INSTALL_DIR`，则位于 `$AICP_INSTALL_DIR/runtime`，Edge 下载缓存位于 `$AICP_INSTALL_DIR/cache/edge`。重新运行脚本会把已有运行时原子改名为事务目录，在原目录补齐和验证，成功后原子提交；失败、TERM 或 INT 会自动改名恢复。这样缓存重装不会在 NFS 上复制整个私有 rootfs。安装事务期间 `runtime/` 会短暂不可用，不要并发启动远端 UI。普通的 `install.sh` 升级只替换 `app/`，会保留现有 `runtime/` 和缓存。运行时解析始终把环境路径放在私有目录之前，所以之后在环境中安装的组件会自动优先使用。

安装器会先读取当前 UID，并检查 `/.dockerenv`、`/run/.containerenv`、Kubernetes 环境变量和 cgroup：

- 非 root：使用 `user-sandbox`；环境 Edge 使用自身的正常沙箱，私有 Edge 使用 Linux 非特权用户命名空间沙箱。
- 检测到容器内 root：自动使用 `root-container`，写入 `root-model` 与 `allow-no-sandbox` 标记；Edge 必须以 `--no-sandbox` 运行。
- KAIC WebIDE 镜像即使隐藏了 Docker/Kubernetes 标准标记，也会通过 PID 1 的 KAIC `supervisord` 路径识别为容器。
- 裸机 root：默认拒绝，避免误判。确认它确实处于受控隔离环境时才显式运行 `aicp remote-ui install --allow-root --yes`。

安装末尾会实际启动一次无界面 Edge 做冒烟验证，失败时不会替换旧运行时。非 root 环境如果内核禁用了用户命名空间，仅在可信、专用且与其他用户隔离的服务器上，可以明确接受风险后使用：

```bash
aicp remote-ui install --allow-no-sandbox --yes
```

`--allow-no-sandbox` 和 root 模式都会留下可审计标记；不要在多人共享、挂载宿主机敏感目录或运行不可信网页的容器上使用。

当前自动下载私有缺失项只支持 Debian/Ubuntu amd64。其他发行版或架构只要已经提供全部组件，也可以直接复用环境；脚本不会为了兼容而修改系统软件。

### 2. 让 Agent 先做只读自检

```bash
aicp remote-ui doctor
```

输出中的 `ready` 必须为 `true`；`dependencies` 显示当前真正会执行的组件路径，`privateRuntime.strategy` 显示 `auto`、`private` 或 `system`，`privateRuntime.sources` 逐项显示安装时选择了环境还是私有补齐，并包含 XKB 编译器来源。`privateRuntime.mode` 显示 `user-sandbox`、`user-no-sandbox` 或 `root-container`，`containerDetected` 和 `rootModel` 记录判断结果。root 模式会在 `warnings` 中持续提示。如果 `ready` 为 `false`，命令会返回非零退出码，便于 Agent 自动中止后续步骤。非标准 noVNC 安装可以显式指定：

```bash
aicp login --remote-ui --web-root "$HOME/private-noVNC" --yes
```

### 3. 启动登录界面并转发打印出的端口

```bash
aicp login --remote-ui --yes
```

命令会明确打印以下内容，端口号也会包含在 `status` 输出中：

```text
远端网页端口: 6080
VS Code 转发端口: 6080
登录地址: http://127.0.0.1:6080/vnc.html?autoconnect=1&resize=scale
```

在 VS Code 中打开底部的“端口 / Ports”面板，选择“转发端口 / Forward a Port”，输入命令打印的 `6080`。随后点击 VS Code 给出的转发地址，或在已建立转发的情况下点击终端中的登录地址。若本机 `6080` 已占用，VS Code 可能分配不同的本地端口，应打开“端口”面板中显示的本地地址。

如果不用 VS Code，也可以从本地电脑建立 SSH 隧道：

```bash
ssh -N -L 6080:127.0.0.1:6080 USER@SERVER
```

然后在本地浏览器打开终端打印的登录地址。SSH 使用了不同本地端口时，把 URL 中的 `6080` 改为对应本地端口。

### 4. 人工完成 MFA，然后关闭远端画面

在 noVNC 页面中输入账号、密码和新的手机验证码。首次登录可以接受 Edge 的“保存密码”提示。确认登录成功后，在远端终端验证真实接口并停止画面服务：

```bash
aicp dev list --mine
aicp remote-ui stop --yes
```

`stop` 默认只关闭 noVNC、x11vnc 和窗口管理器，网页端口随即不可访问；后台 Edge 与 Xvfb 会继续运行。金山云的核心认证 Cookie 属于浏览器会话 Cookie，必须保留 Edge 进程才能继续使用，因此之后 `aicp dev ...`、`aicp train ...`、`aicp gpu` 等命令可以直接复用当前登录态。再次执行 `aicp login --remote-ui --yes` 会恢复 VNC 入口并显示原窗口，不需要重新登录。

需要释放全部后台进程时使用下面的命令。它会关闭 Edge 和 Xvfb，当前金山云会话 Cookie 随之失效，下次需要重新完成手机验证码：

```bash
aicp remote-ui stop --all --yes
```

需要从本地浏览器使用远端 GUI 时，在另一个远端终端启动并保持该命令运行：

```bash
aicp gui --no-open --port 17863
```

再用 VS Code 转发它打印的 `17863` 端口。登录 noVNC 的 `6080` 只在人工登录时需要；日常 GUI 使用的是独立的 `17863`。

会话过期后重新执行 `aicp login --remote-ui --yes`。用户名和密码通常会由 Edge 自动填充，只需输入新的手机验证码。查看或找回启动时打印的端口：

```bash
aicp remote-ui status
```

自定义端口和虚拟显示器：

```bash
aicp login --remote-ui --web-port 16080 --vnc-port 15900 --display :109 --yes
```

### 5. 远端 Agent 可直接执行的流程

Agent 可以负责安装、启动和验证，但手机验证码必须由用户本人在转发页面中输入。建议给 Agent 以下顺序：

```bash
# 在克隆的仓库中执行；普通用户与容器 root 使用同一组命令
./install.sh --no-shortcut
export PATH="$HOME/.local/bin:$PATH"
aicp remote-ui install --yes

# 不修改云端资源的检查
aicp remote-ui doctor

# 启动后，把命令打印的“VS Code 转发端口”和登录地址报告给用户，然后等待用户确认登录完成
aicp login --remote-ui --yes

# 用户确认后再验证；不要替用户输入或记录验证码
aicp dev list --mine
aicp remote-ui stop --yes
```

Agent 不应读取、复制、上传或提交 `AICP_HOME` 下的 `edge-profile/`。也不要把 noVNC 端口绑定到 `0.0.0.0`、公网 IP 或公开转发。

如果 Agent 当前是容器 root，不需要创建额外用户；应先检查 `doctor` 返回的 `rootModel: true` 和 `privateRuntime.mode: "root-container"`。容器不得使用 `--privileged`，不得挂载 Docker socket、宿主机根目录、SSH 密钥或其他敏感凭据。

### 密码存储与安全边界

带桌面的 Linux 通常由 Edge 使用 Gnome Keyring 或 KWallet 保护密码（参见 [Microsoft Edge 密码管理器安全说明](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-security-password-manager-security)）；纯命令行服务器通常没有可解锁的桌面密钥环。为确保无显示器模式能读取可选保存的账号密码，AICP Desk 会让该专用 Edge 配置一致使用 Chromium 的 `basic` 密码存储模式。金山云的当前认证 Cookie 是会话级数据，所以 `remote-ui stop` 会保留后台 Edge；`stop --all` 后仍能自动填充密码，但需要重新输入手机验证码。

这比桌面密钥环保护弱：安全性主要依赖 Linux 用户权限、服务器磁盘和 `AICP_HOME` 目录权限。只在受信任的专用账号下使用，建议启用磁盘加密并执行：

```bash
chmod 700 "${AICP_HOME:-$HOME/.local/state/aicp-cli}"
```

如果服务器为多人共用或不允许在磁盘保存密码，请不要接受 Edge 的“保存密码”提示；Cookie 仍会保留，但重新登录时需要再次输入密码和手机验证码。运行 `aicp logout --forget --yes` 会删除整个专用 Edge 配置和其中保存的密码。

### 常见问题

| 现象 | 处理方式 |
| --- | --- |
| `ready: false` 或提示缺少 Xvfb/noVNC | 运行 `aicp remote-ui install --yes`，再执行 `doctor`；不需要 `sudo apt install`。 |
| 不希望维护私有依赖 | 在确认允许修改当前 Debian/Ubuntu 环境后，以 root 运行 `aicp remote-ui install --runtime-mode system --yes`。 |
| 容器 root 被当成裸机 root | 容器检测可能被运行时隐藏；确认隔离边界后执行 `aicp remote-ui install --allow-root --yes`。 |
| 提示找不到 noVNC 网页 | 重新运行混合安装脚本；它会先查 `/usr/share/novnc` 等环境目录，再补到 `runtime/rootfs/usr/share/novnc`。自定义安装可用 `--web-root` 指定。 |
| 安装仍然准备下载很多包 | 查看安装开头的 component plan，并运行 `aicp remote-ui doctor` 查看实际路径；环境组件必须能通过 `PATH` 或文档中的常见目录找到。已有私有副本会显示为 `private (cached)`。 |
| Edge 下载长时间没有反馈 | v0.13.2 起 Edge 主包会显示进度并自动重试；请确认能访问 `packages.microsoft.com`。启动验证最多等待 30 秒，失败或超时会打印最后 30 行 Edge 输出。 |
| Edge 报 `crashpad`、`--database is required` 或 `$HOME/.config` 不可写 | AICP 会使用自己的 `edge-config/`，不再依赖用户的 `$HOME/.config`。重新安装或升级到 v0.13.2。 |
| 提示私有 Xvfb 缺少 XKB 数据 | v0.13.3 起会复用主机的 `/usr/share/X11/xkb`，仅在主机也缺失时才要求私有 `xkb-data`。 |
| `xvfb 启动失败` 且提示 `/usr/bin/xkbcomp: not found` | v0.13.6 起会把私有 Xvfb 的编译期路径重定向到 `runtime/xkbbin/xkbcomp`，无需写入系统 `/usr/bin`。远端 UI 各进程的末尾错误也会直接显示，并保存在 `AICP_HOME/remote-ui-*.log`。 |
| VNC 页面中文显示方框或乱码 | v0.13.7 起安装器会检查中文字体；环境没有时把 `fonts-noto-cjk` 解包到 AICP 私有运行时，并为 Edge/openbox 使用 UTF-8 locale 和私有 fontconfig。重新运行 `aicp remote-ui install --yes` 后完全重启一次远端 UI。 |
| `6080` 或 `5900` 已占用 | 用 `--web-port`、`--vnc-port` 改成其他未占用的高位端口。 |
| 登录页面是黑屏或进程不完整 | 运行 `aicp remote-ui stop --all --yes`，确认 `doctor` 通过后重新启动。 |
| VS Code 没自动弹出转发提示 | 在“端口 / Ports”面板手动添加命令打印的“VS Code 转发端口”。 |
| 服务器是 ARM64 | Edge Linux 当前没有对应服务器安装包；请改用 amd64 服务器。 |
| `remote-ui stop` 后 Agent 提示登录过期 | 升级到 v0.13.7；默认 `stop` 会保留后台 Edge/Xvfb。只有 `stop --all`、容器重启或真实会话过期后才需要重新完成手机验证码。 |

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

点击“新建训练任务”后，可配置训练专用资源组/队列、镜像、GPU、挂载、运行命令、运行时长、自愈与保留策略。列表提供详情、启动、停止、删除和存为模板按钮。详情抽屉优先显示任务入口命令和各角色运行命令，并可一键复制；“命令行输出”区域可选择全部或单个 Pod、调整最近行数、手动刷新、每 3 秒自动刷新并复制日志。已停止、失败或成功结束的任务可在输入任务名称二次确认后删除。

### GPU 容量页面

“GPU 容量”页面使用金山云原生只读接口显示三种不同口径：

- 节点实时容量：逐台机器显示名称、内网 IP、调度状态、GPU 型号，以及 GPU、内存和 CPU 的“剩余 / 可分配”数值。剩余量按“可分配 - 已分配”计算，内存单位为 GiB；列表优先展示 GPU 和内存余量较大的节点。
- 资源组物理剩余：资源组当前未分配的物理 GPU 卡数，同时显示总量、已分配和不可用卡数。
- 队列配额剩余：队列 GPU 配额减去当前已分配量，并按 GPU 型号展示配置的配额。

节点余量最适合 Agent 在启动实验前判断单机是否放得下所需资源；资源组与队列数据则用于判断整体容量和权限。队列配额剩余不等于当前一定可调度的物理卡数。如果队列允许借用，最终可申请量还会受资源组实时物理剩余、GPU 型号和单节点碎片影响。

节点区域上方提供“只看有空闲卡”开关和剩余卡数升序/降序选择。“有空闲卡”同时要求节点可调度且 `remainingGpu > 0`，避免向 Agent 推荐已禁止调度的机器。筛选和排序状态会在每次 10 秒自动刷新后继续生效。

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

查看资源组、队列和逐节点的 GPU/内存/CPU 容量：

```bash
aicp gpu
```

供 Agent 或脚本读取结构化结果：

```bash
aicp gpu --json
aicp gpu --region cn-northwest-3 --json
aicp gpu --only-free
aicp gpu --only-free --sort-gpu desc --json
```

人类可读输出会分别列出资源组物理剩余、队列配额剩余和每台机器的实时余量，并标记机器是否可调度、队列是否允许借用。`--only-free` 只保留可调度且有剩余 GPU 的节点；`--sort-gpu desc|asc` 控制剩余卡数排序，默认 `desc`。Agent 建议使用 `aicp gpu --only-free --sort-gpu desc --json`；逐节点数据位于 `pools[].nodes[]`，关键字段包括 `gpuModel`、`remainingGpu`、`allocatableGpu`、`remainingMemoryGiB`、`allocatableMemoryGiB`、`remainingCpu` 和 `schedulable`。

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

查看训练进程的命令行输出：

```bash
# 最近 200 行；不指定 Pod 时汇总当前所有 Pod
aicp train logs TRAIN_NAME_OR_ID --tail 200

# 持续追踪新输出，适合 Agent 监控正在运行的实验
aicp train logs TRAIN_NAME_OR_ID --follow

# 只看指定 Pod 或角色
aicp train logs TRAIN_NAME_OR_ID --pod POD_NAME --tail 500
aicp train logs TRAIN_NAME_OR_ID --role Worker --since 3600

# 一次性结构化读取，便于 Agent 解析
aicp train logs TRAIN_NAME_OR_ID --tail 200 --json
```

`--tail` 支持 1–10000 行，默认 200；`--since` 限定最近若干秒，最大 604800 秒；`--interval` 控制 `--follow` 的轮询间隔，默认 3 秒。训练任务重名时可添加 `--latest`。JSON 结果的 `logs[]` 中包含 Pod 信息和 `content` 原始输出，`pods[]` 列出当前所有副本。持续追踪使用纯文本流，因此 `--follow` 不与 `--json` 同时使用。

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
- `edge-config/`：AICP 专用且可写的 Edge/Crashpad 配置；`logout --forget` 时删除。
- `remote-ui.json`：远端画面进程与端口；普通 `remote-ui stop` 会保留其中的 Xvfb 会话宿主记录，`stop --all` 后删除。
- `remote-ui-profile.json`：标记无显示器服务器使用的密码存储模式；`logout --forget` 时删除。
- `remote-ui-*.log`：Xvfb、窗口管理器、x11vnc 和 websockify 的最近一次启动日志。

Linux 程序文件与远端 UI 的私有补齐目录不在上述状态目录中，分别位于 `${XDG_DATA_HOME:-$HOME/.local/share}/aicp-cli/app` 和 `${XDG_DATA_HOME:-$HOME/.local/share}/aicp-cli/runtime`。`uninstall.sh --keep-data` 会删除二者，但保留这里的配置、模板和登录资料。

不要将这些数据目录加入 Git，也不要共享给其他人。

## 更新

拉取新版本后重新运行对应安装脚本即可。安装器会先停止正在运行的旧版 AICP Desk GUI，再替换 `app` 与命令入口；不会删除模板、配置或独立 Edge 登录资料。安装完成后重新运行 `aicp gui`。

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
