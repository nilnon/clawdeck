# openclaw-thinking 插件设计方案

> 版本: 2026.4.1
> 状态: 设计中
> 目标: 替换 openclaw-observability，提供实时阶段追踪 + 完整可观测性能力

---

## 一、背景与问题

### 1.1 WebSocket 事件盲区

当前 OpenClaw Gateway 通过 WebSocket 广播 Agent 事件，但存在明显的**盲区**：

```
用户发送消息 → chat_started → [盲区 10-30秒] → lifecycle.start → ...
                              ↑
                              无任何事件反馈，用户焦虑
```

**盲区阶段分析**：

| 阶段 | 耗时 | 客户端可见 | 说明 |
|------|------|-----------|------|
| 模型解析 (Model Resolve) | 1-3s | ❌ | 根据配置/规则选择合适的模型 |
| Prompt 构建 (Prompt Build) | 2-5s | ❌ | 组装系统提示、历史消息、工具定义 |
| LLM 连接建立 (LLM Connect) | 5-20s | ❌ | 建立 SSE 流式连接，首次请求延迟 |

### 1.2 openclaw-observability 的局限

当前 `openclaw-observability` 插件存在以下问题：

| 问题 | 说明 |
|------|------|
| **数据不流向客户端** | 所有 Hook 数据仅存储到数据库，客户端无法获取实时阶段 |
| **盲区无法填补** | 客户端只能依赖 WebSocket 事件，无法感知 Hook 阶段 |
| **功能耦合** | 实时追踪、历史审计、安全扫描混在一起 |
| **存储开销** | DuckDB/MySQL 存储对于实时场景过重 |

### 1.3 设计目标

**openclaw-thinking** 将成为下一代可观测性插件，核心目标：

1. **实时阶段追踪** - 填补 WebSocket 事件盲区
2. **客户端可见** - 阶段状态实时推送给客户端
3. **完整可观测性** - 保留 openclaw-observability 的审计能力
4. **模块化架构** - 实时追踪、历史存储、安全扫描可独立配置
5. **高性能** - 内存优先，异步持久化

---

