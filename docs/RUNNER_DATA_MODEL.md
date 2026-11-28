# RUNNER_DATA_MODEL — Phase 1「真实执行 MVP」数据模型与状态机

> 状态：设计定稿（本阶段只交设计，不写实现）
> 配套：`docs/RUNNER_DESIGN.md`（十条设计决策）、`docs/THREAT_MODEL.md`（实现时补）
> 范围：本文件锁定 Phase 1 的两块设计产出——**数据模型**（missions.json → SQLite 表结构 + 迁移映射，对应 RUNNER_DESIGN 第 7 条）与**状态机**（run 生命周期 + 转移 + 办公室视图映射，对应第 1、3、6、8、9 条）。

---

## 1. 迁移策略（对应 RUNNER_DESIGN 第 7 条）

- **引擎**：stdlib `sqlite3`，`journal_mode=WAL` + `synchronous=FULL` + `foreign_keys=ON`。
- **可重入幂等**：源 `missions.json` 全程只读；按 mission（或批次）单事务写入，事务中断自动回滚，重跑从断点续。
- **cutover**：迁移未校验完成前，`missions.json` 仍是 source of truth；翻转一处指针（`state.meta` 里的 `source_of_truth`）即完成切换；旧 JSON **归档不删**。
- **演练验收**：`test_migration.py` 用真实 1.5MB `missions.json` 跑 10 次、随机点 `SIGKILL`，事后行数 + 校验和必须与干净跑一致（不丢、不重、不漏）。
- **命名约定**：既有 JSON 的 camelCase 字段平移到 snake_case 列；嵌套结构（charter/rules/estimate/actual/…）保留为 JSON 文本列，不逐字段拆列——只在需要索引/过滤的字段（status、assignee、hash、时间）拆成真列。

---

## 2. SQLite 表结构

### 2.1 既有实体（从 missions.json 平移，字段一一对应）

**`missions`** — 任务本体

| 列 | 类型 | 来源字段 | 说明 |
|---|---|---|---|
| `id` | TEXT PK | `id` | `msn_…` |
| `title` / `description` / `acceptance` | TEXT | 同名 | |
| `priority` | TEXT | `priority` | |
| `status` | TEXT | `status` | `active`（既有语义） |
| `budget` / `currency` / `deadline` / `language` | REAL / TEXT / TEXT / TEXT | 同名 | |
| `token_budget` | INTEGER | `tokenBudget` | |
| `member_scope` | TEXT | `memberScope` | `mixed` / `external` |
| `previous_mission_id` | TEXT | `previousMissionId` | |
| `archived_at` | TEXT NULL | `archivedAt` | |
| `conversation_id` | TEXT → FK | `conversationId` | |
| `members` | JSON | `members[]` | 成员目录快照 |
| `rules` | JSON | `rules[]` | |
| `charter` | JSON | `charter{}` | |
| `decisions` | JSON | `decisions[]` | |
| `auto_discuss` | INTEGER | `autoDiscuss` | 0/1 |
| `discussion` | JSON | `discussion{}` | |
| `auto_run` | JSON | `autoRun{}` | |
| `preferred_executors` | JSON | `preferredExecutors{}` | |
| `artifact_ids` | JSON | `artifactIds[]` | |
| `created_at` / `updated_at` | TEXT | `createdAt` / `updatedAt` | |

**`tasks`** — 任务分解（Phase 1 在既有字段上**新增**声明范围/测试清单列）

