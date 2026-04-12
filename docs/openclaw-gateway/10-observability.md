# 可观测性

> **本文档引用的源码文件**
> - `src/gateway/server-methods/observability.ts` - 可观测性方法

## 目录

1. [简介](#简介)
2. [统计数据](#统计数据)
3. [会话监控](#会话监控)
4. [操作记录](#操作记录)
5. [指标系统](#指标系统)
6. [告警系统](#告警系统)

## 简介

Gateway 提供完整的可观测性支持：

- **统计数据** - 系统运行统计
- **会话监控** - 会话状态追踪
- **操作记录** - 用户操作审计
- **指标系统** - 性能指标收集
- **告警系统** - 异常告警

## 统计数据

### observability.stats

获取系统统计数据。

```typescript
type ObservabilityStatsResponse = {
  uptime: number              // 运行时间（秒）
  connections: number         // 当前连接数
  totalSessions: number       // 总会话数
  activeSessions: number      // 活跃会话数
  totalMessages: number       // 总消息数
  totalTokens: {              // Token 统计
    input: number
    output: number
  }
  models: Record<string, {    // 模型使用统计
    calls: number
    tokens: { input: number; output: number }
  }>
}
```

### 示例

```typescript
const stats = await rpc.call('observability.stats')

console.log('Uptime:', stats.uptime, 'seconds')
console.log('Active sessions:', stats.activeSessions)
console.log('Total tokens:', stats.totalTokens)
```

## 会话监控

### observability.sessions

获取会话监控数据。

```typescript
type ObservabilitySessionsResponse = {
  sessions: SessionMonitorInfo[]
}

type SessionMonitorInfo = {
  sessionKey: string
  agentId: string
  status: 'idle' | 'running' | 'error'
  lastActivity: number
  messageCount: number
  tokens: { input: number; output: number }
  currentRun?: {
    runId: string
    startTime: number
    status: 'running' | 'waiting'
  }
}
```

### observability.session.tree

获取会话树结构。

```typescript
type SessionTreeNode = {
  sessionKey: string
  children: SessionTreeNode[]
  status: 'idle' | 'running'
}
```

### observability.session.graph

获取会话关系图。

```typescript
type SessionGraph = {
  nodes: Array<{ id: string; type: 'main' | 'dashboard' | 'subagent' }>
  edges: Array<{ from: string; to: string; type: 'parent' | 'spawned' }>
}
```

## 操作记录

### observability.actions

获取操作记录。

```typescript
type ObservabilityActionsParams = {
  limit?: number
  agentId?: string
  action?: string
  startTime?: number
  endTime?: number
}

type ObservabilityActionsResponse = {
  actions: ActionRecord[]
}

type ActionRecord = {
  id: string
  timestamp: number
  agentId: string
  action: string
  params: Record<string, unknown>
  result: 'success' | 'failure'
  duration: number
  error?: string
}
```

### 示例

```typescript
const actions = await rpc.call('observability.actions', {
  limit: 100,
  agentId: 'main',
  startTime: Date.now() - 24 * 60 * 60 * 1000  // 最近 24 小时
})

for (const action of actions.actions) {
  console.log(`${action.timestamp} [${action.agentId}] ${action.action} - ${action.result}`)
}
```

## 指标系统

### observability.metrics.overview

获取指标概览。

```typescript
type MetricsOverview = {
  cpu: number              // CPU 使用率
  memory: {                // 内存使用
    used: number
    total: number
  }
  network: {               // 网络统计
    bytesIn: number
    bytesOut: number
  }
  latency: {               // 延迟统计
    p50: number
    p95: number
    p99: number
  }
  throughput: {            // 吞吐量
    requestsPerSecond: number
    messagesPerSecond: number
  }
}
```

### observability.metrics.series

获取指标时间序列。

```typescript
type MetricsSeriesParams = {
  metric: 'cpu' | 'memory' | 'latency' | 'throughput'
  startTime: number
  endTime: number
  interval: number  // 采样间隔（秒）
}

type MetricsSeriesResponse = {
  points: Array<{ timestamp: number; value: number }>
}
```

## 告警系统

### observability.alerts

获取告警列表。

```typescript
type ObservabilityAlertsResponse = {
  alerts: Alert[]
}

type Alert = {
  id: string
  timestamp: number
  severity: 'info' | 'warning' | 'error' | 'critical'
  type: string
  message: string
  details: Record<string, unknown>
  acknowledged: boolean
  acknowledgedBy?: string
  acknowledgedAt?: number
}
```

### observability.alerts.updateStatus

更新告警状态。

```typescript
type UpdateAlertStatusParams = {
  alertId: string
  acknowledged: boolean
}
```

### observability.session.alerts

获取会话相关告警。

```typescript
type SessionAlertsParams = {
  sessionKey: string
}

type SessionAlertsResponse = {
  alerts: Alert[]
}
```

