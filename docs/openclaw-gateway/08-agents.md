# Agent 系统

> **本文档引用的源码文件**
> - `src/gateway/server-methods/agents.ts` - Agent 方法实现
> - `src/infra/agent-events.ts` - Agent 事件定义
> - `src/agents/identity.ts` - Agent 身份

## 目录

1. [简介](#简介)
2. [Agent 结构](#agent-结构)
3. [Agent 操作](#agent-操作)
4. [运行上下文](#运行上下文)
5. [心跳机制](#心跳机制)
6. [文件操作](#文件操作)

## 简介

Agent 是 Gateway 中执行任务的主体：

- 每个 Agent 有独立的身份和工作空间
- 支持多 Agent 并行运行
- 支持心跳保活机制
- 支持文件系统操作

## Agent 结构

### AgentIdentity

```typescript
type AgentIdentity = {
  agentId: string           // Agent 唯一标识
  workspaceDir: string      // 工作空间目录
  model?: string            // 默认模型
  systemPrompt?: string     // 系统提示词
  heartbeat?: {
    enabled: boolean        // 是否启用心跳
    every: string           // 心跳间隔，如 '30m'
    prompt: string          // 心跳提示词
  }
}
```

### AgentInfo

```typescript
type AgentInfo = {
  agentId: string
  workspaceDir: string
  model?: string
  status: 'running' | 'stopped' | 'error'
  createdAt: number
  lastActiveAt?: number
}
```

### 配置文件

Agent 配置存储在 `~/.openclaw/agents/{agentId}/agent.json`:

```json
{
  "agentId": "main",
  "workspaceDir": "/home/user/workspace",
  "model": "claude-3-opus",
  "systemPrompt": "You are a helpful assistant.",
  "heartbeat": {
    "enabled": true,
    "every": "30m",
    "prompt": "HEARTBEAT"
  }
}
```

## Agent 操作

### agents.list

列出所有 Agent。

```typescript
const result = await rpc.call('agents.list') as { agents: AgentInfo[] }

// 响应
{
  "agents": [
    { "agentId": "main", "workspaceDir": "/home/user/workspace", "status": "running" },
    { "agentId": "admin", "workspaceDir": "/home/user/admin", "status": "stopped" }
  ]
}
```

### agents.create

创建新 Agent。

```typescript
type AgentsCreateParams = {
  agentId: string
  config?: {
    model?: string
    systemPrompt?: string
    workspaceDir?: string
    heartbeat?: { enabled: boolean; every: string; prompt: string }
  }
}

await rpc.call('agents.create', {
  agentId: 'my-agent',
  config: {
    model: 'claude-3-opus',
    systemPrompt: 'You are a specialized assistant.'
  }
})
```

### agents.update

更新 Agent 配置。

```typescript
type AgentsUpdateParams = {
  agentId: string
  config: {
    model?: string
    systemPrompt?: string
    heartbeat?: { enabled: boolean; every: string; prompt: string }
  }
}

await rpc.call('agents.update', {
  agentId: 'my-agent',
  config: {
    model: 'claude-3-sonnet'
  }
})
```

### agents.delete

删除 Agent。

```typescript
type AgentsDeleteParams = {
  agentId: string
}

await rpc.call('agents.delete', { agentId: 'my-agent' })
```

## 运行上下文

### AgentRunContext

```typescript
type AgentRunContext = {
  runId: string              // 运行 ID
  sessionKey: string         // 会话 Key
  agentId: string            // Agent ID
  isHeartbeat: boolean       // 是否为心跳运行
  startTime: number          // 开始时间
}
```

### 运行上下文注册表

```typescript
const runContexts = new Map<string, AgentRunContext>()

function getAgentRunContext(runId: string): AgentRunContext | undefined {
  return runContexts.get(runId)
}

function setAgentRunContext(runId: string, context: AgentRunContext): void {
  runContexts.set(runId, context)
}

function clearAgentRunContext(runId: string): void {
  runContexts.delete(runId)
}
```

### 运行状态跟踪

```typescript
function handleAgentEvent(payload: AgentEventPayload) {
  const { runId, stream, data } = payload
  
  if (stream === 'lifecycle') {
    if (data.phase === 'start') {
      // 创建运行上下文
      setAgentRunContext(runId, {
        runId,
        sessionKey: payload.sessionKey,
        agentId: extractAgentId(payload.sessionKey),
        isHeartbeat: isHeartbeatRun(runId),
        startTime: Date.now()
      })
    } else if (data.phase === 'end') {
      // 清理运行上下文
      clearAgentRunContext(runId)
    }
  }
}
```

## 心跳机制

### 心跳配置

```typescript
type HeartbeatConfig = {
  enabled: boolean
  every: string       // 如 '30m', '1h'
  prompt: string      // 心跳提示词
}
```

### 心跳运行

```typescript
// 心跳 runId 格式
const heartbeatRunId = `heartbeat-${Date.now()}`

// 心跳消息
await rpc.call('chat.send', {
  sessionKey: 'agent:main:main',
  message: 'HEARTBEAT',
  idempotencyKey: heartbeatRunId
})
```

### 心跳响应处理

```typescript
function handleHeartbeatResponse(payload: AgentEventPayload) {
  if (!isHeartbeatRun(payload.runId)) return
  
  // 剥离心跳标记
  const text = stripHeartbeatToken(payload.data.text || '')
  
  // 更新心跳状态
  updateHeartbeatStatus({
    agentId: extractAgentId(payload.sessionKey),
    lastHeartbeat: Date.now(),
    response: text
  })
}
```

## 文件操作

### agents.files.list

列出工作空间文件。

```typescript
type AgentsFilesListParams = {
  agentId: string
  path?: string      // 相对路径
}

const result = await rpc.call('agents.files.list', {
  agentId: 'main',
  path: 'src'
})

// 响应
{
  "files": [
    { "name": "index.ts", "type": "file", "size": 1234 },
    { "name": "utils", "type": "directory" }
  ]
}
```

### agents.files.get

获取文件内容。

```typescript
type AgentsFilesGetParams = {
  agentId: string
  path: string       // 相对路径
}

const result = await rpc.call('agents.files.get', {
  agentId: 'main',
  path: 'src/index.ts'
})

// 响应
{
  "content": "file content...",
  "mimeType": "text/plain"
}
```

### agents.files.set

写入文件。

```typescript
type AgentsFilesSetParams = {
  agentId: string
  path: string       // 相对路径
  content: string    // 文件内容
}

await rpc.call('agents.files.set', {
  agentId: 'main',
  path: 'src/new-file.ts',
  content: 'export const hello = "world"'
})
```

### 文件操作权限

```typescript
// 权限检查
function checkFileAccess(agentId: string, path: string, operation: 'read' | 'write'): boolean {
  const workspace = getWorkspaceDir(agentId)
  const absolutePath = resolve(workspace, path)
  
  // 确保路径在工作空间内
  if (!absolutePath.startsWith(workspace)) {
    throw new Error('Access denied: path outside workspace')
  }
  
  return true
}
```