| 列 | 类型 | 来源/新增 | 说明 |
|---|---|---|---|
| `id` | TEXT PK | `id` | `task_…` |
| `mission_id` | TEXT → FK | `missionId` | |
| `key` / `title` / `brief` / `role` / `acceptance` / `deliverable` | TEXT | 同名 | |
| `required_skills` | JSON | `requiredSkills[]` | |
| `deps` | JSON | `deps[]` | 任务 DAG 边（拓扑序＝合并顺序） |
| `assignee_id` / `assignee_name` | TEXT | `assigneeId` / `assigneeName` | |
| `status` | TEXT | `status` | 规划层 6 态，见 §3.5 |
| `priority` | TEXT | `priority` | |
| `estimate` | JSON | `estimate{minutes,tokens,confidence}` | |
| `actual` | JSON | `actual{…}` | |
| `report` / `verification` / `test_run` | JSON NULL | `report` / `verification` / `testRun` | |
| `usages` | JSON | `usages[]` | |
| `artifact_ids` | JSON | `artifactIds[]` | |
| `created_at` / `updated_at` | TEXT | `createdAt` / `updatedAt` | |
| `expected_paths` | JSON NULL | **新增**（RUNNER_DESIGN §1） | 声明改动范围，diff 落在范围外转人审 |
| `pinned_tests` | JSON NULL | **新增**（§6） | 钉死不许动的测试文件清单 |
| `deliverable_tests` | JSON NULL | **新增**（§6） | 本次要新增/改的测试文件 |
| `test_command` | TEXT NULL | **新增**（§6） | 验收命令，bridge 侧存储、Agent 不可改 |
| `base_commit` | TEXT NULL | **新增**（§4） | 派发时锁定的 base |

**`conversations` / `messages` / `artifacts` / `memories` / `model_calls`** — 平移保留既有结构，字段一一对应（`conversations`: `id/kind/title/mission_id/members/pinned/muted/read_seq/created_at/updated_at`；`messages`: `id/seq/conversation_id/text/sender_*/type/attachment_ids/created_at`；`model_calls` 供审计/计费）。

**`approvals`** — 审批（Phase 1 对**执行类审批**新增 run 绑定列）

| 列 | 类型 | 来源/新增 | 说明 |
|---|---|---|---|
| `id` | TEXT PK | `id` | `apr_…` |
| `mission_id` | TEXT → FK | `missionId` | |
| `type` | TEXT | `type` | `spend/decision/login/authorization` |
| `title` / `description` / `service` | TEXT | 同名 | |
| `amount` / `currency` | REAL / TEXT | 同名 | |
| `options` / `scopes` | JSON | 同名 | |
| `requested_by` | TEXT | `requestedBy` | |
| `task_id` | TEXT NULL | `taskId` | |
| `attachment_ids` | JSON | `attachmentIds[]` | |
| `status` | TEXT | `status` | `pending/approved/rejected` |
| `resolution` | JSON NULL | `resolution{}` | |
| `created_at` / `resolved_at` | TEXT | `createdAt` / `resolvedAt` | |
| `run_id` | TEXT NULL | **新增**（§8） | 执行类审批绑 run |
| `diff_hash` / `test_output_hash` / `claim_hash` | TEXT NULL | **新增**（§8） | 审批绑整包，非只绑 diffHash |

**`meta`** — 单例表：`key` TEXT PK / `value` JSON。存 `next` 计数器、迁移指针（`source_of_truth`）、桥状态引用。

### 2.2 Phase 1 新增实体

**`runs`** — 一次真实执行的生命周期（本阶段核心）

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | `run_…`（= runId） |
| `task_id` / `mission_id` | TEXT → FK | 归属 |
| `status` | TEXT | 5 态 + 1 瞬态，见 §3 |
| `worktree_path` | TEXT | per-task linked worktree 绝对路径 |
| `base_commit` / `head_commit` | TEXT NULL | 相对 base 的 diff 两端 |
| `exit_code` | INTEGER NULL | 进程退出码 |
| `diff_hash` / `test_output_hash` / `claim_hash` | TEXT NULL | bridge 重算，**Agent 提交的值一律忽略** |
| `receipt_hash` | TEXT NULL | 本 run 证据回执 hash |
| `prev_receipt_hash` | TEXT NULL | 上一条 run 的回执 hash（run 级哈希链） |
| `review_reason` | TEXT NULL | 见 §3.4 |
| `fail_reason` | TEXT NULL | 见 §3.4 |
| `blocked_note` | TEXT NULL | 护栏停因，人读 |
| `heartbeat_at` | TEXT | 心跳时间戳（<1s 更新） |
| `started_at` / `ended_at` | TEXT NULL | |

