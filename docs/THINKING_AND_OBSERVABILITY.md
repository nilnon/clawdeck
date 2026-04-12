# Thinking 过程与可观测性完整指南

> 本文档详细说明 OpenClaw Gateway 中思考过程（Thinking）和可观测性（Observability）的实现机制，以及如何在客户端实现极致的 Thinking 体验。

## 目录

1. [概念区分](#1-概念区分)
2. [思考过程（Thinking）](#2-思考过程thinking)
3. [可观测性（Observability）](#3-可观测性observability)
4. [事件流对比](#4-事件流对比)
5. [实现极致 Thinking 体验](#5-实现极致-thinking-体验)
6. [客户端实现指南](#6-客户端实现指南)

***

## 1. 概念区分

### 1.1 Thinking vs Observability

| 特性        | Thinking（思考过程） | Observability（可观测性） |
| --------- | -------------- | ------------------- |
| **目的**    | 展示 AI 的思考过程    | 监控系统运行状态            |
| **数据来源**  | LLM 输出         | **Gateway 内部 Hook** |
| **传输方式**  | WebSocket 事件流  | 服务端日志（不发送给客户端）      |
| **客户端可见** | ✅ 是            | ❌ 否                 |
| **实时性**   | 实时流式           | 后处理统计               |
| **主要用途**  | 用户交互体验         | 运维监控调试              |

### 1.2 数据流向

```
┌─────────────────────────────────────────────────────────────────────┐
│                          数据流向对比                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  【Thinking 流向】                                                   │
│  LLM → Gateway → WebSocket → 客户端 → UI 显示                       │
│                                                                      │
│  【Observability 流向】                                              │
│  Gateway Hook → 服务端日志文件 → 运维查看                           │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

***

## 2. 思考过程（Thinking）

### 2.1 什么是 Thinking

Thinking 是模型在生成最终回复之前的**内部思考过程**，展示了：

- 问题分析
- 推理步骤
- 代码规划
- 自我纠错

### 2.2 支持的模型

| 模型                    | Thinking 支持 | 说明     |
| --------------------- | ----------- | ------ |
| **Claude 3.5 Sonnet** | ✅ 原生支持      | 推荐     |
| **Claude 3.5 Haiku**  | ✅ 原生支持      | <br /> |
| **DeepSeek R1**       | ✅ 原生支持      | 推理模型   |
| **DeepSeek V3**       | ✅ 原生支持      | <br /> |
| **GPT-4o**            | ❌ 不支持       | <br /> |
| **Gemini 2.0**        | ✅ 原生支持      | <br /> |

### 2.3 Thinking 级别

```typescript
type ThinkingLevel = 'light' | 'medium' | 'heavy'

// 创建会话时设置
await adapter.createSession({
  thinking: 'medium'  // 推荐值
})
```

| 级别       | Token 消耗 | 思考深度 | 适用场景     |
| -------- | -------- | ---- | -------- |
| `light`  | 低        | 简单思考 | 快速响应     |
| `medium` | 中        | 平衡   | 日常使用（推荐） |
| `heavy`  | 高        | 深度思考 | 复杂问题     |

### 2.4 Thinking 事件结构

#### Agent 事件中的 Thinking

```json
{
  "type": "event",
  "event": "agent",
  "payload": {
    "stream": "assistant",
    "sessionKey": "session-xxx",
    "runId": "chat-xxx",
    "data": {
      "delta": "最终回复文本",
      "thinking": "让我思考一下这个问题..."
    }
  }
}
```

#### 字段说明

| 字段         | 类型     | 说明        |
| ---------- | ------ | --------- |
| `delta`    | string | 最终回复的增量文本 |
| `thinking` | string | 思考过程的增量文本 |

### 2.5 Thinking 生命周期

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Thinking 生命周期                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  lifecycle.start                                                     │
│       ↓                                                              │
│  assistant (thinking 流)  ←──────────────────┐                      │
│       ↓                                       │                      │
│  assistant (thinking + delta 交替)           │                      │
│       ↓                                       │                      │
│  assistant (delta 流)  ──────────────────────┘                      │
│       ↓                                                              │
│  lifecycle.end                                                       │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**典型事件序列**：

```
1. lifecycle.start          → 开始生成
2. assistant (thinking)     → 思考开始
3. assistant (thinking)     → 思考继续
4. assistant (thinking)     → 思考结束
5. assistant (delta)        → 输出回复
6. assistant (delta)        → 输出继续
7. lifecycle.end            → 生成完成
```

***

## 3. 可观测性（Observability）

### 3.1 什么是 Observability

可观测性是 Gateway 内部的**监控和追踪系统**，用于：

- 性能分析
- Token 统计
- 错误追踪
- 审计日志

### 3.2 可观测性事件类型

```typescript
type ObservabilityEventType =
  | 'before_model_resolve'   // 模型解析前
  | 'before_prompt_build'    // 构建提示词前
  | 'llm_input'              // LLM 输入
  | 'llm_output'             // LLM 输出
  | 'agent_start'            // Agent 开始
  | 'agent_end'              // Agent 结束
  | 'tool_start'             // 工具调用开始
  | 'tool_end'               // 工具调用结束
```

### 3.3 可观测性事件示例

```
13:14:53 [openclaw-observability] before_model_resolve: session=xxx
13:14:56 [openclaw-observability] before_prompt_build: session=xxx msgs=112
13:14:56 [openclaw-observability] llm_input: session=xxx model=openrouter/minimax/minimax-m2.5:free
13:15:15 [openclaw-observability] agent_end: session=xxx success=true duration=18665ms
13:15:16 [openclaw-observability] llm_output: session=xxx tokens=18981/71
```

### 3.4 可观测性数据获取

客户端通过 **RPC 方法** 获取可观测性数据：

```typescript
// 获取统计数据
const stats = await adapter.getObservabilityStats()
// {
//   totalSessions: 10,
//   activeSessions: 2,
//   totalMessages: 150,
//   totalTokens: 50000,
//   modelUsage: { 'claude-3.5-sonnet': 30000, 'gpt-4o': 20000 },
//   toolCalls: 45,
//   averageResponseTime: 2500
// }

// 获取会话监控
const sessions = await adapter.getObservabilitySessions()
// [{
//   sessionKey: 'session-xxx',
//   agentId: 'default',
//   status: 'running',
//   messageCount: 15,
//   lastActivity: 1712934567890,
//   model: 'claude-3.5-sonnet'
// }]
```

***

## 4. 事件流对比

### 4.1 完整事件流

```
┌─────────────────────────────────────────────────────────────────────┐
│                      完整事件流（客户端可见）                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  【连接阶段】                                                        │
│  connect.challenge → (认证) → hello-ok                              │
│                                                                      │
│  【聊天阶段】                                                        │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ agent 事件                                                    │    │
│  │ ├── lifecycle.start                                          │    │
│  │ ├── assistant (thinking) ← 思考过程                          │    │
│  │ ├── assistant (thinking)                                     │    │
│  │ ├── assistant (delta)    ← 最终回复                          │    │
│  │ ├── tool.start           ← 工具调用                          │    │
│  │ ├── tool.result                                              │    │
│  │ ├── assistant (delta)                                        │    │
│  │ └── lifecycle.end                                            │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  【系统事件】                                                        │
│  health, presence, shutdown, sessions.changed, ...                  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                   可观测性事件流（服务端内部）                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  before_model_resolve → before_prompt_build → llm_input            │
│       ↓                                                              │
│  agent_start → tool_start → tool_end → agent_end                   │
│       ↓                                                              │
│  llm_output                                                         │
│                                                                      │
│  ※ 这些事件不会发送给客户端，仅记录在服务端日志                      │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 事件对照表

| 阶段       | 客户端可见事件                | 服务端可观测性事件              |
| -------- | ---------------------- | ---------------------- |
| 模型选择     | -                      | `before_model_resolve` |
| 提示词构建    | -                      | `before_prompt_build`  |
| LLM 调用   | -                      | `llm_input`            |
| Agent 开始 | `lifecycle.start`      | `agent_start`          |
| 思考过程     | `assistant (thinking)` | -                      |
| 工具调用     | `tool.start`           | `tool_start`           |
| 工具结果     | `tool.result`          | `tool_end`             |
| Agent 结束 | `lifecycle.end`        | `agent_end`            |
| LLM 输出   | -                      | `llm_output`           |

***

## 4.3 过程可见性问题与解决方案

### 问题：Thinking 过程不清晰

如果只是展示 Thinking 文本，用户可能遇到以下问题：

| 问题        | 说明          | 影响       |
| --------- | ----------- | -------- |
| **阶段不明确** | 不知道当前处于哪个阶段 | 用户焦虑     |
| **卡住无反馈** | 某个环节长时间无响应  | 不知道是否出问题 |
| **进度不可见** | 不知道整体进度     | 无法预估时间   |
| **错误难定位** | 出错时不知道哪里出错  | 调试困难     |

### 解决方案：阶段状态追踪

虽然可观测性事件不会发送给客户端，但我们可以从 **agent 事件推断当前阶段**：

```
┌─────────────────────────────────────────────────────────────────────┐
│                      阶段状态推断                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  【阶段定义】                                                        │
│  ├── 🚀 INITIALIZING    → lifecycle.start                           │
│  ├── 🧠 THINKING        → assistant (thinking)                      │
│  ├── 📝 GENERATING      → assistant (delta)                         │
│  ├── 🔧 TOOL_CALLING    → tool.start                                │
│  ├── ⏳ TOOL_WAITING    → tool.start (等待结果)                      │
│  ├── ✅ TOOL_COMPLETE   → tool.result                               │
│  ├── ✔️ COMPLETED       → lifecycle.end                             │
│  └── ❌ ERROR           → lifecycle.end (error)                     │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 实现方案

#### 1. 阶段状态定义

```typescript
export type AgentPhase = 
  | 'idle'           // 空闲
  | 'initializing'   // 初始化中
  | 'thinking'       // 思考中
  | 'generating'     // 生成回复中
  | 'tool_calling'   // 工具调用中
  | 'tool_waiting'   // 等待工具结果
  | 'tool_complete'  // 工具调用完成
  | 'completed'      // 完成
  | 'error'          // 错误

export interface AgentState {
  phase: AgentPhase
  phaseStartTime: number
  phaseTimeout: number  // 当前阶段超时时间（毫秒）
  thinkingContent: string
  outputContent: string
  currentTool?: {
    name: string
    callId: string
    args: Record<string, unknown>
    startTime: number
  }
  completedTools: Array<{
    name: string
    callId: string
    duration: number
    success: boolean
  }>
  totalDuration: number
  error?: string
}
```

#### 2. 阶段转换逻辑

```typescript
function updatePhase(state: AgentState, event: ClassifiedEvent): AgentState {
  const now = Date.now()
  
  switch (event.type) {
    case 'lifecycle_start':
      return {
        ...state,
        phase: 'initializing',
        phaseStartTime: now,
        phaseTimeout: 5000,  // 5秒超时
      }
      
    case 'assistant_stream':
      const hasThinking = event.agentPayload?.data?.thinking
      const hasDelta = event.agentPayload?.data?.delta
      
      if (hasThinking && !hasDelta) {
        return {
          ...state,
          phase: 'thinking',
          phaseStartTime: now,
          phaseTimeout: 60000,  // 思考可能较长
          thinkingContent: state.thinkingContent + hasThinking,
        }
      }
      
      if (hasDelta) {
        return {
          ...state,
          phase: 'generating',
          phaseStartTime: now,
          phaseTimeout: 30000,
          outputContent: state.outputContent + hasDelta,
        }
      }
      return state
      
    case 'agent_tool_start':
      return {
        ...state,
        phase: 'tool_calling',
        phaseStartTime: now,
        phaseTimeout: 60000,
        currentTool: {
          name: event.agentPayload?.data?.name,
          callId: event.agentPayload?.data?.toolCallId,
          args: event.agentPayload?.data?.arguments,
          startTime: now,
        },
      }
      
    case 'agent_tool_result':
      return {
        ...state,
        phase: 'tool_complete',
        phaseStartTime: now,
        phaseTimeout: 1000,
        currentTool: undefined,
        completedTools: [
          ...state.completedTools,
          {
            name: state.currentTool?.name || '',
            callId: state.currentTool?.callId || '',
            duration: now - (state.currentTool?.startTime || now),
            success: true,
          },
        ],
      }
      
    case 'lifecycle_end':
      return {
        ...state,
        phase: 'completed',
        phaseStartTime: now,
        totalDuration: now - state.phaseStartTime,
      }
      
    case 'error':
    case 'chat_error':
      return {
        ...state,
        phase: 'error',
        error: event.chatPayload?.errorMessage || 'Unknown error',
      }
      
    default:
      return state
  }
}
```

#### 3. 超时检测

```typescript
function checkPhaseTimeout(state: AgentState): { timeout: boolean; phase: AgentPhase } {
  const elapsed = Date.now() - state.phaseStartTime
  
  if (elapsed > state.phaseTimeout) {
    return { timeout: true, phase: state.phase }
  }
  
  return { timeout: false, phase: state.phase }
}

// 定时检查（每秒）
setInterval(() => {
  const { timeout, phase } = checkPhaseTimeout(currentState)
  if (timeout) {
    console.warn(`Phase "${phase}" has been running for too long`)
    // 可以显示警告给用户
    showPhaseWarning(phase, elapsed)
  }
}, 1000)
```

#### 4. UI 状态展示

```tsx
function AgentStatusIndicator({ state }: { state: AgentState }) {
  const elapsed = Date.now() - state.phaseStartTime
  
  return (
    <div className="agent-status">
      {/* 当前阶段 */}
      <div className="phase-indicator">
        <PhaseIcon phase={state.phase} />
        <span>{getPhaseLabel(state.phase)}</span>
        <span className="elapsed">{formatDuration(elapsed)}</span>
      </div>
      
      {/* 进度条 */}
      <div className="progress-bar">
        <div 
          className="progress" 
          style={{ width: `${calculateProgress(state)}%` }}
        />
      </div>
      
      {/* 当前工具 */}
      {state.currentTool && (
        <div className="current-tool">
          <WrenchIcon />
          <span>调用: {state.currentTool.name}</span>
          <Spinner />
        </div>
      )}
      
      {/* 已完成工具 */}
      {state.completedTools.length > 0 && (
        <div className="completed-tools">
          {state.completedTools.map(tool => (
            <div key={tool.callId} className="tool-item">
              <CheckIcon />
              <span>{tool.name}</span>
              <span>{formatDuration(tool.duration)}</span>
            </div>
          ))}
        </div>
      )}
      
      {/* 超时警告 */}
      {isPhaseTimeout(state) && (
        <div className="timeout-warning">
          <AlertIcon />
          <span>当前阶段耗时较长，请耐心等待...</span>
        </div>
      )}
    </div>
  )
}

function getPhaseLabel(phase: AgentPhase): string {
  const labels: Record<AgentPhase, string> = {
    idle: '空闲',
    initializing: '初始化中',
    thinking: '思考中',
    generating: '生成回复',
    tool_calling: '调用工具',
    tool_waiting: '等待工具结果',
    tool_complete: '工具调用完成',
    completed: '已完成',
    error: '出错了',
  }
  return labels[phase]
}
```

### 阶段超时建议值

| 阶段             | 建议超时 | 说明          |
| -------------- | ---- | ----------- |
| `initializing` | 5s   | 初始化应该很快     |
| `thinking`     | 60s  | 思考可能较长，复杂问题 |
| `generating`   | 30s  | 生成回复        |
| `tool_calling` | 60s  | 工具执行可能较慢    |
| `tool_waiting` | 60s  | 等待外部服务      |

***

## 5. 实现极致 Thinking 体验

### 5.1 架构设计

```
┌─────────────────────────────────────────────────────────────────────┐
│                    极致 Thinking 体验架构                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │   Gateway    │───▶│   Adapter    │───▶│     UI       │          │
│  │  (WebSocket) │    │  (事件处理)   │    │  (渲染展示)   │          │
│  └──────────────┘    └──────────────┘    └──────────────┘          │
│         │                   │                   │                   │
│         │                   │                   │                   │
│         ▼                   ▼                   ▼                   │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │ agent 事件    │    │ ChatChunk    │    │ Thinking 组件 │          │
│  │ - thinking   │───▶│ - chunkType  │───▶│ - 实时渲染    │          │
│  │ - delta      │    │ - thinking   │    │ - 折叠/展开   │          │
│  │ - tool       │    │ - toolName   │    │ - 语法高亮    │          │
│  └──────────────┘    └──────────────┘    └──────────────┘          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 数据结构设计

#### ChatChunk 类型

```typescript
export type ChatChunkType = 
  | 'text'          // 普通文本
  | 'thinking'      // 思考过程
  | 'tool_start'    // 工具调用开始
  | 'tool_result'   // 工具调用结果
  | 'error'         // 错误

export interface ChatChunk {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  done: boolean
  timestamp: number
  
  // 类型标识
  chunkType?: ChatChunkType
  
  // Thinking 相关
  thinking?: string
  
  // Tool 相关
  toolName?: string
  toolCallId?: string
  toolArgs?: Record<string, unknown>
  toolResult?: unknown
}
```

### 5.3 事件处理逻辑

```typescript
// 在 chat() 方法中处理事件
const messageHandler = (data: unknown) => {
  const classified = classifyStreamEvent(data)
  
  if (classified.source === 'agent') {
    if (classified.type === 'assistant_stream') {
      const dataObj = classified.agentPayload?.data
      
      // 1. 处理 thinking
      const thinking = dataObj?.thinking
      if (thinking) {
        responseQueue.push({
          content: '',
          done: false,
          chunkType: 'thinking',
          thinking: thinking
        })
      }
      
      // 2. 处理 delta
      const delta = dataObj?.delta
      if (delta) {
        responseQueue.push({
          content: delta,
          done: false,
          chunkType: 'text'
        })
      }
    }
    
    // 3. 处理工具调用
    if (classified.type === 'agent_tool_start') {
      responseQueue.push({
        content: '',
        done: false,
        chunkType: 'tool_start',
        toolName: data.name,
        toolArgs: data.arguments
      })
    }
  }
}
```

### 5.4 UI 渲染策略

#### 思考过程渲染

```tsx
// ThinkingBlock.tsx
function ThinkingBlock({ thinking }: { thinking: string }) {
  const [expanded, setExpanded] = useState(true)
  
  return (
    <div className="thinking-block">
      <div 
        className="thinking-header"
        onClick={() => setExpanded(!expanded)}
      >
        <BrainIcon />
        <span>思考过程</span>
        <ChevronIcon direction={expanded ? 'down' : 'right'} />
      </div>
      
      {expanded && (
        <div className="thinking-content">
          <Markdown>{thinking}</Markdown>
        </div>
      )}
    </div>
  )
}
```

#### 工具调用渲染

```tsx
// ToolCallBlock.tsx
function ToolCallBlock({ toolName, toolArgs, toolResult }: Props) {
  const [expanded, setExpanded] = useState(false)
  
  return (
    <div className="tool-call-block">
      <div className="tool-header">
        <WrenchIcon />
        <span>调用工具: {toolName}</span>
        <StatusBadge status={toolResult ? 'success' : 'running'} />
      </div>
      
      {expanded && (
        <div className="tool-details">
          <div className="tool-args">
            <h4>参数</h4>
            <CodeBlock language="json">
              {JSON.stringify(toolArgs, null, 2)}
            </CodeBlock>
          </div>
          
          {toolResult && (
            <div className="tool-result">
              <h4>结果</h4>
              <CodeBlock language="json">
                {JSON.stringify(toolResult, null, 2)}
              </CodeBlock>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

***

## 6. 客户端实现指南

### 6.1 完整实现示例

```typescript
// useChat.ts
function useChat(adapter: IAgentAdapter, sessionId: string) {
  const [messages, setMessages] = useState<Message[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [currentThinking, setCurrentThinking] = useState('')
  const [currentToolCalls, setCurrentToolCalls] = useState<ToolCall[]>([])
  
  async function sendMessage(content: string) {
    // 添加用户消息
    setMessages(prev => [...prev, { role: 'user', content }])
    
    // 准备接收响应
    setIsStreaming(true)
    setCurrentThinking('')
    setCurrentToolCalls([])
    
    let assistantContent = ''
    let thinkingContent = ''
    
    try {
      for await (const chunk of adapter.chat(content, { sessionId })) {
        switch (chunk.chunkType) {
          case 'thinking':
            // 累积思考过程
            thinkingContent += chunk.thinking || ''
            setCurrentThinking(thinkingContent)
            break
            
          case 'text':
            // 累积回复内容
            assistantContent += chunk.content
            // 实时更新消息
            setMessages(prev => {
              const last = prev[prev.length - 1]
              if (last?.role === 'assistant' && !last.done) {
                return [...prev.slice(0, -1), {
                  ...last,
                  content: assistantContent,
                  thinking: thinkingContent,
                  done: chunk.done
                }]
              }
              return [...prev, {
                role: 'assistant',
                content: assistantContent,
                thinking: thinkingContent,
                done: chunk.done
              }]
            })
            break
            
          case 'tool_start':
            // 添加工具调用
            setCurrentToolCalls(prev => [...prev, {
              id: chunk.toolCallId!,
              name: chunk.toolName!,
              args: chunk.toolArgs,
              status: 'running'
            }])
            break
            
          case 'tool_result':
            // 更新工具结果
            setCurrentToolCalls(prev => prev.map(tc => 
              tc.id === chunk.toolCallId 
                ? { ...tc, result: chunk.toolResult, status: 'success' }
                : tc
            ))
            break
            
          case 'error':
            throw new Error(chunk.content)
        }
        
        if (chunk.done) {
          setIsStreaming(false)
        }
      }
    } catch (error) {
      console.error('Chat error:', error)
      setIsStreaming(false)
    }
  }
  
  return {
    messages,
    isStreaming,
    currentThinking,
    currentToolCalls,
    sendMessage
  }
}
```

### 6.2 最佳实践

#### 1. 会话配置

```typescript
// 创建支持 thinking 的会话
const sessionId = await adapter.createSession({
  model: 'claude-3.5-sonnet',  // 支持 thinking 的模型
  thinking: 'medium',           // 启用思考过程
  systemPrompt: '...'           // 可选的系统提示
})
```

#### 2. 实时更新 UI

```typescript
// 使用 requestAnimationFrame 优化渲染
let pendingUpdate = false

function scheduleUpdate(update: () => void) {
  if (!pendingUpdate) {
    pendingUpdate = true
    requestAnimationFrame(() => {
      update()
      pendingUpdate = false
    })
  }
}
```

#### 3. 错误处理

```typescript
// 完整的错误处理
for await (const chunk of adapter.chat(content, { sessionId })) {
  if (chunk.chunkType === 'error') {
    // 显示错误
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `错误: ${chunk.content}`,
      isError: true
    }])
    break
  }
}
```

#### 4. 中止生成

```typescript
// 用户点击停止按钮
function handleAbort() {
  adapter.abort(currentRunId)
  setIsStreaming(false)
}
```

### 6.3 性能优化

#### 1. 节流渲染

```typescript
// 使用 throttle 控制渲染频率
const throttledUpdate = throttle((content: string) => {
  setAssistantContent(content)
}, 50)  // 50ms 更新一次
```

#### 2. 虚拟滚动

```typescript
// 长对话使用虚拟滚动
import { Virtuoso } from 'react-virtuoso'

function MessageList({ messages }) {
  return (
    <Virtuoso
      data={messages}
      itemContent={(index, message) => (
        <MessageItem key={index} message={message} />
      )}
    />
  )
}
```

#### 3. 增量更新

```typescript
// 只更新变化的部分
function updateMessage(index: number, updates: Partial<Message>) {
  setMessages(prev => {
    const newMessages = [...prev]
    newMessages[index] = { ...newMessages[index], ...updates }
    return newMessages
  })
}
```

***

## 附录

### A. 事件处理完整代码

参见：[server/adapters/openclaw/index.ts](../server/adapters/openclaw/index.ts)

### B. 类型定义

参见：[shared/types.ts](../shared/types.ts)

### C. 相关文档

- [OpenClaw Gateway 协议](./openclaw-gateway/03-protocol.md)
- [OpenClaw Gateway 事件](./openclaw-gateway/05-events.md)
- [OpenClaw Gateway 聊天](./openclaw-gateway/07-chat.md)

