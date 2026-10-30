# FORK.md — Fork 项目改动记录

> 记录本仓库(nuwax-ai/claude-code-acp-ts)相对于官方上游 `main` 分支的全部自定义改动。
> 最后更新:2026-10-31(已合并上游 main @ `eb78afa`,合并取舍见第 6 节)。

## 1. 项目定位

本项目是 **Claude Agent SDK 的 ACP 适配器**(TypeScript),将 Claude Code 暴露为 ACP 兼容的
编码 agent,供 Zed 等 ACP 客户端使用。包名 `claude-code-acp-ts`(官方原版为
`claude-code-acp`,fork 时为避免发布冲突而重命名)。

## 2. 与上游的分歧规模

| 指标 | 数值 |
|------|------|
| merge-base | `bba9127` |
| 上游 main 领先 | 288 个提交 |
| fork 自有提交 | 42 个(非 merge) |
| main 对核心文件 acp-agent.ts 的改动 | +9609 / -2739 行(8094 → 14964 行) |
| fork 对 acp-agent.ts 的净改动 | 约 +150 行 |

## 3. 功能性自定义改动

以下改动按提交时间倒序排列,均为 fork 独有、上游没有的内容。

### 3.1 turn settlement 竞态修复(`6abd56c`,2026-08-06)— **已于 2026-10-31 合并时移除**

