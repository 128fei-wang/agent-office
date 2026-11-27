# 聊天窗口设计与验收（1.20.0）

这一轮把聊天工作台重做成 **Signal Studio**：更大、更安静的 1020×700 双栏空间，墨色夜间与暖纸白天两套主题，左侧会话分段、在线团队、频道眉标、角色标签、快捷输入和重新设计的详情抽屉。群消息入口固定到左侧「工作」上方，未读角标直接可见。

## 参考的 GitHub 产品

按“AI 对话 + 即时通信 + 二次弹窗/浮层”的匹配度，并结合 2026-11-27 的 GitHub star 数，选取以下 5 个产品做功能拆解：

| 排名 | 产品 | Stars | 主要参考 |
|---|---|---:|---|
| 1 | [Open WebUI](https://github.com/open-webui/open-webui) | 159,655 | 会话侧栏、搜索、富文本/代码、附件、流式回复、响应式 |
| 2 | [NextChat](https://github.com/ChatGPTNextWeb/NextChat) | 88,983 | Markdown/LaTeX/代码、话题、提示模板、分享、PWA/移动端 |
| 3 | [LobeHub](https://github.com/lobehub/lobehub) | 86,189 | Agent/群聊、话题、消息操作、文件/图片、跨平台布局 |
| 4 | [LibreChat](https://github.com/LibreChat-AI/LibreChat) | 47,571 | 消息编辑/分支、富文本复制、全局搜索、附件、导入导出 |
| 5 | [Chatwoot](https://github.com/chatwoot/chatwoot) | 40,654 | 网页浮窗、未读、输入态、@提及、canned responses、快捷键盘 |

另参考了 AnythingLLM（68,681 stars）的工作区/文件组织，以及 Gemini Web 的留白、字号层级、消息操作和移动端体验。

## 1.20.0 Signal Studio 设计

- **入口**：左侧顶部「群消息」位于「工作」上方，打开群组模式并显示群组未读角标；「沟通」保留新建群组、私聊和已有群组列表，并显示迁移提示。
- **画布**：1020×700 桌面工作台、300px 会话栏；移动端 100dvh 全屏，聊天列表与消息页二层切换。
- **视觉**：墨色/暖纸双主题、薄荷到天蓝信号强调、30px 网格纹理、20px 频道标题、13px 消息正文、柔和消息卡、浮动输入 dock。
- **结构**：固定/今天/更早三段会话；在线团队头像条；频道眉标、成员角色、LIVE 标记、任务快捷入口。
- **输入**：同步进度 / 请求拍板 / 上传文件三个 quick actions；发送按钮带文字标签与 Enter/Shift+Enter 提示；附件、表情、@ 提及保持原能力。
- **详情**：抽屉起点在频道头以下，不再遮挡页头操作；成员、信息、文件和任务入口保持。
- **回归**：`dev-chat.html` 70 项；新增桌面、移动端和快捷输入断言。

## 1.19.1 入口与路由

- **创建只负责任务**：左侧「创建」和完整功能抽屉不再出现「创建群组」，只保留任务管理；抽屉里保留一行迁移提示。
- **沟通负责新建与已有群组**：浮层提供「新建群组」「私聊」，并异步列出最多 6 个已建群组/任务群，带最新消息与未读角标；群消息入口固定在左侧「工作」上方。
- **直达工作台**：点击顶部「群消息」、「已有群组」、Mission Control 的群组/私聊行，或 Mission Control 的「建群」「私聊」「聊天工作台」按钮，都直接打开本文件的聊天工作台，不再进入旧 Mission 内联聊天或旧 NEW GROUP 表单。
- **无活跃会话时**：Mission Control 的「聊天工作台」打开会话列表，而不是空建群表单；「建群」才进入建群表单。
- **回归覆盖**：`dev-features.html` 校验创建/沟通分组和迁移提示；`dev-missions.html` 校验 Mission 群组行、私聊入口、建群入口和头部工作台入口的路由。

## 本轮吸收的功能

| 能力 | 参考 | 实现 |
|---|---|---|
| 双栏会话工作台 | Open WebUI / LobeHub / Chatwoot | 1020×700 工作台、300px 会话列表 + 消息主区；移动端自动切成列表/对话两层 |
| 会话搜索、群聊/私聊过滤、最近会话 | Open WebUI / Chatwoot | 侧栏搜索、全部/群聊/私聊 tab、最近消息预览 |
| 未读与已读 | Chatwoot | bridge 持久化 `readSeq`；侧栏未读角标、打开会话自动已读、静音会话不计入总未读 |
| 固定 / 静音 / 重命名 / 删除 | Chatwoot / LibreChat | 会话菜单 + PATCH 接口；固定置顶、静音降级、群聊重命名、非任务会话可删除 |
| 消息分组、日期分隔、时间 | Gemini / Open WebUI | 今天/昨天/日期分隔，5 分钟内同发送者合并，悬浮显示时间 |
| Markdown / 代码块 | NextChat / LibreChat | 标题、列表、引用、粗体、斜体、链接、行内代码、围栏代码块与复制按钮；全部经过转义 |
| 消息操作 | LibreChat / Open WebUI | 复制、引用回复、打开任务；自己的消息显示送达勾选 |
| 引用回复 | Chatwoot / IM | 引用条 + 消息内引用卡片，引用内容随消息持久化 |
| 附件 | Open WebUI / Chatwoot | 多文件上传、图片预览、文件卡片、拖放/粘贴上传、25 MB/6 个限制 |
| @提及 | Chatwoot | 群聊内输入 `@` 弹出成员建议，方向键选择，回车插入；bridge 会把回复路由给被 @ 的 Agent |
| 输入态 | Chatwoot / Gemini | 「Agent 正在输入…」；不会被任务执行汇报误清，只由真正的聊天回复结束 |
| 增量实时 | Open WebUI / Chatwoot | `/missions/stream` 消息事件触发增量刷新；3 秒轮询兜底，AI 回复通常 <1 秒出现 |
| 草稿 | LibreChat / Gemini | 每个会话独立草稿，切换/关闭/重开不丢失 |
| 会话详情与文件 | Chatwoot / AnythingLLM | 成员列表、在线状态、角色、创建时间、消息数、会话文件、任务入口；详情从频道头下方展开 |
| 在线团队与频道头 | Chatwoot / Gemini | 在线头像条、频道眉标、成员角色、LIVE 标记、任务快捷入口 |
| 快捷输入 | Gemini / Chatwoot | 同步进度、请求拍板、上传文件三个 quick actions；发送按钮带标签与键盘提示 |
| 快捷键与无障碍 | Chatwoot / Gemini | Enter 发送、Shift+Enter 换行、Esc 关闭、Cmd/Ctrl+F 消息搜索、焦点陷阱、focus-visible、aria 标签、reduced-motion |
| 浅色主题与移动端 | Gemini | 完整 day palette、430px 全屏 bottom sheet、安全区、触屏可见操作 |
| 欢迎态 / 空态 / 错误态 | Gemini | 欢迎页、统计、快捷入口、无消息提示、bridge 错误、上传失败提示 |

暂未在本轮落地的能力：token 级流式渲染、消息分支/编辑重发、跨会话全文搜索、语音/视频、端到端加密。它们不影响这一轮的 9.8 验收，但已列入后续路线。

## Gemini 口径的验收 checklist

- [x] 正文 13px，层级清楚；会话标题 12px、频道标题 20px、眉标 8px。
- [x] 4/8px 间距体系；消息、卡片、快捷条和输入 dock 有稳定的留白节奏。
- [x] 深色/浅色都有 ≥ WCAG AA 的正文对比度；浅色主题下 report/card 文本单独校正。
- [x] 所有可交互元素有 hover / focus-visible / disabled 状态；键盘可完成发送、搜索、切换会话、引用、关闭。
- [x] 弹窗具备 `role="dialog"`、`aria-modal`、焦点陷阱与 Esc 关闭；关闭后焦点回到触发按钮。
- [x] 移动端 100dvh 全屏、无横向溢出、触屏操作可见；输入区避开 safe-area，聊天列表和消息页二层切换。
- [x] 支持 `prefers-reduced-motion`；连续动画可被系统设置关闭。
- [x] 空态、加载态、发送失败、上传失败、bridge 离线都有明确提示。
- [x] 消息内容先转义再渲染 Markdown；链接仅允许 `http(s)`，新窗口带 `noopener noreferrer`。
- [x] 未读、已读、固定、静音、重命名、附件、草稿真实持久化，刷新不丢。

## 验证

```bash
python3 -m unittest discover -s tests -v
# dev-chat.html 覆盖 70 项聊天窗口检查
# dev-features.html 覆盖左侧导航、创建/沟通分组与设置
# dev-missions.html 覆盖 Mission Control 到聊天工作台的路由
```

`dev-chat.html` 会创建临时群聊/私聊、验证 Markdown/代码、引用、搜索、附件、固定、重命名、未读、快捷输入、桌面/移动布局、详情面板和关闭清理，不触碰真实任务内容。
