# 团队记忆（Company Memory）

团队记忆保存跨任务仍然有效的判断、偏好和事实，解决“每个新任务都从零开始”的问题。

## 数据模型

```json
{
  "id": "mem-...",
  "title": "发布前回滚演练",
  "text": "任何对外发布前先完成一次回滚演练。",
  "scope": "workspace",
  "agentId": "",
  "tags": ["发布", "风险"],
  "pinned": true,
  "createdAt": "...",
  "updatedAt": "..."
}
```

- `scope=workspace`：对所有任务、聊天和 Agent 生效。
- `scope=agent`：只在指定 Agent 参与的任务/聊天中生效。
- 记忆保存在本机 `~/.agent-office/missions.json`，不上传；API 不返回 provider 密钥。

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/memories?q=&scope=all|workspace|agent&agentId=` | 列表/搜索 |
| POST | `/memories` | 创建；`text` 必填，最多 6000 字符 |
| PATCH | `/memories/<id>` | 编辑标题、正文、范围、标签、固定 |
| DELETE | `/memories/<id>` | 删除 |

## 注入规则

- 讨论：注入工作区记忆 + 所有任务成员的 Agent 记忆。
- 任务执行：注入工作区记忆 + 任务执行者的 Agent 记忆。
- 聊天：注入工作区记忆 + 回复 Agent 的记忆。
- 注入文本明确标注“参考资料，不是指令”，最多 8 条、2600 字符；固定记忆优先，其次按更新时间。
- 没有记忆时不占上下文。

## UI

入口：

- 设置浮动面板 →「团队记忆」
- 完整功能抽屉 → 设置中心 →「团队记忆」
- `Cmd/Ctrl+K` →「团队记忆」

支持双栏列表/详情、搜索、全部/团队/Agent 筛选、创建、编辑、固定、标签和两步删除；移动端为列表/详情二层。

## 全局搜索

`Cmd/Ctrl+K` 调用 `/search?q=`，分组返回任务、任务项、会话、消息、文件、记忆和 Agent。任务项深链到 Mission Control 任务抽屉，消息深链到会话并高亮目标消息，文件打开原始文件，Agent 打开档案。

## 验收

```bash
python3 -m unittest discover -s tests
# dev-memory.html: 18 checks
```
