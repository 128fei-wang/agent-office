# Token 预估、上下文洞察、模型调用与交付验证

## 设计原则

1. **任务不设 Token 上限**：创建任务不再要求 tokenBudget；自动执行不会因预算停止。`tokenBudget` 仅为旧客户端兼容字段，新任务固定为 0。
2. **先预估，再执行**：每个任务根据角色、复杂度、技能匹配和当前负载得到输入/输出 token 预估；任务卡、计划表和评估页均可见。
3. **执行后看真实值**：每次模型调用落台账，记录 Provider、模型、用途、上下文规模、输入/输出、延迟、状态和错误；配置价格表后同时记录按真实 token 计算的成本。
4. **上下文透明**：Mission 详情的 Context Insight 汇总需求、文件、记忆、历史汇报和决策的上下文规模，避免“感觉花了很多但不知道为什么”。

## 价格表与成本

- 在 AI 接入向导的高级设置里填写某 Provider 的**输入/输出价格（每 1M tokens）和币种**；也可以写入 `~/.agent-office/providers.json` 的 `pricing`。
- 每次真实 provider 响应后按 `输入/1M × 输入价 + 输出/1M × 输出价` 计算，存入模型调用台账。
- 「模型调用」面板显示成本统计、每行成本和详情；任务评估页显示模型总成本、每个 Agent 的实际成本和未定价状态。
- 没有价格表的调用显示 `—`，不会把 0 当成免费；价格由用户维护，不包含缓存/批量折扣和税。

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
  "model": "your-model",
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


## Delivery verification (1.24.0)

- Every generated task can be checked from Mission Control → Tasks → **交付验证 / 运行验证**.
- The check records file hashes, sizes, presence, placeholder rejection and syntax/structure results. It does not execute generated applications or project tests.
- `passed` means syntax/structure checks passed; `failed` means a file is missing, empty, placeholder or syntactically invalid; `unverified` means only presence could be established (for example documents or a missing runtime).
- Auto-run blocks a task with a failed check and never marks it done. Passed/unverified tasks continue, with the status visible.
- Endpoint: `POST /missions/<missionId>/tasks/<taskId>/verify`.
- External-agent reports are self-reported until this local verification is run; the UI labels that provenance.


## Real artifact diff (1.25.0)

- A task re-run compares the new artifact set with the previous set by name.
- The task card shows added/modified/removed files, real added/removed line counts and a unified diff preview.
- This is local file evidence; it is not a signed git commit and does not prove runtime correctness.


## Sandboxed test execution (1.26.0)

- A task detail shows **运行测试** only when it has artifacts. The first click asks for confirmation; nothing runs automatically.
- A supported sandbox is mandatory: macOS `sandbox-exec` or Linux `bubblewrap`. Unsupported platforms return **沙箱不可用** and do not run unsandboxed.
- Auto-detects Python `unittest`, Python `pytest` (when installed), and Node `node --test` (Node 18+). The **自定义测试命令** field accepts allowlisted commands such as `pytest -q`, `npm test` or `node --test`.
- The sandbox denies network, denies home-directory reads, writes only inside a throw-away workspace, strips host secrets, bounds output and kills the process group on timeout. Dependencies are not installed.
- The task stores backend, runner, command, exit code, duration, counts, timeout/truncation, isolation metadata and output. A failed or unavailable test is evidence; it does not mark the task done.
- On Windows or a Linux host without usable bubblewrap namespaces, use a disposable VM. This is a process-level sandbox, not a hardened container.

## Evidence receipts (1.26.0)

- Every task report creates a bridge-signed HMAC receipt with the report hash, artifact SHA-256s, sequence number and previous hash.
- In a task card, **证据回执** shows the receipt state, source, sequence/hash and artifact count; **验证回执** re-checks the chain and current files; **导出 JSON** downloads the signed bundle (never the key).
- A changed report or file is shown as **文件或汇报已变更**; an edited/deleted receipt is **回执异常**.
- The receipt proves local receipt/file integrity, not the truth of the report and not external-agent identity. External MCP reports are labeled `mcp-header` / not identity-verified unless signed with the agent’s HMAC key (`agent-hmac`). A separate anchor detects rollback of `evidence.json` alone; rolling back evidence and anchor together is still possible.
- External agents can upload a text deliverable with the MCP tool `agent_office_upload_deliverable` and include its `artifactIds` in `agent_office_report_task`.
