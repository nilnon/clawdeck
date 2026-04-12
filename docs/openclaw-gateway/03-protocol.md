# 协议层

> **本文档引用的源码文件**
> - `src/gateway/protocol/index.ts` - 协议入口
> - `src/gateway/protocol/schema.ts` - JSON Schema 定义

## 目录

1. [简介](#简介)
2. [消息帧格式](#消息帧格式)
3. [协议验证](#协议验证)
4. [错误处理](#错误处理)
5. [最佳实践](#最佳实践)

## 简介

OpenClaw Gateway 使用 JSON-RPC 风格的消息协议，基于 WebSocket 进行传输。协议层负责：

- 消息序列化/反序列化
- 消息格式验证
- 错误格式化
- 版本协商

## 消息帧格式

### 请求帧 (RequestFrame)

用于客户端向服务器发送 RPC 请求。

```typescript
type RequestFrame = {
  type: 'req'
  id: string           // UUID，用于匹配响应
  method: string       // 方法名，如 'sessions.list'
  params?: object      // 方法参数
}
```

**示例**:

```json
{
  "type": "req",
  "id": "req-1-1712899200000",
  "method": "sessions.list",
  "params": {}
}
```

### 响应帧 (ResponseFrame)

用于服务器返回 RPC 调用结果。

```typescript
type ResponseFrame = {
  type: 'res'
  id: string           // 对应请求 ID
  ok: boolean          // 是否成功
  payload?: object     // 响应数据（成功时）
  error?: {            // 错误信息（失败时）
    code: string
    message: string
    details?: unknown
  }
}
```

**成功响应示例**:

```json
{
  "type": "res",
  "id": "req-1-1712899200000",
  "ok": true,
  "payload": {
    "sessions": [
      { "key": "agent:main:main", "label": "Main Session" }
    ]
  }
}
```

**错误响应示例**:

```json
{
  "type": "res",
  "id": "req-1-1712899200000",
  "ok": false,
  "error": {
    "code": "INVALID_PARAMS",
    "message": "at root: unexpected property 'title'"
  }
}
```

### 事件帧 (EventFrame)

用于服务器向客户端推送事件。

```typescript
type EventFrame = {
  type: 'event'
  event: string        // 事件名，如 'chat', 'agent'
  payload: object      // 事件数据
  seq?: number         // 序列号（用于检测丢包）
}
```

**示例**:

```json
{
  "type": "event",
  "event": "chat",
  "payload": {
    "state": "delta",
    "sessionKey": "agent:main:main",
    "message": { "content": [{ "type": "text", "text": "Hello" }] }
  },
  "seq": 123
}
```

## 协议验证

### JSON Schema 定义

**源码位置**: `src/gateway/protocol/schema.ts`

```typescript
// 请求帧 Schema
const RequestFrameSchema = {
  type: 'object',
  required: ['type', 'id', 'method'],
  properties: {
    type: { const: 'req' },
    id: { type: 'string' },
    method: { type: 'string' },
    params: { type: 'object' }
  },
  additionalProperties: false
}

// 响应帧 Schema
const ResponseFrameSchema = {
  type: 'object',
  required: ['type', 'id', 'ok'],
  properties: {
    type: { const: 'res' },
    id: { type: 'string' },
    ok: { type: 'boolean' },
    payload: { type: 'object' },
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        details: {}
      }
    }
  },
  additionalProperties: false
}

// 事件帧 Schema
const EventFrameSchema = {
  type: 'object',
  required: ['type', 'event', 'payload'],
  properties: {
    type: { const: 'event' },
    event: { type: 'string' },
    payload: { type: 'object' },
    seq: { type: 'number' }
  },
  additionalProperties: false
}
```

### 验证器编译

```typescript
import Ajv from 'ajv'

const ajv = new Ajv({ allErrors: true, strict: false })

// 编译验证器
export const validateRequestFrame = ajv.compile<RequestFrame>(RequestFrameSchema)
export const validateResponseFrame = ajv.compile<ResponseFrame>(ResponseFrameSchema)
export const validateEventFrame = ajv.compile<EventFrame>(EventFrameSchema)
```

### 验证使用

```typescript
function processMessage(data: unknown) {
  const msg = data as Record<string, unknown>
  
  // 根据类型选择验证器
  if (msg.type === 'req') {
    if (!validateRequestFrame(msg)) {
      return errorShape('INVALID_FRAME', formatValidationErrors(validateRequestFrame.errors))
    }
    return handleRequest(msg)
  }
  
  if (msg.type === 'res') {
    if (!validateResponseFrame(msg)) {
      console.error('Invalid response frame:', validateResponseFrame.errors)
      return
    }
    return handleResponse(msg)
  }
  
  if (msg.type === 'event') {
    if (!validateEventFrame(msg)) {
      console.error('Invalid event frame:', validateEventFrame.errors)
      return
    }
    return handleEvent(msg)
  }
  
  return errorShape('UNKNOWN_FRAME_TYPE', `Unknown frame type: ${msg.type}`)
}
```

## 错误处理

### 错误码定义

| 错误码                | 说明      |
| ------------------ | ------- |
| `INVALID_FRAME`    | 消息帧格式无效 |
| `INVALID_PARAMS`   | 方法参数无效  |
| `METHOD_NOT_FOUND` | 方法不存在   |
| `UNAUTHORIZED`     | 权限不足    |
| `SCOPE_REQUIRED`   | 缺少所需权限  |
| `INTERNAL_ERROR`   | 内部错误    |
| `TIMEOUT`          | 请求超时    |

### 错误格式化

```typescript
function formatValidationErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) return 'Unknown validation error'
  
  return errors.map(err => {
    const path = err.instancePath || 'root'
    const message = err.message || 'Invalid value'
    return `at ${path}: ${message}`
  }).join('; ')
}

function errorShape(code: string, message: string, details?: unknown): ResponseFrame {
  return {
    type: 'res',
    id: '',  // 调用时填充
    ok: false,
    error: { code, message, details }
  }
}
```

### 参数验证示例

```typescript
// 方法定义
const sessionsCreateSchema = {
  type: 'object',
  properties: {
    model: { type: 'string' },
    parentSessionKey: { type: 'string' },
    label: { type: 'string' }
  },
  additionalProperties: false  // 禁止额外属性
}

// 验证器
const validateSessionsCreate = ajv.compile(sessionsCreateSchema)

// 使用
function handleSessionsCreate(params: unknown) {
  if (!validateSessionsCreate(params)) {
    return errorShape(
      'INVALID_PARAMS',
      formatValidationErrors(validateSessionsCreate.errors)
    )
  }
  // 处理逻辑...
}
```

## 最佳实践

### 1. ID 生成

```typescript
// 推荐：使用递增序号 + 时间戳
let messageId = 0
function generateId(): string {
  return `req-${++messageId}-${Date.now()}`
}
```

### 2. 超时处理

```typescript
async function call(method: string, params: object, timeoutMs = 30000): Promise<unknown> {
  const id = generateId()
  
  return new Promise((resolve, reject) => {
    // 设置超时
    const timer = setTimeout(() => {
      pendingCalls.delete(id)
      reject(new Error(`RPC call "${method}" timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    
    // 注册等待
    pendingCalls.set(id, { resolve, reject, timer })
    
    // 发送请求
    ws.send(JSON.stringify({ type: 'req', id, method, params }))
  })
}
```

### 3. 消息大小限制

```typescript
// 检查消息大小
const MAX_PAYLOAD = 26 * 1024 * 1024  // 26MB

function sendMessage(data: unknown) {
  const json = JSON.stringify(data)
  if (json.length > MAX_PAYLOAD) {
    throw new Error(`Message too large: ${json.length} bytes (max: ${MAX_PAYLOAD})`)
  }
  ws.send(json)
}
```

### 4. 序列号处理

```typescript
// 检测丢包
let lastSeq = 0

function handleEvent(event: EventFrame) {
  if (event.seq !== undefined) {
    if (event.seq > lastSeq + 1) {
      console.warn(`Missed ${event.seq - lastSeq - 1} events`)
    }
    lastSeq = event.seq
  }
  
  // 处理事件...
}
```

### 5. 批量请求

```typescript
// 不支持批量请求，需要逐个发送
async function batchCall(calls: Array<{ method: string; params: object }>) {
  return Promise.all(
    calls.map(({ method, params }) => call(method, params))
  )
}
```

