# RUNNER_DATA_MODEL — Phase 1「真实执行 MVP」数据模型与状态机

> 状态：设计定稿（本阶段只交设计，不写实现）
> 配套：`docs/RUNNER_DESIGN.md`（十条设计决策）、`docs/THREAT_MODEL.md`（威胁模型）
> 范围：本文件锁定 Phase 1 的两块设计产出——**数据模型**（missions.json → SQLite 表结构 + 迁移映射，对应 RUNNER_DESIGN 第 7 条）与**状态机**（run 生命周期 + 转移 + 办公室视图映射，对应第 1、3、6、8、9 条）。

---

## 1. 迁移策略（对应 RUNNER_DESIGN 第 7 条）

- **引擎**：stdlib `sqlite3`，`journal_mode=WAL` + `synchronous=FULL` + `foreign_keys=ON` + `busy_timeout`（写锁串行化）。
- **维护模式**：迁移全程进维护模式，bridge **停写** missions.json（新写入排队/拒绝并提示）——源只读在**整个系统**成立，解决「迁移期间 bridge 仍在写」的双写冲突。
- **可重入幂等**：源 `missions.json` 全程只读；按 mission（或批次）单事务写入，事务中断自动回滚，重跑从断点续。
- **cutover 与回退**：cutover = 翻转 `meta.source_of_truth`；**回退前先给 SQLite 拍快照 + 保留 WAL**，回退 = 指针翻回 + 回放 post-cutover 写入到 JSON（不丢 cutover 后的写入）。旧 JSON 归档不删。
- **schema_version + 迁移框架**：`meta` 存 `schema_version`；后续 schema 变更走同一框架（版本 → 脚本 → 事务 → 校验）。
- **连接模型**：连接**按线程创建、不复用跨线程**（sqlite3 连接非线程安全）。
- **演练验收**：`test_migration.py` 用真实 1.5MB `missions.json` 跑 10 次、随机点 `SIGKILL`，事后行数 + 校验和必须与干净跑一致（不丢、不重、不漏）。
- **命名约定**：既有 JSON 的 camelCase 字段平移到 snake_case 列；嵌套结构保留为 JSON 文本列，只在需要索引/过滤的字段（status、assignee、hash、时间）拆成真列。

---

## 2. SQLite 表结构

### 2.1 既有实体（从 missions.json 平移，字段一一对应）

**`missions`** — 任务本体（字段与上版一致，略去逐列重复，见 v1 文档；关键列 `id/status/priority/deadline/members/rules/charter/auto_run/artifact_ids/created_at/updated_at`）

**`tasks`** — 任务分解（Phase 1 在既有字段上**新增**声明范围/测试清单列）

| 列 | 类型 | 来源/新增 | 说明 |
|---|---|---|---|
| `id` / `mission_id` / `key` / `title` / `brief` / `role` / `acceptance` / `deliverable` | TEXT | 同名 | |
| `deps` / `required_skills` / `artifact_ids` / `estimate` / `actual` / `report` / `verification` / `test_run` / `usages` | JSON | 同名 | |
| `assignee_id` / `assignee_name` | TEXT | 同名 | |
| `status` | TEXT | `status` | 规划层 6 态，见 §3.5 |
| `priority` | TEXT | `priority` | |
| `created_at` / `updated_at` | TEXT | 同名 | |
| `expected_paths` | JSON NULL | **新增**（§1） | 声明改动范围，diff 落在范围外转人审 |
| `pinned_tests` | JSON NULL | **新增**（§6） | 钉死的测试面（文件 + 配置 + fixtures + 环境变量），创建时自动生成 |
| `deliverable_tests` | JSON NULL | **新增**（§6） | 本次要新增/改的测试文件 |
| `test_command` | TEXT NULL | **新增**（§6） | 验收命令，bridge 侧存储、Agent 不可改 |
| `test_command_hash` | TEXT NULL | **新增**（§6） | 测试命令 hash，随审批展示 |
| `no_tests` | INTEGER | **新增**（§12 B2） | 1 = 文档类任务，G3 由 diff+人审兜 |
| `base_commit` | TEXT NULL | **新增**（§4） | 派发时锁定的固定 commit hash（非分支名） |
| `merge_target` | TEXT NULL | **新增**（§8） | merge 目标 ref |

**`conversations` / `messages` / `artifacts` / `memories` / `model_calls`** — 平移保留既有结构，字段一一对应。

