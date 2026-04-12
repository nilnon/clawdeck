# RPC 方法详解

> **本文档引用的源码文件**
> - `src/gateway/server-methods.ts` - 方法注册
> - `src/gateway/server-methods/sessions.ts` - 会话方法
> - `src/gateway/server-methods/chat.ts` - 聊天方法
> - `src/gateway/server-methods/agents.ts` - Agent 方法

## 目录

1. [简介](#简介)
2. [方法分类](#方法分类)
3. [会话方法](#会话方法)
4. [聊天方法](#聊天方法)
5. [Agent 方法](#agent-方法)
6. [模型方法](#模型方法)
7. [工具方法](#工具方法)
8. [配置方法](#配置方法)
9. [健康检查方法](#健康检查方法)

## 简介

Gateway 支持 **140+** 个 RPC 方法，按功能分类：

| 分类       | 方法数量 | 说明                                 |
| -------- | ---- | ---------------------------------- |
| 会话管理     | 15+  | sessions.\*                        |
| 聊天功能     | 3    | chat.\*                            |
| Agent 管理 | 7+   | agents.\*                          |
| 模型管理     | 1    | models.\*                          |
| 工具系统     | 3    | tools.\*                           |
| 配置管理     | 6    | config.\*                          |
| 健康检查     | 2    | health, status                     |
| 可观测性     | 15+  | observability.\*                   |
| TTS 语音   | 6    | tts.\*                             |
| 定时任务     | 7    | cron.\*                            |
| 审批系统     | 10+  | exec.approval.*, plugin.approval.* |
| 节点配对     | 15+  | node.*, device.*                   |

## 方法分类

### 权限要求

| Scope                | 可访问方法                                                       |
| -------------------- | ----------------------------------------------------------- |
| `operator.admin`     | 所有方法                                                        |
| `operator.read`      | sessions.list, models.list, health, status, config.get      |
| `operator.write`     | sessions.create, sessions.delete, chat.send, sessions.patch |
| `operator.approvals` | exec.approval.*, plugin.approval.*                          |
| `operator.pairing`   | node.pair.*, device.pair.*                                  |

## 会话方法

### sessions.list

列出所有会话。

**参数**:

```typescript
type SessionsListParams = {
  agentId?: string  // 可选，过滤指定 Agent 的会话
}
```

**响应**:

```typescript
type SessionsListResponse = {
  sessions: SessionEntry[]
}

type SessionEntry = {
  key: string           // sessionKey
  label?: string        // 显示名称
  model?: string        // 模型 ID
  thinking?: 'light' | 'medium' | 'heavy'
  systemPrompt?: string
  createdAt: number
  updatedAt: number
  messageCount: number
  parentSessionKey?: string
}
```

**示例**:

```json
// 请求
{ "type": "req", "id": "1", "method": "sessions.list", "params": {} }

// 响应
{
  "type": "res", "id": "1", "ok": true,
  "payload": {
    "sessions": [
      { "key": "agent:main:main", "label": "Main", "createdAt": 1712899200000 }
    ]
  }
}
```

### sessions.create

创建新会话。

**参数**:

```typescript
type SessionsCreateParams = {
  model?: string           // 模型 ID
  parentSessionKey?: string  // 父会话（创建子会话时使用）
}
```

**响应**:

```typescript
type SessionsCreateResponse = {
  key: string  // 新创建的 sessionKey
}
```

**示例**:

```json
// 请求
{ "type": "req", "id": "2", "method": "sessions.create", "params": { "model": "claude-3-opus" } }

// 响应
{ "type": "res", "id": "2", "ok": true, "payload": { "key": "agent:main:main" } }
```

### sessions.delete

删除会话。

**参数**:

```typescript
type SessionsDeleteParams = {
  sessionKey: string
}
```

### sessions.patch

更新会话属性。

**参数**:

```typescript
type SessionsPatchParams = {
  sessionKey: string
  model?: string
  thinking?: 'light' | 'medium' | 'heavy'
  systemPrompt?: string
  label?: string
}
```

### sessions.reset

重置会话（清空消息历史）。

**参数**:

```typescript
type SessionsResetParams = {
  sessionKey: string
}
```

### sessions.compact

压缩会话（压缩历史消息）。

**参数**:

```typescript
type SessionsCompactParams = {
  sessionKey: string
}
```

### sessions.preview

预览会话内容。

**参数**:

```typescript
type SessionsPreviewParams = {
  keys: string[]  // sessionKey 数组
}
```

### sessions.subscribe / sessions.unsubscribe

订阅/取消订阅会话变更。

**参数**:

```typescript
type SessionsSubscribeParams = {
  sessionKeys?: string[]  // 可选，不传则订阅所有
}
```

## 聊天方法

### chat.send

发送消息。

**参数**:

```typescript
type ChatSendParams = {
  sessionKey: string
  message: string | ContentBlock[]
  idempotencyKey?: string  // 幂等键，防止重复发送
  deliver?: boolean        // 是否投递到 Agent（默认 false，通过事件接收）
}
```

**响应**:

```typescript
type ChatSendResponse = {
  runId: string    // 运行 ID
  status: 'accepted' | 'rejected'
}
```

**示例**:

```json
// 请求
{
  "type": "req", "id": "3", "method": "chat.send",
  "params": {
    "sessionKey": "agent:main:main",
    "message": "Hello, how are you?",
    "idempotencyKey": "chat-1712899200000-abc123"
  }
}

// 响应
{
  "type": "res", "id": "3", "ok": true,
  "payload": { "runId": "run-xyz789", "status": "accepted" }
}
```

### chat.history

获取消息历史。

**参数**:

```typescript
type ChatHistoryParams = {
  sessionKey: string
  limit?: number      // 默认 50
  before?: string     // 消息 ID，用于分页
}
```

**响应**:

```typescript
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

### chat.abort

中止正在进行的生成。

**参数**:

```typescript
type ChatAbortParams = {
  runId: string
}
```

## Agent 方法

### agents.list

列出所有 Agent。

**响应**:

```typescript
type AgentsListResponse = {
  agents: AgentInfo[]
}

type AgentInfo = {
  agentId: string
  workspaceDir: string
  model?: string
  status: 'running' | 'stopped'
}
```

### agents.create

创建新 Agent。

**参数**:

```typescript
type AgentsCreateParams = {
  agentId: string
  config?: {
    model?: string
    systemPrompt?: string
  }
}
```

### agents.update

更新 Agent 配置。

**参数**:

```typescript
type AgentsUpdateParams = {
  agentId: string
  config: {
    model?: string
    systemPrompt?: string
    heartbeat?: { enabled: boolean; every: string; prompt: string }
  }
}
```

### agents.delete

删除 Agent。

**参数**:

```typescript
type AgentsDeleteParams = {
  agentId: string
}
```

### agents.files.list

列出 Agent 工作空间文件。

**参数**:

```typescript
type AgentsFilesListParams = {
  agentId: string
  path?: string  // 相对路径
}
```

### agents.files.get

获取文件内容。

**参数**:

```typescript
type AgentsFilesGetParams = {
  agentId: string
  path: string
}
```

### agents.files.set

写入文件。

**参数**:

```typescript
type AgentsFilesSetParams = {
  agentId: string
  path: string
  content: string
}
```

## 模型方法

### models.list

列出可用模型。

**响应**:

```typescript
type ModelsListResponse = {
  models: ModelInfo[]
}

type ModelInfo = {
  id: string
  name: string
  provider: string
  contextWindow?: number
}
```

## 工具方法

### tools.catalog

获取工具目录。

**响应**:

```typescript
type ToolsCatalogResponse = {
  tools: ToolDefinition[]
}

type ToolDefinition = {
  name: string
  description: string
  parameters: JSONSchema
}
```

### tools.effective

获取当前有效的工具列表。

**参数**:

```typescript
type ToolsEffectiveParams = {
  sessionKey?: string
}
```

## 配置方法

### config.get

获取配置。

**参数**:

```typescript
type ConfigGetParams = {
  key?: string  // 可选，不传则返回全部
}
```

### config.set

设置配置。

**参数**:

```typescript
type ConfigSetParams = {
  key: string
  value: unknown
}
```

### config.schema

获取配置 Schema。

**响应**:

```typescript
type ConfigSchemaResponse = {
  schema: JSONSchema
}
```

## 健康检查方法

### health

获取健康状态。

**响应**:

```typescript
type HealthResponse = {
  ok: boolean
  ts: number
  durationMs: number
  agents: AgentHealth[]
  sessions: { count: number; recent: SessionSummary[] }
}
```

### status

获取系统状态。

**响应**:

```typescript
type StatusResponse = {
  version: string
  uptime: number
  connections: number
  memory: { used: number; total: number }
}
```


## 附录

### A. Gateway 支持的所有方法 (140+)

```
health, doctor.memory.*, logs.tail, channels.*, status, usage.*, 
tts.*, config.*, exec.approval.*, plugin.approval.*, wizard.*, 
talk.*, models.list, tools.*, agents.*, skills.*, update.run, 
voicewake.*, secrets.*, sessions.*, chat.*, node.*, device.*, 
cron.*, gateway.identity.*, agent.*, observability.*
```

### B. 方法分类详解

| 分类 | 方法前缀 | 说明 |
|------|----------|------|
| **核心** | `health`, `status` | 系统健康检查 |
| **会话** | `sessions.*` | 会话生命周期管理 |
| **聊天** | `chat.*` | 消息发送与历史 |
| **Agent** | `agents.*`, `agent.*` | Agent 管理 |
| **模型** | `models.*` | 模型目录 |
| **工具** | `tools.*` | 工具目录 |
| **配置** | `config.*` | 配置管理 |
| **定时** | `cron.*` | 定时任务 |
| **语音** | `tts.*`, `voicewake.*` | TTS 服务、语音唤醒 |
| **技能** | `skills.*` | 技能管理 |
| **节点** | `node.*` | 节点管理 |
| **设备** | `device.*` | 设备配对 |
| **审批** | `exec.approval.*`, `plugin.approval.*` | 审批流程 |
| **向导** | `wizard.*` | 设置向导 |
| **可观测** | `observability.*` | 监控指标 |
| **密钥** | `secrets.*` | 密钥管理 |
| **使用** | `usage.*` | 使用统计 |
| **频道** | `channels.*` | 频道管理 |
| **日志** | `logs.*` | 日志管理 |
| **更新** | `update.*` | 更新系统 |
| **诊断** | `doctor.*` | 内存医生 |
| **身份** | `gateway.identity.*` | Gateway 身份 |

### C. 常用方法速查

#### 会话操作

| 方法 | 说明 |
|------|------|
| `sessions.list` | 列出所有会话 |
| `sessions.create` | 创建新会话 |
| `sessions.delete` | 删除会话 |
| `sessions.patch` | 更新会话属性 |
| `sessions.reset` | 重置会话（清空历史） |
| `sessions.compact` | 压缩会话历史 |
| `sessions.preview` | 预览会话内容 |
| `sessions.subscribe` | 订阅会话变更 |

#### 聊天操作

| 方法 | 说明 |
|------|------|
| `chat.send` | 发送消息 |
| `chat.history` | 获取历史消息 |
| `chat.abort` | 中止生成 |

#### Agent 操作

| 方法 | 说明 |
|------|------|
| `agents.list` | 列出所有 Agent |
| `agents.create` | 创建 Agent |
| `agents.update` | 更新 Agent 配置 |
| `agents.delete` | 删除 Agent |
| `agents.files.list` | 列出工作空间文件 |
| `agents.files.get` | 获取文件内容 |
| `agents.files.set` | 写入文件 |

#### 系统操作

| 方法 | 说明 |
|------|------|
| `health` | 获取健康状态 |
| `status` | 获取系统状态 |
| `config.get` | 获取配置 |
| `config.set` | 设置配置 |
| `models.list` | 列出可用模型 |
| `tools.catalog` | 获取工具目录 |
