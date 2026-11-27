# Token 预估、上下文洞察与模型调用

## 设计原则

1. **任务不设 Token 上限**：创建任务不再要求 tokenBudget；自动执行不会因预算停止。`tokenBudget` 仅为旧客户端兼容字段，新任务固定为 0。
2. **先预估，再执行**：每个任务根据角色、复杂度、技能匹配和当前负载得到输入/输出 token 预估；任务卡、计划表和评估页均可见。
3. **执行后看真实值**：每次模型调用落台账，记录 Provider、模型、用途、上下文规模、输入/输出、延迟、状态和错误。
4. **上下文透明**：Mission 详情的 Context Insight 汇总需求、文件、记忆、历史汇报和决策的上下文规模，避免“感觉花了很多但不知道为什么”。

## 上下文估算

- `baseChars`：标题、描述、验收、规则。
- `artifactChars`：最近 16 个带文本的附件/交付物。
- `memoryChars`：工作区 + 当前成员 Agent 记忆（上限 8 条）。
- `reportChars`：已完成任务的 summary + solution。
- `decisionChars`：决策 topic + outcome。
- `contextTokens ≈ contextChars / 3.2`。
- `estimatedInputTokens = Σ task.estimate.tokens × 0.6`；`estimatedOutputTokens = Σ × 0.4`。
- 这些是预估值，不阻断执行；真实值以模型调用台账为准。

## 模型调用台账

字段：

```json
{
  "id": "call-...",
  "createdAt": "2026-11-27T...",
  "provider": "anthropic",
  "model": "deepseek-flash[1m]",
  "purpose": "task|discussion|deliverable|chat",
  "missionId": "", "missionTitle": "",
  "taskId": "", "taskTitle": "",
  "agentId": "", "agentName": "",
  "promptChars": 0, "systemChars": 0, "contextTokens": 0,
  "tokensIn": 0, "tokensOut": 0, "durationMs": 0,
  "ok": true, "error": "", "fallback": ""
}
```

- 最多保留 800 条。
- 不保存 prompt/response 正文，不记录 API Key。
- 历史任务 `usages`、任务群报告 usage 和讨论 usage 会在首次加载时回填为调用记录（`fallback: history`），所以升级后立即可查。

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/model-calls?limit=&missionId=&taskId=&purpose=&q=` | 调用记录 + 汇总（输入/输出/平均延迟/失败） |
| GET | `/missions/<id>` | 详情含 `contextInsight` |
| POST | `/missions/<id>/tasks/<taskId>/rerun` | 重新交付并生成调用记录 |

## UI

- 设置浮动面板 / 完整抽屉 →「模型调用」
- `Cmd/Ctrl+K` →「模型调用」
- Mission Control → 评估 → Context Insight →「查看模型调用明细」

面板提供调用数、输入/输出 token、平均延迟、失败数；Mission/用途筛选；搜索；行详情。

## 验证

```bash
python3 -m unittest discover -s tests
# dev-usage.html: 16 checks
# dev-missions.html: 114 checks
```
