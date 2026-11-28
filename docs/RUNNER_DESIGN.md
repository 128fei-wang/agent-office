# RUNNER_DESIGN — Phase 1「真实执行 MVP」设计

> 状态：设计定稿（本阶段只交设计 + 数据模型 + 状态机 + 威胁模型，不写实现）
> 目标：把「任务 → 真实执行 → diff/测试证据 → 审批 → 合并」端到端打通；办公室视图只展示真实运行状态，不再展示模拟状态。
> 配套：`docs/RUNNER_DATA_MODEL.md`（数据模型 + 状态机）、`docs/THREAT_MODEL.md`（威胁模型）。

## 0. 范围与硬约束（本阶段承诺不碰）

- **先交设计、后写实现**：三处验收变更（第 3/10 条、第 1 条 G2 出口）需老板明确「接受」后才开工实现（见第 13 节）；第二轮评审 A/B/C 逐条回应见第 14 节；其余技术决策我已定稿、不逐项请示。
- 不改前端视觉、不加新 provider、不做一人公司模板。
- 不自动 push / merge；所有 git 操作可回滚；不动仓库以外的用户文件。
- 每项改动配套测试；验收命令写进任务描述。

---

## 1. 完成判定

**选择：采纳四门判定，另补「声明范围」作为第五道异常防线；G2 加「无改动已论证」出口（走人审）。**

一次真实执行产出一条 `run` 记录，只有下面四门**全部通过**才允许把任务置 `done`：

| # | 门 | 判据 | 拦截的异常 |
|---|---|---|---|
| G1 | 进程正常退出 | 退出码 = 0，且非超时、非被 SIGKILL/SIGTERM | 中途崩溃、超时 |
| G2 | diff 非空 或「无改动已论证」 | 相对 base commit 有实际内容变更；diff 为空时必须提交「无改动已论证」claim（附调查证据，走人审） | 空跑、空转 |
| G3 | 任务声明的测试通过 | 由任务定义的验收命令在沙箱里 exit 0 且有用例真实通过 | 改错文件（功能没做成） |
| G4 | 通过 MCP `submit_evidence` 提交 | 持 run-scoped token 提交 claim，bridge 采到的证据回执已签发并与 run 绑定 | 未提交 / 提交不完整 / 冒名提交 |

**「改错文件」怎么兜住**：任务描述里可选声明 `expectedPaths`（预期改动的路径范围）。diff 若落在声明范围之外，不自动 `done`，置 `review` 并列出范围外文件，由老板人工判。主要防线仍是 G3——验收命令必须真实覆盖改动行为，改错文件会导致测试失败。

**「无改动」任务怎么不被误杀**：G2 允许「diff 非空 **或** 无改动已论证」——调查后确认无需改代码是合法结果，不是空跑。空跑 = 既无 diff、又无「无改动」claim，仍是 blocked。claim 走人审，不自动 done。

**G3 的边界规则（见第 12 节 B2）**：文档类 / 无测试命令 / 自定义测试命令 / 如何解析「有用例真实通过」，都有明确规则，不再各自发挥。

---

## 2. 证据采集独立性

**选择：采纳。diff / 测试输出由 bridge 采集，签名密钥由 bridge 持有；Agent 只交 claim，不能交最终 hash。但「密钥 Agent 读不到」这句不成立，已诚实降级（见 §THREAT_MODEL）。**

架构上把「干活」和「取证」分给两个主体：

- **Agent 干活**：在 per-task worktree 里跑它自己的 CLI（Claude Code / Codex），只能写工作区文件、交一份 `submit_evidence` 的 claim（摘要 + 自述改了哪些文件）。
- **bridge 取证**：run 结束后，bridge 自己 `git diff`（含 untracked，见第 12 节 B3）、自己跑任务声明的测试命令（走 `execution.py` 沙箱）、自己算 `diffHash` / `testOutputHash` / `exitCode`。**Agent 提交的任何 hash 字段一律忽略、全部重算。**