**`run_evidence`** — bridge 采集的原始证据（工作区外，Agent 够不着）

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | |
| `run_id` | TEXT → FK | |
| `kind` | TEXT | `diff / test_output / exit / claim` |
| `content_hash` | TEXT | 内容哈希 |
| `content` | TEXT/BLOB | 采集到的原文 |
| `collected_by` | TEXT | 恒为 `bridge` |
| `created_at` | TEXT | |

**`events`** — 读审计 + 事件流（对应第 7 条读审计、第 3 条 git 留痕）

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | |
| `type` | TEXT | `read / write / git / evidence / run / approval` |
| `agent_id` | TEXT NULL | 谁 |
| `resource_type` / `resource_id` | TEXT | 读了/动了什么 |
| `payload` | JSON | 详情 |
| `created_at` | TEXT | |

### 2.3 索引与约束

- 索引：`tasks(mission_id, status)`、`tasks(assignee_id)`、`runs(task_id)`、`runs(status)`、`runs(receipt_hash)`、`approvals(mission_id, status)`、`events(resource_type, resource_id)`、`events(agent_id)`。
- 外键：`tasks.mission_id → missions.id`、`runs.task_id → tasks.id`、`approvals.run_id → runs.id`、`run_evidence.run_id → runs.id`。
- 一致性约束：`receipt_hash` 与 `prev_receipt_hash` 链上相邻 run 首尾相接，写入时校验（见 §4）；`runs.status` 只能按 §3 转移表走，非法转移写 `events` 告警并拒绝。

---

## 3. 状态机

### 3.1 run 状态（5 态 + 1 瞬态）

执行层的状态机只有 **6 个值**：

```
queued → running → waiting_approval → done
                 ↘ failed（任一异常）
                    ↑
                 stopping（瞬态，≤5s 必归 failed）
```

- `queued`：run 已创建（任务派发、deps 满足），等待 runner 拉起。
- `running`：runner PTY 活跃，心跳 <1s。
- `stopping`（瞬态）：收到 kill，进程死亡中，≤5s 内落 `failed`。
- `waiting_approval`：四门已过（或带软复核标记），等人工决策。
- `failed`：终态异常，附 `fail_reason`；重试＝新 run（新 runId）。
- `done`：审批通过 + merge 前 hash 重算一致，终态。

### 3.2 状态转移表

| From | 触发 / 条件 | To | 附记 |
|---|---|---|---|
| — | 任务派发，deps 全 done | `queued` | |
| `queued` | runner 拉起 | `running` | |
| `running` | 心跳 <1s | `running` | 更新 `heartbeat_at` |
| `running` | kill 请求 | `stopping` | 立即可见 |
| `running` | exit=0 且 G1/G2/G3/G4 全过 | `waiting_approval` | `review_reason=NULL` |
| `running` | exit=0 但 G2 需人审（无改动 claim / 范围外 / 疑似改测试） | `waiting_approval` | 置 `review_reason` |
| `running` | exit≠0 / 崩溃 / SIGKILL | `failed` | `fail_reason=crash/non_zero_exit` |
| `running` | 超时 | `failed` | `timeout` |
| `running` | 心跳丢失 N 秒 | `failed` | `heartbeat_lost` |
| `running` | git 包装拦到违规动词 | `failed` | `git_violation`（先落回执） |
| `running` | 空跑（无 diff 且无无改动 claim） | `failed` | `empty_run` |
| `running` | 证据重算不一致（篡改） | `failed` | `evidence_tamper` |
| `stopping` | 进程死亡 | `failed` | `killed`（端到端 ≤5s） |
| `waiting_approval` | 人审通过 + merge 前 hash 重算一致 | `done` | |
| `waiting_approval` | 人审通过但 hash 重算不一致 | `failed` | `hash_mismatch`（报明哪个变了） |
| `waiting_approval` | 人审拒绝 | `failed` | `rejected` |
| `failed` | 重试策略 → 新 run | `queued` | 新 runId |

