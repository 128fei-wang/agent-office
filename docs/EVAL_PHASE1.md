# EVAL_PHASE1 — Phase 1「真实执行 MVP」黑盒验收评测

配套 `scripts/eval_phase1.py`。这是对 `docs/RUNNER_DESIGN.md` 十条设计的**可执行验收**：只经 HTTP / CLI / 落盘产物（git diff、SQLite、evidence bundle、日志）断言，不 import runner/bridge 内部函数。

## 环境要求

- Python 3.9+，**只用标准库**（无第三方依赖、无网络、无交互）。
- 本机有 `git`（临时仓库用 `git init` + 本地提交，不配 remote、不 push/fetch）。
- 运行用户对 `tempfile.gettempdir()` 有写权限（全部状态写临时目录）。

## 运行

```bash
# 仓库根目录
python3 scripts/eval_phase1.py --json /tmp/eval-phase1.json   # 全量，结果写 JSON
python3 scripts/eval_phase1.py --case g1_exit0_done            # 单跑一个用例
python3 scripts/eval_phase1.py --list                          # 列出全部用例
```

**退出码**：`0` 全过或仅有 SKIP；`1` 存在 fail；`2` 参数错误。

## 隔离与安全（实现方式）

- 每个用例 `tempfile.mkdtemp()` 独立临时目录；bridge 经 `BRIDGE_STATE_DIR` / `BRIDGE_STATE` / `BRIDGE_PROVIDERS` 指向临时目录，**不读写真实 `~/.agent-office`**。
- 每用例独立空闲端口（`bind 0` 取端口）、独立临时 git 仓库（`git init` + 本地提交）。
- 子进程 `start_new_session=True`（独立进程组），结束 `killpg(SIGKILL)` 并 `rmtree` 清理；不杀非本评测进程。
- 评测前后对**当前仓库**做 `git status --porcelain` + `HEAD` 快照比对，写入 JSON 的 `repo_unchanged`，不一致则 `repo_diff_before_after` 给出差异。
- 单用例超时 ≤ 60s，总超时 ≤ 10min；超时判 fail 并记实际输出。
- **不 push / fetch 远端，不改用户 git 配置**（临时仓库用仓库内 `git config`，不碰 `~/.gitconfig`）。

## 覆盖矩阵（映射 RUNNER_DESIGN 条款，每条正向 + 反向）

| 用例 id | 条款 | 正向/反向 | 断言 |
|---|---|---|---|
| g1_exit0_done | §1 G1 | 正 | 退出码 0 → done |
| g1_nonzero_fail | §1 G1 | 反 | 退出码非 0 → 不得 done（`non_zero_exit`） |
| g1_timeout_fail | §1 G1 | 反 | 超时 → 不得 done（`timeout`） |
| g1_sigkill_fail | §1 G1 | 反 | SIGKILL → 不得 done（`killed`） |
| g2_diff_pass | §1 G2 | 正 | 有 diff → 通过 |
| g2_empty_diff_blocked | §1 G2 | 反 | 空 diff 无 claim → blocked（`empty_run`） |
| g2_empty_diff_claim_review | §1 G2 | 正 | 空 diff + claim → 人审，不自动 done |
| g2_untracked_in_diff | §12 B3 | 反 | untracked 新文件进 diffHash（只 add 部分验证未跟踪也采集） |
| g3_test_pass | §1 G3 | 正 | 任务声明的测试通过 → done |
| g3_test_fail | §1 G3 | 反 | 测试失败 → 不得 done |
| g3_no_tests_doc | §12 B2 | 规则 | 文档类 `no_tests` 不得静默 done |
| g3_custom_cmd_not_allowlist | §12 B2 | 反 | 自定义命令不在 allowlist → 明确 SKIP/失败原因 |
| g4_submit_normal | §2 G4 | 正 | submit_evidence 正常签发回执 |
| g4_forged_runid | §2 B8 | 反 | 伪造 runId → 拒绝 |
| g4_missing_token | §2 B8 | 反 | 缺 run token → 拒绝 |
| g4_duplicate_submit | §2 G4 | 反 | 重复提交 → 拒绝 |
| g4_agent_hash_ignored | §2 | 正 | Agent 提交的 hash 字段被忽略（篡改 hash 不影响最终证据） |
| tamper_pinned | §6 | 反 | pinnedTests 被改 → 不得自动 done |
| tamper_config | §6 B4 | 反 | conftest / pytest.ini / package.json scripts 被改 → 拦截 |
| tamper_deliverable | §6 | 正 | deliverableTests 新增 → 允许并记录 |
| approval_modify_after | §8 B5 | 反 | 批准后改工作区 → 审批失效、merge 阻断 |
| approval_diff_base | §8 B5 | 反 | 同 diff 不同 baseCommit → 审批不通用 |
| approval_not_stopped | §8 B5 | 反 | 审批前 run 未 stop → 拒绝 merge |
| restart_orphan | §9 A3 | 正/反 | bridge 重启后无主 run 归 failed(orphaned) 或重连，不得永远 running |
| isolation_second_bridge | 安全评审 #6 | 反 | 第二个 bridge 共用 STATE_DIR → 拒绝启动 |
| isolation_expected_paths_conflict | §4 | 反 | 两个任务 expectedPaths 冲突 → 串行或 merge-prep 报冲突 |
| migration_10x | §7 B6 | 正 | 真实 missions.json 迁 10 次 + 随机 SIGKILL，行数/校验和一致 |
| migration_rollback | §7 B6 | 正 | cutover 后回退可用 |
| view_5state_map | §9 B7 | 正 | run 5 态 ↔ task 状态映射一致 |
| view_kill_5s | §9 | 正 | kill 后 ≤5s 事件流出现 failed |
| negative_reason | §9 C5 | 正 | 每类失败带可读 reason + 证据，不裸 500 |

## 期望输出

JSON 顶层：`commit`、`startedAt`、`runner_implemented`、`submit_evidence_implemented`、`migration_implemented`、`summary{passed,failed,skipped}`、`cases[]`、`repo_unchanged`、`finishedAt`。

每个用例：`id`、`title`、`clause`、`expected`、`actual`、`status`(pass/fail/skip)、`duration_sec`、`evidence_path`、`repro`。

## 已知 SKIP（当前状态）

- **依赖 runner 实现的用例（G1–G3、审批、重启、expectedPaths 冲突、视图）**：`runner.py` 未落地时全部 SKIP，理由「runner 实现未落地（三处验收变更待老板签字）」。这是显式前置，不是把失败吞成 skip。
- **依赖 submit_evidence 的用例（g4_*）**：`bridge.py` 尚无 `submit_evidence` 工具时 SKIP。
- **依赖 migration 的用例（migration_*）**：`migration.py` 未落地时 SKIP。

## 已确认的真实缺口（评测先于实现发现）

- `isolation_second_bridge`（安全评审 #6「无单实例锁」）：当前 bridge 允许第二个实例共用同一 `BRIDGE_STATE_DIR` 正常启动，会互相覆盖写。**列为实现轮必修**，落地单实例锁后此用例应转绿。

## 验收口径

- 实现落地后（三处验收变更经老板签字），同一评测命令应得到 `0 failed`（依赖实现的用例从 SKIP 转 pass）。
- `negative_reason`、`isolation_second_bridge` 两个「先于实现即可验证」的用例，现在即可运行并给真实结果。