**密钥的真实位置（诚实版）**：签名沿用 `evidence.py` 的 HMAC，key 只落在 `~/.agent-office/` 桥状态目录（0600）。**但 0600 只防其他 OS 用户，不防同 UID 的 Agent 进程——Agent 能读 key、也能 curl loopback REST 伪造 claim。** 因此证据签名的安全意义是「防事后篡改 + 审计锚」，不是「防 Agent 本机作恶」。完整边界见 `docs/THREAT_MODEL.md`，UI 口径同步改（见其 §5）。

**run-scoped token（claim 归属，第 12 节 B8）**：runner 把一次性 `AGENT_OFFICE_RUN_TOKEN` 只注入该 Agent 进程 env；`submit_evidence` 校验 `token → runId → agentId` 三元组，缺一即拒。让「任意本地进程替任意 run 交 claim」不再成立（对同 UID 恶意进程仍是护栏不是边界，见威胁模型）。

**run 级哈希链**：单 run 完整性只防「当前工作区被改」，不防「证据历史被整体替换」。每个 run 的回执 hash 覆盖上一个 run 的回执 hash，形成追加式证据链；办公室视图**只读**这条链上的签名证据库，永不读工作区。

**理由**：现状 `evidence.py` 已经是「bridge 持有密钥、Agent 只提交、bridge 重算哈希」的同构方案，Phase 1 只是把取证对象从「上传的文件」换成「工作区 diff + 测试输出」，方向一致、零新机制。

---

## 3. Agent 的 git 权力边界

**选择：权威合并/发布路径全程不经 Agent + git 薄包装做护栏与留痕。撤销「100% 阻止」和「Agent 够不着权威仓库」两条过强表述。**

上一版「per-task linked worktree 不配 remote → push 结构性不可能」「权威仓库 Agent 够不着」**都不成立**：linked worktree 与主仓**共享同一 gitdir 和 remote**（remote 在共享 config 里，不在 worktree 里）；且 Agent 同 UID、持有用户 SSH 凭据 + 网络，能找到主仓路径、能直接推 origin。这两句已从文档删除。真正成立的是下面三层：

1. **权威路径人审（真正的防线）**：merge / 审批 / 发布只由 bridge 在**人审 diffHash 之后**执行，Agent 不参与权威 refs 的写入。对配合型 Agent，这条成立——Agent 在 worktree 里怎么折腾，改不到权威状态，因为权威状态由「人审 + 桥写」决定。
2. **git 薄包装（护栏 + 留痕，不是安全边界）**：PATH 前置包装，拦 `push` / `reset --hard` / `update-ref` / 写 hooks，拦到即 `blocked` 并落证据回执。它只对「配合的 Agent 走 git 命令」生效——linked worktree 的 `.git` 是指向共享 gitdir 的指针，Agent 直接写文件即可绕过。
3. **残余信任显式化**：Agent 有完整 shell + 文件写权限。对**配合型** Agent，护栏 + 留痕 + 人审足够；对**恶意** Agent，除 OS 隔离外没有硬边界。本产品默认「配合型 Agent」，恶意 Agent 留给未来 OS 隔离（见 `docs/THREAT_MODEL.md` §6）。

**验收（已改）**：
- 配合型 Agent `git push` / `reset --hard` / 改 hooks → 被包装拦（`blocked`）或 **100% 留痕**（落 `events(type=git)` + 证据回执）。
- **撤销**「故意改 hooks 被 100% 阻止」作为验收标准——对恶意 Agent 这句验不过。

---

## 4. 隔离单位

**选择：per-task worktree（每个任务一个 linked worktree），从 mission 的固定 base commit 分叉。**

- 每任务独立 worktree + 独立分支 → 并发互不污染、per-task diff 干净（供 G2 与 diffHash 使用）。
- **base 必须是固定 commit hash**（派发时锁定并写进 `tasks.base_commit`），**不是分支名**——分支会前移，diff 两端漂移会导致证据失配。
- 依赖映射：任务 DAG 的**拓扑序**即合并顺序——某任务的 deps 全部 `done` 后，其分支才进入 merge-prep。
- **冲突结构化解**：两个并发任务的 `expectedPaths` 有交集时，调度器串行化（不并行），从源头消掉合并冲突；剩余冲突才在 merge-prep 检出，转老板拍板，不自动解决、也不让 Agent 解决。

