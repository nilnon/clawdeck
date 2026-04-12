# 事件系统

> **本文档引用的源码文件**
> - `src/gateway/server-chat.ts` - 聊天事件处理
> - `src/infra/agent-events.ts` - Agent 事件定义

## 目录

1. [简介](#简介)
2. [事件类型总览](#事件类型总览)
3. [Agent 事件](#agent-事件)
4. [Chat 事件](#chat-事件)
5. [系统事件](#系统事件)
6. [事件订阅](#事件订阅)
7. [事件处理最佳实践](#事件处理最佳实践)

## 简介

Gateway 支持 **24** 种事件类型，用于实时推送状态变化：

- **Agent 事件** - Agent 生命周期、消息流、工具调用
- **Chat 事件** - 聊天消息流
- **系统事件** - 健康状态、节点状态、心跳

## 事件类型总览

| 事件                 | 类型    | 说明        |
| ------------------ | ----- | --------- |
| `agent`            | Agent | Agent 消息流 |
| `chat`             | Chat  | 聊天消息流     |
| `session.message`  | 会话    | 会话消息      |
| `session.tool`     | 会话    | 会话工具调用    |
| `sessions.changed` | 会话    | 会话变更      |
| `health`           | 系统    | 健康状态广播    |
| `presence`         | 系统    | 节点上下线     |
| `tick`             | 系统    | 心跳        |
| `shutdown`         | 系统    | 关机通知      |
| `update.available` | 系统    | 更新可用      |

## Agent 事件

### 事件结构

```typescript
type AgentEventPayload = {
  stream: 'lifecycle' | 'assistant' | 'tool'
  sessionKey: string
  runId: string
  seq?: number
  data: {
    // lifecycle
    phase?: 'start' | 'end' | 'error'
    // assistant
    text?: string      // 累积内容
    delta?: string     // 增量内容
    // tool
    name?: string
    toolCallId?: string
    arguments?: object
    result?: unknown
  }
}
```

### lifecycle 事件

Agent 运行生命周期。

**开始**:

```json
{
  "type": "event",
  "event": "agent",
  "payload": {
    "stream": "lifecycle",
    "sessionKey": "agent:main:main",
    "runId": "run-xyz789",
    "data": { "phase": "start" }
  }
}
```

**结束**:

```json
{
  "type": "event",
  "event": "agent",
  "payload": {
    "stream": "lifecycle",
    "sessionKey": "agent:main:main",
    "runId": "run-xyz789",
    "data": { "phase": "end" }
  }
}
```

### assistant 事件

助手消息流。

**关键点**:

- `text` - 累积的完整内容
- `delta` - 本次增量内容

```json
{
  "type": "event",
  "event": "agent",
  "payload": {
    "stream": "assistant",
    "sessionKey": "agent:main:main",
    "runId": "run-xyz789",
    "seq": 1,
    "data": {
      "text": "Hello",
      "delta": "Hello"
    }
  }
}
```

```json
{
  "type": "event",
  "event": "agent",
  "payload": {
    "stream": "assistant",
    "sessionKey": "agent:main:main",
    "runId": "run-xyz789",
    "seq": 2,
    "data": {
      "text": "Hello, how are",
      "delta": ", how are"
    }
  }
}
```

### tool 事件

工具调用。

**开始**:

```json
{
  "type": "event",
  "event": "agent",
  "payload": {
    "stream": "tool",
    "sessionKey": "agent:main:main",
    "runId": "run-xyz789",
    "data": {
      "phase": "start",
      "name": "read_file",
      "toolCallId": "call-abc123",
      "arguments": { "path": "/src/index.ts" }
    }
  }
}
```

**结果**:

```json
{
  "type": "event",
  "event": "agent",
  "payload": {
    "stream": "tool",
    "sessionKey": "agent:main:main",
    "runId": "run-xyz789",
    "data": {
      "phase": "result",
      "toolCallId": "call-abc123",
      "result": "file content..."
    }
  }
}
```

## Chat 事件

### 事件结构

```typescript
type ChatEventPayload = {
  state: 'started' | 'delta' | 'final' | 'aborted' | 'error'
  sessionKey: string
  runId: string
  seq?: number
  message: {
    role: 'assistant'
    content: Array<{ type: 'text'; text: string }>
  }
}
```

### started 事件

开始生成。

```json
{
  "type": "event",
  "event": "chat",
  "payload": {
    "state": "started",
    "sessionKey": "agent:main:dashboard:uuid",
    "runId": "run-xyz789"
  }
}
```

### delta 事件

增量内容。

**关键点**: `message.content` 是**累积的完整内容**，不是增量！

```json
{
  "type": "event",
  "event": "chat",
  "payload": {
    "state": "delta",
    "sessionKey": "agent:main:dashboard:uuid",
    "runId": "run-xyz789",
    "seq": 1,
    "message": {
      "role": "assistant",
      "content": [{ "type": "text", "text": "Hello" }]
    }
  }
}
```

```json
{
  "type": "event",
  "event": "chat",
  "payload": {
    "state": "delta",
    "sessionKey": "agent:main:dashboard:uuid",
    "runId": "run-xyz789",
    "seq": 2,
    "message": {
      "role": "assistant",
      "content": [{ "type": "text", "text": "Hello, how are you?" }]
    }
  }
}
```

### final 事件

最终消息。

```json
{
  "type": "event",
  "event": "chat",
  "payload": {
    "state": "final",
    "sessionKey": "agent:main:dashboard:uuid",
    "runId": "run-xyz789",
    "message": {
      "role": "assistant",
      "content": [{ "type": "text", "text": "Hello, how are you? I hope you're doing well!" }]
    }
  }
}
```

### aborted 事件

中止生成。

```json
{
  "type": "event",
  "event": "chat",
  "payload": {
    "state": "aborted",
    "sessionKey": "agent:main:dashboard:uuid",
    "runId": "run-xyz789"
  }
}
```

### error 事件

生成错误。

```json
{
  "type": "event",
  "event": "chat",
  "payload": {
    "state": "error",
    "sessionKey": "agent:main:dashboard:uuid",
    "runId": "run-xyz789",
    "message": { "error": "Rate limit exceeded" }
  }
}
```

## 系统事件

### health 事件

健康状态广播。

```typescript
type HealthSnapshot = {
  ok: boolean
  ts: number
  durationMs: number
  channels: Record<string, ChannelStatus>
  channelOrder: string[]
  channelLabels: Record<string, string>
  heartbeatSeconds: number
  defaultAgentId: string
  agents: AgentHealth[]
  sessions: {
    path: string
    count: number
    recent: SessionSummary[]
  }
}
```

### presence 事件

节点上下线。

```typescript
type PresenceEntry = {
  host: string           // 主机名
  ip?: string            // IP 地址
  version: string        // 版本
  platform: string       // 平台
  mode: string           // 模式: gateway, backend, webchat, cli
  roles?: string[]       // 角色
  scopes?: string[]      // 权限范围
  instanceId: string     // 实例 ID
  reason: string         // 原因: connect, disconnect, self
  ts: number             // 时间戳
  text?: string          // 显示文本
}
```

```json
{
  "type": "event",
  "event": "presence",
  "payload": {
    "host": "my-pc",
    "mode": "gateway",
    "instanceId": "inst-abc123",
    "reason": "connect",
    "ts": 1712899200000
  }
}
```

### tick 事件

心跳（每 30 秒）。

```json
{
  "type": "event",
  "event": "tick",
  "payload": { "ts": 1712899200000 }
}
```

### shutdown 事件

关机通知。

```json
{
  "type": "event",
  "event": "shutdown",
  "payload": { "reason": "SIGTERM", "ts": 1712899200000 }
}
```

## 事件订阅

### 订阅会话变更

```typescript
// 订阅
await rpc.call('sessions.subscribe', { sessionKeys: ['agent:main:main'] })

// 取消订阅
await rpc.call('sessions.unsubscribe', { sessionKeys: ['agent:main:main'] })
```

### 订阅消息

```typescript
// 订阅
await rpc.call('sessions.messages.subscribe', { sessionKey: 'agent:main:main' })

// 取消订阅
await rpc.call('sessions.messages.unsubscribe', { sessionKey: 'agent:main:main' })
```

## 事件处理最佳实践

### 1. 事件分类

```typescript
function classifyEvent(msg: unknown): { type: string; payload: unknown } | null {
  if (!msg || typeof msg !== 'object') return null
  
  const data = msg as Record<string, unknown>
  if (data.type !== 'event') return null
  
  const event = data.event as string
  const payload = data.payload
  
  return { type: event, payload }
}
```

### 2. 增量内容处理

```typescript
// Agent 事件：直接使用 delta
function handleAgentEvent(payload: AgentEventPayload) {
  if (payload.stream === 'assistant' && payload.data.delta) {
    appendToMessage(payload.data.delta)
  }
}

// Chat 事件：计算增量
let accumulatedContent = ''
function handleChatEvent(payload: ChatEventPayload) {
  if (payload.state === 'delta') {
    const fullText = extractText(payload.message.content)
    const delta = fullText.slice(accumulatedContent.length)
    accumulatedContent = fullText
    if (delta) appendToMessage(delta)
  }
}
```

### 3. 序列号检测

```typescript
let lastSeq = 0
function checkSequence(seq: number | undefined) {
  if (seq !== undefined && seq > lastSeq + 1) {
    console.warn(`Missed ${seq - lastSeq - 1} events`)
  }
  if (seq !== undefined) lastSeq = seq
}
```

### 4. 运行状态跟踪

```typescript
const activeRuns = new Map<string, RunContext>()

function handleAgentEvent(payload: AgentEventPayload) {
  const { runId, stream, data } = payload
  
  if (stream === 'lifecycle') {
    if (data.phase === 'start') {
      activeRuns.set(runId, { sessionKey: payload.sessionKey, startTime: Date.now() })
    } else if (data.phase === 'end') {
      activeRuns.delete(runId)
    }
  }
}
```

## 附录

### A. Gateway 支持的所有事件 (24)

```
connect.challenge, agent, chat, session.message, session.tool, 
sessions.changed, presence, tick, talk.mode, shutdown, health, 
heartbeat, cron, node.pair.requested, node.pair.resolved, 
node.invoke.request, device.pair.requested, device.pair.resolved, 
voicewake.changed, exec.approval.requested, exec.approval.resolved, 
plugin.approval.requested, plugin.approval.resolved, update.available
```

### B. 事件分类详解

| 分类        | 事件                                                    | 说明        |
| --------- | ----------------------------------------------------- | --------- |
| **连接**    | `connect.challenge`                                   | 认证挑战      |
| **Agent** | `agent`                                               | Agent 消息流 |
| **聊天**    | `chat`                                                | 聊天消息流     |
| **会话**    | `session.message`, `session.tool`, `sessions.changed` | 会话相关      |
| **系统**    | `tick`, `health`, `heartbeat`, `shutdown`, `presence` | 系统状态      |
| **语音**    | `talk.mode`, `voicewake.changed`                      | 语音模式      |
| **定时**    | `cron`                                                | 定时任务事件    |
| **配对**    | `node.pair.*`, `device.pair.*`, `node.invoke.request` | 节点/设备配对   |
| **审批**    | `exec.approval.*`, `plugin.approval.*`                | 审批流程      |
| **更新**    | `update.available`                                    | 更新可用通知    |

### C. 事件处理优先级建议

| 优先级       | 事件                                                                | 说明   |
| --------- | ----------------------------------------------------------------- | ---- |
| **P0 必须** | `connect.challenge`, `agent`, `chat`                              | 核心功能 |
| **P1 高**  | `session.message`, `session.tool`, `sessions.changed`, `shutdown` | 重要功能 |
| **P2 中**  | `health`, `presence`, `update.available`                          | 状态监控 |
| **P3 低**  | `tick`, `heartbeat`, `cron`, `talk.mode`                          | 可选功能 |

### D. Presence 事件结构

```typescript
type PresenceEntry = {
  host: string           // 主机名
  ip?: string            // IP 地址
  version: string        // 版本
  platform: string       // 平台
  mode: string           // 模式: gateway, backend, webchat, cli
  roles?: string[]       // 角色
  scopes?: string[]      // 权限范围
  instanceId: string     // 实例 ID
  reason: string         // 原因: connect, disconnect, self
  ts: number             // 时间戳
  text?: string          // 显示文本
}
```

### E. Health 事件结构

```typescript
type HealthSnapshot = {
  ok: boolean
  ts: number
  durationMs: number
  channels: Record<string, ChannelStatus>
  channelOrder: string[]
  channelLabels: Record<string, string>
  heartbeatSeconds: number
  defaultAgentId: string
  agents: AgentHealth[]
  sessions: {
    path: string
    count: number
    recent: SessionSummary[]
  }
}
```

