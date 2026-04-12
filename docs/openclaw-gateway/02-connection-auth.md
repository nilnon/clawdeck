# 连接与认证

> **本文档引用的源码文件**
> - `src/gateway/client.ts` - Gateway 客户端实现
> - `src/gateway/auth.ts` - 认证逻辑
> - `src/infra/device-identity.ts` - 设备身份

## 目录

1. [简介](#简介)
2. [连接生命周期](#连接生命周期)
3. [设备身份认证](#设备身份认证)
4. [认证模式](#认证模式)
5. [权限控制](#权限控制)
6. [HelloOk 响应](#hellook-响应)

## 简介

OpenClaw Gateway 使用挑战-响应机制进行认证，支持多种认证方式：

- **Token 认证** - 预共享密钥
- **Password 认证** - 用户名密码
- **设备身份认证** - Ed25519 密钥对签名
- **Tailscale 认证** - 基于 Tailscale 身份

## 连接生命周期

### 状态机

```
disconnected → connecting → connected → handshaked → [event loop]
     ↑                                              ↓
     └────────────── reconnect ←───────────────────┘
```

### 连接流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                        连接生命周期                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. WebSocket 连接建立                                               │
│     ws = new WebSocket(url)                                         │
│     ↓                                                                │
│  2. 接收 connect.challenge 事件                                      │
│     { type: "event", event: "connect.challenge",                    │
│       payload: { nonce: "xxx", ts: 1234567890 } }                   │
│     ↓                                                                │
│  3. 发送 connect 请求 (带设备身份签名)                                │
│     { type: "req", id: "connect-xxx", method: "connect",            │
│       params: { device: { ... }, auth: { token: "xxx" } } }         │
│     ↓                                                                │
│  4. 接收 hello-ok 响应                                               │
│     { type: "res", ok: true,                                        │
│       payload: { type: "hello-ok", features: {...}, ... } }         │
│     ↓                                                                │
│  5. 连接成功，开始接收事件                                            │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 源码解读

**客户端连接实现** (`src/gateway/client.ts`):

```typescript
async connect(url: string, token?: string): Promise<void> {
  this.url = url
  this.token = token
  
  return new Promise((resolve, reject) => {
    // 1. 建立 WebSocket 连接
    this.ws = new WebSocket(url, this.wsOptions)
    
    // 2. 监听连接打开
    this.ws.on('open', () => {
      console.log('[RpcClient] WebSocket connected')
      // 等待 connect.challenge
      this.armConnectChallengeTimeout()
    })
    
    // 3. 监听消息
    this.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      this.handleMessage(msg, resolve, reject)
    })
    
    // 4. 监听错误
    this.ws.on('error', (err) => {
      reject(err)
    })
  })
}

private handleMessage(data: unknown, resolve, reject) {
  // 处理 connect.challenge
  if (data.event === 'connect.challenge') {
    this.connectNonce = data.payload.nonce
    this.sendConnect(resolve, reject)
    return
  }
  
  // 处理 hello-ok
  if (data.type === 'res' && data.payload?.type === 'hello-ok') {
    this._handshaked = true
    resolve()
    return
  }
  
  // 分发其他消息
  for (const handler of this.messageHandlers) {
    handler(data)
  }
}
```

## 设备身份认证

### 密钥对生成

**源码位置**: `src/infra/device-identity.ts`

```typescript
import { generateKeyPairSync } from 'crypto'

interface DeviceIdentity {
  deviceId: string       // 设备唯一 ID
  publicKeyPem: string   // PEM 格式公钥
  privateKeyPem: string  // PEM 格式私钥
  createdAt: number      // 创建时间
}

function generateDeviceIdentity(): DeviceIdentity {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  
  return {
    deviceId: randomUUID(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    createdAt: Date.now()
  }
}
```

### 签名生成

```typescript
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

### Device Block 结构

```typescript
type DeviceBlock = {
  deviceId: string
  clientId: string        // 客户端名称
  clientMode: 'backend' | 'webchat' | 'cli'
  role: 'operator' | 'agent'
  scopes: string[]        // 权限范围
  signedAtMs: number      // 签名时间
  token?: string          // 认证令牌
  nonce: string           // 挑战随机数
  signature: string       // Ed25519 签名
}
```

### 发送 Connect 请求

```typescript
private sendConnect(resolve, reject) {
  const device = createDeviceBlock({
    deviceId: this.deviceIdentity.deviceId,
    clientId: 'my-client',
    clientMode: 'backend',
    role: 'operator',
    scopes: ['operator.admin', 'operator.read', 'operator.write'],
    token: this.token,
    nonce: this.connectNonce,
  })
  
  const params = {
    minProtocol: 3,
    maxProtocol: 3,
    client: {
      id: 'my-client',
      version: '1.0.0',
      platform: process.platform,
      mode: 'backend',
    },
    role: 'operator',
    scopes: ['operator.admin', 'operator.read', 'operator.write'],
    auth: { token: this.token },
    device,
  }
  
  this.call('connect', params).then(resolve).catch(reject)
}
```

## 认证模式

### 模式对比

| 模式                | 说明           | 适用场景         | 安全级别 |
| ----------------- | ------------ | ------------ | ---- |
| `none`            | 无认证          | 仅本地回环地址      | 低    |
| `token`           | Token 认证     | 服务间通信        | 中    |
| `password`        | 密码认证         | 用户登录         | 中    |
| `device-token`    | 设备令牌         | 已配对设备        | 高    |
| `bootstrap-token` | 引导令牌         | 首次配对         | 高    |
| `trusted-proxy`   | 信任代理         | Tailscale 环境 | 高    |
| `tailscale`       | Tailscale 认证 | Tailscale 网络 | 高    |

### 认证流程

**源码位置**: `src/gateway/auth.ts`

```typescript
async function authenticate(params: ConnectParams): Promise<GatewayAuthResult> {
  // 1. 检查认证模式
  const mode = resolveAuthMode(params, config)
  
  switch (mode) {
    case 'none':
      // 仅允许本地回环
      if (!isLoopback(clientIp)) {
        return { ok: false, reason: 'Auth required for non-loopback' }
      }
      return { ok: true, method: 'none' }
      
    case 'token':
      // Token 验证
      if (params.auth?.token !== config.auth.token) {
        return { ok: false, reason: 'Invalid token' }
      }
      return { ok: true, method: 'token' }
      
    case 'password':
      // 密码验证
      const valid = await verifyPassword(params.auth.password, config.auth.passwordHash)
      if (!valid) {
        return { ok: false, reason: 'Invalid password' }
      }
      return { ok: true, method: 'password', user: params.auth.username }
      
    case 'device-token':
      // 设备身份验证
      const deviceValid = verifyDeviceSignature(params.device)
      if (!deviceValid) {
        return { ok: false, reason: 'Invalid device signature' }
      }
      return { 
        ok: true, 
        method: 'device-token',
        scopes: params.device.scopes 
      }
      
    default:
      return { ok: false, reason: 'Unknown auth mode' }
  }
}
```

## 权限控制

### Scope 定义

| Scope                | 说明   | 权限范围                                         |
| -------------------- | ---- | -------------------------------------------- |
| `operator.admin`     | 完全访问 | 所有方法                                         |
| `operator.read`      | 只读访问 | sessions.list, models.list, health 等         |
| `operator.write`     | 写入权限 | sessions.create, chat.send, sessions.patch 等 |
| `operator.approvals` | 审批权限 | exec.approval.*, plugin.approval.*           |
| `operator.pairing`   | 配对权限 | node.pair.*, device.pair.*                   |

### 方法权限检查

**源码位置**: `src/gateway/method-scopes.ts`

```typescript
const methodScopes: Record<string, string> = {
  // 只读方法
  'sessions.list': 'operator.read',
  'models.list': 'operator.read',
  'health': 'operator.read',
  'config.get': 'operator.read',
  
  // 写入方法
  'sessions.create': 'operator.write',
  'sessions.delete': 'operator.write',
  'chat.send': 'operator.write',
  'sessions.patch': 'operator.write',
  
  // 管理方法
  'agents.create': 'operator.admin',
  'agents.delete': 'operator.admin',
  'config.set': 'operator.admin',
  
  // 审批方法
  'exec.approval.resolve': 'operator.approvals',
  'plugin.approval.resolve': 'operator.approvals',
  
  // 配对方法
  'node.pair.approve': 'operator.pairing',
  'device.pair.approve': 'operator.pairing',
}

function authorizeMethod(method: string, scopes: string[]): { allowed: boolean; missingScope?: string } {
  const required = methodScopes[method]
  if (!required) return { allowed: true }
  
  if (!scopes.includes(required)) {
    return { allowed: false, missingScope: required }
  }
  
  return { allowed: true }
}
```

## HelloOk 响应

### 结构定义

```typescript
type HelloOk = {
  type: 'hello-ok'
  protocol: number           // 协议版本 (当前为 3)
  server: {
    version: string          // 服务器版本
    connId: string           // 连接 ID
  }
  features: {
    methods: string[]        // 支持的方法列表 (140+)
    events: string[]         // 支持的事件列表 (24)
  }
  snapshot: {
    presence: PresenceEntry[]  // 在线节点
    health: HealthSnapshot     // 健康状态
    stateVersion: {
      presence: number
      health: number
    }
  }
  policy: {
    maxPayload: number       // 最大消息大小 (26MB)
    maxBufferedBytes: number // 最大缓冲字节 (52MB)
    tickIntervalMs: number   // 心跳间隔 (30s)
  }
  auth?: {
    deviceToken?: string     // 设备令牌（用于后续连接）
    role?: string            // 角色
    scopes?: string[]        // 授权范围
  }
}
```

### 示例响应

```json
{
  "type": "res",
  "id": "connect-1234567890",
  "ok": true,
  "payload": {
    "type": "hello-ok",
    "protocol": 3,
    "server": {
      "version": "2026.4.12",
      "connId": "conn-abc123"
    },
    "features": {
      "methods": ["sessions.list", "chat.send", "models.list", ...],
      "events": ["agent", "chat", "health", "tick", ...]
    },
    "snapshot": {
      "presence": [
        { "host": "my-pc", "mode": "gateway", "instanceId": "inst-1" }
      ],
      "health": { "ok": true, "agents": [...] }
    },
    "policy": {
      "maxPayload": 26214400,
      "maxBufferedBytes": 52428800,
      "tickIntervalMs": 30000
    },
    "auth": {
      "deviceToken": "dt-xyz789",
      "role": "operator",
      "scopes": ["operator.admin", "operator.read", "operator.write"]
    }
  }
}
```

### 客户端处理

```typescript
function handleHelloOk(helloOk: HelloOk) {
  // 1. 保存设备令牌
  if (helloOk.auth?.deviceToken) {
    saveDeviceToken(helloOk.auth.deviceToken)
  }
  
  // 2. 记录支持的特性
  this.supportedMethods = new Set(helloOk.features.methods)
  this.supportedEvents = new Set(helloOk.features.events)
  
  // 3. 处理快照
  this.presence = helloOk.snapshot.presence
  this.health = helloOk.snapshot.health
  
  // 4. 设置策略
  this.maxPayload = helloOk.policy.maxPayload
  this.tickInterval = helloOk.policy.tickIntervalMs
  
  // 5. 标记握手完成
  this._handshaked = true
}
```