**理由**：per-mission 单 worktree 会让并发任务互相踩文件、diff 无法归因到单个任务，直接违背第 1、8 条对 per-task diffHash 的要求。

---

## 5. 策略执行点

**选择：事后审计为主，运行时强制只保留两处窄守卫。**

| 位置 | 性质 |
|---|---|
| Agent 主进程（Claude Code / Codex 的 PTY） | **事后审计**——run 结束 bridge 全量重算 diff / 测试 / exit / 哈希，Agent 自述永不采信 |
| git 权力动词 | **运行时强制**（第 3 条包装） |
| 验收测试命令 | **运行时强制**（`execution.py` seatbelt/bwrap 沙箱，无网络、无 home 读） |

**理由（为什么不是 full seatbelt 包住 PTY）**：Agent 主进程要调模型 API、读自己的 `~/.config`、用一堆工具，完整 seatbelt 会把它掐死；而「事后审计 + 两处窄守卫」已经拿到同等性质——**产品的权威（证据、合并、refs、测试）全程在 bridge 手里，Agent 碰不到**。UI 文案与证据语义统一用「审计/核验」口径（「已完成 · 待桥核验」），不用「沙箱强制」口径；也不宣称「防本机作恶」（见 THREAT_MODEL §5）。

---

## 6. 测试可信度

**选择：采纳并加厚——不只钉测试文件，钉「命令 + 配置 + pinned 文件集」；基线在 mission 创建时自动生成，不能由规划模型选择性省略。**

- 验收命令存在**任务**里（bridge 侧存储），由老板/规划者定，Agent 无从改；`submit_evidence` **不收**命令字段，bridge 只跑任务里声明的命令。
- 测试清单按任务级声明，不用全局基线（否则误杀「本次交付就是新增/改测试」的任务）：任务声明 `pinnedTests`（钉死不许动）与 `deliverableTests`（本次要新增/改的，变了是证据、是加分）。
- **钉扎范围从「测试文件」扩到「测试面」**：`pinnedTests` 必须含 `conftest.py` / `pytest.ini` / `tox.ini` / `package.json`（scripts） / fixtures / 测试所需环境变量——只钉测试文件会让 Agent 改配置让测试变绿。跑测试前比对整个 pinned 面的 hash，**任一不一致 → 不自动 done**，标「疑似篡改测试」转 review。
- **pinned 基线在 mission 创建时自动生成**（扫仓库 + 任务声明的测试面），不允许规划模型选择性省略某文件；人工可增补，不可删减。
- **测试命令随审批展示并 hash 固定**：审批界面显示完整的测试命令 + `testCommandHash`，审批者看到的是「我批的这份测试命令跑出的结果」，命令被改即 hash 失配。

**理由**：若 Agent 能换测试命令、改测试文件、改测试配置，「测试通过」就失去意义。命令 + 测试面 hash 双钉，是 G3 能可信的前提。

---

## 7. JSON → SQLite 迁移

**选择：采纳。一次性、可重入、可回退；用真实 1.5MB missions.json 演练 10 次；中途 kill 不丢数据。补维护模式 + cutover 后回退 + 连接模型。**

- **维护模式**：迁移全程进维护模式——bridge **停写** missions.json（新写入排队或拒绝并提示），源只读在**整个系统**成立，不只是迁移进程内成立。解决「迁移期间 bridge 仍在写 missions.json」的双写冲突。
- **可重入幂等**：源 `missions.json` 全程只读；按 mission（或批次）单事务写入 SQLite，事务中断自动回滚，重跑从断点继续。
- **配置与连接**：stdlib `sqlite3`，WAL + `synchronous=FULL` + `foreign_keys=ON` + `busy_timeout`（写锁串行化）；**连接按线程创建、不复用跨线程**（sqlite3 连接不是线程安全的）。
- **cutover 与回退**：迁移未校验完成前，`missions.json` 仍是 source of truth；cutover = 翻转一处指针。**回退**：cutover 前先给 SQLite 拍快照（或保留 cutover 后写操作的 WAL 备份），回退 = 指针翻回 + 回放 post-cutover 写入到 JSON——不能「翻转指针就丢 post-cutover 的写入」。旧 JSON **归档不删**。
- **schema_version + 迁移框架**：`meta` 表记 `schema_version`，后续 schema 变更走同一框架（版本号 → 迁移脚本 → 事务应用 → 校验）。
- **演练验收**：`test_migration.py` 用真实 1.5MB `missions.json` 跑 10 次，随机点 `SIGKILL`，事后行数 + 校验和必须与干净跑完全一致（= 不丢数据、不重不漏）。

