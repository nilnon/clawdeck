# 会话管理

> **本文档引用的源码文件**
> - `src/gateway/server-methods/sessions.ts` - 会话方法实现
> - `src/config/sessions/types.ts` - 会话类型定义

## 目录

1. [简介](#简介)
2. [会话类型](#会话类型)
3. [会话 Key 格式](#会话-key-格式)
4. [会话操作](#会话操作)
5. [会话属性](#会话属性)
6. [会话快照](#会话快照)

## 简介

会话(Session)是 Gateway 中管理对话状态的核心概念：

- 每个会话有唯一的 sessionKey
- 支持多 Agent、多会话
- 支持会话层级关系（父子会话）
- 支持会话持久化

## 会话类型

| 类型            | 说明           | sessionKey 格式                      |
| ------------- | ------------ | ---------------------------------- |
| **main**      | 主会话          | `agent:{agentId}:main`             |
| **dashboard** | Dashboard 会话 | `agent:{agentId}:dashboard:{uuid}` |
| **subagent**  | 子代理会话        | `agent:{agentId}:subagent:{uuid}`  |

### Main 会话

- 每个 Agent 有且仅有一个 main 会话
- 用于 Agent 的主要交互
- 事件类型：`agent` 事件

### Dashboard 会话

- 用于 Dashboard 功能
- 可以有多个
- 事件类型：`chat` 事件

### Subagent 会话

- 用于子代理交互
- 有父会话关联
- 事件类型：`chat` 事件

## 会话 Key 格式

### 格式规则

```
agent:{agentId}:{sessionType}:{sessionId}
```

- `agent` - 固定前缀
- `{agentId}` - Agent 标识，如 `main`, `admin`
- `{sessionType}` - 会话类型：`main`, `dashboard`, `subagent`
- `{sessionId}` - 可选的会话 ID（UUID）

### 示例

```
agent:main:main                      # main 会话
agent:main:dashboard:abc123          # dashboard 会话
agent:main:subagent:def456           # subagent 会话
agent:admin:main                     # admin agent 的 main 会话
```

### 解析

```typescript
function parseSessionKey(sessionKey: string): {
  agentId: string
  sessionType: 'main' | 'dashboard' | 'subagent' | 'other'
  sessionId?: string
} {
  const match = sessionKey.match(/^agent:([^:]+):([^:]+)(?::(.+))?$/)
  
  if (!match) {
    return { agentId: 'unknown', sessionType: 'other' }
  }
  
  const [, agentId, typePart, idPart] = match
  
  let sessionType: 'main' | 'dashboard' | 'subagent' | 'other'
  if (typePart === 'main' && !idPart) {
    sessionType = 'main'
  } else if (typePart === 'dashboard') {
    sessionType = 'dashboard'
  } else if (typePart === 'subagent') {
    sessionType = 'subagent'
  } else {
    sessionType = 'other'
  }
  
  return { agentId, sessionType, sessionId: idPart }
}
```

## 会话操作

### 列出会话

```typescript
const result = await rpc.call('sessions.list') as { sessions: SessionEntry[] }
```

### 创建会话

```typescript
// 创建 main 会话
const result = await rpc.call('sessions.create', {
  model: 'claude-3-opus'
}) as { key: string }

// 创建子会话
const subResult = await rpc.call('sessions.create', {
  parentSessionKey: 'agent:main:main',
  model: 'claude-3-opus'
}) as { key: string }
```

### 删除会话

```typescript
await rpc.call('sessions.delete', {
  sessionKey: 'agent:main:dashboard:abc123'
})
```

### 更新会话

```typescript
await rpc.call('sessions.patch', {
  sessionKey: 'agent:main:main',
  model: 'claude-3-sonnet',
  thinking: 'medium',
  systemPrompt: 'You are a helpful assistant.'
})
```

### 重置会话

```typescript
// 清空消息历史，保留配置
await rpc.call('sessions.reset', {
  sessionKey: 'agent:main:main'
})
```

### 压缩会话

```typescript
// 压缩历史消息，生成摘要
await rpc.call('sessions.compact', {
  sessionKey: 'agent:main:main'
})
```

### 预览会话

```typescript
const result = await rpc.call('sessions.preview', {
  keys: ['agent:main:main', 'agent:main:dashboard:abc123']
})
```

## 会话属性

### 属性定义

```typescript
type SessionEntry = {
  key: string           // sessionKey
  label?: string        // 显示名称
  model?: string        // 模型 ID
  thinking?: 'light' | 'medium' | 'heavy'  // 思考级别
  systemPrompt?: string // 系统提示词
  createdAt: number     // 创建时间
  updatedAt: number     // 更新时间
  messageCount: number  // 消息数量
  parentSessionKey?: string  // 父会话
}
```

### 模型设置

```typescript
await rpc.call('sessions.patch', {
  sessionKey: 'agent:main:main',
  model: 'claude-3-opus'
})
```

### 思考级别

| 级别       | 说明   |
| -------- | ---- |
| `light`  | 轻度思考 |
| `medium` | 中度思考 |
| `heavy`  | 深度思考 |

```typescript
await rpc.call('sessions.patch', {
  sessionKey: 'agent:main:main',
  thinking: 'heavy'
})
```

### 系统提示词

```typescript
await rpc.call('sessions.patch', {
  sessionKey: 'agent:main:main',
  systemPrompt: 'You are a helpful coding assistant.'
})
```

## 会话快照

### 快照列表

```typescript
const result = await rpc.call('sessions.compaction.list', {
  sessionKey: 'agent:main:main'
})
```

### 获取快照

```typescript
const result = await rpc.call('sessions.compaction.get', {
  sessionKey: 'agent:main:main',
  compactionId: 'compaction-abc123'
})
```

### 从快照恢复

```typescript
await rpc.call('sessions.compaction.restore', {
  sessionKey: 'agent:main:main',
  compactionId: 'compaction-abc123'
})
```

### 创建分支

```typescript
const result = await rpc.call('sessions.compaction.branch', {
  sessionKey: 'agent:main:main',
  compactionId: 'compaction-abc123'
})
```

