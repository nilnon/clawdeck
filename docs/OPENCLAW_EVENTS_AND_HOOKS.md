# OpenClaw 事件系统与 Hooks 机制详解

> 本文档详细说明 OpenClaw Gateway 的事件系统架构，包括 WebSocket Agent 事件和插件 Hooks 的区别与使用方式。

## 目录

1. [概述](#1-概述)
2. [WebSocket Agent 事件](#2-websocket-agent-事件)
3. [OpenClaw Hooks](#3-openclaw-hooks)
4. [事件对照表](#4-事件对照表)
5. [Thinking 数据获取](#5-thinking-数据获取)
6. [客户端实现指南](#6-客户端实现指南)

---

## 1. 概述

OpenClaw Gateway 有两套独立的事件系统：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    OpenClaw 事件系统架构                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  1. WebSocket Agent 事件 (客户端可见)                                 │    │
│  │     • Gateway 广播给所有连接的客户端                                  │    │
│  │     • 用于实时 UI 更新                                               │    │
│  │     • 只有 3 种 stream 类型                                          │    │
│  │     • 通过 WebSocket 实时推送                                        │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                               │
│                              ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  2. OpenClaw Hooks (插件系统内部)                                     │    │
│  │     • Gateway 内部触发                                               │    │
│  │     • 用于插件监控、审计、可观测性                                    │    │
│  │     • 24 个细粒度 Hook 点                                            │    │
│  │     • 不发送给客户端                                                 │    │
│  │     • 仅通过插件 API 访问                                            │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 核心区别

| 特性 | WebSocket Agent 事件 | OpenClaw Hooks |
|------|---------------------|----------------|
| **可见性** | 客户端可见 | 仅插件内部可见 |
| **数量** | 3 种 stream | 24 个 Hook |
| **用途** | UI 实时更新 | 监控、审计、可观测性 |
| **数据粒度** | 粗粒度 | 细粒度 |
| **传输方式** | WebSocket 广播 | 插件 API 回调 |

---

## 2. WebSocket Agent 事件

### 2.1 事件格式

```typescript
interface AgentEvent {
  type: 'event'
  event: 'agent'
  payload: {
    stream: 'lifecycle' | 'assistant' | 'tool'
    sessionKey: string
    runId: string
    seq?: number
    data: Record<string, unknown>
  }
}
```

### 2.2 Stream 类型

#### lifecycle - 生命周期事件

```json
{
  "type": "event",
  "event": "agent",
  "payload": {
    "stream": "lifecycle",
    "sessionKey": "agent:main:main",
    "runId": "chat-xxx",
    "data": {
      "phase": "start" | "end" | "error"
    }
  }
}
```

| Phase | 说明 |
|-------|------|
| `start` | Agent 开始执行 |
| `end` | Agent 执行完成 |
| `error` | Agent 执行出错 |

#### assistant - 助手输出事件

```json
{
  "type": "event",
  "event": "agent",
  "payload": {
    "stream": "assistant",
    "sessionKey": "agent:main:main",
    "runId": "chat-xxx",
    "data": {
      "delta": "最终回复文本",
      "thinking": "让我思考一下这个问题...",
      "text": "累积文本"
    }
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `delta` | string | 增量输出文本 |
| `thinking` | string | 思考过程文本 |
| `text` | string | 累积输出文本 |

#### tool - 工具调用事件

```json
// 工具调用开始
{
  "type": "event",
  "event": "agent",
  "payload": {
    "stream": "tool",
    "sessionKey": "agent:main:main",
    "runId": "chat-xxx",
    "data": {
      "phase": "start",
      "name": "read_file",
      "toolCallId": "call-abc123",
      "arguments": { "path": "/src/index.ts" }
    }
  }
}

// 工具调用结果
{
  "type": "event",
  "event": "agent",
  "payload": {
    "stream": "tool",
    "sessionKey": "agent:main:main",
    "runId": "chat-xxx",
    "data": {
      "phase": "result",
      "toolCallId": "call-abc123",
      "result": "file content...",
      "duration": 150
    }
  }
}
```

| Phase | 说明 |
|-------|------|
| `start` | 工具调用开始 |
| `update` | 工具调用进度更新 |
| `result` | 工具调用结果返回 |

### 2.3 完整事件流示例

```
┌─────────────────────────────────────────────────────────────────────┐
│                      典型聊天事件流                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. lifecycle.start          → Agent 开始执行                        │
│  2. assistant (thinking)     → 思考过程开始                          │
│  3. assistant (thinking)     → 思考过程继续                          │
│  4. assistant (delta)        → 输出回复                              │
│  5. tool.start               → 工具调用开始                          │
│  6. tool.result              → 工具调用完成                          │
│  7. assistant (delta)        → 继续输出                              │
│  8. lifecycle.end            → Agent 执行完成                        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. OpenClaw Hooks

### 3.1 Hooks 概述

Hooks 是 Gateway 内部的插件扩展点，用于实现可观测性、审计、安全扫描等功能。

### 3.2 完整 Hooks 列表 (26 个)

> 源码位置: `openclaw\src\plugins\types.ts`

| Hook 类别 | Hook 名称 | 说明 |
|-----------|-----------|------|
| **Agent** | `before_model_resolve` | 模型解析前 |
| | `before_prompt_build` | Prompt 构建前 |
| | `before_agent_start` | Agent 启动前 (Legacy) |
| | `agent_end` | Agent 结束 |
| **LLM** | `llm_input` | LLM 输入 |
| | `llm_output` | LLM 输出 |
| **Tool** | `before_tool_call` | 工具调用前 |
| | `after_tool_call` | 工具调用后 |
| | `tool_result_persist` | 工具结果持久化 |
| **Message** | `message_received` | 消息接收 |
| | `message_sending` | 消息发送中 |
| | `message_sent` | 消息已发送 |
| | `before_message_write` | 消息写入前 |
| | `before_dispatch` | 消息分发前 |
| **Context** | `before_compaction` | 上下文压缩前 |
| | `after_compaction` | 上下文压缩后 |
| | `before_reset` | 重置前 |
| **Session** | `session_start` | 会话开始 |
| | `session_end` | 会话结束 |
| **Subagent** | `subagent_spawning` | 子 Agent 创建中 |
| | `subagent_delivery_target` | 子 Agent 投递目标 |
| | `subagent_spawned` | 子 Agent 已创建 |
| | `subagent_ended` | 子 Agent 结束 |
| **Gateway** | `gateway_start` | 网关启动 |
| | `gateway_stop` | 网关停止 |
| **Inbound** | `inbound_claim` | 入站请求声明 |

### 3.3 Hook 数据结构

```typescript
// llm_input Hook 数据
interface LlmInputHook {
  sessionId: string
  runId: string
  provider: string
  model: string
  prompt: string
  systemPrompt?: string
  historyMessages: Message[]
  imagesCount?: number
}

// llm_output Hook 数据
interface LlmOutputHook {
  sessionId: string
  runId: string
  provider: string
  model: string
  usage?: {
    input: number
    output: number
    cacheRead?: number
    cacheWrite?: number
  }
  assistantTexts?: string[]
  lastAssistant?: Message
}

// before_tool_call Hook 数据
interface BeforeToolCallHook {
  sessionId: string
  runId: string
  toolName: string
  toolCallId: string
  arguments: Record<string, unknown>
}

// after_tool_call Hook 数据
interface AfterToolCallHook {
  sessionId: string
  runId: string
  toolName: string
  toolCallId: string
  result: unknown
  durationMs: number
}
```

### 3.4 插件注册 Hooks

```typescript
// openclaw.plugin.json
{
  "id": "my-plugin",
  "slots": [
    "llm_input",
    "llm_output",
    "before_tool_call",
    "after_tool_call"
  ]
}

// index.ts
function activate(api: PluginAPI) {
  api.on('llm_input', (event, ctx) => {
    console.log('LLM Input:', event.model, event.runId)
  })
  
  api.on('llm_output', (event, ctx) => {
    console.log('LLM Output:', event.usage)
  })
  
  // runtime.events 用于实时流式事件
  api.runtime?.events?.onAgentEvent((evt) => {
    if (evt.stream === 'assistant') {
      const thinking = evt.data.thinking
      const delta = evt.data.delta
    }
  })
}
```

---

## 4. 事件对照表

### 4.1 完整对照

| 阶段 | WebSocket 事件 (客户端可见) | Hooks (插件内部) |
|------|---------------------------|------------------|
| 模型选择 | ❌ 不可见 | `before_model_resolve` |
| Prompt 构建 | ❌ 不可见 | `before_prompt_build` |
| LLM 调用开始 | ❌ 不可见 | `llm_input` |
| Agent 开始 | `lifecycle.start` | - |
| **Thinking** | `assistant (thinking)` | - |
| 普通输出 | `assistant (delta)` | - |
| 工具调用开始 | `tool.start` | `before_tool_call` |
| 工具调用结束 | `tool.result` | `after_tool_call` |
| 工具结果持久化 | ❌ 不可见 | `tool_result_persist` |
| Agent 结束 | `lifecycle.end` | `agent_end` |
| LLM 调用结束 | ❌ 不可见 | `llm_output` |
| 消息接收 | ❌ 不可见 | `message_received` |
| 消息发送 | ❌ 不可见 | `message_sending` |
| 消息写入 | ❌ 不可见 | `before_message_write` |
| 上下文压缩 | ❌ 不可见 | `before_compaction` / `after_compaction` |
| 会话开始 | ❌ 不可见 | `session_start` |
| 会话结束 | ❌ 不可见 | `session_end` |

### 4.2 数据可见性

| 数据类型 | 客户端 (WebSocket) | 插件 (Hooks) |
|----------|-------------------|--------------|
| Thinking 文本 | ✅ 可见 | ✅ 可见 |
| 输出文本 | ✅ 可见 | ✅ 可见 |
| 工具调用 | ✅ 可见 | ✅ 可见 |
| Token 统计 | ❌ 不可见 | ✅ 可见 |
| 模型选择 | ❌ 不可见 | ✅ 可见 |
| Prompt 内容 | ❌ 不可见 | ✅ 可见 |
| 历史消息 | ❌ 不可见 | ✅ 可见 |
| 上下文压缩 | ❌ 不可见 | ✅ 可见 |

---

## 5. Thinking 数据获取

### 5.1 数据来源

Thinking 数据来自 LLM 的原生输出，通过 WebSocket `assistant` stream 广播：

```json
{
  "type": "event",
  "event": "agent",
  "payload": {
    "stream": "assistant",
    "data": {
      "thinking": "让我分析一下这个问题...",
      "delta": "根据分析结果..."
    }
  }
}
```

### 5.2 客户端获取方式

```typescript
// 方式 1: WebSocket 直接监听
ws.on('message', (data) => {
  const event = JSON.parse(data)
  if (event.event === 'agent' && event.payload.stream === 'assistant') {
    const thinking = event.payload.data.thinking
    const delta = event.payload.data.delta
    
    if (thinking) {
      // 处理 Thinking 内容
      appendThinking(thinking)
    }
    if (delta) {
      // 处理普通输出
      appendOutput(delta)
    }
  }
})
```

### 5.3 插件获取方式

```typescript
// 方式 2: 插件 runtime.events
api.runtime?.events?.onAgentEvent((evt) => {
  if (evt.stream === 'assistant') {
    const thinking = evt.data?.thinking
    const delta = evt.data?.delta
  }
})
```

### 5.4 支持 Thinking 的模型

| 模型 | Thinking 支持 | 说明 |
|------|--------------|------|
| Claude 3.5 Sonnet | ✅ 原生支持 | 推荐 |
| Claude 3.5 Haiku | ✅ 原生支持 | |
| DeepSeek R1 | ✅ 原生支持 | 推理模型 |
| DeepSeek V3 | ✅ 原生支持 | |
| GPT-4o | ❌ 不支持 | |
| Gemini 2.0 | ✅ 原生支持 | |

---

## 6. 客户端实现指南

### 6.1 OpenClawAdapter 实现

```typescript
// server/adapters/openclaw/index.ts

type StreamEventType =
  | 'lifecycle_start'
  | 'lifecycle_end'
  | 'assistant_stream'
  | 'agent_tool_start'
  | 'agent_tool_result'

function classifyStreamEvent(msg: Record<string, unknown>): ClassifiedEvent | null {
  const evt = msg.event as string
  
  if (evt === 'agent') {
    const ap = msg.payload as Record<string, unknown>
    
    if (ap.stream === 'lifecycle') {
      const phase = ap.data?.phase
      if (phase === 'start') return { type: 'lifecycle_start' }
      if (phase === 'end' || phase === 'error') return { type: 'lifecycle_end' }
    }
    
    if (ap.stream === 'assistant') {
      return { type: 'assistant_stream' }
    }
    
    if (ap.stream === 'tool') {
      const phase = ap.data?.phase
      if (phase === 'start') return { type: 'agent_tool_start' }
      if (phase === 'result') return { type: 'agent_tool_result' }
    }
  }
  
  return null
}

// 处理 assistant_stream 事件
if (type === 'assistant_stream') {
  const data = agentPayload?.data
  const delta = data?.delta
  const thinking = data?.thinking
  
  if (delta) {
    responseQueue.push({ content: delta, chunkType: 'text' })
  }
  if (thinking) {
    responseQueue.push({ content: '', chunkType: 'thinking', thinking })
  }
}
```

### 6.2 前端 ChatPanel 实现

```typescript
// src/features/chat/ChatPanel.tsx

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  toolCalls?: ToolCall[]
}

// 处理 SSE 流
const reader = res.body.getReader()
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  
  const chunk = JSON.parse(data)
  
  switch (chunk.chunkType) {
    case 'thinking':
      // 累积 Thinking 内容
      setMessages(prev => prev.map(m =>
        m.id === assistantMsg.id
          ? { ...m, thinking: (m.thinking || '') + chunk.thinking }
          : m
      ))
      break
      
    case 'text':
      // 累积普通输出
      setMessages(prev => prev.map(m =>
        m.id === assistantMsg.id
          ? { ...m, content: m.content + chunk.content }
          : m
      ))
      break
      
    case 'tool_start':
      // 添加工具调用
      setMessages(prev => prev.map(m =>
        m.id === assistantMsg.id
          ? { ...m, toolCalls: [...(m.toolCalls || []), {
              id: chunk.toolCallId,
              name: chunk.toolName,
              args: chunk.toolArgs,
              status: 'running'
            }]}
          : m
      ))
      break
      
    case 'tool_result':
      // 更新工具调用结果
      setMessages(prev => prev.map(m =>
        m.id === assistantMsg.id
          ? { ...m, toolCalls: m.toolCalls?.map(tc =>
              tc.id === chunk.toolCallId
                ? { ...tc, result: chunk.toolResult, status: 'success' }
                : tc
            )}
          : m
      ))
      break
  }
}
```

### 6.3 useThinkingFlow Hook

```typescript
// src/features/chat/useThinkingFlow.ts

interface ThinkingFlowState {
  phase: 'idle' | 'thinking' | 'responding' | 'tool_calling' | 'completed'
  thinkingContent: string
  outputContent: string
  toolCalls: ToolCallInfo[]
}

export function useThinkingFlow() {
  const [flowState, setFlowState] = useState<ThinkingFlowState>(INITIAL_STATE)
  
  const handleAssistantStream = useCallback((content: string, isThinking: boolean) => {
    setFlowState(prev => ({
      ...prev,
      phase: isThinking ? 'thinking' : 'responding',
      ...(isThinking 
        ? { thinkingContent: prev.thinkingContent + content }
        : { outputContent: prev.outputContent + content }
      ),
    }))
  }, [])
  
  return {
    flowState,
    handleAssistantStream,
  }
}
```

---

## 附录

### A. 完整事件类型定义

```typescript
// WebSocket 事件
type WebSocketEventType = 
  | 'agent'      // Agent 事件
  | 'chat'       // Chat 事件
  | 'health'     // 健康状态
  | 'presence'   // 节点状态
  | 'shutdown'   // 关机通知

// Agent stream 类型
type AgentStreamType = 
  | 'lifecycle'  // 生命周期
  | 'assistant'  // 助手输出
  | 'tool'       // 工具调用

// Plugin Hook 类型 (26 个) - 来自 OpenClaw 源码 src/plugins/types.ts PluginHookName
type PluginHookName =
  | 'before_model_resolve'    // 模型解析前
  | 'before_prompt_build'     // Prompt 构建前
  | 'before_agent_start'      // Agent 启动前 (Legacy)
  | 'llm_input'               // LLM 输入
  | 'llm_output'              // LLM 输出
  | 'agent_end'               // Agent 结束
  | 'before_compaction'       // 上下文压缩前
  | 'after_compaction'        // 上下文压缩后
  | 'before_reset'            // 重置前
  | 'inbound_claim'           // 入站请求声明
  | 'message_received'        // 消息接收
  | 'message_sending'         // 消息发送中
  | 'message_sent'            // 消息已发送
  | 'before_tool_call'        // 工具调用前
  | 'after_tool_call'         // 工具调用后
  | 'tool_result_persist'     // 工具结果持久化
  | 'before_message_write'    // 消息写入前
  | 'session_start'           // 会话开始
  | 'session_end'             // 会话结束
  | 'subagent_spawning'       // 子 Agent 创建中
  | 'subagent_delivery_target'// 子 Agent 投递目标
  | 'subagent_spawned'        // 子 Agent 已创建
  | 'subagent_ended'          // 子 Agent 结束
  | 'gateway_start'           // 网关启动
  | 'gateway_stop'            // 网关停止
  | 'before_dispatch'         // 消息分发前
```

### B. 相关文档

- [OpenClaw Gateway 源码解读](./OPENCLAW_GATEWAY_SOURCE_ANALYSIS.md)
- [Thinking 过程与可观测性完整指南](./THINKING_AND_OBSERVABILITY.md)
- [插件系统](./openclaw-gateway/12-plugins.md)
- [聊天系统](./openclaw-gateway/07-chat.md)