**理由**：现 `missions.json` 是单进程锁下的本地源；SQLite 给事务 + 崩溃安全 + 未来并发，迁移代价低，且源 JSON 只读 + 快照保证可随时回退。

---

## 8. 审批时效

**选择：采纳并加厚——审批绑定 `{baseCommit, mergeTarget, runId, diffHash, testOutputHash, claimHash, testCommandHash}`；审批前冻结 worktree；merge 在同一个锁内完成重算与写入。**

- 不能只绑 `diffHash`：同一 diff 在不同 base 上 merge 结果不同，且能钻「批 diff X、却合进 diff X + 测试结果 Y」的缝。所以绑定**整包**（含 baseCommit、merge 目标、测试命令 hash）。
- **审批前置**：run 必须已停止、worktree **冻结**（无写入），审批者看到的是静止快照。
- **merge 前置条件（消除 TOCTOU）**：merge 时在**同一个锁内**完成「重算各 hash == 批准值」→「写入」两步——不允许「校验后、写入前」工作区仍被改的窗口。任一 hash 不等 → 审批自动失效、merge 阻断、任务回 `waiting_approval`，并**报出是哪个 hash 变了**（区分「Agent 追加 commit」「证据被篡改」「base 前移」）。

**理由**：与第 2 条防篡改同源。审批必须钉死在「被批准的那份内容 + 那份内容所处的 base/目标」上，否则批准后工作区被改也能合。

---

## 9. 办公室视图一致性 + runner 生命周期

**选择：采纳。canonical 5 态；办公室只映射真实状态；kill 后 ≤5s 显示 failed。补 runner 生命周期（bridge 重启接管）。**

- run 状态机只有 5 态：`queued → running → waiting_approval → done`，任一点异常/失败 → `failed`。
- 真实执行任务，办公室（像素层 + 任务焦点板）**只渲染这 5 态**，不再合成「走路/开会/庆祝」等模拟态；未派发的任务 = 不渲染（无态）。
- **心跳兜底**：runner 每 <1s 打心跳，N 秒无心跳 → 置 `failed`（否则一个静默死掉的 runner 会永远停在 running）。
- kill 语义：kill 先入瞬态 `stopping`（让用户看到「kill 已收到」），进程死亡即写 `failed`，经现有 `GET /missions/stream` SSE 即时推；端到端 ≤5s。

**runner 生命周期（bridge 重启接管，新增）**：

- runner 的 PTY 子进程用 `start_new_session=True`（独立进程组），**不随 bridge 一起死**。
- bridge 启动时**扫描无主 run**：`running` 且心跳超时、PID 死亡或不属于已知会话 → 一律归 `failed(orphaned)`；PID 仍活 → 重连接管（续上心跳监督）。**任何 run 不得在重启后停留 running 无心跳。**
- 重启窗口内不误判：以「心跳时间戳 + 进程组存活」判定，而非单一墙钟。

**验收**：bridge 重启后，所有 run 在一次扫描内归到终态或重连，不留「永远 running」。

**理由**：办公室视图的「可信」来自它只反射真实 run 态。监督循环 <1s + SSE 即时推，天然满足 5s 上限；补上重启接管，才不让「update 重启 bridge」这个必然事件留下僵尸 run。

---

## 10. 对照验证

**选择：定协议、留位置，实施需真实用户（我无法自造）。指标改用 `time-to-trusted-merge` + `post-merge 缺陷数`，并把审批/取证开销单列。**