**`approvals`** — 审批（Phase 1 对执行类审批新增 run 绑定列）

| 列 | 类型 | 来源/新增 | 说明 |
|---|---|---|---|
| `id` / `mission_id` / `type` / `title` / `description` / `service` / `amount` / `currency` / `options` / `scopes` / `requested_by` / `task_id` / `attachment_ids` / `status` / `resolution` / `created_at` / `resolved_at` | — | 同名 | |
| `run_id` | TEXT NULL | **新增**（§8） | 执行类审批绑 run |
| `base_commit` | TEXT NULL | **新增**（§8） | 审批时锁定的 base |
| `merge_target` | TEXT NULL | **新增**（§8） | 审批时锁定的 merge 目标 |
| `diff_hash` / `test_output_hash` / `claim_hash` / `test_command_hash` | TEXT NULL | **新增**（§8） | 审批绑整包，非只绑 diffHash |

**`meta`** — 单例表：`key` TEXT PK / `value` JSON。存 `next` 计数器、`source_of_truth` 迁移指针、`schema_version`。

### 2.2 Phase 1 新增实体

**`runs`** — 一次真实执行的生命周期（本阶段核心）

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | `run_…`（= runId） |
| `task_id` / `mission_id` | TEXT → FK | 归属 |
| `status` | TEXT | 5 态 + 1 瞬态，见 §3 |
| `worktree_path` | TEXT | per-task linked worktree 绝对路径 |
| `base_commit` / `head_commit` | TEXT NULL | 相对 base 的 diff 两端（base 为固定 commit hash） |
| `merge_target` | TEXT NULL | merge 目标 ref |
| `exit_code` | INTEGER NULL | 进程退出码 |
| `diff_hash` / `test_output_hash` / `claim_hash` / `test_command_hash` | TEXT NULL | bridge 重算，**Agent 提交的值一律忽略** |
| `receipt_hash` | TEXT NULL | 本 run 证据回执 hash |
| `prev_receipt_hash` | TEXT NULL | 上一条 run 的回执 hash（run 级哈希链） |
| `session_pgid` | INTEGER NULL | runner PTY 进程组 ID（`start_new_session`，供重启接管） |
| `token_hash` | TEXT NULL | run-scoped token 的 HMAC（只存 hash，不存明文） |
| `frozen` | INTEGER | worktree 是否已冻结（审批前置） |
| `review_reason` | TEXT NULL | 见 §3.4 |
| `fail_reason` | TEXT NULL | 见 §3.4 |
| `blocked_note` | TEXT NULL | 护栏停因，人读 |
| `heartbeat_at` | TEXT | 心跳时间戳（<1s 更新） |
| `started_at` / `ended_at` | TEXT NULL | |

**`run_evidence`** — bridge 采集的原始证据（工作区外）

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | |
| `run_id` | TEXT → FK | |
| `kind` | TEXT | `diff / test_output / exit / claim`（diff 含 untracked，见 §12 B3） |
| `content_hash` | TEXT | 内容哈希 |
| `content` | TEXT/BLOB | 采集到的原文（二进制只存 hash + 标记 `binary`） |
| `collected_by` | TEXT | 恒为 `bridge` |
| `created_at` | TEXT | |

**`run_tokens`** — run-scoped token（claim 归属）

| 列 | 类型 | 说明 |
|---|---|---|
| `run_id` | TEXT → FK | |
| `token_hash` | TEXT | token 的 HMAC（只存 hash） |
| `agent_id` | TEXT | 归属 Agent（校验 token→runId→agentId 三元组） |
| `created_at` / `expires_at` | TEXT | 一次性/限时 |

**`events`** — 读审计 + 事件流（对应第 7 条读审计、第 3 条 git 留痕、第 11 条 C5 可观测性）

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | |
| `type` | TEXT | `read / write / git / evidence / run / approval / heartbeat / restart / kill` |
| `agent_id` | TEXT NULL | 谁 |
| `resource_type` / `resource_id` | TEXT | 读了/动了什么 |
| `payload` | JSON | 详情 |
| `created_at` | TEXT | |

### 2.3 索引与约束

