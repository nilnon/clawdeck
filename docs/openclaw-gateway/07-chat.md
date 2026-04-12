# 聊天系统

> **本文档引用的源码文件**
> - `src/gateway/server-methods/chat.ts` - 聊天方法实现
> - `src/gateway/server-chat.ts` - 聊天事件处理

## 目录

1. [简介](#简介)
2. [消息发送](#消息发送)
3. [消息流处理](#消息流处理)
4. [内容块类型](#内容块类型)
5. [心跳消息处理](#心跳消息处理)
6. [历史消息](#历史消息)

## 简介

聊天系统是 Gateway 的核心功能，提供：

- **消息发送** - 发送用户消息到 Agent
- **消息流处理** - 实时接收 Agent 响应
- **历史管理** - 获取和管理消息历史
- **中止控制** - 中止正在进行的生成

## 消息发送

### chat.send 方法

```typescript
type ChatSendParams = {
  sessionKey: string           // 会话 Key
  message: string | ContentBlock[]  // 消息内容
  idempotencyKey?: string      // 幂等键
  deliver?: boolean            // 是否投递（默认 false）
}

type ChatSendResponse = {
  runId: string                // 运行 ID
  status: 'accepted' | 'rejected'
}
```

### 发送流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                        消息发送流程                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. 客户端发送 chat.send                                             │
│     { method: "chat.send", params: { sessionKey, message } }        │
│     ↓                                                                │
│  2. Gateway 验证会话                                                 │
│     - 检查 sessionKey 是否存在                                       │
│     - 检查权限                                                       │
│     ↓                                                                │
│  3. 创建运行上下文                                                   │
│     - 生成 runId                                                     │
│     - 注册事件处理器                                                 │
│     ↓                                                                │
│  4. 返回确认                                                         │
│     { runId, status: "accepted" }                                   │
│     ↓                                                                │
│  5. 开始接收事件流                                                   │
│     - agent 事件 (main 会话)                                        │
│     - chat 事件 (dashboard/subagent 会话)                           │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 示例代码

```typescript
// 发送消息
const result = await rpc.call('chat.send', {
  sessionKey: 'agent:main:main',
  message: 'Hello, how are you?',
  idempotencyKey: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
})

console.log('Run ID:', result.runId)

// 监听事件流
rpc.onMessage((data) => {
  if (data.type === 'event' && data.event === 'agent') {
    handleAgentEvent(data.payload)
  }
})
```

## 消息流处理

### Agent 事件流（main 会话）

```typescript
// 事件序列
lifecycle.start → assistant (多个 delta) → lifecycle.end

// 示例
{ event: 'agent', payload: { stream: 'lifecycle', data: { phase: 'start' } } }
{ event: 'agent', payload: { stream: 'assistant', data: { delta: 'Hello' } } }
{ event: 'agent', payload: { stream: 'assistant', data: { delta: '!' } } }
{ event: 'agent', payload: { stream: 'lifecycle', data: { phase: 'end' } } }
```

### Chat 事件流（dashboard/subagent 会话）

```typescript
// 事件序列
started → delta (多个) → final

// 示例
{ event: 'chat', payload: { state: 'started' } }
{ event: 'chat', payload: { state: 'delta', message: { content: [{ text: 'Hello' }] } } }
{ event: 'chat', payload: { state: 'delta', message: { content: [{ text: 'Hello!' }] } } }
{ event: 'chat', payload: { state: 'final', message: { content: [{ text: 'Hello!' }] } } }
```

### 增量内容处理

**关键点**：

- Agent 事件的 `delta` 是**增量内容**，可直接追加
- Chat 事件的 `message.content` 是**累积内容**，需要计算增量

```typescript
// Agent 事件处理
function handleAgentEvent(payload: AgentEventPayload) {
  if (payload.stream === 'assistant') {
    const delta = payload.data.delta
    if (delta) {
      appendToMessage(delta)
    }
  }
}

// Chat 事件处理
let accumulatedContent = ''
function handleChatEvent(payload: ChatEventPayload) {
  if (payload.state === 'delta' || payload.state === 'final') {
    const fullText = extractTextFromContent(payload.message.content)
    const delta = fullText.slice(accumulatedContent.length)
    accumulatedContent = fullText
    if (delta) {
      appendToMessage(delta)
    }
    if (payload.state === 'final') {
      accumulatedContent = ''  // 重置
    }
  }
}
```

## 内容块类型

### 类型定义

```typescript
type ContentBlock = 
  | { type: 'text'; text: string }
  | { type: 'image'; url: string; mimeType?: string }
  | { type: 'tool_use'; name: string; toolCallId: string; arguments: object }
  | { type: 'tool_result'; toolCallId: string; content: string; isError?: boolean }
```

### 文本块

```json
{ "type": "text", "text": "Hello, how can I help you?" }
```

### 图像块

```json
{ "type": "image", "url": "data:image/png;base64,...", "mimeType": "image/png" }
```

### 工具调用块

```json
{
  "type": "tool_use",
  "name": "read_file",
  "toolCallId": "call-abc123",
  "arguments": { "path": "/src/index.ts" }
}
```

### 工具结果块

```json
{
  "type": "tool_result",
  "toolCallId": "call-abc123",
  "content": "file content...",
  "isError": false
}
```

### 内容提取

```typescript
function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  
  return content
    .map(block => {
      if (typeof block === 'string') return block
      if (block && typeof block === 'object' && 'text' in block) {
        return (block as { text: string }).text
      }
      return ''
    })
    .filter(Boolean)
    .join('')
}
```

## 心跳消息处理

### 心跳运行检测

```typescript
function isHeartbeatRun(runId: string): boolean {
  return runId.startsWith('heartbeat-')
}
```

### 心跳标记剥离

```typescript
function stripHeartbeatToken(text: string): { shouldSkip: boolean; text: string } {
  // HEARTBEAT_OK 标记
  if (text === 'HEARTBEAT_OK') {
    return { shouldSkip: true, text: '' }
  }
  
  // 剥离心跳前缀
  const heartbeatPrefix = 'HEARTBEAT_'
  if (text.startsWith(heartbeatPrefix)) {
    return { shouldSkip: false, text: text.slice(heartbeatPrefix.length) }
  }
  
  return { shouldSkip: false, text }
}
```

### 处理流程

```typescript
function handleAssistantEvent(payload: AgentEventPayload) {
  // 检查是否为心跳运行
  if (isHeartbeatRun(payload.runId)) {
    const { shouldSkip, text } = stripHeartbeatToken(payload.data.text || '')
    if (shouldSkip) return
    
    // 处理心跳响应
    console.log('Heartbeat response:', text)
    return
  }
  
  // 正常消息处理
  // ...
}
```

## 历史消息

### chat.history 方法

```typescript
type ChatHistoryParams = {
  sessionKey: string
  limit?: number      // 默认 50
  before?: string     // 消息 ID，用于分页
}

type ChatHistoryResponse = {
  messages: ChatMessage[]
}

type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string | ContentBlock[]
  timestamp: number
  tokens?: { input: number; output: number }
}
```

### 获取历史

```typescript
// 获取最近 50 条消息
const result = await rpc.call('chat.history', {
  sessionKey: 'agent:main:main',
  limit: 50
})

// 分页获取
const older = await rpc.call('chat.history', {
  sessionKey: 'agent:main:main',
  limit: 50,
  before: result.messages[0]?.id
})
```

### 消息解析

```typescript
function parseMessage(msg: ChatMessage): string {
  if (typeof msg.content === 'string') {
    return msg.content
  }
  return extractTextFromContent(msg.content)
}
```

## 中止生成

### chat.abort 方法

```typescript
type ChatAbortParams = {
  runId: string
}
```

### 使用示例

```typescript
// 发送消息
const { runId } = await rpc.call('chat.send', { sessionKey, message })

// 用户点击停止按钮
stopButton.onclick = async () => {
  await rpc.call('chat.abort', { runId })
}
```

### 中止事件

```typescript
// 收到 aborted 事件
{ event: 'chat', payload: { state: 'aborted', runId } }
```