- 协议：同一任务双臂跑——A 臂「直接开 Claude Code 终端」vs B 臂「本产品 runner」。指标不用裸墙钟（本产品故意加审批/取证开销，比裸跑谁快等于判它必输），改用 **`time-to-trusted-merge` + `post-merge 缺陷数`**，记录返工次数、审批次数、结果质量。**A 臂自跑要记录机器/模型/任务版本**，否则数据点不可比。
- **B 臂把「审批 + 取证」开销单列**为独立指标，否则对比必输且无意义——要回答的是「多花的审批/取证时间，换回了多少 post-merge 缺陷的减少」。
- n=3 只给方向性结论、不给统计数字，不撑「本产品更优」的断言。
- 产出：`docs/RUNNER_VALIDATION.md`，给结论。
- **边界**：此条需要 3 个真实用户，属外部依赖，**待老板提供用户**；在此之前我先自跑 A 臂（直接终端）当 1 个数据点存档。

---

## 11. 并发、回收与可观测性

**C1 并发与回收**：
- 最大并行 run 数 = 配置项（默认与 CPU 核数相关，上限可调）；超出进队列（FIFO + 优先级），不无限并发。
- worktree / log / artifact 磁盘上限：每 run 设 cap，超限降级（diff 走 BLOB 摘要、log 截断归档）。
- 崩溃残留清理：启动扫描 + 定时清理无主 worktree / 临时分支 / 孤儿进程组。
- merge 后删除任务分支（worktree + 分支），只留 run 证据与 hash。

**C2 大仓与二进制**：diff 大小上限（超限只存摘要 + 抽样，标记人审）；超大文件 / 二进制不产文本 diff，只 hash 内容并标记 `binary`；submodule 策略 = 默认不采集子模块内容、只记指针 hash，需采集则显式声明。

**C5 可观测性**：run 状态变化、心跳、bridge 重启、kill、git 留痕**全进同一 `events` 事件流**——5s 失败判定、心跳丢失、重启接管都要能被审计到，否则「≤5s 显示 failed」无法复核。

---

## 12. 执行路径与采集规则

**B1 执行路径单一化**：Phase 1 的「真实执行」**只走 CLI runner**（bridge 拉起 Claude Code / Codex）。现有 provider API 直跑路径（bridge 直接调模型、无 MCP 客户端、没人调 `submit_evidence`）对「执行类任务」**停用/替换**，只保留给聊天/讨论——**不允许两套执行路径并存**（否则 G4 对 provider 直跑永远不成立，办公室视图又会变回模拟态）。

**B2 G3 边界规则**：
- 无测试命令 / 无测试文件（文档类任务）→ 任务必须显式声明 `no_tests`，G3 由「diff + 人审」兜，不自动 done。
- 自定义测试命令（如 `./scripts/test.sh`）不在 `execution.py` allowlist 里 → 派发时**必须进 allowlist**，runner 拒跑未知命令（不静默放行）。
- 「有用例真实通过」按 runner 归一解析：pytest `N passed`（N≥1，0 failed/0 error）、unittest `Ran N tests ... OK`（N≥1）、node `# pass`（≥1，0 fail）。**0 用例通过 ≠ 通过**（「测试命令 exit 0 但一个用例都没跑」判不过 G3）。

**B3 diff 采集规则**：
- `git diff <base>` 看不到未 `git add` 的新文件 → 采集前 `git add -N`（intent-to-add），或同时用 `git status --porcelain` 逐文件 hash，确保**新建文件也进 diffHash 和 merge**。
- **base 必须是固定 commit hash**（第 4 条），不是分支名。
- 明确 `.gitignore`（被 ignore 的文件不采集，除非任务声明需要）、LFS（指针文件按内容 hash 或解析后 hash，二选一写死）、二进制（见 C2）。

**B8 run token**：见第 2 条。

---

## 13. 待老板签字的三处验收变更（签字前不写实现）

以下三处属于**改验收标准**，我按此已定稿并写进本文，但按「先交设计、老板确认后写实现」的边界，**等你一句「接受 / 不接受」才开工实现**：

