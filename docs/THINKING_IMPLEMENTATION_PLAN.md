# 思考过程处理方案

> 本文档基于 OpenClaw-Nerve 实现分析，结合 ClawDeck 现有架构，提出思考过程处理的完整方案。

## 目录

1. [现状分析](#1-现状分析)
2. [核心问题](#2-核心问题)
3. [方案设计](#3-方案设计)
4. [数据结构设计](#4-数据结构设计)
5. [事件处理流程](#5-事件处理流程)
6. [UI 组件设计](#6-ui-组件设计)
7. [实现步骤](#7-实现步骤)
8. [与 Nerve 的差异](#8-与-nerve-的差异)

---

## 1. 现状分析

### 1.1 Nerve 实现分析

**优点**：
- 完整的 `ThinkingFlowState` 状态机
- WebSocket 代理层注入时间戳
- 多层 UI 组件（ProcessingIndicator、ThinkingFlowBar、TraceView）
- 实时活动日志

**不足**：
- 状态管理分散在多个 Hook 中
- 时间戳依赖代理层注入，对直连场景不友好
- UI 组件层级较深，复用性一般

### 1.2 ClawDeck 现状

**已有**：
- `OpenClawAdapter` 基础事件分类
- `ChatChunk` 支持 `chunkType` 字段
- `MessageBlocks.tsx` 基础组件

**缺失**：
- 无状态机管理思考流程
- 无时间戳追踪
- 无活动日志
- UI 组件不完整

---

## 2. 核心问题

### 2.1 问题清单

| 问题 | 影响 | 优先级 |
|------|------|--------|
| 无法区分消息类型 | 思考过程和工具调用显示为纯文本 | P0 |
| 无阶段状态追踪 | 用户不知道当前处于哪个阶段 | P0 |
| 无时间戳信息 | 无法知道各阶段耗时 | P1 |
| 无活动日志 | 工具调用过程不清晰 | P1 |
| 无超时检测 | 卡住时无反馈 | P2 |

### 2.2 根本原因

1. **事件处理不完整**：只处理了 `delta` 内容，忽略了 `thinking` 和工具事件
2. **状态管理缺失**：没有状态机来追踪整个流程
3. **时间戳未传递**：Gateway 发送的时间戳未被保留

---

## 3. 方案设计

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ClawDeck 架构                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐ │
│  │  OpenClawAdapter │───▶│ ThinkingFlowStore│───▶│   ChatPanel     │ │
│  │  (事件处理)      │    │  (状态管理)      │    │   (UI 渲染)     │ │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘ │
│          │                      │                      │            │
│          │                      │                      │            │
│          ▼                      ▼                      ▼            │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐ │
│  │  事件分类器      │    │  ActivityLog    │    │  TraceView      │ │
│  │  classifyEvent  │    │  (活动日志)      │    │  (追踪视图)      │ │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘ │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 设计原则

1. **单一数据源**：所有状态由 `ThinkingFlowStore` 管理
2. **前端计算时间戳**：不依赖代理层，在 adapter 中计算
3. **渐进式 UI**：从简单到复杂，逐步增强
4. **可测试性**：状态逻辑与 UI 分离

---

## 4. 数据结构设计

### 4.1 思考流程状态

```typescript
// 阶段定义
export type ThinkingPhase = 
  | 'idle'           // 空闲
  | 'thinking'       // 思考中（LLM 推理）
  | 'tool_calling'   // 工具调用中
  | 'responding'     // 生成回复中
  | 'completed'      // 完成
  | 'error'          // 错误

// 工具调用状态
export interface ToolCallState {
  id: string                    // toolCallId
  name: string                  // 工具名称
  status: 'running' | 'completed' | 'error'
  startedAt: number             // 开始时间戳
  completedAt?: number          // 完成时间戳
  duration?: number             // 持续时间（毫秒）
  args?: Record<string, unknown>    // 输入参数
  result?: unknown              // 输出结果
}

// 活动日志条目
export interface ActivityLogEntry {
  id: string
  toolName: string
  description: string           // 人类可读描述
  startedAt: number
  completedAt?: number
  duration?: number
  phase: 'running' | 'completed'
  input?: Record<string, unknown>
  output?: unknown
}

// 完整思考流程状态
export interface ThinkingFlowState {
  phase: ThinkingPhase
  runId: string
  sessionKey: string
  
  // 时间追踪
  startTime: number             // 流程开始时间
  thinkingStartTime?: number    // 思考开始时间
  thinkingEndTime?: number      // 思考结束时间
  thinkingDuration?: number     // 思考持续时间
  responseStartTime?: number    // 响应开始时间
  
  // 内容
  thinkingContent: string       // 累积的思考内容
  outputContent: string         // 累积的输出内容
  
  // 工具调用
  toolCalls: ToolCallState[]    // 工具调用列表
  currentToolId?: string        // 当前运行的工具 ID
  
  // 活动日志
  activityLog: ActivityLogEntry[]
  
  // 统计
  totalDuration?: number        // 总持续时间
  error?: string                // 错误信息
}
```

### 4.2 ChatChunk 扩展

```typescript
export interface ChatChunk {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  done: boolean
  timestamp: number
  
  // 扩展字段
  chunkType?: 'text' | 'thinking' | 'tool_start' | 'tool_result' | 'error'
  
  // 思考内容
  thinking?: string
  
  // 工具调用
  toolName?: string
  toolCallId?: string
  toolArgs?: Record<string, unknown>
  toolResult?: unknown
  toolStartedAt?: number
  toolDuration?: number
  
  // 时间戳
  phaseStartTime?: number
}
```

---

## 5. 事件处理流程

### 5.1 事件分类

```typescript
type StreamEventType =
  | 'lifecycle_start'    // Agent 开始
  | 'lifecycle_end'      // Agent 结束
  | 'assistant_stream'   // 助手输出流
  | 'agent_tool_start'   // 工具调用开始
  | 'agent_tool_result'  // 工具调用结果
  | 'chat_started'       // 聊天开始
  | 'chat_delta'         // 聊天增量
  | 'chat_final'         // 聊天结束
  | 'chat_error'         // 错误
  | 'chat_aborted'       // 中止
  | 'ignore'             // 忽略

interface ClassifiedEvent {
  type: StreamEventType
  source: 'agent' | 'chat'
  sessionKey?: string
  runId?: string
  agentPayload?: Record<string, unknown>
  chatPayload?: Record<string, unknown>
}
```

### 5.2 状态转换

```
┌─────────────────────────────────────────────────────────────────────┐
│                        状态转换图                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  [idle] ──lifecycle_start──▶ [thinking]                             │
│                                 │                                    │
│                                 ├── assistant(thinking) ──▶ 保持    │
│                                 │                                    │
│                                 ├── tool_start ──▶ [tool_calling]   │
│                                 │                        │          │
│                                 │                        │          │
│                                 │   ◀── tool_result ─────┘          │
│                                 │        │                          │
│                                 │        └──▶ [thinking] 或         │
│                                 │            [responding]           │
│                                 │                                    │
│                                 ├── assistant(delta) ──▶ [responding]│
│                                 │                                    │
│                                 └── lifecycle_end ──▶ [completed]   │
│                                                                      │
│  任意状态 ──error──▶ [error]                                        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.3 Adapter 层处理

```typescript
// 在 OpenClawAdapter.chat() 中
const messageHandler = (data: unknown) => {
  const msg = data as Record<string, unknown>
  if (msg.type !== 'event') return

  const classified = classifyStreamEvent(msg)
  if (!classified || classified.sessionKey !== sessionKey) return

  const now = Date.now()

  switch (classified.type) {
    case 'lifecycle_start':
      responseQueue.push({
        content: '',
        done: false,
        chunkType: 'text',
        phaseStartTime: now,
      })
      break

    case 'assistant_stream':
      const data = classified.agentPayload?.data as Record<string, unknown> | undefined
      if (data) {
        // 思考内容
        if (data.thinking) {
          responseQueue.push({
            content: '',
            done: false,
            chunkType: 'thinking',
            thinking: data.thinking as string,
            phaseStartTime: now,
          })
        }
        // 输出内容
        if (data.delta) {
          responseQueue.push({
            content: data.delta as string,
            done: false,
            chunkType: 'text',
            phaseStartTime: now,
          })
        }
      }
      break

    case 'agent_tool_start':
      const toolData = classified.agentPayload?.data as Record<string, unknown> | undefined
      if (toolData) {
        responseQueue.push({
          content: '',
          done: false,
          chunkType: 'tool_start',
          toolName: toolData.name as string,
          toolCallId: toolData.toolCallId as string,
          toolArgs: toolData.arguments as Record<string, unknown>,
          toolStartedAt: now,
        })
      }
      break

    case 'agent_tool_result':
      const resultData = classified.agentPayload?.data as Record<string, unknown> | undefined
      if (resultData) {
        responseQueue.push({
          content: '',
          done: false,
          chunkType: 'tool_result',
          toolCallId: resultData.toolCallId as string,
          toolResult: resultData.result,
          toolDuration: now,  // 前端计算持续时间
        })
      }
      break

    case 'lifecycle_end':
      isComplete = true
      break
  }
}
```

---

## 6. UI 组件设计

### 6.1 组件层级

```
ChatPanel.tsx
├── ProcessingIndicator.tsx      // 实时状态指示器（P0）
│   ├── PhaseIcon                // 阶段图标
│   ├── ElapsedTime              // 已用时间
│   └── CurrentTool              // 当前工具
│
├── MessageList.tsx
│   ├── MessageBubble.tsx        // 消息气泡
│   ├── ThinkingBubble.tsx       // 思考气泡（P0）
│   │   └── TraceView.tsx        // 追踪视图（P1）
│   └── ToolCallBlock.tsx        // 工具调用块（P0）
│
└── ActivityLog.tsx              // 活动日志（P1）
```

### 6.2 ProcessingIndicator

```tsx
interface ProcessingIndicatorProps {
  phase: ThinkingPhase
  elapsedMs: number
  currentTool?: { name: string; startedAt: number }
  activityLog: ActivityLogEntry[]
}

function ProcessingIndicator({ phase, elapsedMs, currentTool, activityLog }: Props) {
  return (
    <div className="processing-indicator">
      {/* 阶段状态 */}
      <div className="phase-row">
        <PhaseIcon phase={phase} />
        <span className="phase-label">{getPhaseLabel(phase)}</span>
        <span className="elapsed">{formatDuration(elapsedMs)}</span>
      </div>
      
      {/* 当前工具 */}
      {currentTool && (
        <div className="current-tool">
          <WrenchIcon />
          <span>{currentTool.name}</span>
          <Spinner />
        </div>
      )}
      
      {/* 活动日志 */}
      {activityLog.length > 0 && (
        <ActivityLog entries={activityLog.slice(-4)} />
      )}
    </div>
  )
}
```

### 6.3 ThinkingBubble

```tsx
interface ThinkingBubbleProps {
  thinkingContent: string
  activityLog: ActivityLogEntry[]
  thinkingDuration?: number
  isCollapsed: boolean
  onToggle: () => void
}

function ThinkingBubble({ thinkingContent, activityLog, thinkingDuration, isCollapsed, onToggle }: Props) {
  return (
    <div className="thinking-bubble">
      {/* 折叠头部 */}
      <div className="thinking-header" onClick={onToggle}>
        <ChevronRight className={isCollapsed ? '' : 'rotate-90'} />
        <span>💭 Thinking</span>
        {thinkingDuration && (
          <span className="duration">{formatDuration(thinkingDuration)}</span>
        )}
        {isCollapsed && (
          <span className="tool-count">{activityLog.length} tool calls</span>
        )}
      </div>
      
      {/* 展开内容 */}
      {!isCollapsed && (
        <div className="thinking-content">
          {/* 追踪视图 */}
          <TraceView 
            entries={activityLog}
            thinkingDuration={thinkingDuration}
            thinkingText={thinkingContent}
          />
          
          {/* 思考文本 */}
          {thinkingContent && (
            <div className="thinking-text">
              <MarkdownRenderer content={thinkingContent} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

### 6.4 TraceView

```tsx
interface TraceSection {
  id: string
  type: 'thinking' | 'tool_call' | 'response'
  name: string
  startTime: number
  endTime?: number
  duration: number
  status: 'running' | 'completed' | 'error'
  input?: Record<string, unknown>
  output?: unknown
}

function TraceView({ entries, thinkingDuration, thinkingText }: Props) {
  const sections = buildTraceSections(entries, thinkingDuration, thinkingText)
  
  return (
    <div className="trace-view">
      <div className="trace-header">
        <span>Trace</span>
        <span>{sections.length} sections</span>
      </div>
      
      {sections.map(section => (
        <div key={section.id} className="trace-section">
          <div className="section-header">
            <SectionIcon type={section.type} />
            <span className="name">{section.name}</span>
            <span className="duration">{formatDuration(section.duration)}</span>
            <StatusIcon status={section.status} />
          </div>
          
          {/* 展开详情 */}
          {section.input && (
            <div className="section-input">
              <pre>{JSON.stringify(section.input, null, 2)}</pre>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
```

---

## 7. 实现步骤

### 7.1 阶段规划

| 阶段 | 内容 | 优先级 |
|------|------|--------|
| **P0** | 基础状态追踪 + 简单 UI | 必须 |
| **P1** | 活动日志 + TraceView | 重要 |
| **P2** | 超时检测 + 性能优化 | 可选 |

### 7.2 P0 实现清单

1. **数据结构**
   - [ ] 定义 `ThinkingFlowState` 类型
   - [ ] 扩展 `ChatChunk` 类型

2. **Adapter 层**
   - [ ] 完善事件分类器
   - [ ] 添加时间戳字段
   - [ ] 处理 thinking 内容

3. **状态管理**
   - [ ] 创建 `useThinkingFlow` hook
   - [ ] 实现状态转换逻辑

4. **UI 组件**
   - [ ] 实现 `ProcessingIndicator`
   - [ ] 实现 `ThinkingBubble`
   - [ ] 实现 `ToolCallBlock`

### 7.3 P1 实现清单

1. **活动日志**
   - [ ] 实现 `ActivityLog` 组件
   - [ ] 添加工具描述生成

2. **TraceView**
   - [ ] 实现 `TraceView` 组件
   - [ ] 添加时间线可视化

3. **消息处理**
   - [ ] 合并思考内容到消息
   - [ ] 保存活动日志到消息

---

## 8. 与 Nerve 的差异

### 8.1 架构对比

```
┌─────────────────────────────────────────────────────────────────────┐
│                          架构对比                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  【Nerve 架构】                                                      │
│  Browser ──→ Nerve Server ──→ OpenClaw Gateway                      │
│                 │                                                    │
│                 ├── ws-proxy.ts (注入时间戳)                         │
│                 └── 前端 Hook 处理事件                               │
│                                                                      │
│  【ClawDeck 架构】                                                   │
│  Browser ──→ ClawDeck Server ──→ OpenClaw Gateway                   │
│                 │                                                    │
│                 ├── OpenClawAdapter (处理事件)                       │
│                 ├── WsGateway (转发事件)                             │
│                 └── 前端 Hook 处理事件                               │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 8.2 关键差异

| 方面 | Nerve | ClawDeck |
|------|-------|----------|
| 时间戳注入 | ws-proxy.ts 代理层注入 | Adapter 层计算 |
| WebSocket 转发 | 代理模式 | WsGateway 转发 |
| 状态管理 | 多个 Hook 组合 | 单一 Hook（推荐） |
| UI 组件 | 4 层嵌套 | 3 层扁平（推荐） |

### 8.3 时间戳处理方案

**Nerve 方案**：在 ws-proxy.ts 中拦截事件并注入时间戳

```typescript
// Nerve: ws-proxy.ts
if (toolData?.phase === 'start' && toolCallId) {
  toolCallTimings.set(toolCallId, Date.now())
  toolData.startedAt = Date.now()  // 注入到事件中
}
```

**ClawDeck 方案**：在 OpenClawAdapter 中计算时间戳

```typescript
// ClawDeck: OpenClawAdapter.chat()
case 'agent_tool_start':
  responseQueue.push({
    chunkType: 'tool_start',
    toolName: data.name,
    toolCallId: data.toolCallId,
    toolStartedAt: Date.now(),  // 在 Adapter 层计算
  })
  break

case 'agent_tool_result':
  // 计算持续时间
  const startTime = toolTimings.get(data.toolCallId)
  const duration = startTime ? Date.now() - startTime : 0
  responseQueue.push({
    chunkType: 'tool_result',
    toolCallId: data.toolCallId,
    toolDuration: duration,
  })
  break
```

### 8.4 简化决策

1. **合并状态 Hook**
   - 原因：Nerve 的多 Hook 设计增加复杂度
   - 方案：单一 `useThinkingFlow` hook

2. **简化 UI 层级**
   - 原因：Nerve 的 ThinkingFlowBar 功能与 TraceView 重叠
   - 方案：合并为 TraceView

3. **消息持久化**
   - 思考内容和活动日志保存到消息中
   - 历史消息也能展示完整流程

### 8.5 可选增强：WebSocket 代理层

如果需要更精确的时间戳，可以在 ClawDeck 的 WsGateway 中添加类似 Nerve 的代理层：

```typescript
// server/ws/gateway.ts 增强
class WsGateway {
  private toolTimings = new Map<string, number>()
  
  private injectTimestamps(msg: unknown): unknown {
    // 类似 Nerve 的 ws-proxy.ts
    // 注入 startedAt, durationMs 等时间戳
  }
}
```

但这不是必须的，Adapter 层计算已经足够

---

## 附录

### A. 阶段标签映射

```typescript
const PHASE_LABELS: Record<ThinkingPhase, string> = {
  idle: '空闲',
  thinking: '思考中',
  tool_calling: '工具调用',
  responding: '生成回复',
  completed: '完成',
  error: '错误',
}

const PHASE_ICONS: Record<ThinkingPhase, string> = {
  idle: '○',
  thinking: '🧠',
  tool_calling: '🔧',
  responding: '📝',
  completed: '✓',
  error: '✗',
}
```

### B. 工具描述生成

```typescript
function describeToolUse(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'read':
    case 'read_file':
      return `Reading ${args.path || args.file_path || 'file'}`
    case 'write':
    case 'write_file':
      return `Writing ${args.path || args.file_path || 'file'}`
    case 'exec':
      return `Running: ${args.command || 'command'}`
    case 'web_search':
      return `Searching: ${args.query || 'web'}`
    case 'web_fetch':
      return `Fetching: ${args.url || 'url'}`
    default:
      return `Using ${name}`
  }
}
```

### C. 时间格式化

```typescript
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const mins = Math.floor(ms / 60000)
  const secs = ((ms % 60000) / 1000).toFixed(0)
  return `${mins}m ${secs}s`
}
```
