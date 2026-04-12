# openclaw-thinking

实时思考阶段追踪插件 - 填补 WebSocket 事件盲区，提供细粒度阶段状态追踪。

## 功能特性

- **填补盲区**：捕获 WebSocket 不可见的阶段（模型解析、Prompt 构建、LLM 连接）
- **实时推送**：通过 Gateway Method 或 SSE 将阶段状态推送给客户端
- **超时检测**：自动检测阶段超时并发出警告
- **模块化设计**：各功能模块可独立启用/禁用

## 安装

### 推荐：使用 OpenClaw CLI 安装

```bash
# 安装本地插件（链接模式，方便开发）
openclaw plugins install --link /path/to/openclaw-thinking

# 或者复制模式（独立安装）
openclaw plugins install /path/to/openclaw-thinking
```

### 链接模式 vs 复制模式

| 模式 | 命令 | 说明 |
|------|------|------|
| **链接模式** | `--link` | 直接从源目录加载，修改源码后直接生效 |
| **复制模式** | 无 `--link` | 复制到 extensions 目录，独立安装 |

## 配置

使用 `openclaw plugins install` 安装后，配置会自动写入 `~/.openclaw/openclaw.json`，无需手动配置。

如需自定义配置，可在 `~/.openclaw/openclaw.json` 的 `plugins.entries.openclaw-thinking.config` 中修改：

```json
{
  "plugins": {
    "entries": {
      "openclaw-thinking": {
        "enabled": true,
        "config": {
          "modules": {
            "phaseTracking": true,
            "realtimeBroadcast": true,
            "storage": false,
            "security": false,
            "webDashboard": false
          },
          "broadcast": {
            "mode": "gateway_method"
          },
          "timeouts": {
            "model_resolving": 5000,
            "prompt_building": 10000,
            "llm_connecting": 30000
          }
        }
      }
    }
  }
}
```

### 配置说明

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `modules.phaseTracking` | 启用阶段追踪 | `true` |
| `modules.realtimeBroadcast` | 启用实时广播 | `true` |
| `broadcast.mode` | 广播模式：`gateway_method`、`sse`、`both` | `gateway_method` |
| `timeouts.*` | 各阶段超时时间（毫秒） | 见下表 |

### 阶段超时默认值

| 阶段 | 超时时间 | 说明 |
|------|----------|------|
| `model_resolving` | 5s | 模型解析 |
| `prompt_building` | 10s | Prompt 构建 |
| `llm_connecting` | 30s | LLM 连接 |
| `llm_first_token` | 60s | 等待首个 Token |
| `thinking` | 120s | 思考中 |
| `generating` | 60s | 生成回复 |
| `tool_calling` | 30s | 工具调用 |
| `tool_executing` | 120s | 工具执行 |

## 客户端使用

### 方式 1：SSE 订阅（推荐）

实时推送阶段变更，无需轮询。

```typescript
const es = new EventSource('/plugins/thinking/api/phase/stream?sessionId=xxx')

// 阶段变更事件
es.addEventListener('phase_change', (e) => {
  const state = JSON.parse(e.data)
  console.log(`Phase: ${state.phase}, Elapsed: ${state.phaseElapsedTime}ms`)
})

// 心跳事件
es.addEventListener('heartbeat', (e) => {
  console.log('Heartbeat:', JSON.parse(e.data).ts)
})
```

### 方式 2：Gateway Method

一次性查询当前状态，适合偶尔查询。

```typescript
// 获取单个会话的阶段状态
const phase = await adapter.callGatewayMethod('getThinkingPhase', { 
  sessionId: 'your-session-id' 
})

// 获取所有活动会话
const { sessions } = await adapter.callGatewayMethod('getActiveThinkingSessions')
```

### 方式 3：HTTP API

```typescript
// 获取阶段状态
const res = await fetch('/plugins/thinking/api/phase?sessionId=xxx')
const phase = await res.json()

// 响应示例
{
  "sessionId": "xxx",
  "phase": "thinking",
  "phaseStartTime": 1712934567890,
  "phaseElapsedTime": 2345,
  "previousPhase": "llm_connecting",
  "metadata": {
    "modelName": "claude-3.5-sonnet",
    "completedTools": []
  }
}
```

### React 组件示例

```tsx
import { useEffect, useState } from 'react'

interface PhaseState {
  sessionId: string
  phase: string
  phaseElapsedTime: number
  metadata: {
    modelName?: string
    currentTool?: { name: string }
  }
}

const PHASE_LABELS: Record<string, string> = {
  idle: '空闲',
  model_resolving: '模型解析中',
  prompt_building: '提示词构建中',
  llm_connecting: 'LLM 连接中',
  thinking: '思考中',
  generating: '生成回复中',
  tool_calling: '工具调用中',
  completed: '已完成',
}

export function ThinkingIndicator({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<PhaseState | null>(null)

  useEffect(() => {
    const es = new EventSource(`/plugins/thinking/api/phase/stream?sessionId=${sessionId}`)
    
    es.addEventListener('phase_change', (e) => {
      setState(JSON.parse(e.data))
    })

    return () => es.close()
  }, [sessionId])

  if (!state || state.phase === 'idle' || state.phase === 'completed') {
    return null
  }

  return (
    <div className="thinking-indicator">
      <span className="phase">{PHASE_LABELS[state.phase] || state.phase}</span>
      <span className="elapsed">{Math.round(state.phaseElapsedTime / 1000)}s</span>
      {state.metadata.currentTool && (
        <span className="tool">🔧 {state.metadata.currentTool.name}</span>
      )}
    </div>
  )
}
```

## 阶段说明

### 盲区阶段（WebSocket 不可见）

| 阶段 | 触发 Hook | 说明 |
|------|-----------|------|
| `model_resolving` | `before_model_resolve` | 模型解析中 |
| `prompt_building` | `before_prompt_build` | Prompt 构建中 |
| `llm_connecting` | `llm_input` | LLM 连接建立中 |
| `llm_first_token` | `lifecycle.start` | 等待首个 Token |

### 可见阶段（WebSocket 可见）

| 阶段 | 触发事件 | 说明 |
|------|----------|------|
| `thinking` | `assistant (thinking)` | 思考中 |
| `generating` | `assistant (delta)` | 生成回复中 |
| `tool_calling` | `tool.start` | 工具调用中 |
| `tool_executing` | `after_tool_call` | 工具执行中 |
| `tool_complete` | `tool.result` | 工具完成 |

### 终态

| 阶段 | 说明 |
|------|------|
| `completed` | 完成 |
| `error` | 错误 |
| `cancelled` | 取消 |

## 与 openclaw-observability 的关系

| 特性 | openclaw-thinking | openclaw-observability |
|------|-------------------|------------------------|
| 实时阶段追踪 | ✅ | ❌ |
| 客户端可见 | ✅ | ❌ |
| 历史审计 | ❌（计划中） | ✅ |
| 安全扫描 | ❌（计划中） | ✅ |

**推荐**：两个插件同时启用，互补使用。

## 开发

```bash
# 安装依赖
npm install

# 编译
npm run build

# 监听模式
npm run dev
```

## License

MIT