| # | 变更 | 原标准（你 11-28 提出） | 现标准 | 我的判断 |
|---|---|---|---|---|
| 1 | 第 3 条 git 边界 | 「故意 push / 改 hooks 被阻止，或 100% 留痕」 | 「配合型 Agent 被拦 + 越权 100% 留痕；恶意 Agent 无硬边界（除非 OS 隔离）」 | 你原话里本就有「或 100% 留痕」分支，这是选它并诚实标注恶意 Agent 极限 |
| 2 | 第 10 条指标 | 「记录耗时 / 返工 / 审批次数并给结论」 | `time-to-trusted-merge` + `post-merge 缺陷数`，审批/取证开销单列 | 加严不是放宽，避免比裸墙钟必输 |
| 3 | 第 1 条 G2 | 「diff 非空 … 缺一不得置 done」 | 「diff 非空 **或** 无改动已论证（走人审）」 | 只加一个「调查后确认不改」的合法出口，仍走人审、不自动 done |

**其余决策我已定稿、不逐项请示**（属技术实现范围）。**唯一外部依赖**仍是第 10 条 3 个真实用户（我无法自造）；你提供前我先自跑 A 臂存档。

**开工边界**：上述三处你确认后按本文落实现。每项改动配测试，验收命令写进任务描述；不改前端视觉、不加 provider、不自动 push/merge、不动仓库以外的用户文件。

---

## 14. 评审回应矩阵（第二轮 RUNNER_DESIGN 评审 A/B/C · 逐条）

> 逐条回应第二轮只读 reviewer 的 A1–A3 / B1–B8 / C1–C5 共 16 条。**全部「接受」**（我已逐条对源码与 git 语义验真，无一条误报）；无「拒绝」条。C4 的三处验收变更单列见 §13，标注「待老板签字」。验收命令列在实现后验证时执行；其中标注「文档断言」的现在即可用 grep 复核。

