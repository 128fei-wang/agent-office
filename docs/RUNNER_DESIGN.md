# RUNNER_DESIGN — Phase 1「真实执行 MVP」设计

> 状态：设计定稿（本阶段只交设计 + 数据模型 + 状态机，不写实现）
> 目标：把「任务 → 真实执行 → diff/测试证据 → 审批 → 合并」端到端打通；办公室视图只展示真实运行状态，不再展示模拟状态。
> 配套：`docs/RUNNER_DATA_MODEL.md`（数据模型 + 状态机，本阶段第二产出）。

## 0. 范围与硬约束（本阶段承诺不碰）

- **先定设计、后写实现**：第 1/2/3 项需老板明确接受建议后才开工；其余 7 条无异议按本文执行。
- 不改前端视觉、不加新 provider、不做一人公司模板。
- 不自动 push / merge；所有 git 操作可回滚；不动仓库以外的用户文件。
- 每项改动配套测试；验收命令写进任务描述。

---

## 1. 完成判定

**选择：采纳四门判定，另补「声明范围」作为第五道异常防线。**

一次真实执行产出一条 `run` 记录，只有下面四门**全部通过**才允许把任务置 `done`：

| # | 门 | 判据 | 拦截的异常 |
|---|---|---|---|
| G1 | 进程正常退出 | 退出码 = 0，且非超时、非被 SIGKILL/SIGTERM | 中途崩溃、超时 |
| G2 | diff 非空 或「无改动已论证」 | 相对 base commit 有实际内容变更；diff 为空时必须提交「无改动已论证」claim（附调查证据，走人审） | 空跑、空转 |
| G3 | 任务声明的测试通过 | 由任务定义的验收命令在沙箱里 exit 0 且有用例真实通过 | 改错文件（功能没做成） |
| G4 | 通过 MCP `submit_evidence` 提交 | bridge 采到的证据回执已签发，且与 run 绑定 | 未提交 / 提交不完整 |

**「改错文件」怎么兜住**：任务描述里可选声明 `expectedPaths`（预期改动的路径范围）。diff 若落在声明范围之外，不自动 `done`，置 `review` 并列出范围外文件，由老板人工判。主要防线仍是 G3——验收命令必须真实覆盖改动行为，改错文件会导致测试失败。

**「无改动」任务怎么不被误杀**：G2 允许「diff 非空 **或** 无改动已论证」——调查后确认无需改代码是合法结果，不是空跑。空跑 = 既无 diff、又无「无改动」claim，仍是 blocked。claim 走人审，不自动 done。

**理由**：四门是「可机器判定、且每门都有现成采集点」的最小完备集。exit 码、diff、测试结果、证据回执现在 bridge 都能拿，不引入新的信任假设。

---

## 2. 证据采集独立性

**选择：采纳。diff / 测试输出由 bridge 采集，签名密钥只在 bridge；Agent 只交 claim，不能交最终 hash。**

架构上把「干活」和「取证」分给两个主体：

- **Agent 干活**：在 per-task worktree 里跑它自己的 CLI（Claude Code / Codex），只能写工作区文件、交一份 `submit_evidence` 的 claim（摘要 + 自述改了哪些文件）。
- **bridge 取证**：run 结束后，bridge 自己 `git diff`、自己跑任务声明的测试命令（走 `execution.py` 沙箱）、自己算 `diffHash` / `testOutputHash` / `exitCode`。**Agent 提交的任何 hash 字段一律忽略、全部重算。**

签名密钥沿用 `evidence.py` 的 HMAC 方案：密钥只落在 `~/.agent-office/` 桥状态目录，永不进工作区、永不交给 Agent。证据回执升级为覆盖 `runId + diffHash + testOutputHash + exitCode`。

**防篡改验收**：证据签发后工作区被改动，merge 前重算 diffHash 与回执不一致 → 必被检出（见第 8 条）。

**run 级哈希链**：单 run 完整性只防「当前工作区被改」，不防「证据历史被整体替换」。每个 run 的回执 hash 覆盖上一个 run 的回执 hash，形成追加式证据链；办公室视图**只读**这条链上的签名证据库，永不读工作区。

**理由**：现状 `evidence.py` 已经是「bridge 持有密钥、Agent 只提交、bridge 重算哈希」的同构方案，Phase 1 只是把取证对象从「上传的文件」换成「工作区 diff + 测试输出」，方向一致、零新机制。