- 索引：`tasks(mission_id, status)`、`tasks(assignee_id)`、`runs(task_id)`、`runs(status)`、`runs(receipt_hash)`、`runs(heartbeat_at)`、`approvals(mission_id, status)`、`events(resource_type, resource_id)`、`events(agent_id)`、`run_tokens(run_id)`。
- 外键：`tasks.mission_id → missions.id`、`runs.task_id → tasks.id`、`approvals.run_id → runs.id`、`run_evidence.run_id → runs.id`、`run_tokens.run_id → runs.id`。
- 一致性约束：`receipt_hash` 与 `prev_receipt_hash` 链上相邻 run 首尾相接，写入时校验（见 §4）；`runs.status` 只能按 §3 转移表走，非法转移写 `events` 告警并拒绝。

---

## 3. 状态机

### 3.1 run 状态（5 态 + 1 瞬态）

```
queued → running → waiting_approval → done
                 ↘ failed（任一异常）
                    ↑
                 stopping（瞬态，≤5s 必归 failed）
```

- `queued`：run 已创建（任务派发、deps 满足），等待 runner 拉起。
- `running`：runner PTY 活跃，心跳 <1s。
- `stopping`（瞬态）：收到 kill，进程死亡中，≤5s 内落 `failed`。
- `waiting_approval`：四门已过（或带软复核标记），等人工决策；此时 worktree 已冻结。
- `failed`：终态异常，附 `fail_reason`；重试＝新 run（新 runId）。
- `done`：审批通过 + merge 前 hash 重算一致（锁内完成），终态。

### 3.2 状态转移表

| From | 触发 / 条件 | To | 附记 |
|---|---|---|---|
| — | 任务派发，deps 全 done，base_commit 锁定 | `queued` | |
| `queued` | runner 拉起（注入 run token） | `running` | |
| `running` | 心跳 <1s | `running` | 更新 `heartbeat_at` |
| `running` | kill 请求 | `stopping` | 立即可见 |
| `running` | exit=0 且 G1/G2/G3/G4 全过 | `waiting_approval` | `review_reason=NULL`，worktree 冻结 |
| `running` | exit=0 但需人审（无改动 claim / 范围外 / 疑似改测试） | `waiting_approval` | 置 `review_reason` |
| `running` | exit≠0 / 崩溃 / SIGKILL | `failed` | `fail_reason=crash/non_zero_exit` |
| `running` | 超时 | `failed` | `timeout` |
| `running` | 心跳丢失 N 秒 | `failed` | `heartbeat_lost` |
| `running` | git 包装拦到违规动词 | `failed` | `git_violation`（先落回执） |
| `running` | 空跑（无 diff 且无无改动 claim） | `failed` | `empty_run` |
| `running` | 证据重算不一致（篡改） | `failed` | `evidence_tamper` |
| `running` | bridge 重启、PID 死亡/会话丢失 | `failed` | `orphaned`（启动扫描一次到位） |
| `running` | bridge 重启、PID 仍活 | `running` | 重连接管，续心跳监督 |
| `stopping` | 进程死亡 | `failed` | `killed`（端到端 ≤5s） |
| `waiting_approval` | 人审通过 + merge 前 hash 重算一致（锁内） | `done` | |
| `waiting_approval` | 人审通过但 hash 重算不一致 | `failed` | `hash_mismatch`（报明哪个变了：diff/test/claim/testCommand/base） |
| `waiting_approval` | 人审拒绝 | `failed` | `rejected` |
| `failed` | 重试策略 → 新 run | `queued` | 新 runId |

### 3.3 办公室视图映射（只渲染 5 态）

| run 状态 | 办公室显示 |
|---|---|
| `queued` | `queued` |
| `running` / `stopping` | `running`（`stopping` 附「正在停止…」） |
| `waiting_approval` | `waiting_approval`（附 `review_reason` 文案） |
| `failed` | `failed`（附 `fail_reason` 文案） |
| `done` | `done` |

未派发的任务 = 不渲染（无态）。kill 后经 `GET /missions/stream` SSE 即时推，端到端 ≤5s。

### 3.4 原因枚举（`review_reason` / `fail_reason`）

- `review_reason` ∈ `no_change_claim`（无改动已论证）、`out_of_scope_diff`（diff 超出 `expected_paths`）、`tampered_test`（pinned 测试面 hash 变更）。
- `fail_reason` ∈ `crash`、`non_zero_exit`、`timeout`、`heartbeat_lost`、`killed`、`empty_run`、`git_violation`、`evidence_tamper`、`hash_mismatch`、`rejected`、`orphaned`。

