# FORK.md — Fork 项目改动记录

> 记录本仓库(nuwax-ai/claude-code-acp-ts)相对于官方上游 `main` 分支的全部自定义改动。
> 最后更新:2026-10-30,基于 merge-base `bba9127`。

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

### 3.1 turn settlement 竞态修复(`6abd56c`,2026-08-06)

**问题**:后台 subagent 调度后,快响应模型可能立即 end_turn,终端 `result` 先于
`task_started` 到达。此时 `spawnedTaskIds` 还是空的,`turnAwaitingSubagents` 返回
false,turn 提前 settle,导致 subagent 被孤立——其流式输出、权限请求和模型的后续
总结全部落在 turn 之外(上游 issues #864/#866)。

**实现**:新增 `Turn.pendingSubagentToolUseIds`(src/acp-agent.ts:385),在 result
先到、`task_started` 未到时,以 tool_use_id 为 key 保持 turn 打开;`task_started`
到达后转换为按 `task_id` 跟踪(`spawnedTaskIds`),并清掉对应的 pending 条目。

### 3.2 强制禁用 dataviz skill(`d3a8c57`,2026-07-29)

- 常量 `DISABLED_SKILLS = ["dataviz"]`(src/acp-agent.ts:154)。
- 通过 `disallowedTools` 追加 `Skill(dataviz)` + 注入 `skillOverrides: "off"`
  双重封禁:对模型不可见,且不可调用。

### 3.3 compaction 以 tool_call 生命周期呈现(`9f986a8`,2026-07-25)

- 新增 `compactionToolCallId` 状态机(src/acp-agent.ts:2087 起):
  `compacting` → 发出 `tool_call`(in_progress,同时置
  `session.emittedAssistantText = true`,防止 `/compact` 场景下结果文本被
  issue-#453 fallback 重复转发);`compact_result` → `tool_call_update`(completed/failed)。
- 背景:SDK 对失败的 compaction 会发两次不可区分的终态消息,用 in-progress
  标记去重,第二次终态为 no-op。
- 客户端视角:压缩不再是穿插在助手文本里的 prose,而是离散的、有状态的工具调用。

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

## 6. 合并上游 main 的冲突分析(2026-10-30 模拟)

用 `git merge-tree --write-tree HEAD origin/main` 模拟,结果:

**冲突文件 4 个,共 15 个冲突块;README.md、package.json 可自动合并。**

| 文件 | 冲突块 | 冲突内容 |
|------|--------|----------|
| `.github/workflows/publish.yml` | 2 | 触发方式(tag vs push main)、setup-node 版本。→ 保留 fork 的 tag 方案 |
| `src/acp-agent.ts` | 5 | ① compactionToolCallId 声明与清理;② turn settle 逻辑(isHeldOpen / pendingSubagentToolUseIds / deferredSettle);③ compaction tool_call 发送;④ subagent task_started 追踪 |
| `src/tests/acp-agent.test.ts` | 7 | compaction 断言(tool_call vs message_chunk)、subagent settlement 测试用例 |
| `src/tests/create-session-options.test.ts` | 1 | 轻微,dataviz 相关断言 |

**结论:机械冲突少,语义冲突重。** 上游 main 在冲突区域做了大规模重构
(新增 `acp-subagents.ts`、`native-subagents.ts`、`async-tasks.ts`、
`context-compaction.ts` 等,acp-agent.ts 体量翻倍),合并前需逐项判断:

1. **settlement 竞态修复(3.1)**:上游新 subagent 体系可能已原生解决同样的
   task_started 竞态 —— 若已修,fork 补丁应丢弃而非保留,需对照
   `acp-subagents.ts` / `async-tasks.ts` 验证。
2. **compaction tool_call(3.3)**:上游新增 `context-compaction.ts` /
   `context-compaction-meta.ts`,方向可能已收敛,应与上游实现对齐而非硬保
   fork 版本。
3. **禁用工具/skill(3.2/3.4)**:需确认在上游新的 `permissions/` 体系下
   的挂载方式。
4. **CI(第 4 节)**:整块保留 fork 版本,不做取舍。

## 7. 同步上游的操作建议

```bash
git fetch origin main
git merge origin/main   # 或 rebase,视团队习惯;历史上一直用 merge
```

- 解决顺序建议:先 publish.yml(整块取 fork)→ create-session-options.test.ts
  → acp-agent.ts(按第 6 节逐块判断)→ acp-agent.test.ts(跟随实现调整断言)。
- 合并后必跑:`npm run build && npm run test:run`(本地 vitest 单测)。
- 三个"待判断"项(第 6 节 1–3)建议在合并前先读上游对应新文件,决定
  保留 / 对齐 / 丢弃,避免把上游已修复的问题又改回 fork 的旧方案。
