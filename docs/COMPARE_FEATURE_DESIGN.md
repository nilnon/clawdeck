# OpenClaw vs Hermes 对比功能设计方案

## 一、现状分析

### 已有组件

| 模块 | 状态 | 说明 |
|------|------|------|
| OpenClawAdapter | ✅ 完整 | WebSocket RPC 通信，支持 thinking/tool 流式事件 |
| HermesAdapter | ✅ 完整 | ACP 协议/CLI 双模式 |
| AdapterRegistry | ✅ 完整 | 多适配器管理 |
| ChatPanel | ✅ 完整 | 单一聊天面板，流式响应 |
| AgentContext | ✅ 完整 | Agent 切换管理 |

### 缺失功能

| 模块 | 状态 | 说明 |
|------|------|------|
| 对比页面 | ❌ 缺失 | 左右并排对比视图 |
| 并行请求 API | ❌ 缺失 | 同时向两个 Agent 发送消息 |
| 共享输入框 | ❌ 缺失 | 统一输入，分发到两侧 |
| 响应对比组件 | ❌ 缺失 | 并排显示响应结果 |

---

## 二、架构设计

```
┌─────────────────────────────────────────────────────────────────────┐
│                           ComparePage                                │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────┐   ┌─────────────────────────┐         │
│  │     OpenClaw Panel      │   │      Hermes Panel       │         │
│  │  ┌───────────────────┐  │   │  ┌───────────────────┐  │         │
│  │  │ Status Indicator  │  │   │  │ Status Indicator  │  │         │
│  │  ├───────────────────┤  │   │  ├───────────────────┤  │         │
│  │  │                   │  │   │  │                   │  │         │
│  │  │   Messages Area   │  │   │  │   Messages Area   │  │         │
│  │  │   (Streaming)     │  │   │  │   (Streaming)     │  │         │
│  │  │                   │  │   │  │                   │  │         │
│  │  └───────────────────┘  │   │  └───────────────────┘  │         │
│  │  Stats: Time/Tokens     │   │  Stats: Time/Tokens     │         │
│  └─────────────────────────┘   └─────────────────────────┘         │
├─────────────────────────────────────────────────────────────────────┤
│                     ┌─────────────────────┐                         │
│                     │   Shared Input      │                         │
│                     │   [Text Area] [Send]│                         │
│                     └─────────────────────┘                         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 三、详细实现方案

### 1. 后端 API 扩展

#### 新增路由: `/api/chat/compare`

```typescript
// server/routes/compare.ts
POST /api/chat/compare
Body: { message: string, openclawSessionId?: string, hermesSessionId?: string }
Response: SSE 流，包含两个 Agent 的响应
```

#### 事件格式

```typescript
// OpenClaw 事件
data: { source: 'openclaw', ...ChatChunk }

// Hermes 事件  
data: { source: 'hermes', ...ChatChunk }

// 完成标记
data: { source: 'openclaw', done: true }
data: { source: 'hermes', done: true }
data: [DONE]
```

### 2. 前端组件结构

```
src/
├── pages/
│   └── ComparePage.tsx          # 对比页面入口
├── features/
│   └── compare/
│       ├── ComparePanel.tsx     # 对比面板容器
│       ├── AgentResponsePanel.tsx # 单个 Agent 响应面板
│       ├── SharedInput.tsx      # 共享输入框
│       ├── CompareStats.tsx     # 对比统计信息
│       └── useCompareChat.ts    # 对比聊天 Hook
└── contexts/
    └── CompareContext.tsx       # 对比状态管理
```

### 3. 核心类型定义

```typescript
// shared/types.ts 新增

export interface CompareConfig {
  openclawAgentId: string
  hermesAgentId: string
  openclawSessionId?: string
  hermesSessionId?: string
}

export interface CompareResponse {
  source: 'openclaw' | 'hermes'
  chunk: ChatChunk
}