| 条目 | 结论 | 理由（一锤） | 验收命令 | 落点 |
|---|---|---|---|---|
| A1 密钥同 UID 可读 | 接受（诚实降级，不选现在做 OS 隔离） | `0600` 只防别的 OS 用户、不防同 UID 的 Agent——能 `cat` key、能 curl loopback 伪造 claim | 非成员身份 `curl /files?missionId=<他人>` → 403；UI 文案 =「已完成 · 待桥核验」（文档断言：`grep -q "已完成 · 待桥核验"` 相关源码/文案） | `docs/THREAT_MODEL.md` §1/§2/§5；RUNNER_DESIGN §2；UI 文案 |
| A2 第 3 节自相矛盾 | 接受 | linked worktree 与主仓**共享 gitdir 和 remote**，「worktree 不配 remote」「权威仓库 Agent 够不着」均不成立，两句已删 | `git -C <worktree> remote -v` 显示与主仓相同 origin；文档断言 `grep -c "不配 remote\|够不着" docs/RUNNER_DESIGN.md` = 0 | RUNNER_DESIGN §3；`docs/THREAT_MODEL.md` §4 |
| A3 状态机没覆盖 bridge 重启 | 接受 | 补 runner 生命周期：PTY `start_new_session` 独立进程组 + bridge 启动扫描无主 run | kill bridge → 重启 → 所有 run 一次扫描归 `failed(orphaned)` 或重连，无「永远 running」 | RUNNER_DESIGN §9；`docs/RUNNER_DATA_MODEL.md` §3 `session_pgid` |
| B1 G4 对 provider 直跑不成立 | 接受 | Phase 1 真实执行只走 CLI runner；provider 直跑对执行类任务停用，不两套路径并存 | 执行类任务必须经 `runner.py` 产 run；provider 直跑不产 run、不改任务状态 | RUNNER_DESIGN §12 |
| B2 G3 边界未定义 | 接受 | 文档类任务 `no_tests`；自定义命令派发时必须进 allowlist；0 用例通过 ≠ 通过 | `./scripts/test.sh` 未进 allowlist → runner 拒跑并给明原因（不静默放行） | RUNNER_DESIGN §12 B2；`tasks.no_tests`/`test_command` |
| B3 diff 漏 untracked | 接受 | 采集前 `git add -N` + `git status --porcelain` 逐文件 hash；base 锁固定 commit hash（非分支名） | 新建文件未 add 也进 diffHash 与 merge（反向：只 add 部分文件，验证未跟踪文件仍被采集） | RUNNER_DESIGN §12 B3 |
| B4 测试钉扎太窄 | 接受 | 钉「命令 + 配置 + pinned 文件集」；pinned 基线 mission 创建时自动生成、不可选择性省略 | 改 `conftest.py`/`pytest.ini`/`package.json` scripts → 不自动 done，标 `tampered_test` | RUNNER_DESIGN §6；`tasks.pinned_tests` |
| B5 审批缺 baseCommit + TOCTOU | 接受 | 绑 `{baseCommit, mergeTarget, runId, diffHash, testOutputHash, claimHash, testCommandHash}` 整包；审批前 stop + 冻结；merge 锁内重算 | 批准后改工作区 → 审批失效、merge 阻断；同 diff 不同 baseCommit 不通用；审批前未 stop → 拒 merge | RUNNER_DESIGN §8；`approvals.*` |
| B6 迁移双写冲突 | 接受 | 维护模式停写 + `schema_version` + 快照回退 + 连接按线程建 | 真实 1.5MB missions.json 迁 10 次 + 随机 SIGKILL，行数/校验和一致；cutover 后回退可用 | RUNNER_DESIGN §7；`docs/RUNNER_DATA_MODEL.md` §1 |
| B7 状态映射缺失 | 接受 | task×run 完整映射表；`cancelled`/`timeout` 并入 `failed` 不另设态 | 「任务 done 但 run failed」不得出现（run 唯一真相源，task 只是投影） | `docs/RUNNER_DATA_MODEL.md` §3.5 |
| B8 run token 未定义 | 接受 | `AGENT_OFFICE_RUN_TOKEN` 只注入该 Agent 进程 env；校验 `token→runId→agentId` 三元组 | 伪造 runId / 缺 token / 重复提交 → 拒；异 Agent token 替跑 → 拒 | RUNNER_DESIGN §2；`run_tokens` |
| C1 并发回收 | 接受 | 并行上限、磁盘 cap、崩溃残留清理、merge 后删分支 | 超并行上限 → 进队列；merge 后分支 + worktree 删除 | RUNNER_DESIGN §11 |
| C2 大仓二进制 | 接受 | diff 大小上限、二进制只 hash 标 `binary`、submodule 只记指针 hash | 超大文件 → 只存摘要 + 抽样并标人审 | RUNNER_DESIGN §11 |
| C3 对照验证口径 | 接受 | A 臂记机器/模型/任务版本；B 臂单列审批 + 取证开销；n=3 只当方向不给数字 | `docs/RUNNER_VALIDATION.md` 双臂结论，B 臂审批/取证开销单列 | RUNNER_DESIGN §10 |
| C4 三处验收变更 | 接受（三处标注「待老板签字」，见 §13） | 属**改验收标准**，实现方不自宣布定稿 | 老板回「接受/不接受」→ **签字前不写实现** | RUNNER_DESIGN §13 + §0 |
| C5 可观测性 | 接受 | run 状态/心跳/重启/kill/git 留痕全进同一 `events` 流 | `events` 流可查到心跳丢失、重启、kill、git 留痕 | RUNNER_DESIGN §11；`docs/RUNNER_DATA_MODEL.md` `events` |

---

## 附：落点与新增面（确认后实现）

| 主题 | 落点 |
|---|---|
| run 生命周期 + 5 态 + 重启接管 | `missions.py` 新增 run 记录；`bridge.py` runner 监督 + 启动扫描 |
| per-task worktree（固定 base commit） | 新增 `runner.py`（worktree 建/拆、PTY 监督、git 包装、run token 注入） |
| MCP `submit_evidence`（run-scoped token） | `bridge.py` `/mcp` 新增工具（只收 claim，不收 hash/命令；校验 token→runId→agentId） |
| 证据升级 | `evidence.py` 回执扩 runId/diffHash/testOutputHash/exitCode |
| SQLite 迁移（维护模式 + schema_version） | 新增 `migration.py` + `test_migration.py` |
| 审批绑定（baseCommit + mergeTarget + 锁内重算） | `missions.py` approval 记录扩；merge-prep 重算 |
| 威胁模型 | `docs/THREAT_MODEL.md`（本阶段已补） |
| 对照验证 | `docs/RUNNER_VALIDATION.md`（待真实用户） |
