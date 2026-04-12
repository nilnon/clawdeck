# OpenClaw Gateway 源码解读

> 本文档深入解析 OpenClaw Gateway 的架构设计与核心实现。

## 目录

1. [概述](#1-概述)
2. [架构设计](#2-架构设计)
3. [连接与认证](#3-连接与认证)
4. [协议层](#4-协议层)
5. [RPC 方法处理](#5-rpc-方法处理)
6. [事件系统](#6-事件系统)
7. [会话管理](#7-会话管理)
8. [聊天系统](#8-聊天系统)
9. [Agent 系统](#9-agent-系统)
10. [工具系统](#10-工具系统)
11. [插件系统](#11-插件系统)
12. [安全机制](#12-安全机制)

---

## 1. 概述

### 1.1 什么是 OpenClaw Gateway

OpenClaw Gateway 是 OpenClaw 的核心通信枢纽，提供：

- **WebSocket RPC 服务** - 实时双向通信
- **会话管理** - 多 Agent、多会话支持
- **事件广播** - 实时消息、状态推送
- **认证授权** - Token、Password、设备身份认证
- **插件扩展** - Channel、Skill、Hook 等扩展机制

### 1.2 核心源码目录

```
src/gateway/
├── server.impl.ts          # Gateway 服务器主入口
├── client.ts               # Gateway 客户端实现
├── call.ts                 # RPC 调用封装
├── auth.ts                 # 认证逻辑
├── boot.ts                 # 启动引导
├── protocol/               # 协议定义
│   ├── index.ts            # 协议入口
│   └── schema.ts           # JSON Schema 定义
├── server-methods/         # RPC 方法实现
│   ├── sessions.ts         # 会话方法
│   ├── chat.ts             # 聊天方法
│   ├── agents.ts           # Agent 方法
│   └── ...
├── server-chat.ts          # 聊天事件处理
├── server-runtime-state.ts # 运行时状态
└── ...                     # 其他模块
```

---

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                        OpenClaw Gateway                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │  WebSocket   │    │    HTTP      │    │   Control    │          │
│  │   Server     │    │   Server     │    │     UI       │          │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘          │
│         │                   │                   │                  │
│         ▼                   ▼                   ▼                  │
│  ┌─────────────────────────────────────────────────────────┐       │
│  │                    Protocol Layer                         │       │
│  │  - Request/Response Frame                                │       │
│  │  - Event Frame                                           │       │
│  │  - Validation (AJV)                                      │       │
│  └─────────────────────────────────────────────────────────┘       │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────┐       │
│  │                    Auth Layer                            │       │
│  │  - Token Auth                                            │       │
│  │  - Password Auth                                         │       │
│  │  - Device Identity (Ed25519)                             │       │
│  │  - Tailscale Auth                                        │       │
│  └─────────────────────────────────────────────────────────┘       │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────┐       │
│  │                    Method Handlers                       │       │
│  │  - sessions.*  - chat.*      - agents.*                  │       │
│  │  - models.*    - tools.*     - config.*                  │       │
│  │  - health.*    - cron.*      - ...                       │       │
│  └─────────────────────────────────────────────────────────┘       │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────┐       │
│  │                    Event System                          │       │
│  │  - agent events (lifecycle, assistant, tool)             │       │
│  │  - chat events (started, delta, final, error)            │       │
│  │  - system events (health, presence, tick)                │       │
│  └─────────────────────────────────────────────────────────┘       │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 核心组件

| 组件 | 源码文件 | 职责 |
|------|----------|------|
| GatewayServer | `server.impl.ts` | 服务器启动、生命周期管理 |
| GatewayClient | `client.ts` | 客户端连接、RPC 调用 |
| Protocol | `protocol/` | 消息格式定义、验证 |
| Auth | `auth.ts` | 认证授权 |
| MethodHandlers | `server-methods/` | RPC 方法实现 |
| EventSystem | `server-chat.ts` | 事件分发、订阅 |

---

## 3. 连接与认证

### 3.1 连接生命周期

**源码**: `src/gateway/client.ts`

```typescript
// 连接状态机
disconnected → connecting → connected → handshaked → [event loop]
```

**连接流程**:

```typescript
// 1. WebSocket 连接
ws = new WebSocket(url, wsOptions)

// 2. 等待 connect.challenge 事件
ws.on('message', (data) => {
  const parsed = JSON.parse(data)
  if (validateEventFrame(parsed) && parsed.event === 'connect.challenge') {
    this.connectNonce = parsed.payload.nonce
    this.sendConnect()
  }
})

// 3. 发送 connect 请求（带设备身份签名）
const device = buildDeviceAuthPayloadV3({
  deviceId: this.opts.deviceIdentity.deviceId,
  clientId: this.opts.clientName,
  clientMode: this.opts.mode,
  role,
  scopes,
  signedAtMs,
  token: signatureToken,
  nonce,
})
const signature = signDevicePayload(privateKeyPem, payload)

// 4. 等待 hello-ok 响应
await client.request<HelloOk>("connect", params)
```

### 3.2 设备身份认证

**源码**: `src/infra/device-identity.ts`

```typescript
// 设备身份结构
type DeviceIdentity = {
  deviceId: string           // 设备唯一 ID
  publicKeyPem: string       // PEM 格式公钥
  privateKeyPem: string      // PEM 格式私钥
  createdAt: number          // 创建时间
}

// 签名流程
function signDevicePayload(privateKeyPem: string, payload: object): string {
  const payloadJson = JSON.stringify(payload)
  const payloadBase64 = Buffer.from(payloadJson).toString('base64url')
  const signature = crypto.sign('sha256', Buffer.from(payloadBase64), {
    key: privateKeyPem,
    type: 'pkcs8',
    format: 'pem',
  })
  return signature.toString('base64url')
}
```

### 3.3 认证模式

**源码**: `src/gateway/auth.ts`

```typescript
type ResolvedGatewayAuthMode = 
  | 'none'           // 无认证（仅本地回环）
  | 'token'          // Token 认证
  | 'password'       // 密码认证
  | 'trusted-proxy'  // 信任代理（Tailscale）

type GatewayAuthResult = {
  ok: boolean
  method?: 'none' | 'token' | 'password' | 'tailscale' | 'device-token' | 'bootstrap-token'
  user?: string
  reason?: string
  rateLimited?: boolean
  retryAfterMs?: number
}
```

### 3.4 Scope 权限控制

**源码**: `src/gateway/method-scopes.ts`

```typescript
// Operator Scopes
type OperatorScope = 
  | 'operator.admin'    // 完全访问
  | 'operator.read'     // 只读访问
  | 'operator.write'    // 写入权限

// 方法权限检查
function authorizeOperatorScopesForMethod(method: string, scopes: string[]) {
  const required = getRequiredScopeForMethod(method)
  if (!scopes.includes(required)) {
    return { allowed: false, missingScope: required }
  }
  return { allowed: true }
}
```

---

## 4. 协议层

### 4.1 消息帧格式

**源码**: `src/gateway/protocol/schema.ts`

#### 请求帧 (RequestFrame)

```typescript
type RequestFrame = {
  type: 'req'
  id: string           // UUID，用于匹配响应
  method: string       // 方法名，如 'sessions.list'
  params?: object      // 方法参数
}
```

#### 响应帧 (ResponseFrame)

```typescript
type ResponseFrame = {
  type: 'res'
  id: string           // 对应请求 ID
  ok: boolean          // 是否成功
  payload?: object     // 响应数据
  error?: {
    code: string
    message: string
    details?: unknown
  }
}
```

#### 事件帧 (EventFrame)

```typescript
type EventFrame = {
  type: 'event'
  event: string        // 事件名，如 'chat', 'agent'
  payload: object      // 事件数据
  seq?: number         // 序列号（用于检测丢包）
}
```

### 4.2 协议验证

**源码**: `src/gateway/protocol/index.ts`

```typescript
import Ajv from 'ajv'

const ajv = new Ajv({ allErrors: true, strict: false })

// 编译验证器
export const validateRequestFrame = ajv.compile<RequestFrame>(RequestFrameSchema)
export const validateResponseFrame = ajv.compile<ResponseFrame>(ResponseFrameSchema)
export const validateEventFrame = ajv.compile<EventFrame>(EventFrameSchema)

// 错误格式化
export function formatValidationErrors(errors: ErrorObject[]) {
  // 将 AJV 错误转换为用户友好的消息
  // 例如: "at root: unexpected property 'title'"
}
```

### 4.3 HelloOk 响应

```typescript
type HelloOk = {
  type: 'hello-ok'
  protocol: number           // 协议版本
  server: {
    version: string          // 服务器版本
    connId: string           // 连接 ID
  }
  features: {
    methods: string[]        // 支持的方法列表
    events: string[]         // 支持的事件列表
  }
  snapshot: {
    presence: PresenceEntry[]  // 在线节点
    health: HealthSnapshot     // 健康状态
  }
  policy: {
    maxPayload: number       // 最大消息大小
    tickIntervalMs: number   // 心跳间隔
  }
}
```

---

## 5. RPC 方法处理

### 5.1 方法注册

**源码**: `src/gateway/server-methods.ts`

```typescript
export const coreGatewayHandlers: GatewayRequestHandlers = {
  ...connectHandlers,      // connect
  ...sessionsHandlers,     // sessions.*
  ...chatHandlers,         // chat.*
  ...agentsHandlers,       // agents.*
  ...modelsHandlers,       // models.*
  ...toolsCatalogHandlers, // tools.*
  ...configHandlers,       // config.*
  ...healthHandlers,       // health
  ...cronHandlers,         // cron.*
  ...ttsHandlers,          // tts.*
  ...skillsHandlers,       // skills.*
  ...nodeHandlers,         // node.*
  ...deviceHandlers,       // device.*
  ...execApprovalsHandlers, // exec.approval.*
  ...wizardHandlers,       // wizard.*
  ...usageHandlers,        // usage.*
  ...logsHandlers,         // logs.*
}
```

### 5.2 请求处理流程

```typescript
export async function handleGatewayRequest(
  method: string,
  params: unknown,
  options: GatewayRequestOptions
): Promise<unknown> {
  // 1. 权限检查
  const authError = authorizeGatewayMethod(method, options.client)
  if (authError) {
    return authError
  }

  // 2. 查找处理器
  const handler = coreGatewayHandlers[method]
  if (!handler) {
    return errorShape(ErrorCodes.METHOD_NOT_FOUND, `unknown method: ${method}`)
  }

  // 3. 参数验证
  const validationError = validateParams(method, params)
  if (validationError) {
    return validationError
  }

  // 4. 执行处理器
  return handler(params, options)
}
```

### 5.3 方法分类

| 分类 | 方法 | 说明 |
|------|------|------|
| **会话** | `sessions.list/create/delete/patch/reset/compact` | 会话生命周期管理 |
| **聊天** | `chat.send/history/abort` | 消息发送与历史 |
| **Agent** | `agents.list/create/update/delete` | Agent 管理 |
| **模型** | `models.list` | 模型目录 |
| **工具** | `tools.catalog/effective` | 工具目录 |
| **配置** | `config.get/set/apply/patch/schema` | 配置管理 |
| **健康** | `health/status` | 系统状态 |
| **定时** | `cron.list/add/update/remove/run` | 定时任务 |
| **语音** | `tts.status/convert/enable/disable` | TTS 服务 |
| **技能** | `skills.status/search/install/update` | 技能管理 |
| **节点** | `node.list/describe/invoke/pair.*` | 节点管理 |
| **设备** | `device.pair.*/token.rotate/revoke` | 设备配对 |
| **审批** | `exec.approval.*/plugin.approval.*` | 审批流程 |
| **向导** | `wizard.start/next/cancel/status` | 设置向导 |

---

## 6. 事件系统

### 6.1 事件类型

**源码**: `src/gateway/server-chat.ts`

```typescript
// Agent 事件
type AgentEventPayload = {
  stream: 'lifecycle' | 'assistant' | 'tool'
  sessionKey: string
  runId: string
  seq?: number
  data: {
    phase?: 'start' | 'end' | 'error'    // lifecycle
    text?: string                         // assistant (累积)
    delta?: string                        // assistant (增量)
    name?: string                         // tool
    toolCallId?: string                   // tool
    arguments?: object                    // tool
    result?: unknown                      // tool result
  }
}

// Chat 事件
type ChatEventPayload = {
  state: 'started' | 'delta' | 'final' | 'aborted' | 'error'
  sessionKey: string
  runId: string
  seq?: number
  message: {
    role: 'assistant'
    content: Array<{ type: 'text', text: string }>
  }
}
```

### 6.2 事件处理

```typescript
// 源码: src/gateway/server-chat.ts
export function createAgentEventHandler(options: {
  onEvent: (event: EventFrame) => void
  runRegistry: ChatRunRegistry
}) {
  return (payload: AgentEventPayload) => {
    const { stream, data, sessionKey, runId } = payload
    
    switch (stream) {
      case 'lifecycle':
        if (data.phase === 'start') {
          // 开始新的生成
        } else if (data.phase === 'end') {
          // 生成结束
        }
        break
        
      case 'assistant':
        // 助手消息流
        // data.text = 累积内容
        // data.delta = 增量内容
        options.onEvent({
          type: 'event',
          event: 'agent',
          payload,
          seq: payload.seq
        })
        break
        
      case 'tool':
        // 工具调用
        break
    }
  }
}
```

### 6.3 事件订阅

```typescript
// 会话消息订阅
type SessionsMessagesSubscribeParams = {
  sessionKey: string
}

// 会话变更订阅
type SessionsSubscribeParams = {
  sessionKeys?: string[]
}

// 订阅注册表
export function createSessionMessageSubscriberRegistry() {
  const subscribers = new Map<string, Set<string>>() // sessionKey -> clientIds
  
  return {
    subscribe(sessionKey: string, clientId: string) {
      if (!subscribers.has(sessionKey)) {
        subscribers.set(sessionKey, new Set())
      }
      subscribers.get(sessionKey)!.add(clientId)
    },
    unsubscribe(sessionKey: string, clientId: string) {
      subscribers.get(sessionKey)?.delete(clientId)
    },
    broadcast(sessionKey: string, event: EventFrame) {
      // 向所有订阅者发送事件
    }
  }
}
```

### 6.4 系统事件

| 事件 | 说明 | 触发时机 |
|------|------|----------|
| `tick` | 心跳 | 每 30 秒 |
| `health` | 健康状态 | 状态变化时 |
| `presence` | 节点状态 | 节点上线/下线 |
| `shutdown` | 关机通知 | 服务器关闭前 |
| `update.available` | 更新可用 | 检测到新版本 |

---

## 7. 会话管理

### 7.1 会话结构

**源码**: `src/config/sessions/types.ts`

```typescript
type SessionEntry = {
  key: string           // sessionKey
  label?: string        // 显示名称
  model?: string        // 模型 ID
  thinking?: 'light' | 'medium' | 'heavy'
  systemPrompt?: string
  createdAt: number
  updatedAt: number
  messageCount: number
  parentSessionKey?: string  // 父会话（用于子会话）
}
```

### 7.2 会话 Key 格式

```
agent:{agentId}:{sessionType}:{sessionId}

示例:
- agent:main:main                    # main 会话
- agent:main:dashboard:uuid          # dashboard 会话
- agent:main:subagent:uuid           # subagent 会话
- agent:admin:main                   # admin agent 的 main 会话
```

### 7.3 会话方法实现

**源码**: `src/gateway/server-methods/sessions.ts`

```typescript
export const sessionsHandlers = {
  // 列出会话
  'sessions.list': async (params, options) => {
    const agentId = options.client?.connect?.agentId ?? 'main'
    const storePath = resolveStorePath(cfg.session?.store, { agentId })
    const store = loadSessionStore(storePath)
    return { sessions: Object.values(store) }
  },

  // 创建会话
  'sessions.create': async (params: SessionsCreateParams, options) => {
    const sessionKey = params.parentSessionKey
      ? createSubsessionKey(params.parentSessionKey)
      : createMainSessionKey(agentId)
    
    const entry: SessionEntry = {
      key: sessionKey,
      model: params.model,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 0,
    }
    
    await updateSessionStore(storePath, (store) => {
      store[sessionKey] = entry
    })
    
    return { key: sessionKey }
  },

  // 删除会话
  'sessions.delete': async (params: SessionsDeleteParams) => {
    await updateSessionStore(storePath, (store) => {
      delete store[params.sessionKey]
    })
  },

  // 更新会话
  'sessions.patch': async (params: SessionsPatchParams) => {
    await updateSessionStore(storePath, (store) => {
      if (params.model) store[params.sessionKey].model = params.model
      if (params.thinking) store[params.sessionKey].thinking = params.thinking
      if (params.systemPrompt) store[params.sessionKey].systemPrompt = params.systemPrompt
    })
  },

  // 重置会话
  'sessions.reset': async (params: SessionsResetParams) => {
    // 清空消息历史，保留会话配置
  },

  // 压缩会话
  'sessions.compact': async (params: SessionsCompactParams) => {
    // 压缩历史消息，保留摘要
  },
}
```

---

## 8. 聊天系统

### 8.1 消息发送

**源码**: `src/gateway/server-methods/chat.ts`

```typescript
export const chatHandlers = {
  'chat.send': async (params: ChatSendParams, options) => {
    const { sessionKey, message, idempotencyKey, deliver } = params
    
    // 1. 验证会话存在
    const session = await loadSessionEntry(sessionKey)
    if (!session) {
      throw new Error('session not found')
    }

    // 2. 创建运行上下文
    const runId = idempotencyKey ?? randomUUID()
    
    // 3. 注册事件处理器
    const eventHandler = createAgentEventHandler({
      onEvent: (event) => {
        // 广播给订阅者
        broadcastToSubscribers(sessionKey, event)
      },
      runRegistry,
    })

    // 4. 启动 Agent 运行
    const agentRun = await startAgentRun({
      sessionKey,
      message,
      runId,
      onEvent: eventHandler,
    })

    // 5. 返回确认
    return {
      runId,
      status: 'accepted'
    }
  },

  'chat.history': async (params: ChatHistoryParams) => {
    const { sessionKey, limit, before } = params
    const messages = await readSessionMessages(sessionKey, { limit, before })
    return { messages }
  },

  'chat.abort': async (params: ChatAbortParams) => {
    // 中止正在进行的生成
    abortAgentRun(params.runId)
  },
}
```

### 8.2 消息流处理

**源码**: `src/gateway/server-chat.ts`

```typescript
// 助手消息合并
function resolveMergedAssistantText(params: {
  previousText: string
  nextText: string
  nextDelta: string
}): string {
  const { previousText, nextText, nextDelta } = params
  
  // 如果 nextText 以 previousText 开头，直接使用 nextText
  if (nextText && previousText && nextText.startsWith(previousText)) {
    return nextText
  }
  
  // 如果有 delta，追加到 previousText
  if (nextDelta) {
    return appendUniqueSuffix(previousText, nextDelta)
  }
  
  return nextText || previousText
}

// 心跳消息处理
function normalizeHeartbeatChatFinalText(params: {
  runId: string
  text: string
}): { suppress: boolean; text: string } {
  // 检查是否为心跳运行
  if (!isHeartbeatRun(params.runId)) {
    return { suppress: false, text: params.text }
  }
  
  // 剥离心跳标记
  const stripped = stripHeartbeatToken(params.text)
  if (stripped.shouldSkip) {
    return { suppress: true, text: '' }
  }
  
  return { suppress: false, text: stripped.text }
}
```

### 8.3 消息格式

```typescript
type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string | ContentBlock[]
  timestamp: number
  tokens?: {
    input: number
    output: number
  }
}

type ContentBlock = 
  | { type: 'text'; text: string }
  | { type: 'image'; url: string; mimeType?: string }
  | { type: 'tool_use'; name: string; toolCallId: string; arguments: object }
  | { type: 'tool_result'; toolCallId: string; content: string }
```

---

## 9. Agent 系统

### 9.1 Agent 结构

**源码**: `src/agents/identity.ts`

```typescript
type AgentIdentity = {
  agentId: string
  workspaceDir: string
  model?: string
  systemPrompt?: string
  heartbeat?: {
    enabled: boolean
    every: string      // 如 '30m'
    prompt: string
  }
}
```

### 9.2 Agent 方法

**源码**: `src/gateway/server-methods/agents.ts`

```typescript
export const agentsHandlers = {
  'agents.list': async (params, options) => {
    // 列出所有 Agent
    const agentsDir = resolveAgentsDir()
    const agents = await listAgents(agentsDir)
    return { agents }
  },

  'agents.create': async (params: AgentsCreateParams) => {
    // 创建新 Agent
    const agentDir = path.join(agentsDir, params.agentId)
    await fs.mkdir(agentDir, { recursive: true })
    await writeAgentConfig(agentDir, params.config)
  },

  'agents.update': async (params: AgentsUpdateParams) => {
    // 更新 Agent 配置
  },

  'agents.delete': async (params: AgentsDeleteParams) => {
    // 删除 Agent
  },

  'agents.files.list': async (params: AgentsFilesListParams) => {
    // 列出 Agent 工作空间文件
  },

  'agents.files.get': async (params: AgentsFilesGetParams) => {
    // 获取文件内容
  },

  'agents.files.set': async (params: AgentsFilesSetParams) => {
    // 写入文件
  },
}
```

### 9.3 Agent 运行上下文

**源码**: `src/infra/agent-events.ts`

```typescript
type AgentRunContext = {
  runId: string
  sessionKey: string
  agentId: string
  isHeartbeat: boolean
  startTime: number
}

// 运行上下文注册表
const runContexts = new Map<string, AgentRunContext>()

export function getAgentRunContext(runId: string): AgentRunContext | undefined {
  return runContexts.get(runId)
}

export function setAgentRunContext(runId: string, context: AgentRunContext) {
  runContexts.set(runId, context)
}

export function clearAgentRunContext(runId: string) {
  runContexts.delete(runId)
}
```

---

## 10. 工具系统

### 10.1 工具目录

**源码**: `src/gateway/server-methods/tools-catalog.ts`

```typescript
type ToolDefinition = {
  name: string
  description: string
  parameters: JSONSchema
  required?: string[]
}

export const toolsCatalogHandlers = {
  'tools.catalog': async (params, options) => {
    // 获取所有可用工具
    const tools = await loadToolCatalog()
    return { tools }
  },
}
```

### 10.2 工具调用事件

```typescript
// 工具调用开始
type ToolStartEvent = {
  stream: 'tool'
  data: {
    phase: 'start'
    name: string
    toolCallId: string
    arguments: object
  }
}

// 工具调用结果
type ToolResultEvent = {
  stream: 'tool'
  data: {
    phase: 'result'
    toolCallId: string
    result: unknown
  }
}
```

---

## 11. 插件系统

### 11.1 插件类型

| 类型 | 说明 | 示例 |
|------|------|------|
| Channel | 通信渠道 | Zalo, LINE, IRC |
| Skill | 技能扩展 | GitHub, Notion, Slack |
| Hook | 钩子扩展 | Gmail, Webhook |

### 11.2 插件生命周期

```typescript
// 源码: src/plugins/runtime.ts

type PluginRuntime = {
  channel: {
    start(plugin: ChannelPlugin): Promise<void>
    stop(plugin: ChannelPlugin): Promise<void>
  }
  skill: {
    register(skill: SkillDefinition): void
    unregister(skillId: string): void
  }
  hook: {
    register(hook: HookDefinition): void
    trigger(event: HookEvent): Promise<void>
  }
}
```

### 11.3 插件加载

**源码**: `src/gateway/server-plugin-bootstrap.ts`

```typescript
export async function loadGatewayStartupPlugins(options: {
  cfg: OpenClawConfig
  pluginRegistry: PluginRegistry
}): Promise<void> {
  // 1. 加载内置插件
  await loadBundledPlugins(options)
  
  // 2. 加载配置的插件
  await loadConfiguredPlugins(options)
  
  // 3. 启动自动启动的 Channel
  await startAutoStartChannels(options)
}
```

---

## 12. 安全机制

### 12.1 安全检查

**源码**: `src/gateway/client.ts`

```typescript
// 安全检查：禁止明文 WebSocket 连接到非回环地址
if (!isSecureWebSocketUrl(url, { allowPrivateWs })) {
  throw new Error(
    'SECURITY ERROR: Cannot connect over plaintext ws://. ' +
    'Use wss:// for remote URLs. ' +
    'Safe defaults: keep gateway.bind=loopback and connect via SSH tunnel.'
  )
}
```

### 12.2 TLS 指纹验证

```typescript
// TLS 证书指纹验证
if (url.startsWith('wss://') && opts.tlsFingerprint) {
  wsOptions.rejectUnauthorized = false
  wsOptions.checkServerIdentity = (host, cert) => {
    const fingerprint = normalizeFingerprint(cert.fingerprint256)
    const expected = normalizeFingerprint(opts.tlsFingerprint)
    if (fingerprint !== expected) {
      return new Error('gateway tls fingerprint mismatch')
    }
    return undefined
  }
}
```

### 12.3 速率限制

**源码**: `src/gateway/auth-rate-limit.ts`

```typescript
type AuthRateLimiter = {
  check(params: { clientIp: string; scope?: string }): RateLimitCheckResult
  reset(clientIp: string): void
}

type RateLimitCheckResult = {
  allowed: boolean
  retryAfterMs?: number
  remainingAttempts?: number
}

// 认证失败时记录
function recordFailedAttempt(clientIp: string) {
  rateLimiter.record(clientIp)
}

// 检查是否被限制
function checkRateLimit(clientIp: string): RateLimitCheckResult {
  return rateLimiter.check({ clientIp })
}
```

### 12.4 审计日志

**源码**: `src/gateway/control-plane-audit.ts`

```typescript
type AuditLogEntry = {
  timestamp: number
  actor: string          // 操作者
  action: string         // 操作
  resource: string       // 资源
  result: 'success' | 'failure'
  details?: object
}

function logAuditEntry(entry: AuditLogEntry) {
  // 写入审计日志
}
```

---

## 附录

### A. 完整方法列表

```
health, doctor.memory.*, logs.tail, channels.*, status, usage.*, 
tts.*, config.*, exec.approval.*, plugin.approval.*, wizard.*, 
talk.*, models.list, tools.*, agents.*, skills.*, update.run, 
voicewake.*, secrets.*, sessions.*, chat.*, node.*, device.*, 
cron.*, gateway.identity.*, agent.*, observability.*
```

### B. 完整事件列表

```
connect.challenge, agent, chat, session.message, session.tool, 
sessions.changed, presence, tick, talk.mode, shutdown, health, 
heartbeat, cron, node.pair.*, device.pair.*, voicewake.changed, 
exec.approval.*, plugin.approval.*, update.available
```

### C. 关键源码文件索引

| 功能 | 文件路径 |
|------|----------|
| 服务器主入口 | `src/gateway/server.impl.ts` |
| 客户端实现 | `src/gateway/client.ts` |
| RPC 调用 | `src/gateway/call.ts` |
| 认证逻辑 | `src/gateway/auth.ts` |
| 协议定义 | `src/gateway/protocol/schema.ts` |
| 会话方法 | `src/gateway/server-methods/sessions.ts` |
| 聊天方法 | `src/gateway/server-methods/chat.ts` |
| Agent 方法 | `src/gateway/server-methods/agents.ts` |
| 事件处理 | `src/gateway/server-chat.ts` |
| 权限控制 | `src/gateway/method-scopes.ts` |
| 设备身份 | `src/infra/device-identity.ts` |
| 插件系统 | `src/plugins/runtime.ts` |
