# 工具系统

> **本文档引用的源码文件**
> - `src/gateway/server-methods/tools-catalog.ts` - 工具目录
> - `src/tools/` - 工具实现

## 目录

1. [简介](#简介)
2. [工具目录](#工具目录)
3. [工具定义](#工具定义)
4. [工具调用](#工具调用)
5. [工具事件](#工具事件)

## 简介

工具系统是 Gateway 的扩展机制：

- 提供标准化的工具接口
- 支持 Agent 调用外部功能
- 支持工具结果返回
- 支持工具权限控制

## 工具目录

### tools.catalog 方法

```typescript
const result = await rpc.call('tools.catalog') as { tools: ToolDefinition[] }
```

### 响应示例

```json
{
  "tools": [
    {
      "name": "read_file",
      "description": "Read the contents of a file",
      "parameters": {
        "type": "object",
        "properties": {
          "path": { "type": "string", "description": "File path" }
        },
        "required": ["path"]
      }
    },
    {
      "name": "write_file",
      "description": "Write content to a file",
      "parameters": {
        "type": "object",
        "properties": {
          "path": { "type": "string" },
          "content": { "type": "string" }
        },
        "required": ["path", "content"]
      }
    }
  ]
}
```

### tools.effective 方法

获取当前有效的工具列表（考虑权限过滤）。

```typescript
type ToolsEffectiveParams = {
  sessionKey?: string
}

const result = await rpc.call('tools.effective', { sessionKey: 'agent:main:main' })
```

## 工具定义

### ToolDefinition 类型

```typescript
type ToolDefinition = {
  name: string              // 工具名称
  description: string       // 工具描述
  parameters: JSONSchema    // 参数 Schema
  required?: string[]       // 必需参数
}
```

### 内置工具

| 工具名               | 说明        |
| ----------------- | --------- |
| `read_file`       | 读取文件      |
| `write_file`      | 写入文件      |
| `list_directory`  | 列出目录      |
| `execute_command` | 执行命令      |
| `search_web`      | 搜索网页      |
| `fetch_url`       | 获取 URL 内容 |

### 自定义工具

```typescript
// 工具定义
const myTool: ToolDefinition = {
  name: 'my_custom_tool',
  description: 'A custom tool for specific operations',
  parameters: {
    type: 'object',
    properties: {
      input: { type: 'string', description: 'Input value' },
      options: { 
        type: 'object',
        properties: {
          verbose: { type: 'boolean' }
        }
      }
    },
    required: ['input']
  }
}
```

## 工具调用

### 调用流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                        工具调用流程                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. Agent 决定调用工具                                               │
│     ↓                                                                │
│  2. 发送 tool_use 内容块                                             │
│     { type: "tool_use", name: "read_file", arguments: {...} }       │
│     ↓                                                                │
│  3. Gateway 执行工具                                                 │
│     - 验证权限                                                       │
│     - 执行工具逻辑                                                   │
│     ↓                                                                │
│  4. 返回 tool_result 内容块                                          │
│     { type: "tool_result", content: "...", isError: false }         │
│     ↓                                                                │
│  5. Agent 继续处理                                                   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 工具调用事件

**开始事件**:

```json
{
  "type": "event",
  "event": "agent",
  "payload": {
    "stream": "tool",
    "data": {
      "phase": "start",
      "name": "read_file",
      "toolCallId": "call-abc123",
      "arguments": { "path": "/src/index.ts" }
    }
  }
}
```

**结果事件**:

```json
{
  "type": "event",
  "event": "agent",
  "payload": {
    "stream": "tool",
    "data": {
      "phase": "result",
      "toolCallId": "call-abc123",
      "result": "file content..."
    }
  }
}
```

## 工具事件

### 处理工具事件

```typescript
function handleToolEvent(payload: AgentEventPayload) {
  if (payload.stream !== 'tool') return
  
  const { phase, name, toolCallId, arguments: args, result } = payload.data
  
  if (phase === 'start') {
    // 显示工具调用开始
    console.log(`🔧 Calling tool: ${name}`)
    console.log(`   Arguments:`, args)
    
    // 更新 UI
    showToolCall({
      toolCallId,
      name,
      arguments: args,
      status: 'running'
    })
  } else if (phase === 'result') {
    // 显示工具调用结果
    console.log(`✅ Tool result:`, result)
    
    // 更新 UI
    updateToolCall(toolCallId, {
      status: 'completed',
      result
    })
  }
}
```

### 工具调用显示

```typescript
function formatToolCall(name: string, args: Record<string, unknown>): string {
  const argsStr = Object.entries(args)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(', ')
  
  return `🔧 ${name}(${argsStr})`
}

// 示例输出
// 🔧 read_file(path="/src/index.ts")
// 🔧 write_file(path="/src/new.ts", content="...")
```

### 工具错误处理

```typescript
function handleToolError(toolCallId: string, error: Error) {
  updateToolCall(toolCallId, {
    status: 'error',
    error: error.message
  })
  
  // 显示错误
  console.error(`❌ Tool error: ${error.message}`)
}
```

