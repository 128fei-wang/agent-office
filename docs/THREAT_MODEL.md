# THREAT_MODEL — Agent Office Phase 1「真实执行 MVP」威胁模型

> 状态：设计定稿（本阶段只交设计，不写实现）
> 配套：`docs/RUNNER_DESIGN.md`（第 3 条）、`docs/RUNNER_DATA_MODEL.md`
> 目的：把「证据 / 密钥 / 权限 / git」的真实边界写死——哪些是硬边界、哪些只是护栏 + 留痕、哪些对恶意 Agent 根本不成立。这是第 2/3 条「证据独立性」和「git 权力边界」能在字面上成立还是成立过头的前提。

## 1. 核心前提（一条不能回避的事实）

Phase 1 的 runner 以**同一 OS 用户**拉起 Claude Code / Codex。由此推出：

**Agent 进程与 bridge 同 UID。** 后果有三，都成立：

1. `~/.agent-office/` 下的 `evidence.key`、`providers.json`、`bridge-state.json` 的 `0600` 只防「**其他 OS 用户**」，**不防同 UID 的 Agent 进程**——Agent 能直接 `cat` 读到。
2. Agent 能直接 `curl` loopback REST（本机进程、浏览器 Origin 不适用），读到全量 mission / 文件——除非补 per-agent token（对应第二轮安全 #1+#2，尚未落地）。
3. Agent 能用本用户的 SSH 凭据 + 网络，直接推到 origin。

**结论（一句）**：Phase 1 的证据签名，安全意义是「**防事后篡改 + 提供审计锚**」，**不是**「防 Agent 本机作恶」。因此设计文档里所有「密钥不给 Agent」「Agent 够不着权威仓库」的表述一律删除，改为本节的口径。

## 2. 两级 Agent 假设（决定每层防护的性质）

| 层级 | 定义 | 能挡住 | Phase 1 状态 |
|---|---|---|---|
| **配合型**（cooperating） | 受权改源码，可能草率 / 偷懒 / 出错，但不故意破坏 | 护栏 + 留痕 + 人审 + 取证 | **Phase 1 默认假设** |
| **恶意**（malicious） | 故意读密钥 / 伪造 claim / 绕过护栏 / 破坏合并 | 只有 OS 隔离（独立用户 / 沙箱 / 断网 / 去凭据） | **Phase 1 不做**（列为 hardening） |

所有「证据、护栏、令牌、留痕」对配合型 Agent 有效，对恶意 Agent 一律只是减速带，不是边界。

## 3. 真正的硬边界（Phase 1 唯一可依赖）

**权威合并 / 发布路径全程不经 Agent、且每一步都有人审。**

- 桥采 diff / 测试 / exit，人审 diffHash，桥落 merge——**Agent 的自述永不采信**。
- 对配合型 Agent：这条边界成立——Agent 在 worktree 里怎么折腾，改不到权威状态，因为权威状态由「人审 + 桥写」决定。
- 对恶意 Agent：这条边界**不成立**——同 UID + 用户凭据 + 网络，Agent 可绕过人审直接推 origin。要拦恶意 Agent，只有 OS 隔离（§6）。

## 4. 各机制的真实性质（护栏 vs 边界）

| 机制 | 真实性质 | 防什么 | 不防什么 |
|---|---|---|---|
| git 薄包装（拦 push / reset / hooks） | 护栏 + 留痕 | 配合型 Agent 走 git 命令的越权 | 直接写共享 gitdir 文件绕过 |
| linked worktree「不配 remote」 | **不成立** | — | —（linked worktree 与主仓共享 gitdir 和 remote） |
| 权威仓库「Agent 够不着」 | **不成立** | — | —（同 UID 能找到路径、能推 origin） |
| 证据 HMAC 签名（evidence.key） | 防事后篡改 + 审计锚 | 事后改文件 / 改证据库被检出 | 同 UID Agent 读 key 伪造 |
| run 级哈希链 | 防证据历史整体替换 | 删除 / 重排 / 截断即断链 | 同 UID 重算整链 |
| per-agent REST token（#1+#2） | 读隔离 | 非成员 Agent 读别的 mission | 同 UID 直接读 state 文件 |
| run-scoped token（submit_evidence） | claim 归属校验 | 任意进程替任意 run 交 claim | 同 UID 读子进程 env |
| 测试沙箱（execution.py seatbelt/bwrap） | 运行时强制 | 测试命令乱读网络 / home | Agent 主进程本身（不经沙箱） |

## 5. UI 口径（与威胁模型一致，不夸大）

- 「已完成 · 待桥核验」（证据由桥采集并重算，Agent 自述不采信）
- 「证据防篡改 · 防事后改动」（不宣称「防本机作恶」）
- 「人工核验后合并」（权威路径人审，不宣称「Agent 够不着」）

## 6. 未来 hardening（Phase 1 不做，按需升级）

1. 每 agent 独立 OS 用户 + 目录权限隔离（禁读 `~/.agent-office`）。
2. 网络 / 凭据限制：无 SSH key、无 origin remote、只给白名单 endpoint。
3. FS 沙箱全包 Agent 主进程（seatbelt / bwrap 包住 PTY）。

这三条是「升级到防恶意 Agent」的唯一路径；本阶段威胁模型明确停在「配合型 Agent」上，不假装覆盖。
