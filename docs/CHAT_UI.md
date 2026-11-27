# 聊天窗口设计与验收（1.19.0）

这一轮把左侧「群聊弹窗 / 单聊弹窗」从“能发消息”升级成一个可长期使用的即时通信工作台，并同步增强了 Mission Control 的任务群/私聊阅读体验。

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

## 本轮吸收的功能

| 能力 | 参考 | 实现 |
|---|---|---|
| 双栏会话工作台 | Open WebUI / LobeHub / Chatwoot | 274px 会话列表 + 消息主区；移动端自动切成列表/对话两层 |
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
| 会话详情与文件 | Chatwoot / AnythingLLM | 成员列表、在线状态、角色、创建时间、消息数、会话文件、任务入口 |
| 快捷键与无障碍 | Chatwoot / Gemini | Enter 发送、Shift+Enter 换行、Esc 关闭、Cmd/Ctrl+F 消息搜索、焦点陷阱、focus-visible、aria 标签、reduced-motion |
| 浅色主题与移动端 | Gemini | 完整 day palette、430px 全屏 bottom sheet、安全区、触屏可见操作 |
| 欢迎态 / 空态 / 错误态 | Gemini | 欢迎页、统计、快捷入口、无消息提示、bridge 错误、上传失败提示 |

暂未在本轮落地的能力：token 级流式渲染、消息分支/编辑重发、跨会话全文搜索、语音/视频、端到端加密。它们不影响这一轮的 9.8 验收，但已列入后续路线。

## Gemini 口径的验收 checklist

- [x] 正文 ≥ 12px，层级清楚；会话标题 11.5px、正文 12.5px、页头 14px。
- [x] 8px 间距体系；消息、卡片、输入区有稳定的留白节奏。
- [x] 深色/浅色都有 ≥ WCAG AA 的正文对比度；浅色主题下 report/card 文本单独校正。
- [x] 所有可交互元素有 hover / focus-visible / disabled 状态；键盘可完成发送、搜索、切换会话、引用、关闭。
- [x] 弹窗具备 `role="dialog"`、`aria-modal`、焦点陷阱与 Esc 关闭；关闭后焦点回到触发按钮。
- [x] 移动端全屏、无横向溢出、触屏操作可见；输入区避开 safe-area。
- [x] 支持 `prefers-reduced-motion`；连续动画可被系统设置关闭。
- [x] 空态、加载态、发送失败、上传失败、bridge 离线都有明确提示。
- [x] 消息内容先转义再渲染 Markdown；链接仅允许 `http(s)`，新窗口带 `noopener noreferrer`。
- [x] 未读、已读、固定、静音、重命名、附件、草稿真实持久化，刷新不丢。

## 验证

```bash
python3 -m unittest discover -s tests -v
# dev-chat.html 覆盖 59 项聊天窗口检查
# dev-features.html 覆盖弹窗接入与设置
```

`dev-chat.html` 会创建临时群聊/私聊、验证 Markdown/代码、引用、搜索、附件、固定、重命名、未读、直达信息面板和关闭清理，不触碰真实任务内容。