## 二、核心架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        openclaw-thinking 插件架构                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        OpenClaw Gateway                              │    │
│  │                                                                      │    │
│  │   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐         │    │
│  │   │ Plugin Hooks │    │ Agent Events │    │ Fetch Inter. │         │    │
│  │   │ (26 hooks)   │    │ (WebSocket)  │    │ (Token统计)  │         │    │
│  │   └──────┬───────┘    └──────┬───────┘    └──────┬───────┘         │    │
│  │          │                   │                   │                  │    │
│  └──────────┼───────────────────┼───────────────────┼──────────────────┘    │
│             │                   │                   │                        │
│             ▼                   ▼                   ▼                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                      openclaw-thinking Core                         │    │
│  │                                                                      │    │
│  │   ┌─────────────────────────────────────────────────────────────┐   │    │
│  │   │                    Phase State Manager                       │   │    │
│  │   │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │   │    │
│  │   │  │ Phase Store │  │ Transition  │  │ Timeout     │         │   │    │
│  │   │  │ (内存Map)   │  │ Logic       │  │ Detector    │         │   │    │
│  │   │  └─────────────┘  └─────────────┘  └─────────────┘         │   │    │
│  │   └─────────────────────────────────────────────────────────────┘   │    │
│  │                                                                      │    │
│  │   ┌───────────────────┐  ┌───────────────────┐  ┌───────────────┐   │    │
│  │   │ Realtime Channel  │  │ Storage Module    │  │ Security Scan │   │    │
│  │   │                   │  │                   │  │               │   │    │
│  │   │ • Gateway Method  │  │ • Async Buffer    │  │ • L1 Rules    │   │    │
│  │   │ • SSE Endpoint    │  │ • DuckDB/MySQL    │  │ • L2 Chains   │   │    │
│  │   │ • WebSocket Broad │  │ • Retention       │  │ • Alerts      │   │    │
│  │   └─────────┬─────────┘  └─────────┬─────────┘  └───────┬───────┘   │    │
│  │             │                      │                    │           │    │
│  └─────────────┼──────────────────────┼────────────────────┼───────────┘    │
│                │                      │                    │                 │
│                ▼                      ▼                    ▼                 │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌───────────────────┐    │
│  │     Client SDK      │  │   Persistence DB    │  │   Alert Storage   │    │
│  │                     │  │                     │  │                   │    │
│  │ • ClawDeck          │  │ • DuckDB (local)    │  │ • audit_alerts    │    │
│  │ • OpenClaw-Nerve    │  │ • MySQL (remote)    │  │ • Web Dashboard   │    │
│  │ • Custom Clients    │  │ • audit_sessions    │  │                   │    │
│  └─────────────────────┘  │ • audit_actions     │  └───────────────────┘    │
│                           └─────────────────────┘                            │
│                                                                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 模块划分

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           模块划分与职责                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐       │
│  │  Core Module    │     │  Storage Module │     │ Security Module │       │
│  │  (核心模块)     │     │  (存储模块)     │     │  (安全模块)     │       │
│  ├─────────────────┤     ├─────────────────┤     ├─────────────────┤       │
│  │ • Phase Manager │     │ • Buffer        │     │ • Scanner       │       │
│  │ • Hook Handlers │     │ • DuckDB Writer │     │ • Rules Engine  │       │
│  │ • Event Router  │     │ • MySQL Writer  │     │ • Chain Detector│       │
│  │ • Timeout Detect│     │ • Retention     │     │ • Alert Manager │       │
│  └────────┬────────┘     └────────┬────────┘     └────────┬────────┘       │
│           │                       │                       │                 │
│           │                       │                       │                 │
│           ▼                       ▼                       ▼                 │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐       │
│  │ Broadcast Module│     │   Web Module    │     │  Gateway Module │       │
│  │  (广播模块)     │     │  (Web模块)      │     │  (网关模块)     │       │
│  ├─────────────────┤     ├─────────────────┤     ├─────────────────┤       │
│  │ • Gateway Method│     │ • Routes        │     │ • RPC Methods   │       │
│  │ • SSE Endpoint  │     │ • API Handlers  │     │ • Method Router │       │
│  │ • WS Broadcaster│     │ • Dashboard UI  │     │ • Auth Handler  │       │
│  └─────────────────┘     └─────────────────┘     └─────────────────┘       │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        Configuration Layer                           │   │
│  │  • Module Enable/Disable  • Storage Mode  • Security Rules          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 三、核心数据模型

### 3.1 阶段定义 (ThinkingPhase)

```typescript
/**
 * 思考阶段枚举
 * 覆盖从用户发消息到完成响应的完整生命周期
 */
export type ThinkingPhase = 
  // === 盲区阶段 (WebSocket 不可见) ===
  | 'idle'              // 空闲，无活动会话
  | 'model_resolving'   // 模型解析中 - before_model_resolve
  | 'prompt_building'   // 提示词构建中 - before_prompt_build
  | 'llm_connecting'    // LLM 连接建立中 - llm_input
  | 'llm_first_token'   // 等待首个 Token - llm_input 后
  
  // === 可见阶段 (WebSocket 可见) ===
  | 'thinking'          // 思考中 - assistant (thinking)
  | 'generating'        // 生成回复中 - assistant (delta)
  | 'tool_calling'      // 工具调用中 - tool.start
  | 'tool_executing'    // 工具执行中 - tool 执行过程
  | 'tool_complete'     // 工具完成 - tool.result
  
  // === 终态 ===
  | 'completed'         // 完成 - lifecycle.end
  | 'error'             // 错误 - 错误事件
  | 'cancelled'         // 取消 - 用户中断

/**
 * 阶段分类
 */
export const PHASE_CATEGORIES = {
  blind_spot: ['model_resolving', 'prompt_building', 'llm_connecting', 'llm_first_token'],
  visible: ['thinking', 'generating', 'tool_calling', 'tool_executing', 'tool_complete'],
  terminal: ['completed', 'error', 'cancelled'],
  idle: ['idle'],
} as const
```

### 3.2 阶段状态 (PhaseState)