---

## 3. Agent 的 git 权力边界

**选择：权威合并/发布路径全程不经 Agent + git 薄包装做护栏与留痕（不选「纯信任」，也不宣称能「阻止」恶意 Agent）。**

真正的边界不在「拦住 Agent 做坏 git 动作」，而在**产品的权威 refs / hooks / remote 只由 bridge 与人工审批路径触达，Agent 的 worktree 永远够不着**。分三层：

1. **权威隔离（真边界）**：Agent 只在 per-task linked worktree 内活动，worktree 不配 remote；merge / 审批 / 发布全由 bridge 在**独立权威仓库**上执行，Agent 不参与、也拿不到该仓库路径。所以 Agent 在 worktree 里 `push`、`reset --hard`、改 hooks，都影响不到产品权威状态。
2. **git 薄包装（护栏 + 留痕，不是安全边界）**：PATH 前置包装，拦 `push` / `reset --hard` / `update-ref` / 写 hooks，拦到即 `blocked` 并落证据回执。它只对「配合的 Agent 走 git 命令」生效——linked worktree 的 `.git` 是指向**共享 gitdir** 的指针，Agent 直接写文件即可绕过，故本层定位为护栏与行为留痕。
3. **残余信任显式化**：Agent 有完整 shell + 文件写权限，对**故意作对**的 Agent，除 FS 沙箱外没有硬边界；本产品默认「Agent 受权改源码、但证据与合并永不采信其自述」。这句写进 `docs/THREAT_MODEL.md`。

**验收**：配合的 Agent `git push` → 被包装拦（blocked）；即便它绕过包装直接改共享 gitdir，也不影响权威仓库与合并路径（权威 refs 在桥侧，Agent 够不着）。「改 hooks 被 100% 阻止」作为验收标准**撤销**，改为「改 hooks 被留痕，且不影响权威合并」。

---

## 4. 隔离单位

**选择：per-task worktree（每个任务一个 linked worktree），从 mission base commit 分叉。**

- 每任务独立 worktree + 独立分支 → 并发互不污染、per-task diff 干净（供 G2 与 diffHash 使用）。
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

**理由（为什么不是 full seatbelt 包住 PTY）**：Agent 主进程要调模型 API、读自己的 `~/.config`、用一堆工具，完整 seatbelt 会把它掐死；而「事后审计 + 两处窄守卫」已经拿到同等性质——**产品的权威（证据、合并、refs、测试）全程在 bridge 手里，Agent 碰不到**。UI 文案与证据语义统一用「审计/核验」口径（如「已完成 · 待桥核验」），不用「沙箱强制」口径。

---

## 6. 测试可信度

**选择：采纳。测试命令定义在任务、Agent 不可改；测试文件 hash 与基线不一致不得自动 done。**

- 验收命令存在**任务**里（bridge 侧存储），由老板/规划者定，Agent 无从改。
- `submit_evidence` **不收**命令字段——bridge 只跑任务里声明的命令。
- 测试清单按任务级声明，不用全局基线（否则会误杀「本次交付就是新增/改测试」的任务）：任务声明 `pinnedTests`（钉死不许动，动了才拦）与 `deliverableTests`（本次要新增/改的，变了是证据、是加分）。跑测试前只比对 `pinnedTests` 的 hash，**不一致 → 不自动 done**，标「疑似篡改测试」转 review。

**理由**：若 Agent 能换测试命令或改测试文件，「测试通过」就失去意义。命令 + 测试文件 hash 双钉，是 G3 能可信的前提。

---

## 7. JSON → SQLite 迁移

**选择：采纳。一次性、可重入、可回退；用真实 1.5MB missions.json 演练 10 次；中途 kill 不丢数据。**

- **可重入幂等**：源 `missions.json` 全程只读、绝不改动；按 mission（或批次）单事务写入 SQLite，事务中断自动回滚，重跑从断点继续。
- **配置**：stdlib `sqlite3`，WAL + `synchronous=FULL` + `foreign_keys=ON`。
- **回退**：迁移未校验完成前，`missions.json` 仍是 source of truth；cutover = 翻转一处指针；旧 JSON **归档不删**。
- **演练**：`test_migration.py` 用真实 1.5MB `missions.json` 跑 10 次，随机点 `SIGKILL`，事后行数 + 校验和必须与干净跑完全一致（= 不丢数据、不重不漏）。