**问题**:后台 subagent 调度后,快响应模型可能立即 end_turn,终端 `result` 先于
`task_started` 到达。此时 `spawnedTaskIds` 还是空的,`turnAwaitingSubagents` 返回
false,turn 提前 settle,导致 subagent 被孤立——其流式输出、权限请求和模型的后续
总结全部落在 turn 之外(上游 issues #864/#866)。

**当初实现**:新增 `Turn.pendingSubagentToolUseIds`,在 assistant 消息消费时播种
Agent/Task tool_use id,由 task_started/task_notification 清理。

**移除原因**:上游 main 的 subagent 体系已彻底重写(spawnedTaskIds hold +
`background_tasks_changed` 丢失 bookend 对账 + 顺序流消费),正是对"主 agent 等
subagent 卡死"问题的上游根治方案。fork 的播种机制与 main 的 native/RFD subagent
路径(不发 task_started)冲突,会引入新的挂起类。按"官方彻底解决则用官方"的原则
整体移除,adopted main 的 settlement 体系。
**遗留观察项**:若生产中再次出现 result 先于 task_started 的孤立症状,需要先在
当前 CLI/SDK 上取证,再考虑向上游提 issue 而非重新打补丁。

### 3.2 强制禁用 dataviz skill(`d3a8c57`,2026-07-29)

- 常量 `DISABLED_SKILLS = ["dataviz"]`(src/acp-agent.ts:154)。
- 通过 `disallowedTools` 追加 `Skill(dataviz)` + 注入 `skillOverrides: "off"`
  双重封禁:对模型不可见,且不可调用。

### 3.3 compaction 以 tool_call 生命周期呈现(`9f986a8`,2026-07-25)— **已于 2026-10-31 合并时移除**

**当初实现**:手工 `compactionToolCallId` 状态机,把压缩呈现为离散 tool_call。

**移除原因**:上游 main 新增 `ContextCompactionLifecycle`(src/context-compaction.ts),
其默认呈现方式就是 `tool_call`("Compact conversation" 工具调用),且额外覆盖了
fork 版本的两个关注点:`consumeDuplicateErrorOutput`(失败压缩的重复终态去重)和
`hasDeliveredOutput`(仅压缩的 turn 不重发结果文本,issue-#453)。fork 实现被
上游原生方案完全取代。

### 3.4 默认禁用交互型/联网工具(`5b92598`,2026-06-12;更早见 `9e13999`/`087282e`)

- `AskUserQuestion`、`WebFetch`、`WebSearch` 无条件加入 `disallowedTools`
  (src/acp-agent.ts:5703),移除了原有的条件 elicitation 判断。
- 理由:这三个工具不适合 ACP 场景暴露(ACP 客户端有自己的交互与网络通道)。
- 注意:`handleAskUserQuestion`(src/acp-agent.ts:5126)的 ACP form 路径仍保留,
  供特定 client capabilities 场景使用。

### 3.5 session 状态重置时机修复(`16e4da5`,2026-06-01)

**问题**:原实现中 `session.cancelled` / `accumulatedUsage` 在 prompt 队列检查
之前重置,`cancel()+新 prompt` 序列下,在飞 prompt 的 while 循环还没观察到
cancelled 标志就被重置,错误地以 `end_turn`(零 usage)返回而非 `cancelled`。

**实现**:状态重置移到队列检查之后——仅当 prompt 真正开始执行时才重置。

### 3.6 `-v/--version` 参数(`5fae89e`,2026-05-26)

`src/index.ts` 读取 package.json 版本立即退出,不初始化 SDK 和 ACP 连接。

### 3.7 模型选择优先级调整(`26f638e`,2026-04-05)

`getAvailableModels` 的选择层级调整为:
`ANTHROPIC_MODEL` 环境变量 > 用户设置 > 列表第一个模型。

### 3.8 session 创建超时保护与诊断日志(`0c1e5a1`,2026-01-12)

- `getAvailableSlashCommands` / `getAvailableModels` 包上 `withTimeout`。
- 环境变量:
  - `ACP_MODEL_FETCH_TIMEOUT_MS` — 模型列表拉取超时
  - `ACP_COMMAND_FETCH_TIMEOUT_MS` — 斜杠命令拉取超时
  - `ACP_USE_DEFAULTS_ON_TIMEOUT` — 超时后优雅降级为默认值
- createSession 全程增加诊断日志。

## 4. CI / 发布自定义

fork 的发布模式与上游完全不同,**合并时这一块必须整块保留 fork 版本**:

- **tag 触发发布**(`8cc05db`,2026-05-26):`publish.yml` 由 push main 触发改为
  push `v*.*.*` tag 触发;排除 beta tag(`587cb38`)。
- **版本号以 git tag 为唯一来源**(`b12e7f8`,2026-06-30):发布时用
  `${GITHUB_REF_NAME}` 推导版本,不再读 package.json。
- **sigstore 模块修复**(`022ce6b`,2026-07-09):解决 npm publish 缺少 sigstore
  导致的失败。
- 另有 beta 发布流程(tag `v*.*.*-beta.*`)。

## 5. 包与工程杂项

- 包名 / bin 命令重命名为 `claude-code-acp-ts`(`36aaf47`/`6f1e51c`,2026-01-13),
  避免与官方包冲突。
- 历史上曾把构建产物提交进仓库、移除过 prepare 脚本(`833ac07`/`cd45609`/
  `594bc4c`);当前 `dist/` 已不入库(曾直接修过 `dist/acp-agent.js` 的
  `427ab8a` 是历史产物,现已随 dist 移除)。
- 定期的依赖升级与 lockfile 同步(`2c5bc39`、`c44f3dd` 等)。
- 版本号 bump 系列提交(0.38.x → 0.62.x → 0.65.0)。

## 6. 2026-10-31 合并上游 main 的记录(merge-base `bba9127` → `eb78afa`,288 个上游提交)

**合并策略与结果:**

| 冲突/语义项 | 取舍 |
|------|------|
| `publish.yml`(2 块) | 整块保留 fork 的 tag 触发 + tag 取版本方案 |
| `create-session-options.test.ts`(1 块) | 双方属性都保留(`skillOverrides.dataviz` + `availableModels`) |
| compaction 实现(acp-agent.ts) | 整体采用 main 的 `ContextCompactionLifecycle`(见 3.3) |
| settlement 竞态补丁(acp-agent.ts) | 整体移除 fork 的 pending 机制(见 3.1) |
| `AskUserQuestion` 相关 main 新测试 | 改写为 fork 语义(无条件禁用,onElicitation 仍接线) |
| 场景 golden 快照(46 个) | 不改快照;在场景 harness 的 `normalize` 中把 fork 包名归一化为上游名,快照与上游保持字节一致,后续合并零冲突 |
| CLAUDE_MODEL_CONFIG 合并测试(3 个) | 期望值补充 `skillOverrides: { dataviz: "off" }` |

**验证:**构建通过、lint 通过;vitest 全量 3510 通过 / 9 失败,失败清单与纯
上游 main 基线逐条一致(均为依赖真实 Claude CLI 的环境型失败:providers ×7、
session-hooks ×2),合并未引入任何新失败。fork 的 5 个竞态回归测试随机制一并移除。

## 7. 同步上游的操作建议

```bash
git fetch origin main
git merge origin/main   # 历史上一直用 merge
```

- 解决顺序建议:先 publish.yml(整块取 fork)→ acp-agent.ts(compaction/
  settlement 预期取 main,只保留禁用工具/skill 注入)→ 测试文件跟随实现。
- 场景 golden 快照永远不要用 `-u` 重新生成:包名差异由 harness 的 normalize
  承接,快照保持与上游一致。
- 合并后必跑:`npm run build && npm run lint && npm run test:run`,并与"纯上游
  基线"(在临时 worktree 检出 origin/main 跑同一套测试)对比失败清单,只允许
  环境型失败存在。