export interface CompareStats {
  source: 'openclaw' | 'hermes'
  totalTime: number
  firstTokenTime?: number
  tokenCount: number
  toolCallCount: number
}
```

---

## 四、实现步骤

### Phase 1: 后端 API (优先级: 高)

| 任务 | 文件 | 说明 |
|------|------|------|
| 1.1 | `server/routes/compare.ts` | 新建对比路由 |
| 1.2 | `server/index.ts` | 注册新路由 |
| 1.3 | `server/routes/sessions.ts` | 添加创建对比会话接口 |

### Phase 2: 前端核心组件 (优先级: 高)

| 任务 | 文件 | 说明 |
|------|------|------|
| 2.1 | `src/features/compare/useCompareChat.ts` | 对比聊天 Hook |
| 2.2 | `src/features/compare/AgentResponsePanel.tsx` | 单侧响应面板 |
| 2.3 | `src/features/compare/SharedInput.tsx` | 共享输入框 |
| 2.4 | `src/features/compare/ComparePanel.tsx` | 对比面板容器 |

### Phase 3: 页面集成 (优先级: 中)

| 任务 | 文件 | 说明 |
|------|------|------|
| 3.1 | `src/pages/ComparePage.tsx` | 对比页面 |
| 3.2 | `src/App.tsx` | 添加路由 |
| 3.3 | `src/layouts/MainLayout.tsx` | 添加导航入口 |

### Phase 4: 增强功能 (优先级: 低)

| 任务 | 文件 | 说明 |
|------|------|------|
| 4.1 | `src/features/compare/CompareStats.tsx` | 对比统计 |
| 4.2 | `src/features/compare/ResponseDiff.tsx` | 响应差异对比 |
| 4.3 | 导出对比报告功能 | PDF/JSON 导出 |

---

## 五、关键代码设计

### 5.1 后端对比路由

```typescript
// server/routes/compare.ts
import { Hono } from 'hono'
import adapterRegistry from '../lib/adapter-registry.js'

const compare = new Hono()

