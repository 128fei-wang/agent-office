# Agent Office

[English](README.en.md) · [架构](docs/ARCHITECTURE.md) · [外部 Agent 配对](docs/PAIRING.md) · [模型 API](docs/PROVIDERS.md) · [AI 三步接入](docs/AI_SETUP.md) · [任务委派](docs/TASK_DELEGATION.md) · [一人公司](docs/COMPANY_OS.md) · [任务工作台](docs/MISSIONS.md) · [MCP 部署](docs/MCP.md) · [2026 趋势](docs/TRENDS.md) · [动画状态机](docs/ANIMATION.md) · [使用指南](docs/GUIDE.md) · [布局说明](docs/LAYOUT.md) · [自行升级](docs/UPGRADING.md) · [事件协议](docs/EVENT_PROTOCOL.md) · [Roadmap](docs/ROADMAP.md)

![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)
![No build step](https://img.shields.io/badge/build-none-brightgreen.svg)
![Python](https://img.shields.io/badge/python-3.9%2B-blue.svg)
![PRs welcome](https://img.shields.io/badge/PRs-welcome-ff69b4.svg)

一个零依赖、本地优先的「多 agent 可视化办公室 + 一人公司 + 任务工作台」：6 个自主协作的 agent 在像素办公室里认领任务、互相评审、开会、处理突发需求，最后把产品发上线；同时提供任务章程、外部 Agent 优先推荐、可编辑职务与头像、逐任务分配、时间与 token 消耗评估、群聊与私聊、文档/图片上传与识别、老板审批门禁、结构化汇报、可追责的工作账本、审计、Trace Lab、Evals、外部 Agent 配对、任务委派、中英文切换、自行升级，以及左侧功能导航栏、群聊/单聊弹窗与 QQ/微信聊天窗口风格、白天/夜间主题和移动端布局。

没有 Node、没有构建步骤、没有外部美术资源。所有角色精灵和办公室都由代码画出来。

![Agent Office](docs/screenshots/office.jpg)

> **Status:** early-stage open-source prototype. 不是生产级可观测平台，也不是真实代码执行沙箱。边界见 [Roadmap](docs/ROADMAP.md)。
>
> **第一次使用？** 看 [使用指南](docs/GUIDE.md)。关闭演示：点右上角 **「关闭演示」**，或左侧 设置 → 演示与预设。

## 快速开始

**方式一：直接打开**

双击 `index.html`，用 Chrome / Safari 打开即可。

**方式二：本地服务（推荐）**

```bash
cd agent-office
./start.sh
# 打开 http://127.0.0.1:5173
# 同时启动 external agent bridge：http://127.0.0.1:8787
```

或者手动启动两个进程：

```bash
python3 serve.py 5173
python3 bridge.py          # 外部 Agent bridge，127.0.0.1:8787
```

## 你会看到什么

- **6 个初始 agent**：产品经理、研究员、设计师、两个工程师、测试。每人有自己的工位、精力、士气、记忆和说话方式；办公室另有 2 个热桌，可通过 UI 增聘到 8 人。
- **自治行为**：认领任务 → 走到工位 → 工作 → 提交评审 → 被退回 / 通过 → 接下一个。
- **协作**：评审、串门聊天、临时会议、阻塞清除会、发布前风险会。
- **意外**：CEO 临时加需求、接口字段对不上、CDN 告警、支付事故……点「制造意外」可以随时再塞一个。
- **完整叙事**：任务看板、白板目标、实时消息流、会议纪要、上线庆祝和彩蛋。
- **可追溯**：每个 agent 认领了什么、调用了哪个 skill/tool、改了哪个文件哪几行、提交/评审/返工/阻塞的完整时间线，都能点开看。
- **可审计**：每个任务带基础工作检查清单（测试、无障碍、性能、安全、回滚、监控…）；审计面板实时汇总「已覆盖 / 风险 / 遗漏 / 待验证」，并给出补齐建议。
- **可导出**：一键导出 Markdown 审计报告或 JSON 原始证据，包含任务、agent、技能、文件行号、评审与遗漏项。
- **两个场景**：「产品发布冲刺」和「支付事故响应」。
- **四个空间**：老板办公室、玻璃会议室、开放工位区、休息区。

### 截图

| Office | Trace Lab |
| --- | --- |
| ![Office](docs/screenshots/office.jpg) | ![Trace Lab](docs/screenshots/trace-lab.jpg) |
| **Audit** | **External appointment & avatar** |
| ![Audit](docs/screenshots/audit.jpg) | ![External profile](docs/screenshots/external-agent-profile.jpg) |
| **Day mode** | **Mobile** |
| ![Day mode](docs/screenshots/day-mode.jpg) | ![Mobile](docs/screenshots/mobile-day.jpg) |
| **Mission Control** | **One-person company** |
| ![Mission Control](docs/screenshots/missions.jpg) | ![Company OS](docs/screenshots/company-os.jpg) |
| **Agent recommendation & per-task executors** | **Usage evaluation** |
| ![Agent recommendation](docs/screenshots/missions-team.jpg) | ![Usage evaluation](docs/screenshots/missions-eval.jpg) |
| **Function navigation rail** | **Group / DM chat popup** |
| ![Function rail](docs/screenshots/feature-drawer.jpg) | ![Chat popup](docs/screenshots/chat-popup.jpg) |
| **真实品牌 Logo** | **首页任务联动** |
| ![Brand logos](docs/screenshots/agent-logos.jpg) | ![Mission live](docs/screenshots/mission-live.jpg) |
| **AI 三步接入** | **测试并启用** |
| ![AI connect](docs/screenshots/ai-connect.jpg) | ![AI test](docs/screenshots/ai-connect-test.jpg) |
| **工具内 AI 状态** | **MCP 部署** |
| ![AI settings](docs/screenshots/ai-tools.jpg) | ![MCP deployment](docs/screenshots/mcp-tools.jpg) |

## 工作可追溯 / 审计

这是这一版最重要的产品能力。模拟不只是「看起来在忙」，而是留下可检查的证据链：

- **任务轨迹**：点任意任务卡，打开 `TASK TRACE` 抽屉。按时间顺序列出认领、阻塞、恢复、技能调用、文件修改、提交评审、退回/返工、通过、完成。
- **技能调用**：每个工作步骤绑定一个 skill 和 tool，例如 `React 实现` + `edit`、`竞品分析` + `web_search`、`E2E` + `playwright`。Agent 档案里会按角色列出技能矩阵和调用次数。
- **代码行号**：工程/测试任务带文件路径、行号范围、增删行数和一段 diff 预览，例如 `src/pages/Home.tsx:24-118 (+86 / −12)`。设计与研究任务展示设计稿帧数或文档行号。
- **基础工作检查**：每个任务按角色挂 4-5 项 Definition of Done，例如测试、无障碍、性能预算、错误态、安全检查、回滚方案。工作步骤覆盖到的项会打勾，没覆盖的项在评审通过后标为「风险」或「遗漏」。
- **审计面板**：右侧 `AUDIT` tab 显示基础工作覆盖率、已评审质量分、风险/遗漏数量、返工次数、`AGENT SHIFT`（每个 agent 的完成/技能/缺口）以及逐条补齐建议。
- **行动流**：底部 `LIVE FEED` 切到「行动」，可以看到全局结构化事件流，不再只是聊天。
- **Agent 档案**：Inspector 里的「完整档案」打开 `AGENT DOSSIER`，看技能矩阵、最近行动、负责任务、触及文件和返工次数。
- **导出**：审计面板底部可导出 `.md`、`.json` 和站会摘要。JSON 里保留完整 ledger、任务检查、agent 技能与文件统计，方便接入真实复盘流程。
- **Trace Lab**：按 `T` 或点 `TRACE` 打开全屏可观测工作台：run / task / event 层级 span、执行时间线、单事件详情、token / cost / duration、回放 scrubber、Evals 和 OTLP 导出。
- **Evals**：7 个确定性断言（完成率、Trace 完整性、代码证据、评审独立性、基础工作质量、发布安全、人类审批），可一键运行并保留评测历史。
- **Human-in-the-loop**：任务完成但发布门禁被风险挡住时，审计面板出现「批准例外发布 / 打回补齐」，人工决策写入 ledger 并改变门禁状态。
- **外部 Agent 接入**：本地 bridge 支持一次性连接码、注册、心跳、事件上报；外部 agent 的 action / skill / tool / file / token / cost 会进入 ledger、Live Feed、Trace Lab 和 OTLP，Team 面板显示 ONLINE / OFFLINE。
- **任务委派与回写**：在任务抽屉里把待办任务派给外部 Agent；外部 Agent 通过 `GET /assignments` 领取、`PATCH /assignments/<id>` 回写进度/完成/失败，任务板、审计和 Trace 同步更新。
- **白天 / 夜间**：顶部太阳/月亮按钮或按 `D` 切换主题；白天模式使用暖色纸张面板和日光洗墙，夜间保持指挥中心配色。主题写入 localStorage。
- **任务工作台**：新建任务即写章程、自动组队和拆解、按技能分配、建任务群；群聊/私聊、文档/图片上传与下载、图片识别、结构化汇报、团队决策和老板审批在同一个工作台完成。任务可按 Agent 过滤并查看当前进度，评审任务可接受、退回、标记阻塞、改派或批量处理；Boss Inbox 显示任务、发起人、时间和审批历史，支持批量审批；对话可搜索，任务可定时执行、复制、归档、导出和删除。`Cmd/Ctrl + K` 可打开全局命令面板，任务进度与审批通过本机 SSE 实时刷新。真实模式保留办公室动画、外部 Agent 工位、真实统计、团队士气和活动流。
- **只有四类事项找老板**：花费、拍板、扫码登录、授权。技术方案、架构、工具、排期、测试和设计取舍由 Agent 讨论解决；把技术问题甩给老板会被 bridge 拒绝。
- **不空岗、不等待**：每个成员都有主任务或真实待命巡检；阻塞汇报必须带解决方案/替代路径；任务记录分配理由和覆盖率。
- **一人公司工作台**：一键生成 8 个 AI 员工、11 个依赖任务、4 个部门频道和每个任务的隔离房间；任务自动派发，依赖完成后自动解锁下一个任务。
- **实时群聊**：bridge 提供 SSE 消息流；创始人、角色 Agent 和系统事件进入各自频道。任务房间要求 `assignmentId + executionId`，防止同一个 Agent 把不同任务的汇报发错群。
- **中英文切换**：顶部 `EN / 中` 或 `?lang=en`；主界面、任务状态、群聊、公司模板和生成内容都支持两种语言。
- **工具与自行升级**：顶部 `工具` / `U` 打开升级中心；可检查官方 GitHub Release，也可选择本地 `.tar.gz` / `.zip` 升级包手动安装。先备份到 `~/.agent-office/backups`，再更新、校验、重启 bridge 并刷新页面；支持失败自动恢复、一键回滚和 `./update.sh` 命令行。
- **常用模型 API**：外部 Agent 弹窗内置豆包、DeepSeek、WorkBuddy、Gemini、Claude、OpenAI、Kimi、Qwen、Ollama；配置一次 bridge 密钥即可「接入」并「试跑」，真实 token/延迟进入 Trace。
- **重命名**：本地 agent 在 Inspector / 完整档案里点 ✎；外部 agent 在外部档案里点「重命名」。本地名字写入 localStorage，外部名字同步到 bridge。
- **进度快照**：`AUDIT` 底部可「保存进度 / 恢复进度」，把当前 world（任务、agent、ledger、会议、历史）存到浏览器 localStorage。刷新后手动恢复，适合演示中途保存现场。

> 说明：文件路径、行号和 diff 是模拟出的工作证据，用于演示「agent 工作可追责」的产品形态；不是从真实仓库读取的 diff。接真实 agent 时，把 ledger 事件换成 Claude Code / Codex / CI 的真实 hooks 即可。

### 深链接

可以直接打开某个视图，方便分享和截图：

```text
?audit=1                打开审计面板
?task=t4                打开任务抽屉
?agent=a4               打开 agent 档案
?theme=day              直接打开白天主题
?company=1              打开一人公司工作台
?lang=en                英文界面
?audit=1&task=t4        组合
```

## 接入外部 Agent

采用一次性连接码模式（参考 ClawChat 的连接码流程）：**你不需要在页面里填 Agent 的 endpoint；生成一段话发给 Agent，让 Agent 自己完成配对。**

1. 启动 `./start.sh`，同时启动网页和 `bridge.py`（默认 `127.0.0.1:8787`）。
2. 左侧 `TEAM` 底部点 **`⇢ 接入外部 Agent`**。
3. 点 **`生成一次性连接码`**，得到 8 位连接码和 `setup.md` 地址。
4. 点 **`复制给 Agent`**，把整段说明发给 Claude Code / Codex / 任意能执行命令的 Agent。
5. Agent 打开 `setup.md`，调用 `POST /pair/<code>/claim` 领取身份。
6. Team 面板的 `WAITING FOR AGENT` 卡片变成外部 Agent 卡片；它发来的问候和后续事件进入 Trace / Feed / 任务轨迹。
7. 点外部 Agent 卡片打开详情，在 **职务与头像** 中选择真实职务（或保持系统自动分工），并选择自动品牌头像、内置头像或自定义缩写/颜色；保存后推荐和任务分配立即使用新职务。

连接码规则：

- 一次性，30 分钟过期
- 每次生成都是新码；旧码在过期前仍可用
- 每个外部 Agent 使用独立连接码和配置
- 没有硬性数量上限
- 连接码只应私下发给对应 Agent，不要公开发布

也可以点 **`启动演示 Agent`** 直接看事件流。手动登记离线档案放在「手动登记离线档案」折叠区。

详细协议见 [docs/PAIRING.md](docs/PAIRING.md)。

### 常用模型 API

外部 Agent 弹窗顶部有 **MODEL APIS** 栏，内置：

- **豆包 / Volcengine Ark**
- **DeepSeek**
- **WorkBuddy**（需要本地 OpenAI 兼容网关）
- **Gemini**
- **Claude / Anthropic**
- **OpenAI**
- **Kimi / Moonshot**
- **通义千问 / DashScope**
- **Ollama**（本地、免 key）

key 只放在 bridge：环境变量，或 `~/.agent-office/providers.json`。这个文件在网页目录之外，不会被 `http.server` 提供；前端、Trace 和导出里都不会出现密钥。

每个配置好的 Provider 可以：

1. **接入**：创建一个 `ext-<provider>` 外部 Agent，并写入问候事件。
2. **试跑**：由 bridge 调用一次模型接口，返回文本、模型名、token 和延迟，并写入 ledger / Trace / OTLP。
3. **刷新**：重新读取 provider 配置，不需要重启 bridge。

示例 `~/.agent-office/providers.json`：

```json
{
  "deepseek": { "apiKey": "sk-...", "model": "deepseek-chat" },
  "gemini": { "apiKey": "...", "model": "gemini-2.5-flash" },
  "workbuddy": { "baseUrl": "http://127.0.0.1:10108/v1", "model": "hy3" }
}
```

![Model APIs](docs/screenshots/model-apis.jpg)

完整配置、各 Provider 的默认 base URL / 模型 / 环境变量、WorkBuddy 本地网关说明和故障排查见 [docs/PROVIDERS.md](docs/PROVIDERS.md)。

> 这些接口是**一次模型调用**，不是完整 coding agent。它们本身不会认领任务；任务委派走下面的 Assignment 协议。

### 委托任务给外部 Agent

1. 在外部 Agent 面板接入一个 Agent（连接码或模型 API 都行）。
2. 在 Sprint Board 点开一个**待办**任务，依赖必须已经完成。
3. 在任务抽屉底部选择外部 Agent，填写任务说明，点 **派发任务**。
4. 任务进入 **进行中**，带 `EXT` 标记；外部 Agent 轮询 `GET /assignments?agentId=...`。
5. Agent 用 `PATCH /assignments/<id>` 回写 `in_progress` / `completed` / `failed`，并附带 `progress`、`result`、`evidence`。
6. 完成后任务进入 **已完成**，但标记为**外部自报完成**；未验证的高优先级检查进入风险，其余进入遗漏，发布门禁会保留这些缺口。

外部 Agent 示例：

```bash
# 领取任务
curl -s 'http://127.0.0.1:8787/assignments?agentId=ext-my-agent'

# 回写进度
curl -X PATCH http://127.0.0.1:8787/assignments/asg-xxxxxxxx \
  -H 'Content-Type: application/json' \
  -d '{"status":"in_progress","progress":60,"result":"hero done, testing"}'

# 回写完成
curl -X PATCH http://127.0.0.1:8787/assignments/asg-xxxxxxxx \
  -H 'Content-Type: application/json' \
  -d '{"status":"completed","progress":100,"result":"12 tests passed","evidence":["tests/12-passed"]}'
```

演示 Agent 会自动推进它的 Assignment，所以不需要真实 Agent 也能看完整流程。


详细协议、状态机和边界见 [docs/TASK_DELEGATION.md](docs/TASK_DELEGATION.md)。

### 演示 Agent

在外部接入弹窗里点 **`启动演示 Agent`**，bridge 会创建一个 `Claude Code · Remote` 外部 agent，并持续发出：
- 读取仓库、修改文件、跑测试、回传风险
- 带 taskId、skill、tool、file、line、tokens、duration 的事件

这些事件会出现在 `TRACE` 里，也可以用 `EXT` 过滤器只看外部 agent。

### 真实外部 Agent API

最推荐的接入方式是连接码：

```bash
# 生成连接码（通常由 UI 完成）
curl -X POST http://127.0.0.1:8787/pair/code \
  -H 'Content-Type: application/json' -d '{}'

# Agent 打开 setup.md 后领取身份
curl -X POST http://127.0.0.1:8787/pair/<code>/claim \
  -H 'Content-Type: application/json' \
  -d '{"name":"My Agent","runtime":"claude-code","skills":["repo-map","edit"]}'
```

也可以手动注册：

```bash
curl -X POST http://127.0.0.1:8787/agents \
  -H 'Content-Type: application/json' \
  -d '{"id":"ext-my-agent","name":"My Agent","runtime":"http","endpoint":"local://my-agent","skills":["edit"]}'

# 心跳（建议 10-30 秒一次）
curl -X POST http://127.0.0.1:8787/agents/ext-my-agent/heartbeat \
  -H 'Content-Type: application/json' -d '{"note":"alive"}'

# 上报事件
curl -X POST http://127.0.0.1:8787/events \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"ext-my-agent","kind":"skill","action":"修改首屏","taskId":"t4","skill":"react","tool":"edit","file":"src/pages/Home.tsx","line":[24,118],"add":8,"del":2,"tokensIn":800,"tokensOut":320}'
```

完整 API：

- `GET /health`
- `GET /company` / `POST /company/bootstrap` / `POST /company/dispatch` / `DELETE /company`
- `GET /rooms` / `GET /messages` / `POST /messages` / `GET /stream?since=N`
- `GET /agents`
- `POST /agents`
- `PATCH /agents/<id>`（重命名 / 更新）
- `DELETE /agents/<id>`
- `POST /agents/<id>/heartbeat`
- `POST /events`
- `GET /events?since=N`
- `GET /update/check` / `GET /update/status`
- `POST /update/apply` / `POST /update/rollback`
- `GET /update/manual/token`
- `POST /update/manual`（原始 tar.gz/tgz/zip/tar 包，80MB 上限）
- `GET /missions` / `GET /missions/overview` / `GET /missions/agents`
- `POST /missions` / `GET /missions/<id>` / `DELETE /missions/<id>`
- `POST /missions/<id>/discuss` / `POST /missions/<id>/tasks/<taskId>/run`
- `GET /mission-tasks?agentId=` / `PATCH /mission-tasks/<id>`
- `GET /conversations` / `POST /conversations` / `GET /conversations/<id>/messages` / `POST /conversations/<id>/messages`
- `GET /approvals` / `POST /approvals` / `POST /approvals/<id>/resolve`
- `POST /files` / `GET /files/<id>` / `GET /files/<id>/raw` / `POST /files/<id>/vision`
- `GET /missions/stream?since=N`
- `GET /assignments` / `GET /assignments?agentId=...`
- `POST /assignments`
- `PATCH /assignments/<id>`
- `DELETE /assignments/<id>`（取消）
- `GET /providers`
- `GET /providers/<id>`
- `POST /providers/<id>/connect`
- `POST /providers/<id>/test`
- `POST /providers/<id>/run`
- `POST /pair/code`
- `GET /pairs`
- `GET /pair/<code>`
- `GET /pair/<code>/setup.md`
- `POST /pair/<code>/claim`
- `DELETE /pair/<code>`
- `POST /demo/start` / `POST /demo/stop`

bridge 只绑定 `127.0.0.1`，不把 API key 放前端；外部 endpoint 目前只是档案字段，真正的 agent 逻辑由你启动的外部进程负责。

### 重命名

- 本地 agent：点击角色 → Inspector 名字旁的 **✎**，或在完整档案里点「重命名」。
- 外部 agent：打开 Team 面板里的外部卡片 → 「重命名」。
- 本地名称写入 `agent-office.names.v1`；外部名称通过 `PATCH /agents/<id>` 写回 bridge。

> 外部事件会进入 Trace/Ledger；任务状态只在显式 Assignment 回写时改变。外部完成是自报完成，不经过本地评审，审计会保留未验证缺口。

## 一人公司 / 实时群聊 / 任务隔离

打开顶部 **`一人公司`**，或在 URL 加 `?company=1`。

### 一键生成

输入公司名、产品/Offer、本周目标、生成语言，点击「生成公司并自动拆解任务」。bridge 会创建：

- 8 个角色：运营操盘手、产品策略、文案、设计、工程师、测试、增长、视频制作
- 11 个带依赖的任务：Offer/ICP、研究、文案、视觉、搭建、埋点、QA、发布、内容、视频、复盘
- 4 个部门频道：创始人会议室、产品与内容、构建与质量、发布与增长
- 每个任务一个独立任务房间
- 无依赖的任务立即创建 Assignment；依赖完成后自动派发下一个任务

角色是 `opc-<role>` 工位。点击角色卡片上的「连接 Agent」，生成绑定角色的连接码，把 setup 消息发给 Claude Code / Codex / 其他 worker；它领取后会以该角色身份工作，并轮询自己的 assignments。

### 群聊和隔离

- 创始人可以在任意频道发消息。
- 角色 Agent 通过 `POST /messages` 发消息；任务房间必须同时带对 `roomId`、`assignmentId`、`executionId`、`agentId`。
- 同一个 Agent 同时做两个任务时，两个 Assignment 有不同 `executionId` 和任务房间；发错房间、用错 executionId 或冒充其他 Agent 都会被 bridge 拒绝。
- 实时消息走 `GET /stream?since=N`（SSE），浏览器通过 EventSource 自动重连。
- 任务完成/进度会写入系统消息，并同步到任务看板。

详细协议、角色表、依赖图和限制见 [docs/COMPANY_OS.md](docs/COMPANY_OS.md)。

### 中英文

- 顶部 `EN / 中` 切换界面语言，公司工作台内部也有语言按钮。
- `?lang=en` / `?lang=zh` 可直接打开对应语言。
- 公司模板的角色、任务、任务说明会按生成语言写入；界面标签可随时切换。
- 仿真叙事和任务正文属于内容层，保留原始语言。

## 任务工作台

打开顶部 **`任务`**，或访问 `?missions=1`。

- **新建任务**：填写描述、验收标准、优先级、截止日期、预算，上传文档/图片。
- **真实外部 Agent 优先推荐**：只要已接入真实外部 Agent，推荐池就只使用这些 Agent，不再用默认系统角色占位；没有外部 Agent 时才回退到系统角色。系统默认分工仍然保留，内置角色仍可手动勾选，也可以按任务逐个指定执行 Agent。
- **可编辑职务任命**：外部 Agent 详情里可选择“系统自动分工”或总协调、产品、设计、工程、QA、增长、内容、视频、执行等职务；选择后推荐和任务分配按这个职务匹配，未设置时保持原来的技能推断逻辑。
- **真实品牌 Logo / 自定义头像**：Codex、Claude、WorkBuddy、Gemini、DeepSeek、豆包、Kimi、Qwen、Ollama、OpenAI 等自动显示对应品牌 Logo（内置 SVG，离线可用）；未知 Agent 回退到缩写。也可以从系统内置头像（机器人、狐狸、猫头鹰、猫、火箭、星星、幽灵、像素怪、闪光、工匠、负责人）中选择，或自定义 1–2 个字符和颜色。
- **推荐与逐任务执行者**：候选卡显示职务、技能、匹配度和预计耗时/token；系统按技能、职务、在线状态和当前负载给出每个任务的 Top 3，并默认落到具体外部执行者。
- **自动组队与拆解**：按技能选人、生成依赖任务、记录分配理由；每个成员都有主任务或真实待命巡检，避免空岗。
- **任务群 / 群聊 / 私聊**：任务自动建群；也可以单独建群或和任一 Agent 私聊。
- **文件与图片**：支持文本、Markdown、CSV、JSON、HTML、DOCX、XLSX、PDF 和图片；图片可按需调用视觉模型或 `tesseract` 识别。
- **规则前置**：任务章程、验收、老板门禁和汇报格式写入任务群；技术问题必须团队解决，不能原样甩给老板。
- **老板审批**：花费、拍板、扫码登录、授权四类进入审批箱；审批前不执行，审批一次性生效。
- **结构化汇报**：已完成 / 下一步 / 风险 / 解决方案 / 证据；缺少解决方案或把技术问题列入老板门禁会被拒绝。
- **Agent 讨论/执行**：配置模型服务后可在同一条任务线程里讨论并让虚拟角色执行任务、产出交付物；外部 Agent 可用 `/mission-tasks` 协议领取和回写。
- **消耗评估**：每个任务有预计/实际耗时、预计/实际 token、Agent 负载和截止风险；Eval 面板显示任务差异、Agent 消耗和 AI 讨论开销，汇报卡片直接显示本次 token 与延迟。

完整规则、API 和外部 Agent 协议见 [docs/MISSIONS.md](docs/MISSIONS.md)。

## 左侧导航栏与聊天弹窗

左侧新增独立 **功能导航栏**，图标从上到下为：

- **工作**：任务中心、一人公司、拉会、制造意外、重置模拟。
- **人脉**：添加好友（本地 Agent）、添加外部 Agent。
- **创建**：创建群组、任务管理 / 创建任务。
- **设置**：工具（含 AI / MCP 部署）、设置、主题、语言。
- **消息**：群聊弹窗、单聊弹窗。

顶部栏只保留场景选择、暂停/速度等运行控制，不再重复任务、公司、工具、主题、语言等入口。点击左侧图标会打开旁边的浮动操作面板；底部 **☰** 打开完整功能抽屉。设置面板里还有 **聊天窗口风格** 切换：

- **Agent**：Agent Office 默认外观。
- **QQ**：紧凑聊天窗口、蓝色标题栏和气泡。
- **微信**：微信式绿色标题栏和气泡。

群聊弹窗 / 单聊弹窗是独立浮窗，支持现有任务群、临时群和私聊，消息走本地 bridge；窗口右上角的 **风** 按钮可以随时切换 QQ / 微信风格。风格只改变外观，不改变消息内容。

## AI 三步接入与全自动执行

打开 **工具 → AI 模型服务 → 3 步接入 AI**，或直接点 Mission Control 里的 **AI 设置**：

1. **选服务**：豆包、DeepSeek、WorkBuddy、Gemini、Claude、OpenAI、Kimi、Qwen、Ollama；本机已检测到的凭据和已配置服务排在最前。
2. **填连接**：复用本机环境、粘贴 API Key，或展开高级设置修改模型和接口地址。
3. **测试并启用**：bridge 发起一次真实最小调用；测试通过后才写入配置，失败不会覆盖旧配置。

bridge 现在会识别 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL` 等本机环境变量，不再出现“明明有凭据却显示 AI 不可用”。密钥只写入本机 `~/.agent-office/providers.json`（权限 `0600`），不进入浏览器存储、任务记录、日志或仓库。

创建任务时勾选 **创建后全自动执行（讨论 → 分配 → 执行 → 汇报）**。每个任务顶部还有常驻状态条：讨论、审批、执行、汇报四个阶段一目了然，并明确显示「需要你操作」还是「无需操作」。讨论完成但未启动的任务直接点 **开始执行 N 个任务**；还没有计划的点 **讨论并执行**，一次完成讨论和启动。只有花费、拍板、扫码登录、授权四类老板门禁会暂停，批准后自动继续。详细规则见 [docs/AI_SETUP.md](docs/AI_SETUP.md)。

## 关闭演示与预设：只使用真实 Agent

**设置中心 → 演示与预设**（左侧设置菜单、功能抽屉和工具面板里也有入口）可以一键关闭本地演示：

- 暂停办公室模拟，隐藏 6 个本地预设角色、剧本任务、模拟看板和演示 Agent。
- 停止并移除演示 Agent（`ext-demo-claude`），保留真实外部 Agent、真实任务、上传文件、审批和汇报。
- 任务推荐和新建任务只使用已接入的真实外部 Agent，不再回退到系统预设角色。
- 首页切换成 REAL OPS：显示 AI 状态、进行中的真实任务、真实外部 Agent 和「创建真实任务」入口；外部 Agent 离线只表示没有心跳，仍可由本机 AI 按分配身份执行。可随时恢复演示。

## 任务上下文、Token 上限与自动重试

- **上下文记忆**：AI 讨论和任务执行会读取本任务的上传文件 / OCR 文本、团队决策、已完成任务汇报、证据和已批准门禁。上下文被标记为不可信资料，不能覆盖规则、泄露密钥或绕过审批。
- **Token 上限**：创建任务时可填写 Token 上限（0 / 留空表示不限）。讨论和任务消耗都会计入；达到上限时自动执行会停止，并在任务评估里给出已用 / 上限；调整后可从命令条继续。
- **失败重试**：单个任务执行失败会自动重试一次，再失败才中断，失败与重试都会写入任务群和审计记录。

2026 趋势、缺口和下一阶段路线见 [docs/TRENDS.md](docs/TRENDS.md)。

## 任务与动画联动

- 完成庆祝是一次性动画：3 个 tick 后角色回到空闲，继续聊天、喝咖啡、散步、回看板，不会在「庆祝中」定格好几分钟。
- 工作 / 评审中的角色脚下有任务进度条，团队卡显示 `任务 · NN%`；空闲、聊天、评审也有各自的细微动画。
- 24 tick 无进展的任务会被看门狗重新指派；没人跟进的会放回看板，并记录到 feed 和审计。
- 真实任务自动执行时，首页 MISSION LIVE 和热桌卡显示当前任务已运行时间，并提供直接停止按钮。
- SHIPPED 横幅有「新一轮」按钮，可立即重置当前场景。
- 真实任务全部完成后，命令条和概览出现 **开启下一轮**：复用团队，带上上一轮交付物、决策和汇报作为上下文，并沿用之前的自动执行方式。

细节与参考案例见 [docs/ANIMATION.md](docs/ANIMATION.md)。

## MCP 部署

工具面板新增 **MCP 部署**，让 Agent Office 本身作为本地 MCP 服务：

1. 打开 **工具 → MCP 部署**。
2. 选择已有外部 Agent，或点 **创建 MCP Agent**。
3. 工具会生成 MCP 客户端配置，复制到 Claude Code、Codex 或其他支持 MCP 的客户端。
4. 点 **测试 MCP** 可验证 initialize / tools/list 与工具数量。

Endpoint 是 `http://127.0.0.1:8787/mcp`，通过 `X-Agent-Id` 绑定 MCP 客户端对应的 Agent 身份。已提供工具：

- `agent_office_status`
- `agent_office_list_agents`
- `agent_office_list_tasks`
- `agent_office_get_task`
- `agent_office_report_task`
- `agent_office_send_message`
- `agent_office_list_conversations`

MCP 和配对码、模型 API 一样，是外部 Agent 的连接方式之一；Bridge 仍然只监听 localhost。

## 自行升级

- 顶部 **`工具`**，或按 `U`，打开「工具与升级」。
- **自动升级**：点击 **检查更新**，bridge 读取官方 GitHub Release 并与本地 `VERSION` 比较；有新版本时显示发布日期和更新内容，确认后自动备份、更新、校验、重启 bridge。
- **手动升级**：在同一个面板选择本地的 `.tar.gz`、`.tgz`、`.zip` 或 `.tar` 包。适合离线或自动检查失败时使用；只接受比当前版本更高的包。压缩包会拒绝路径穿越、符号链接、加密包、超大文件和缺少必要文件的包。
- Git 部署使用干净的 `git pull --ff-only`；有未提交修改时拒绝覆盖。
- 最近一次可回滚备份（版本不同于当前）可在同一面板 **回滚**；数据目录 `~/.agent-office` 不会被更新覆盖。
- 面板底部提供命令行和备份路径：

```bash
./update.sh --check
./update.sh --apply
./update.sh --manual release.tar.gz
./update.sh --rollback
```

安全模型、API、失败处理和首次从 1.2.0 手动升级到 1.3.0 的说明见 [docs/UPGRADING.md](docs/UPGRADING.md)。

## 怎么添加 Agent

### 用界面添加（推荐）

1. 左侧 `TEAM` 面板底部点 **`＋ 添加 Agent`**。
2. 填写名字、角色、性格/备注，选发型和配饰；右侧会实时预览像素形象。
3. 系统自动分配空热桌（`d7` / `d8`），点 **`入职并创建任务`**。
4. 新 agent 会出现在办公室、Team 列表和 Trace 里，并自动获得一条 **onboarding 任务**（熟悉工具链与看板），随后进入正常任务流。
5. 入职信息写入 `localStorage`（`agent-office.hires.v1`）；刷新后会自动恢复，并在场景重置时自动生成 onboarding 任务。

当前办公室支持 **最多 8 个 agent**（6 个固定工位 + 2 个热桌）。热桌满后按钮仍可打开，但提交会被禁用。

### 改代码添加固定 agent

1. 在 `src/data.js` 的 `AO.AGENTS` 里加角色定义（id、name、role、deskId、配色、发型、配饰、性格）。
2. 在 `AO.DESKS` 里加一个工位；`hot: true` 表示热桌，`w` 可覆盖默认 90px 宽度。
3. 在 `AO.START_POSITIONS` 里按相同索引加初始位置。
4. 如果需要新职能，在 `AO.ROLES` 和 `AO.ROLE_SKILLS` 里补角色与技能。
5. 跑 `dev-paths.html` / `dev-check.html`，确认新工位没有把角色卡进家具。

> 热桌会同时进入 `AO.OBSTACLES`，所以加位置后一定要跑路径自检。

## 参考的 GitHub 工具与取舍

这一版的核心工具升级不是凭空加的，主要参考了这些项目的产品结构：

| 项目 | 借鉴的能力 | 在我们的实现 |
| --- | --- | --- |
| [langfuse/langfuse](https://github.com/langfuse/langfuse) | Trace / session / cost / evals / OTel | Trace Lab 的 run、span、token、cost、Evals 和 OTLP JSON |
| [AgentOps-AI/agentops](https://github.com/AgentOps-AI/agentops) | Session replay、step-by-step execution graph、cost | 回放 scrubber、任务/事件时间线、模拟 token/cost |
| [Arize-ai/phoenix](https://github.com/Arize-ai/phoenix) | OpenTelemetry tracing、evaluation、experiment | OTLP 导出、确定性 eval 断言、评测历史 |
| [raga-ai-hub/RagaAI-Catalyst](https://github.com/raga-ai-hub/RagaAI-Catalyst) | Timeline + execution graph、tool utilization、TRACE 管理 | 任务时间线、tool/skill 调用统计、span detail |
| [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph) | Durable execution、human-in-the-loop、state transitions | replay cursor、人工审批门禁、状态重建 |
| [openai/openai-agents-python](https://github.com/openai/openai-agents-python) | Handoffs、guardrails、human-in-the-loop、tracing | handoff/评审事件、基础工作 guardrails、Trace |
| [humanlayer/humanlayer](https://github.com/humanlayer/humanlayer) | 人类审批和 coding agent 控制面 | 批准例外 / 打回发布，决策进入 ledger |
| [All-Hands-AI/OpenHands](https://github.com/All-Hands-AI/OpenHands) | 多 backend 控制中心、session、automation | Trace Lab 作为独立控制面，可接真实事件 |
| [Aider-AI/aider](https://github.com/Aider-AI/aider) | repo map、lint/test、git diff | 文件/行号/diff 证据和 verification 检查 |
| [SWE-agent/SWE-agent](https://github.com/SWE-agent/SWE-agent) | Agent-Computer Interface、trajectory | 结构化行动轨迹与 tool/file 证据链 |

取舍：没有直接嵌这些平台（它们需要后端、数据库和 API key），而是把最有价值的产品原语做成本地零依赖版本；事件模型按 OTel/GenAI 语义设计，后续可以接真实 bridge。

## 办公室空间

- **老板办公室**：独立玻璃间，带城市窗景、双屏 exec 桌、真皮会客沙发 + 单人皮椅 + 茶几、私人酒柜、`FOUNDER'S CLUB` 奖杯墙、书架、地毯、落地灯和“老板在岗”指示灯。门是开的，老板会自己走出去评审、开会、喝咖啡，再回来。
- **秘书位**：老板办公室门口的独立行政助理位，有专属地毯、秘书台、显示器、电话和名签。秘书“小满”是静态办公室 NPC，不参与任务模拟。
- **会议室**：玻璃隔断、投影屏、六人会议桌、绿植。开会时玻璃会亮起 `LIVE`。
- **开放工位区**：5 个工位、绿植隔断、服务器机柜、书架、打印机、暖光台灯。
- **休息区**：沙发、猫、咖啡机、豆袋、落地灯、懒人毯。

视觉上用了暖色木地板、分层地毯、顶灯光池、随模拟时间变化的墙钟、角色脚下阴影、昼夜色调和代码生成的像素家具。所有美术元素都是 CSS/SVG，没有外部图片依赖。

## 特效层

参考了“AI 集群指挥中心”式的数据可视化风格，在像素办公室上加了一层可开关的特效：

- **房间网络**：CEO、EA、TASK、OPS、MEET、LNG 六个节点之间是低对比度**地面蚀刻实线 + 单颗流动光点**，不使用虚线、模糊双线或阴影光晕。
- **实时连线**：只在真实协作发生时出现一条「细基线 + 短光弹」的 crisp beam；评审紫、会议琥珀、聊天粉、阻塞红。
- **路线替代方案**：原来的常驻虚线网和大圆环投影会像“地上的阴影轨迹”，现在改为“蚀刻线 + 信号弹”；想完全隐藏时按 `X` 关掉 FX。
- **节点光环**：每个 agent 脚下有角色色能量环；工作中、评审中、开会中会变亮并流动。
- **会议雷达**：会议进行时，会议桌出现旋转雷达、双环、中心脉冲和从座位到桌心的连线。
- **工位光柱**：有 agent 在工位工作时，桌面升起角色色光柱，屏幕增亮。
- **氛围**：蓝/紫/暖分区光、体积光柱、全息网格、扫描带、电影颗粒、漂浮数据粒子、四角 HUD 框和 `SIM NET ONLINE` 状态条。
- **事件脉冲**：任务完成、会议开始、项目上线时，会在对应位置扩散发光圆环。
- **实时数据**：底部 LOAD 曲线是每 tick 的真实负载历史，不是装饰。
- **开关**：顶部 `◈` 按钮或按 `X`。关闭后隐藏网络层，只保留原办公室，性能更好。

整页走“夜班指挥中心”配色：老板办公室保留暖金，会议室冷青，工位区深青，休息区紫罗兰。开放工位下方有一圈缓慢旋转的全息指挥甲板，桌面有角色色光晕。

打开页面会先播放一段 `AGENT OPS` 开机序列，再揭开办公室；调试时加 `?intro=0` 可跳过。

所有特效都是 CSS/SVG，没有引入 Canvas 库或额外依赖。

## 白天 / 夜间与移动端

- 顶部 **☀ / ☾** 按钮切换主题，快捷键 `D`，选择写入 `agent-office.theme.v1`。
- 白天模式把面板、抽屉、Trace Lab、外部 Agent 弹窗改成暖色纸张质感，并给办公室加一层日光洗墙；夜间保持原来的指挥中心配色。
- 主题只使用 CSS，没有引入图片或 Canvas。
- 移动端采用单列布局：办公室、Feed、Team、Board 依次排列；顶部控制条横向滑动；任务/Agent 抽屉、Trace Lab、外部 Agent 弹窗在 390px 宽度下都占满视口。
- 白天和移动端截图见上方截图表。

```text
?theme=day                  直接打开白天主题
?theme=night                直接打开夜间主题
```

## 操作

| 操作 | 说明 |
| --- | --- |
| 暂停 / 继续 | 顶部按钮，或空格键 |
| 1× / 2× / 4× | 模拟速度，或按 `1` `2` `4` |
| 拉个会 | 立刻召集一场临时对齐会，按 `M` |
| 制造意外 | 随机插入一个新任务，按 `E` |
| 重置 | 回到 Day 1 09:00 |
| 点击角色 | 打开 Agent Inspector，查看状态、任务和最近记忆 |
| 点击任务卡 | 打开 `TASK TRACE`：技能、文件行号、diff、评审与基础工作 |
| 添加 Agent | TEAM 面板底部 `＋ 添加 Agent`，最多 8 人 |
| 接入外部 Agent | TEAM 面板底部 `⇢ 接入外部 Agent`，走本地 bridge |
| 委托任务 | 打开待办任务 → 选择外部 Agent → 派发任务 |
| 白天 / 夜间 | 顶部主题按钮，或按 `D` |
| 任务工作台 | 顶部 `任务`，或 `?missions=1` |
| 一人公司 / 群聊 | 顶部 `一人公司`，或按 `C` |
| 中英文 | 顶部 `EN / 中`，或 `?lang=en` |
| 工具 / 升级 | 顶部 `工具`，或按 `U`，或 `?update=1` |
| 重命名 | Inspector / 完整档案里的 ✎；外部 agent 在外部档案里重命名 |
| 审计 tab / `A` | 打开/关闭 `AUDIT` 面板 |
| AUDIT 保存/恢复 | 手动保存或恢复当前模拟进度（localStorage） |
| 行动流 / `L` | 把底部 feed 切到结构化工作日志 |
| Trace Lab / `T` | 打开 run → task → event 的 trace、时间线、回放和 Evals |
| AUDIT 人工审批 | 任务全部完成后，批准例外发布或打回补齐 |
| 全屏按钮 / `F` | 把办公室放大到全屏，方便看角色走动 |
| 特效开关 `◈` / `X` | 开关指挥中心特效层 |
| `Esc` | 关闭任务/agent 抽屉 |

调试参数（可选）：

```text
?ticks=60&speed=2            直接快进 60 个 tick
?scenario=incident           直接进入事故场景
?ticks=150                   直接看上线庆祝
?intro=0                     跳过开机动画
?audit=1                     直接打开审计面板
?task=t4                     直接打开某个任务轨迹
?agent=a4                    直接打开某个 agent 档案
?trace=1                     直接打开 Trace Lab
?trace=evals                 直接打开 Trace Lab 的 Evals
?hire=1                      直接打开 Add Agent 表单
?external=1                  直接打开外部 Agent 接入面板
?theme=day                   直接打开白天主题
?company=1                   直接打开一人公司工作台
?missions=1                  直接打开任务工作台
?update=1                    直接打开「工具与升级」
?lang=en                     英文界面
```

## 目录结构

```text
agent-office/
├── index.html          页面骨架
├── styles.css          全部视觉样式（像素办公室 / 面板 / 动画）
├── src/
│   ├── data.js         角色、工位、场景、任务、台词、事件
│   ├── sprites.js      代码生成的像素角色 SVG
│   ├── engine.js       模拟引擎：状态机、任务、评审、会议、寻路
│   ├── fx.js           可开关的蚀刻路线 / 信号弹 / 会议雷达 / 粒子层
│   ├── trace.js        Trace Lab：span、时间线、回放、Evals、OTLP
│   ├── hiring.js       Add Agent 表单、热桌分配、localStorage 持久化
│   ├── i18n.js         中英文词典、语言切换
│   ├── external.js     外部 Agent 连接、配对、任务委派、心跳轮询、重命名
│   ├── company.js      一人公司模板、角色、任务、群聊、SSE、隔离校验
│   ├── update.js       工具面板、自动/手动升级、进度、重启检测、回滚
│   ├── missions.js     任务工作台、群聊/私聊、文件、审批、AI 讨论/执行
│   ├── shell.js        左侧导航栏、群聊/单聊弹窗、设置和聊天窗口风格
│   ├── render.js       DOM 渲染、办公室搭建、面板更新
│   └── main.js         启动、循环、控件、快捷键
├── dev-check.html      跑完两个场景并输出断言结果
├── dev-trace.html      输出逐 tick 的状态变化，排查卡死
├── dev-consistency.html 检查角色状态和任务状态是否一致
├── dev-actions.html    自检「制造意外」和完成后再插任务
├── dev-paths.html      检查角色是否会走进桌子/墙里
├── dev-path-debug.html 输出寻路失败点和非法目标点
├── dev-fx.html         自检特效开关
├── dev-audit.html      自检任务轨迹、技能、diff、审计、导出
├── dev-tracelab.html   自检 trace、回放、Evals、人工审批、OTLP
├── dev-hiring.html     自检 Add Agent、热桌、onboarding、刷新恢复
├── dev-external.html   自检 bridge、外部事件、重命名、职务、头像、OTLP
├── dev-delegation.html 自检外部任务委派、进度、回写、审计
├── dev-theme.html      自检白天/夜间、主题持久化、移动端布局
├── dev-company.html    自检一人公司、任务派发、群聊、隔离、自动解锁
├── dev-i18n.html       自检中英文切换和持久化
├── dev-update.html     自检工具入口、自动升级、确认、进度、重启和完成态
├── dev-update-manual.html 自检本地升级包选择、上传、进度和完成态
├── dev-missions.html   自检任务、群聊、私聊、附件、审批、无空岗和汇报
├── dev-features.html   自检功能抽屉、群聊/单聊弹窗、设置和聊天风格
├── dev-ai-setup.html   自检 3 步 AI 接入、环境凭据、测试保存和任务自动执行
├── dev-mission-live.html 自检首页 MISSION LIVE、外部 Agent 热桌和任务气泡
├── dev-demo-mode.html  自检演示关闭、真实模式、只推荐外部 Agent 和恢复
├── dev-activity.html   自检任务进度条、完成后动画循环和「新一轮」
├── dev-guide.html      自检右上角演示开关、使用指南和快捷入口
├── trace.css           Trace Lab / Evals / 审批样式
├── hiring.css          Add Agent / 热桌样式
├── external.css        外部 Agent / 重命名 / 委派样式
├── theme.css           白天主题、Trace Lab 明色皮肤、移动端样式
├── company.css         一人公司工作台 / 群聊 / 语言样式
├── update.css          工具与升级面板样式
├── missions.css        任务工作台 / 群聊 / 私聊 / 审批样式
├── demo-mode.css       演示关闭 / REAL OPS 首页 / 真实任务看板样式
├── features.css        功能栏 / 聊天弹窗 / 设置 / 聊天窗口风格样式
├── bridge.py           外部 Agent 本地 bridge（配对 / 模型 API / 任务 / 文件 / 审批 / 升级）
├── missions.py         任务章程、自动分配、群聊、文件、审批和汇报规则
├── ocr_vision.swift    macOS Vision 本地图片识别兜底
├── updater.py          检查、下载、手动包、备份、更新、校验、回滚
├── update.sh           命令行升级入口（含 --manual）
├── providers.example.json  模型 API 配置模板（密钥不提交）
├── tests/test_bridge.py bridge 集成测试（stdlib unittest）
├── tests/test_updater.py 更新器单元测试
├── tests/test_missions.py 任务规划、汇报、审批和文件提取测试
├── tests/test_context.py 任务上下文、Token 预算和提示安全测试
├── docs/PROVIDERS.md   模型 API 配置与故障排查
├── docs/TASK_DELEGATION.md 外部任务委派协议与状态机
├── docs/COMPANY_OS.md  一人公司模板、群聊、任务隔离
├── docs/MISSIONS.md    任务工作台、自动分配、审批、文件与 Agent 协议
├── docs/TRENDS.md      2026 Agent 平台趋势、差距与本项目路线
├── docs/ANIMATION.md   任务联动、完成态一次性动画和空转看门狗
├── docs/GUIDE.md       使用指南：关闭演示、接 Agent、AI、任务与下一轮
├── docs/UPGRADING.md   自行升级、备份、回滚和安全边界
└── start.sh            本地静态服务器 + bridge
```

## 引擎怎么工作

每个 tick（默认约 850ms，随倍速缩短）：

1. 触发到点的事件（发言、会议、阻塞、新任务）。
2. 推进会议：参与者走到会议桌，入座，每隔一 tick 有人说一句，结束后产出会议纪要并解除阻塞。
3. 每个 agent 按状态机行动：
   - `idle` 时按优先级决策：恢复自己的任务 → 评审 → 认领同角色任务 → 老板回办公室看板 → 找人聊天 / 闲逛。
   - `working` 时推进进度、消耗精力；按进度触发 work plan 里的 skill 调用，记录文件/行号/diff，并勾选覆盖到的基础工作；进度满后提交评审。
   - 精力低于阈值会去咖啡机，回来继续。
   - 评审人走到作者工位，1 tick 后通过或退回。通过时把未覆盖的高优先级检查标为「风险」、其余标为「遗漏」；退回时会挑一项缺口返工补齐，并写入 ledger。
4. 管理者做站会播报；所有任务完成后全员去休息区庆祝。
5. 每个有意义的动作写入 `world.ledger`：认领、skill/tool、文件修改、交接、评审、返工、阻塞、会议、决策、完成、评测、人工审批。审计面板从这里和任务检查清单推导。
6. Trace Lab 把 ledger 投影成 run → task → event 三层 span，并为每个 span 生成可复现的模拟 duration/token/cost；Evals 从同一份状态计算 7 个确定性断言。

寻路用的是「直线可视 + 走廊 hub」的轻量方案：直线撞到桌子/玻璃墙就依次尝试 1~4 个中继点，最多经过四个中继点。目标点如果落在障碍里（比如社交点刚好在会议桌边），会先自动寻找最近的合法落点。没有引入任何图算法库。

升级后的办公室有玻璃隔断，所以 `AO.HUBS` 里专门加了老板办公室门口、会议室门口、两排工位之间的通道节点。`dev-paths.html` 会逐 tick 检查角色是否进入任何障碍矩形，当前是 0 次穿墙。

## 怎么改

### 加固定 agent / 工位

直接用上面的「怎么添加 Agent → 改代码添加固定 agent」。运行时加人不需要改代码；只有要突破 8 人上限或新增角色类型时，才需要扩 `AO.DESKS` / `AO.AGENTS` / `AO.ROLES`。

### 加一个场景 / 任务

在 `AO.SCENARIOS` 里复制一个场景，改 `goal`、`tasks` 和 `events`。

任务字段：

```js
{
  id: "t1",
  title: "竞品与用户调研",
  role: "research",       // 谁适合接
  effort: 5,              // 进度条速度
  priority: 3,            // 同角色任务排序
  deps: ["t0"],           // 依赖，全部 done 才可认领
  desc: "备注"
}
```

事件支持：

- `say`：某个 agent 发言
- `meeting`：召集会议
- `newTask`：插入任务
- `blocker`：把某角色的进行中任务设为阻塞并开会
- `when`：条件（`t1done` / `t3done` / `t6done` / `t7done` / `engineerActive`），避免固定 tick 导致会议开得太早

### 加工作步骤 / 检查项

- 在 `AO.WORK["场景:任务"]` 里给任务加工作步骤：`skill`、`tool`、`action`、`file`、`line`、`add`、`del`、`checks`、可选 `diff`。
- 在 `AO.CHECK_TEMPLATES[角色]` 里定义该角色的基础工作检查项；`severity: "high"` 会在评审通过后进入「风险」列。
- 在 `AO.SKILL_CATALOG` 里注册技能名，在 `AO.ROLE_SKILLS` 里配置每个角色拥有的技能。
- 在 `AO.CHECK_ACTIONS` 里写每项缺口的补齐建议，审计面板和导出报告会直接引用。

### 接真实 agent 事件

把 `Engine.recordEvent()` 当成统一事件入口：

```js
engine.recordEvent({
  agentId: "a4",
  taskId: "t4",
  kind: "skill",              // claim | skill | handoff | review | rework | risk | ...
  action: "调用 Claude Code 修改首屏",
  skill: "react",
  tool: "edit",
  file: "src/pages/Home.tsx",
  line: [24, 118],
  add: 86,
  del: 12,
  diff: ["- ...", "+ ..."],
  checks: ["error-states"]
});
```

真实接入时，由本地 bridge 把 Claude Code hooks、CI 结果、测试报告转成这种事件；前端只负责展示和审计，不接触 API key。同一个事件模型也会投影成 OTel/GenAI span，可导出给 Phoenix / Langfuse 等平台。

## 接真实 LLM（下一步）

当前是**规则驱动的自治模拟**，优点是零依赖、行为稳定、随时可演示。真正的 LLM 决策层不需要改可视化，只需要替换引擎里的两个地方：

1. `decide(agent)`：把规则决策换成一个异步 `brain.decide(agent, world)`，返回 `{ action, target, taskId, speech }`。
2. `say(agent, context)`：把模板台词换成 LLM 生成的一句话（限制长度，避免气泡爆炸）。

建议架构：

```text
浏览器模拟引擎
   ↓ 每 tick 把「当前 agent + 任务板 + 最近对话」发给本地 bridge
本地 bridge（Python / Node）
   ↓ 调 Claude API（claude-opus-5-5）或 Ollama
   ↓ 返回结构化决策 JSON
浏览器应用决策
```

注意：

- **不要把 API key 放在前端**，走本地 bridge。
- 给 LLM 返回**结构化 JSON**（动作 + 目标 + 台词），不要让模型直接改世界状态。
- 保留规则引擎作为 fallback：LLM 超时/报错时继续用规则决策，演示不会卡住。
- 一次只让 1-2 个 agent 调 LLM，其余用规则，控制成本和延迟；会议发言可以按轮次调用。

## 自检

```bash
# 需要本地服务器
open http://127.0.0.1:5173/dev-check.html
```

页面会跑完两个场景并输出：

- 是否在 300 tick 内完成
- 每个任务的最终状态
- 会议数、评审数、咖啡次数
- 是否有未完成任务

`dev-trace.html` 会输出逐 tick 的任务/角色状态变化，方便定位「为什么某个 agent 一直不干活」。

`dev-consistency.html` 会检查「角色在工作但任务不在进行中」这类状态不一致；`dev-actions.html` 验证「制造意外」按钮在运行中和完成后的行为；`dev-paths.html` 检查穿墙/穿桌子；`dev-path-debug.html` 输出寻路失败点。

`dev-audit.html` 会跑完整场景并验证：任务轨迹、技能/文件行号、diff、基础工作检查、审计面板、Agent 档案、行动流、Markdown/JSON/站会导出、localStorage 快照保存与恢复。支持 `?scenario=incident` 切到事故场景。

`dev-tracelab.html` 会验证 Trace Lab 的 span 树、执行时间线、事件详情、回放 cursor、7 个 Evals、评测历史、OTLP/Trace/Evals 导出，以及人工批准 / 打回对门禁的影响。

`dev-hiring.html` 会验证 Add Agent 表单、热桌分配、onboarding 任务、路径不穿家具、localStorage 持久化和刷新恢复。

`dev-external.html` 会验证 bridge 健康、一次性连接码生成 / 取消 / 领取、一次性约束、外部 Agent 改名 / 移除、职务任命、内置/自定义头像、演示事件、Trace `EXT` 过滤、OTLP 外部 span，以及本地重命名持久化。

`dev-delegation.html` 会验证外部任务委派、进度回写、完成回写、自报完成标记、风险/遗漏、审计保留、Trace claim/complete 事件和清理。

`dev-theme.html` 会验证白天/夜间切换、主题持久化、`D` 快捷键，以及 390px 宽度的移动端布局、任务抽屉、Trace Lab 和外部 Agent 弹窗。

`dev-company.html` 会验证一人公司模板生成、8 角色 / 11 任务 / 15 房间、自动派发、角色连接码、群聊、任务房间隔离、完成回写、依赖解锁和中英文切换。

`dev-i18n.html` 会验证主界面/公司界面的英文切换、`?lang`、持久化和刷新恢复。

`dev-update.html` 会验证工具入口、自动升级、手动升级区、文件选择、备份、确认、进度、重启检测和完成态。

`dev-update-manual.html` 会验证本地升级包选择、文件上传、token/文件名请求头、进度和完成态。

`dev-missions.html` 会验证任务创建、自由选人、推荐卡片、逐任务执行 Agent、品牌 Logo、预计/实际消耗、Eval 面板、自动组队/拆解、无空岗、文档/图片附件、任务群、群聊、私聊、审批、汇报必须带解决方案、技术问题不能升级给老板和清理。

`dev-features.html` 会验证左侧导航栏、六项功能、添加好友/外部 Agent 入口、群聊弹窗、单聊弹窗、设置中心、AI 设置和 MCP 部署。

`dev-ai-setup.html`、`dev-mission-live.html` 和 `dev-demo-mode.html` 会验证 3 步 AI 接入、首页 MISSION LIVE、演示关闭 / 真实 Agent 模式、真实任务看板和恢复演示。`dev-activity.html` 会验证任务进度到角色进度条、完成后庆祝自动回到日常活动，以及「新一轮」重置。

bridge 自身的 32 个集成测试、更新器的 14 个单元测试、任务工作台的 13 个单元测试和上下文的 1 个单元测试（共 60 个）不依赖浏览器：

```bash
python3 -m unittest discover -s tests -v
```

## 开源与贡献

- License: [MIT](LICENSE)
- 贡献指南：[CONTRIBUTING.md](CONTRIBUTING.md)
- 安全边界：[SECURITY.md](SECURITY.md)
- 行为准则：[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- 架构：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 发布清单：[docs/OPEN_SOURCE_CHECKLIST.md](docs/OPEN_SOURCE_CHECKLIST.md)
- Roadmap / 已知缺口：[docs/ROADMAP.md](docs/ROADMAP.md)

仓库已经公开；当前版本 `1.18.3`，历史版本见 GitHub Releases。发布清单见 `docs/OPEN_SOURCE_CHECKLIST.md`。

## 已知限制

- 状态存在内存里；`AUDIT` 底部可以手动保存/恢复 localStorage 快照，但刷新不会自动恢复，清理浏览器数据会丢失。还没有做逐 tick 回放。
- 当前热桌上限 2 个，因此 agent 上限 8 个；没有做「解雇 / 释放热桌」的 UI。
- 文件路径、行号、diff、技能调用是**模拟的工作证据**，不是真实仓库变更；真实接入时代入 bridge 事件即可。
- Trace Lab 的 token / cost / duration 是**可复现的模拟遥测**，不是实际 API 计费；OTLP JSON 的结构按 OpenTelemetry / GenAI 语义设计，方便接真实数据，但目前没有 trace ingest 端点。
- 规则引擎的「自主性」是设计好的行为空间，不是开放式推理；但工作账本和审计模型可以直接复用到真实 agent。
- 外部 Agent 的任务委派是**拉取式 + 自报完成**：bridge 不会主动推送 webhook，完成证据由外部 Agent 自报，未经过本地评审；未验证的基础工作会保留为风险/遗漏。
- Assignment 绑定当前场景和 `runId`；新运行不会自动套用旧运行的委派结果。
- 一人公司的任务自动派发，但真实完成仍需要绑定角色并连接执行 Agent；模型 API Agent 只做单次调用，不参与任务房间。
- SSE 是 localhost 实时流，没有鉴权；公司数据保存在 `~/.agent-office/bridge-state.json`。
- 中英文切换覆盖 UI、状态、任务模板和公司内容；仿真的叙事台词保留原始语言。
- 任务工作台的 AI 讨论/AI 执行需要可用的模型服务；本地 WorkBuddy/Ollama 未启动时会保留规则计划并明确提示。PDF 文本提取需要 `pdftotext`；图片识别优先使用视觉模型，macOS 可用系统 Vision 兜底，其他平台可安装 `tesseract`。
- 时间/token 是估算与消耗统计，不是厂商账单；估算基于角色基线、复杂度、技能匹配和负载，暂未按历史偏差自动校准。实际 token 取决于模型返回或外部 Agent 汇报。
- 品牌 Logo 是本地名称/运行时匹配，不下载商标图片；未知 Agent 使用名称缩写。内置头像是本地 emoji/字符预设，自定义头像只保存缩写和颜色，不上传图片。
- 扫码登录只提供老板审批门禁和二维码/链接附件，不实现各第三方服务自己的 OAuth 流程；审批端点是本机本地信任模型，不是多租户鉴权系统。
- 任务工作台把数据存在 `~/.agent-office/missions.json`；大型部署应迁移到 SQLite/Postgres。
- 自行升级不会后台自动安装；自动升级需要能访问官方 GitHub Release，手动升级需要本地包且版本必须高于当前版本。更新需要 bridge 运行，并会重启 bridge。1.2.0 及更早版本需要先手动升级一次到 1.3.0+ 才能使用内置工具面板。
- 压缩包更新不会删除上游已移除的旧文件；这些文件不影响运行，可手动清理。
- 连接码是邀请机制，不是密码；bridge 无鉴权/TLS，只应在本机使用。
- 模型 API 是单次调用适配器，不会自动完成模拟任务；`cost` 不按厂商价格计算，token 以返回的 usage 为准。
- bridge 是 localhost 开发服务，没有鉴权、TLS 或多租户；不要直接暴露到公网。
- 办公室布局是固定坐标，加太多工位需要调 `AO.HUBS` / 障碍物。
- 所有美术资源由代码生成，可以自由改成你的品牌配色。
