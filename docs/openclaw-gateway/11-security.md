# 安全机制

> **本文档引用的源码文件**
> - `src/gateway/auth.ts` - 认证逻辑
> - `src/gateway/auth-rate-limit.ts` - 速率限制
> - `src/gateway/control-plane-audit.ts` - 审计日志

## 目录

1. [简介](#简介)
2. [安全检查](#安全检查)
3. [TLS 指纹验证](#tls-指纹验证)
4. [速率限制](#速率限制)
5. [审计日志](#审计日志)
6. [安全配置](#安全配置)

## 简介

Gateway 采用多层安全机制：

- **传输安全** - TLS 加密、指纹验证
- **认证安全** - 多种认证方式、速率限制
- **授权安全** - Scope 权限控制
- **审计安全** - 操作日志记录

## 安全检查

### 明文连接检查

Gateway 默认禁止明文 WebSocket 连接到非回环地址：

```typescript
// 源码: src/gateway/client.ts
function checkSecureConnection(url: string, options: { allowPrivateWs?: boolean }) {
  if (url.startsWith('ws://') && !url.includes('localhost') && !url.includes('127.0.0.1')) {
    if (!options.allowPrivateWs) {
      throw new Error(
        'SECURITY ERROR: Cannot connect over plaintext ws://. ' +
        'Use wss:// for remote URLs. ' +
        'Safe defaults: keep gateway.bind=loopback and connect via SSH tunnel.'
      )
    }
  }
}
```

### 安全默认值

```typescript
type SecurityDefaults = {
  // 绑定地址
  bind: 'loopback' | 'all'  // 默认 loopback
  
  // 认证模式
  authMode: 'none' | 'token' | 'password'  // 默认 none（仅 loopback）
  
  // TLS
  tls: {
    enabled: boolean           // 默认 false
    cert?: string
    key?: string
  }
}
```

## TLS 指纹验证

### 验证流程

```typescript
// 源码: src/gateway/client.ts
function setupTlsVerification(wsOptions: WebSocket.ClientOptions, fingerprint: string) {
  wsOptions.rejectUnauthorized = false
  wsOptions.checkServerIdentity = (host: string, cert: PeerCertificate) => {
    const actualFingerprint = normalizeFingerprint(cert.fingerprint256)
    const expectedFingerprint = normalizeFingerprint(fingerprint)
    
    if (actualFingerprint !== expectedFingerprint) {
      return new Error('gateway tls fingerprint mismatch')
    }
    
    return undefined  // 验证通过
  }
}

function normalizeFingerprint(fp: string): string {
  return fp.replace(/:/g, '').toLowerCase()
}
```

### 使用示例

```typescript
// 连接时指定 TLS 指纹
const client = new GatewayClient({
  url: 'wss://gateway.example.com',
  tlsFingerprint: 'A1:B2:C3:D4:...'  // 服务器证书指纹
})

await client.connect()
```

### 获取指纹

```bash
# 使用 openssl 获取证书指纹
openssl s_client -connect gateway.example.com:443 | \
  openssl x509 -fingerprint -sha256 -noout

# 输出
SHA256 Fingerprint=A1:B2:C3:D4:E5:F6:...
```

## 速率限制

### 配置

```typescript
type RateLimitConfig = {
  enabled: boolean
  maxAttempts: number       // 最大尝试次数，默认 5
  windowMs: number           // 时间窗口，默认 60000 (1分钟)
  blockDurationMs: number    // 封禁时长，默认 300000 (5分钟)
}
```

### 实现

```typescript
// 源码: src/gateway/auth-rate-limit.ts
class AuthRateLimiter {
  private attempts = new Map<string, number[]>()
  private blocked = new Map<string, number>()
  
  check(params: { clientIp: string; scope?: string }): RateLimitCheckResult {
    const { clientIp } = params
    
    // 检查是否被封禁
    const blockedUntil = this.blocked.get(clientIp)
    if (blockedUntil && blockedUntil > Date.now()) {
      return {
        allowed: false,
        retryAfterMs: blockedUntil - Date.now()
      }
    }
    
    // 清理过期记录
    this.cleanup(clientIp)
    
    // 检查尝试次数
    const attempts = this.attempts.get(clientIp) || []
    if (attempts.length >= this.config.maxAttempts) {
      // 封禁
      this.blocked.set(clientIp, Date.now() + this.config.blockDurationMs)
      return {
        allowed: false,
        retryAfterMs: this.config.blockDurationMs
      }
    }
    
    return { allowed: true }
  }
  
  record(clientIp: string): void {
    const attempts = this.attempts.get(clientIp) || []
    attempts.push(Date.now())
    this.attempts.set(clientIp, attempts)
  }
  
  reset(clientIp: string): void {
    this.attempts.delete(clientIp)
    this.blocked.delete(clientIp)
  }
}
```

### 认证失败处理

```typescript
async function handleAuth(params: AuthParams, clientIp: string): Promise<AuthResult> {
  const rateCheck = rateLimiter.check({ clientIp })
  
  if (!rateCheck.allowed) {
    return {
      ok: false,
      reason: `Rate limited. Retry after ${Math.ceil(rateCheck.retryAfterMs! / 1000)} seconds`,
      rateLimited: true,
      retryAfterMs: rateCheck.retryAfterMs
    }
  }
  
  const result = await authenticate(params)
  
  if (!result.ok) {
    rateLimiter.record(clientIp)
  } else {
    rateLimiter.reset(clientIp)
  }
  
  return result
}
```

## 审计日志

### 日志结构

```typescript
type AuditLogEntry = {
  timestamp: number          // 时间戳
  actor: string              // 操作者（用户/设备）
  action: string             // 操作类型
  resource: string           // 资源标识
  result: 'success' | 'failure'
  details?: object           // 详细信息
  ip?: string                // 客户端 IP
  userAgent?: string         // User-Agent
  sessionId?: string         // 会话 ID
}
```

### 审计事件类型

```typescript
type AuditAction = 
  // 认证相关
  | 'auth.login'
  | 'auth.logout'
  | 'auth.failed'
  | 'auth.token.refresh'
  
  // 会话相关
  | 'session.create'
  | 'session.delete'
  | 'session.reset'
  
  // Agent 相关
  | 'agent.create'
  | 'agent.delete'
  | 'agent.config.change'
  
  // 配置相关
  | 'config.change'
  
  // 审批相关
  | 'approval.granted'
  | 'approval.denied'
  
  // 配对相关
  | 'pairing.requested'
  | 'pairing.approved'
  | 'pairing.rejected'
```

### 日志记录

```typescript
// 源码: src/gateway/control-plane-audit.ts
class AuditLogger {
  private logPath: string
  
  log(entry: AuditLogEntry): void {
    const logLine = JSON.stringify(entry) + '\n'
    appendFileSync(this.logPath, logLine)
  }
  
  logAuth(params: { action: AuditAction; actor: string; ip: string; result: 'success' | 'failure' }) {
    this.log({
      timestamp: Date.now(),
      actor: params.actor,
      action: params.action,
      resource: 'auth',
      result: params.result,
      ip: params.ip
    })
  }
  
  logSession(params: { action: AuditAction; actor: string; sessionKey: string; result: 'success' | 'failure' }) {
    this.log({
      timestamp: Date.now(),
      actor: params.actor,
      action: params.action,
      resource: params.sessionKey,
      result: params.result
    })
  }
}
```

## 安全配置

### 完整配置

```typescript
type SecurityConfig = {
  // 认证配置
  auth: {
    mode: 'none' | 'token' | 'password' | 'trusted-proxy'
    token?: string
    passwordHash?: string  // bcrypt hash
  }
  
  // 速率限制
  rateLimit: {
    enabled: boolean
    maxAttempts: number
    windowMs: number
    blockDurationMs: number
  }
  
  // TLS 配置
  tls: {
    enabled: boolean
    cert?: string      // 证书路径
    key?: string       // 私钥路径
    fingerprint?: string
  }
  
  // 审计配置
  audit: {
    enabled: boolean
    logPath?: string
    retentionDays: number
  }
  
  // 绑定配置
  bind: 'loopback' | 'all'
}
```

### 配置示例

```json
{
  "auth": {
    "mode": "token",
    "token": "your-secure-token-here"
  },
  "rateLimit": {
    "enabled": true,
    "maxAttempts": 5,
    "windowMs": 60000,
    "blockDurationMs": 300000
  },
  "tls": {
    "enabled": true,
    "cert": "/etc/ssl/cert.pem",
    "key": "/etc/ssl/key.pem"
  },
  "audit": {
    "enabled": true,
    "logPath": "/var/log/openclaw/audit.log",
    "retentionDays": 30
  },
  "bind": "loopback"
}
```

### 最佳实践

1. **生产环境**：
   - 使用 `token` 或 `password` 认证
   - 启用 TLS
   - 启用速率限制
   - 启用审计日志
   - 绑定到 `loopback`，通过反向代理暴露

2. **开发环境**：
   - 可以使用 `none` 认证（仅限本地）
   - 不需要 TLS
   - 可以禁用速率限制

3. **远程访问**：
   - 使用 SSH 隧道
   - 或使用 Tailscale
   - 或使用 TLS + 认证