compare.post('/', async (c) => {
  const body = await c.req.json()
  const { message, openclawSessionId, hermesSessionId } = body

  const openclaw = adapterRegistry.get('openclaw')
  const hermes = adapterRegistry.get('hermes')

  if (!openclaw || !hermes) {
    return c.json({ error: 'Both agents must be connected' }, 400)
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      let openclawDone = false
      let hermesDone = false

      const sendChunk = (source: string, chunk: any) => {
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ source, ...chunk })}\n\n`
        ))
      }

      // 并行执行两个流
      const runOpenclaw = async () => {
        try {
          for await (const chunk of openclaw.chat(message, { sessionId: openclawSessionId })) {
            sendChunk('openclaw', chunk)
          }
        } finally {
          openclawDone = true
          if (openclawDone && hermesDone) {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
          }
        }
      }

      const runHermes = async () => {
        try {
          for await (const chunk of hermes.chat(message, { sessionId: hermesSessionId })) {
            sendChunk('hermes', chunk)
          }
        } finally {
          hermesDone = true
          if (openclawDone && hermesDone) {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
          }
        }
      }

      await Promise.all([runOpenclaw(), runHermes()])
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
})

export default compare
```

### 5.2 前端对比 Hook

```typescript
// src/features/compare/useCompareChat.ts
import { useState, useCallback } from 'react'
import type { ChatChunk } from '@shared/types'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  thinking?: string
  toolCalls?: ToolCall[]
}

interface CompareStats {
  totalTime: number
  firstTokenTime?: number
  tokenCount: number
  toolCallCount: number
}

interface AgentState {
  messages: Message[]
  isStreaming: boolean
  stats: CompareStats
}

interface CompareState {
  openclaw: AgentState
  hermes: AgentState
}

const initialStats: CompareStats = {
  totalTime: 0,
  firstTokenTime: undefined,
  tokenCount: 0,
  toolCallCount: 0,
}

const initialState: CompareState = {
  openclaw: { messages: [], isStreaming: false, stats: { ...initialStats } },
  hermes: { messages: [], isStreaming: false, stats: { ...initialStats } },
}

export function useCompareChat() {
  const [state, setState] = useState<CompareState>(initialState)

  const sendMessage = useCallback(async (message: string, openclawSessionId?: string, hermesSessionId?: string) => {
    const startTime = Date.now()
    
    // 添加用户消息
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
      timestamp: startTime,
    }

    // 重置状态并添加用户消息
    setState({
      openclaw: {
        messages: [userMessage],
        isStreaming: true,
        stats: { ...initialStats, totalTime: startTime },
      },
      hermes: {
        messages: [userMessage],
        isStreaming: true,
        stats: { ...initialStats, totalTime: startTime },
      },
    })

    try {
      const res = await fetch('/api/chat/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, openclawSessionId, hermesSessionId }),
      })

      if (!res.body) throw new Error('No response body')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data: ')) continue

          const data = trimmed.slice(6)
          if (data === '[DONE]') continue

          try {
            const chunk = JSON.parse(data)
            const source = chunk.source as 'openclaw' | 'hermes'
            
            setState(prev => ({
              ...prev,
              [source]: updateAgentState(prev[source], chunk, startTime),
            }))
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err) {
      console.error('Compare chat error:', err)
      setState(prev => ({
        openclaw: { ...prev.openclaw, isStreaming: false },
        hermes: { ...prev.hermes, isStreaming: false },
      }))
    }
  }, [])

  const reset = useCallback(() => {
    setState(initialState)
  }, [])

  return { state, sendMessage, reset }
}

function updateAgentState(prev: AgentState, chunk: any, startTime: number): AgentState {
  const now = Date.now()
  let messages = [...prev.messages]
  let stats = { ...prev.stats }
  
  // 获取或创建 assistant 消息
  let assistantMsg = messages.find(m => m.role === 'assistant' && m.isStreaming)
  if (!assistantMsg) {
    assistantMsg = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: now,
      isStreaming: true,
      thinking: '',
      toolCalls: [],
    }
    messages.push(assistantMsg)
  }

  // 更新消息内容
  const msgIndex = messages.findIndex(m => m.id === assistantMsg!.id)
  
  if (chunk.chunkType === 'thinking') {
    messages[msgIndex] = {
      ...assistantMsg,
      thinking: (assistantMsg.thinking || '') + (chunk.thinking || ''),
    }
  } else if (chunk.chunkType === 'tool_start') {
    messages[msgIndex] = {
      ...assistantMsg,
      toolCalls: [
        ...(assistantMsg.toolCalls || []),
        {
          id: chunk.toolCallId,
          name: chunk.toolName,
          args: chunk.toolArgs,
          status: 'running',
          startTime: chunk.toolStartedAt,
        },
      ],
    }
    stats.toolCallCount++
  } else if (chunk.chunkType === 'tool_result') {
    messages[msgIndex] = {
      ...assistantMsg,
      toolCalls: assistantMsg.toolCalls?.map(tc =>
        tc.id === chunk.toolCallId
          ? { ...tc, status: 'success', result: chunk.toolResult }
          : tc
      ),
    }
  } else if (chunk.content) {
    // 记录首 token 时间
    if (!stats.firstTokenTime && chunk.content) {
      stats.firstTokenTime = now - startTime
    }
    stats.tokenCount++
    
    messages[msgIndex] = {
      ...assistantMsg,
      content: assistantMsg.content + chunk.content,
    }
  }

  // 处理完成
  if (chunk.done) {
    messages[msgIndex] = { ...messages[msgIndex], isStreaming: false }
    stats.totalTime = now - startTime
    return { messages, isStreaming: false, stats }
  }

  return { messages, isStreaming: true, stats }
}
```

### 5.3 对比面板组件

```typescript
// src/features/compare/ComparePanel.tsx
import { useState } from 'react'
import { Send, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AgentResponsePanel } from './AgentResponsePanel'
import { useCompareChat } from './useCompareChat'

export function ComparePanel() {
  const { state, sendMessage, reset } = useCompareChat()
  const [input, setInput] = useState('')
  
  const isStreaming = state.openclaw.isStreaming || state.hermes.isStreaming

  const handleSend = () => {
    if (!input.trim() || isStreaming) return
    sendMessage(input.trim())
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* 对比区域 */}
      <div className="flex-1 flex gap-4 p-4 overflow-hidden">
        <AgentResponsePanel
          title="OpenClaw"
          agentType="openclaw"
          messages={state.openclaw.messages}
          isStreaming={state.openclaw.isStreaming}
          stats={state.openclaw.stats}
          themeColor="blue"
        />
        <AgentResponsePanel
          title="Hermes"
          agentType="hermes"
          messages={state.hermes.messages}
          isStreaming={state.hermes.isStreaming}
          stats={state.hermes.stats}
          themeColor="green"
        />
      </div>

      {/* 共享输入框 */}
      <div className="border-t border-border p-4 bg-card/50 backdrop-blur-sm">
        <div className="w-full max-w-5xl mx-auto">
          <div className="flex gap-3 items-end">
            <div className="flex-1 relative">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入消息，同时发送到 OpenClaw 和 Hermes..."
                rows={1}
                className="w-full resize-none rounded-xl border border-input bg-background px-4 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>
            <Button
              onClick={handleSend}
              disabled={!input.trim() || isStreaming}
              className="rounded-xl h-11 w-11 p-0"
            >
              {isStreaming ? (
                <Square className="w-4 h-4" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

### 5.4 单侧响应面板

```typescript
// src/features/compare/AgentResponsePanel.tsx
import { Bot, User, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ThinkingBubble, ToolCallBlock, type ToolCall } from '@/features/chat/MessageBlocks'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  isStreaming?: boolean
  thinking?: string
  toolCalls?: ToolCall[]
}