**理由**：现 `missions.json` 是单进程锁下的本地源（架构文档已注明）；SQLite 给事务 + 崩溃安全 + 未来并发，迁移代价低，且源 JSON 只读保证可随时回退。

---

## 8. 审批时效

**选择：采纳。审批绑定 `runId + diffHash`，merge 前重算 hash，变了自动失效。**

- 审批记录绑定**整包** `{ runId, diffHash, testOutputHash, claimHash, decision, approvedAt }`——不能只绑 diffHash，否则能钻「批 diff X、却合进 diff X + 测试结果 Y」的缝。
- merge 前置条件：重算当前工作区各 hash == 批准时对应值；**任一不等 → 审批自动失效、merge 阻断、任务回 `waiting_approval`**，并**报出是哪个 hash 变了**（区分「Agent 追加 commit」和「证据被篡改」）。

**理由**：与第 2 条防篡改同源。审批必须钉死在「被批准的那份内容」上，否则批准后工作区被改也能合。

---

## 9. 办公室视图一致性

**选择：采纳。canonical 5 态；办公室只映射真实状态；kill 后 ≤5s 显示 failed。**

- run 状态机只有 5 态：`queued → running → waiting_approval → done`，任一点异常/失败 → `failed`。
- 真实执行任务，办公室（像素层 + 任务焦点板）**只渲染这 5 态**，不再合成「走路/开会/庆祝」等模拟态；未派发的任务 = 不渲染（无态）。
- **心跳兜底**：runner 每 <1s 打心跳，N 秒无心跳 → 置 `failed`（否则一个静默死掉的 runner 会永远停在 running）。
- kill 语义：kill 先入瞬态 `stopping`（让用户看到「kill 已收到」），进程死亡即写 `failed`，经现有 `GET /missions/stream` SSE 即时推；端到端 ≤5s。

**理由**：办公室视图的「可信」来自它只反射真实 run 态。监督循环 <1s + SSE 即时推，天然满足 5s 上限。

---

## 10. 对照验证

**选择：定协议、留位置，实施需真实用户（我无法自造）。**

- 协议：同一任务双臂跑——A 臂「直接开 Claude Code 终端」vs B 臂「本产品 runner」。指标不用裸墙钟（本产品故意加审批/取证开销，比裸跑谁快等于判它必输），改用 **`time-to-trusted-merge` + `post-merge 缺陷数`**，记录返工次数、审批次数、结果质量。n=3 只给方向性结论、不给统计数字。
- 产出：`docs/RUNNER_VALIDATION.md`，给结论（谁快、谁返工少、审批是否带来可量化的拦截收益）。
- **边界**：此条需要 3 个真实用户，属外部依赖，**待老板提供用户**；在此之前我先自跑 A 臂（直接终端）当 1 个数据点存档。

---

## 11. 已定稿（技术决策由我自行决断）

四门判定 + 声明范围、bridge 采证据、git 权力边界，连同我补的四处修正（G2「无改动已论证」出口、任务级测试清单、权威合并路径隔离、验证指标重框）与三处加厚（run 级哈希链、审批绑整包、心跳 + stopping 态），已全部并入本文、按此执行。

**唯一外部依赖**：第 10 条对照验证需要 3 个真实用户（我无法自造）。在你提供之前，我先自跑 A 臂（直接终端）存档。

**开工边界**：设计已定稿，按本文落实现。每项改动配测试，验收命令写进任务描述；不改前端视觉、不加 provider、不自动 push/merge、不动仓库以外的用户文件。

---

## 附：落点与新增面（确认后实现）

| 主题 | 落点 |
|---|---|
| run 生命周期 + 5 态 | `missions.py` 新增 run 记录；`bridge.py` runner 监督 |
| per-task worktree | 新增 `runner.py`（worktree 建/拆、PTY 监督、git 包装） |
| MCP `submit_evidence` | `bridge.py` `/mcp` 新增工具（只收 claim，不收 hash/命令） |
| 证据升级 | `evidence.py` 回执扩 runId/diffHash/testOutputHash/exitCode |
| SQLite 迁移 | 新增 `migration.py` + `test_migration.py` |
| 审批绑定 | `missions.py` approval 记录扩 runId/diffHash；merge-prep 重算 |
| 威胁模型 | 新增 `docs/THREAT_MODEL.md` |
| 对照验证 | `docs/RUNNER_VALIDATION.md`（待真实用户） |
