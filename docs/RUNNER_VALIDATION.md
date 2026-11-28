# RUNNER_VALIDATION — 第 10 条对照验证协议与结论

> 状态：协议已定稿、指标已落地（`runs.merged_at` + `runs.post_merge_defects` +
> `agentdb.run_metrics()` + eval `metric_ttm`）。**数据未采集**：n=3 真实用户
> 属外部依赖（待老板提供）；此前先自跑 A 臂当 1 个数据点存档。

## 1. 指标（老板 11-28 签字「三处都接受」后定稿）

| 指标 | 定义 | 落点 |
|---|---|---|
| `time-to-trusted-merge` | 任务从 run 建立（`started_at`）到人审通过并入 done（`merged_at`）的墙钟时长 | `runs.started_at` → `runs.merged_at` |
| `post-merge 缺陷数` | 合并后暴露的缺陷数（人工回填） | `runs.post_merge_defects` |

**审批 + 取证开销单列**：不在「合并时钟」里混算，而是从 `approvals`（`created_at`
→ `resolved_at`）与取证耗时单独读出——要回答的问题是「多花的审批/取证时间，换回了
多少 post-merge 缺陷的减少」，不是「谁裸跑更快」。

## 2. 双臂协议

- **A 臂**：同一任务直接开 Claude Code 终端做，记墙钟 + 结果质量。
- **B 臂**：同一任务走本产品 runner（四门 + 人审 + merge）。
- **A 臂自跑必须记录机器/模型/任务版本**，否则数据点不可比。
- n=3 只给方向性结论，不撑「本产品更优」的断言。

## 3. 如何取数

```bash
BRIDGE_STATE_DIR=~/.agent-office python3 scripts/validation_metrics.py
# 输出每个 done run 的 started_at / merged_at / time-to-trusted-merge / post_merge_defects
```

或直接读库：

```sql
SELECT id, started_at, merged_at,
       (julianday(merged_at) - julianday(started_at)) * 86400.0 AS ttm_sec,
       post_merge_defects
FROM runs WHERE status = 'done';
```

## 4. 当前数据点

- **A 臂自跑**：待采集（1 个数据点存档）。
- **B 臂真实用户**：待老板提供 3 个真实用户。

## 5. 结论

**暂无**（数据未采集，不编数字）。等 A 臂 1 个数据点 + B 臂 n=3 到位后再给结论。