```typescript
/**
 * 单个会话的阶段状态
 */
export interface PhaseState {
  // === 标识 ===
  sessionId: string
  runId: string
  userId?: string
  
  // === 当前阶段 ===
  phase: ThinkingPhase
  phaseStartTime: number
  phaseElapsedTime: number  // 计算值，毫秒
  
  // === 阶段历史 ===
  previousPhase?: ThinkingPhase
  phaseHistory: PhaseTransition[]
  
  // === 元数据 ===
  metadata: PhaseMetadata
  
  // === 超时状态 ===
  timeoutStatus?: {
    isTimeout: boolean
    threshold: number
    elapsed: number
  }
}

/**
 * 阶段转换记录
 */
export interface PhaseTransition {
  from: ThinkingPhase
  to: ThinkingPhase
  timestamp: number
  duration: number  // 在 from 阶段停留的时间
  trigger: 'hook' | 'agent_event' | 'timeout' | 'user_action'
  metadata?: Record<string, unknown>
}

/**
 * 阶段元数据
 */
export interface PhaseMetadata {
  // 模型信息
  modelName?: string
  modelProvider?: string
  
  // 工具信息
  currentTool?: {
    name: string
    callId: string
    args?: Record<string, unknown>
    startTime: number
  }
  completedTools: Array<{
    name: string
    callId: string
    duration: number
    success: boolean
  }>
  
  // Token 统计
  tokens?: {
    prompt: number
    completion: number
    cacheRead?: number
    cacheWrite?: number
  }
  
  // 错误信息
  error?: {
    message: string
    code?: string
    stack?: string
  }
  
  // 性能指标
  timing?: {
    modelResolveTime?: number
    promptBuildTime?: number
    llmConnectTime?: number
    firstTokenTime?: number
    totalDuration?: number
  }
}
```

---

## 四、Hook 与阶段映射

### 4.1 完整 Hook 映射表

| Hook | Phase | 说明 |
|------|-------|------|
| `before_model_resolve` | `model_resolving` | 模型解析开始 |
| `before_prompt_build` | `prompt_building` | 提示词构建开始 |
| `before_agent_start` | `llm_connecting` | Agent 启动 |
| `llm_input` | `llm_connecting` | LLM 输入 |
| `llm_output` | `thinking` | LLM 开始输出 |
| `before_tool_call` | `tool_calling` | 工具调用开始 |
| `after_tool_call` | `tool_executing` | 工具调用完成 |
| `tool_result_persist` | `tool_complete` | 工具结果持久化 |
| `agent_end` | `completed` | Agent 结束 |
| `session_end` | `completed` | 会话结束 |

---

## 五、API 设计

### 5.1 Gateway RPC 方法

| 方法 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `getThinkingPhase` | `{ sessionId }` | `PhaseState` | 获取当前阶段状态 |
| `getActiveThinkingSessions` | - | `PhaseState[]` | 获取所有活动会话 |

### 5.2 HTTP API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/plugins/thinking/api/phase` | GET | 获取当前阶段 |
| `/plugins/thinking/api/phase/stream` | GET | SSE 实时推送 |

### 5.3 SSE 事件格式

```
event: phase_change
data: {"sessionId":"xxx","phase":"thinking","phaseStartTime":1234567890,...}

event: heartbeat
data: {"ts":1234567890}
```

---

## 六、实现状态

### 已完成 (Phase 1 MVP)

- [x] 类型定义 (`types.ts`)
- [x] 配置 Schema (`config.ts`)
- [x] Phase State Manager (`core/phase-manager.ts`)
- [x] Hook Handlers (`hooks/phase-hooks.ts`)
- [x] Broadcast Module (`broadcast/broadcast.ts`)
- [x] 插件入口 (`index.ts`)
- [x] 插件清单 (`openclaw.plugin.json`)

### 待实现 (Phase 2-5)

- [ ] Storage Module (DuckDB/MySQL)
- [ ] Security Module (L1/L2 规则)
- [ ] Web Dashboard

---

*文档版本: 2026.4.1*
*最后更新: 2026-04-12*