### 3.5 与 `task.status` 的完整映射（两层，不混用；含 cancelled/stopped/timeout）

**run 状态** = 执行层（办公室只渲染它）；**`task.status`** = 规划层（既有 6 态 `queued/assigned/in_progress/review/blocked/done`）。

| run.status | task.status（反向驱动） | 备注 |
|---|---|---|
| `queued` | `queued`（若已 assigned 则保持 assigned） | |
| `running` | `in_progress` | |
| `stopping` | `in_progress`（UI 附「停止中」） | 瞬态不落 task |
| `waiting_approval`（review_reason=NULL） | `review` | |
| `waiting_approval`（review_reason≠NULL） | `review`（附 reason） | |
| `done` | `done` | |
| `failed`（crash/non_zero_exit/timeout/heartbeat_lost/orphaned） | `blocked`（附 fail_reason） | |
| `failed`（killed） | `blocked`（= cancelled，附 killed） | 区分「用户取消」与「崩溃」 |
| `failed`（rejected） | `blocked`（= 人审拒绝） | |

**「任务 done 但 run failed」不得出现**：run 是唯一真相源，task.status 只是它的投影；任何 task.status 变更只能由 run 转移驱动，不反向手写。`cancelled` / `timeout` 不单独设 run 态，统一并入 `failed` + 对应 `fail_reason`（`killed` / `timeout`），避免状态爆炸。

---

## 4. 哈希链与证据绑定

- **run 级哈希链**（对应 §2「加厚」）：`receipt_hash = HMAC(bridge_key, prev_receipt_hash ‖ canonical(runId, diffHash, testOutputHash, claimHash, testCommandHash, exitCode, baseCommit))`。全局追加式，删除/重排/截断任一 run 即断链。办公室视图**只读**这条链，永不读工作区。
- **签名密钥**：沿用 `evidence.py` 的 HMAC，key 只在桥状态目录（0600）。**注意**：0600 不防同 UID 的 Agent 读，安全意义见 `docs/THREAT_MODEL.md`——证据签名是「防事后篡改 + 审计锚」，不是「防 Agent 本机作恶」。
- **审批绑整包**（对应 §8）：审批记录绑定 `{baseCommit, mergeTarget, runId, diffHash, testOutputHash, claimHash, testCommandHash}`；merge 在同一个锁内完成「重算 → 比对 → 写入」，任一不等 → 审批失效、任务回 `waiting_approval` 并报明哪个 hash 变了。

---

## 5. 一致性保证（对照 RUNNER_DESIGN 各条）

| 设计条 | 数据模型/状态机落点 |
|---|---|
| §1 完成判定四门 + 声明范围 | `tasks.expected_paths`；四门判据落 `runs`（exit_code/diff_hash/test_output_hash/claim_hash） |
| §2 证据独立性 + 哈希链 + run token | `run_evidence`（bridge 采）+ `runs.receipt_hash/prev_receipt_hash` + `run_tokens` |
| §3 git 权力边界 | `events(type=git)` 留痕；违规 → `failed(git_violation)` |
| §4 隔离单位 + DAG + 固定 base | `tasks.deps` 拓扑序；`runs.worktree_path`；`tasks.base_commit`（固定 hash）；`tasks.expected_paths` 交集串行化 |
| §5 事后审计 | `run_evidence` + `events` |
| §6 测试可信度 | `tasks.pinned_tests/deliverable_tests/test_command/test_command_hash/no_tests`；变更 → `review_reason=tampered_test` |
| §7 JSON→SQLite | §1 迁移策略（维护模式 + schema_version + 快照回退）；`meta.source_of_truth` |
| §8 审批时效 | `approvals.run_id/base_commit/merge_target/diff_hash/test_output_hash/claim_hash/test_command_hash`；merge 锁内重算 |
| §9 视图一致性 + 重启接管 | §3 状态机 + `runs.heartbeat_at` + `runs.session_pgid`（接管）+ `events(type=restart/kill/heartbeat)` |
| §10 对照验证 | 指标记录于 `runs.started_at/ended_at` + `events`，不新增表 |
| §11 并发/回收/可观测性 | `runs.status` 队列 + `events` 事件流 + 磁盘/分支回收策略 |
| §12 B2/B3/B8 | `tasks.no_tests` + `run_evidence.kind=diff`（含 untracked）+ `run_tokens` |