interface CompareStats {
  totalTime: number
  firstTokenTime?: number
  tokenCount: number
  toolCallCount: number
}

interface AgentResponsePanelProps {
  title: string
  agentType: 'openclaw' | 'hermes'
  messages: Message[]
  isStreaming: boolean
  stats: CompareStats
  themeColor: 'blue' | 'green'
}

export function AgentResponsePanel({
  title,
  agentType,
  messages,
  isStreaming,
  stats,
  themeColor,
}: AgentResponsePanelProps) {
  const themeClasses = {
    blue: {
      border: 'border-blue-500/30',
      bg: 'bg-blue-500/5',
      text: 'text-blue-500',
      indicator: 'bg-blue-500',
    },
    green: {
      border: 'border-green-500/30',
      bg: 'bg-green-500/5',
      text: 'text-green-500',
      indicator: 'bg-green-500',
    },
  }
  const theme = themeClasses[themeColor]

  return (
    <div className={cn(
      "flex-1 flex flex-col rounded-xl border overflow-hidden",
      theme.border
    )}>
      {/* Header */}
      <div className={cn("px-4 py-3 border-b flex items-center justify-between", theme.bg)}>
        <div className="flex items-center gap-2">
          <span className={cn("w-2 h-2 rounded-full", theme.indicator, isStreaming && "animate-pulse")} />
          <span className="font-medium text-sm">{title}</span>
          <span className="text-xs text-muted-foreground uppercase">({agentType})</span>
        </div>
        {isStreaming && (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
            <Bot className="w-12 h-12 mb-2 opacity-20" />
            <p className="text-sm">等待输入...</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex gap-3",
                msg.role === 'user' ? "flex-row-reverse" : "flex-row"
              )}
            >
              <div className={cn(
                "w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
                msg.role === 'user' ? "bg-primary text-primary-foreground" : "bg-muted"
              )}>
                {msg.role === 'user' ? (
                  <User className="w-3.5 h-3.5" />
                ) : (
                  <Bot className="w-3.5 h-3.5" />
                )}
              </div>

              <div className={cn(
                "flex-1 max-w-[90%]",
                msg.role === 'user' ? "text-right" : "text-left"
              )}>
                {msg.role === 'assistant' && (
                  <>
                    {msg.thinking && (
                      <div className="mb-2 text-xs text-muted-foreground italic">
                        💭 {msg.thinking.slice(0, 100)}...
                      </div>
                    )}
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div className="space-y-1 mb-2">
                        {msg.toolCalls.map((tc) => (
                          <div key={tc.id} className="text-xs bg-muted/50 rounded px-2 py-1">
                            🔧 {tc.name}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}

                <div className={cn(
                  "inline-block rounded-xl px-3 py-2 text-sm",
                  msg.role === 'user'
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                )}>
                  <pre className="whitespace-pre-wrap font-sans">
                    {msg.content || (msg.isStreaming ? '...' : '')}
                  </pre>
                  {msg.isStreaming && !msg.thinking && (
                    <span className="inline-block w-1.5 h-4 bg-primary/50 ml-0.5 animate-pulse" />
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Stats Footer */}
      <div className={cn("px-4 py-2 border-t text-xs text-muted-foreground", theme.bg)}>
        <div className="flex justify-between">
          <span>耗时: {stats.totalTime}ms</span>
          {stats.firstTokenTime && (
            <span>首Token: {stats.firstTokenTime}ms</span>
          )}
          <span>Tokens: {stats.tokenCount}</span>
          <span>工具调用: {stats.toolCallCount}</span>
        </div>
      </div>
    </div>
  )
}
```

### 5.5 对比页面

```typescript
// src/pages/ComparePage.tsx
import { ComparePanel } from '@/features/compare/ComparePanel'

export default function ComparePage() {
  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="w-full px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">OpenClaw vs Hermes 对比</h1>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>同一输入，对比两个 Agent 的响应</span>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        <ComparePanel />
      </div>
    </div>
  )
}
```

---

## 六、UI/UX 设计要点

### 6.1 视觉对比

- **左侧 OpenClaw**: 蓝色主题边框 (`border-blue-500/30`)
- **右侧 Hermes**: 绿色主题边框 (`border-green-500/30`)
- **中间分隔线**: 可选添加可拖拽调整宽度功能

### 6.2 状态指示

- 连接状态指示器 (圆点)
- 流式响应进度 (脉冲动画)
- 首 Token 时间显示

### 6.3 统计对比

| 指标 | OpenClaw | Hermes |
|------|----------|--------|
| 总耗时 | 1.2s | 1.5s |
| 首 Token | 0.3s | 0.5s |
| Token 数 | 256 | 312 |
| 工具调用 | 2 | 1 |

---

## 七、文件清单

### 需要新建的文件

```
server/routes/compare.ts           # 后端对比路由
src/pages/ComparePage.tsx          # 对比页面
src/features/compare/
├── ComparePanel.tsx               # 对比面板
├── AgentResponsePanel.tsx         # 响应面板
├── SharedInput.tsx                # 共享输入 (可选，已集成到 ComparePanel)
├── CompareStats.tsx               # 统计组件 (可选增强)
└── useCompareChat.ts              # 对比 Hook
```

### 需要修改的文件

```
server/index.ts                    # 注册新路由
src/App.tsx                        # 添加路由
src/layouts/MainLayout.tsx         # 添加导航入口
shared/types.ts                    # 新增类型 (可选)
```

---

## 八、后续增强

### 8.1 会话管理

- 支持选择已有会话进行对比
- 保存对比历史记录
- 导出对比报告 (JSON/PDF)

### 8.2 高级对比

- 响应质量评分
- 自动差异高亮
- 性能图表可视化

### 8.3 多 Agent 对比

- 支持同时对比 3+ 个 Agent
- 自定义对比面板布局
- 分组对比功能