### 3.3 办公室视图映射（只渲染 5 态）

办公室（像素层 + 任务焦点板）**只渲染 run 的 5 态**，不新增渲染态：

| run 状态 | 办公室显示 |
|---|---|
| `queued` | `queued` |
| `running` / `stopping` | `running`（`stopping` 附「正在停止…」） |
| `waiting_approval` | `waiting_approval`（附 `review_reason` 文案） |
| `failed` | `failed`（附 `fail_reason` 文案） |
| `done` | `done` |

未派发的任务 = 不渲染（无态）。kill 后经 `GET /missions/stream` SSE 即时推，端到端 ≤5s。

### 3.4 原因枚举（`review_reason` / `fail_reason`）

- `review_reason` ∈ `no_change_claim`（无改动已论证，走人审）、`out_of_scope_diff`（diff 超出 `expected_paths`）、`tampered_test`（`pinnedTests` hash 变更）。
- `fail_reason` ∈ `crash`、`non_zero_exit`、`timeout`、`heartbeat_lost`、`killed`、`empty_run`、`git_violation`、`evidence_tamper`、`hash_mismatch`、`rejected`。

### 3.5 与既有 `task.status` 的关系（两层，不混用）

- **run 状态** = 执行层（本阶段新增），办公室只渲染它。
- **`task.status`** = 规划层（既有 6 态 `queued/assigned/in_progress/review/blocked/done`），保留给任务分解/派发视图。
- 反向驱动：run `done` → task `done`；run `failed` → task `blocked`（附 `fail_reason`）；run `waiting_approval` + `review_reason` → task `review`。

---

## 4. 哈希链与证据绑定

- **run 级哈希链**（对应 §2「加厚」）：`receipt_hash = HMAC(bridge_key, prev_receipt_hash ‖ canonical(runId, diffHash, testOutputHash, claimHash, exitCode))`。全局追加式，删除/重排/截断任一 run 即断链。办公室视图**只读**这条链，永不读工作区。
- **签名密钥**：沿用 `evidence.py` 的 HMAC，key 只在桥状态目录（0600），永不进 SQLite、永不进工作区。
- **审批绑整包**（对应 §8）：审批记录绑定 `{runId, diffHash, testOutputHash, claimHash}`；merge 前重算四项，任一不等 → 审批失效、任务回 `waiting_approval` 并报明哪个 hash 变了（区分「Agent 追加 commit」vs「证据被篡改」）。

---

## 5. 一致性保证（对照 RUNNER_DESIGN 各条）

| 设计条 | 数据模型/状态机落点 |
|---|---|
| §1 完成判定四门 + 声明范围 | `tasks.expected_paths`；四门判据落 `runs`（exit_code/diff_hash/test_output_hash/claim_hash） |
| §2 证据独立性 + 哈希链 | `run_evidence`（bridge 采）+ `runs.receipt_hash/prev_receipt_hash` |
| §3 git 权力边界 | `events(type=git)` 留痕；违规 → `failed(git_violation)` |
| §4 隔离单位 + DAG | `tasks.deps` 拓扑序；`runs.worktree_path`；`tasks.expected_paths` 交集串行化 |
| §5 事后审计 | `run_evidence` + `events` |
| §6 测试可信度 | `tasks.pinned_tests/deliverable_tests/test_command`；变更 → `review_reason=tampered_test` |
| §7 JSON→SQLite | §1 迁移策略；`meta.source_of_truth` 翻转指针 |
| §8 审批时效 | `approvals.run_id/diff_hash/test_output_hash/claim_hash`；merge 前重算 |
| §9 视图一致性 | §3 状态机 + `runs.heartbeat_at`（心跳）+ `stopping` 瞬态 |
| §10 对照验证 | 指标 `time-to-trusted-merge`/`post-merge 缺陷数` 记录于 `runs.started_at/ended_at` + `events`，不新增表 |
