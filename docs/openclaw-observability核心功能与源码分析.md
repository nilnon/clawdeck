# openclaw-observability 核心功能与源码分析

openclaw plugins install openclaw-observability

## 一、项目概述

**openclaw-observability** 是 OpenClaw 平台的全栈可观测性插件，用于自动记录所有 LLM 调用、工具调用和 Agent 生命周期事件，并提供内置的 Web Dashboard 进行追踪、分析和安全审计。

### 基本信息

- **版本**: 2026.4.1
- **入口文件**: `dist/index.js`
- **许可证**: MIT
- **核心依赖**:
  - `@duckdb/node-api` - 嵌入式 DuckDB 数据库
  - `mysql2` - MySQL 连接池
  - `@opentelemetry/otlp-transformer` - OTLP 指标处理
  - `protobufjs` - Protocol Buffers 解析

***

## 二、核心功能

### 2.1 全链路追踪 (Full-Chain Tracing)

插件注册了 **24 个 OpenClaw Hooks**，覆盖完整的 Agent 生命周期：

| Hook 类别      | Hook 名称                | 说明         |
| ------------ | ---------------------- | ---------- |
| **Agent**    | `before_model_resolve` | 模型解析前      |
| <br />       | `before_prompt_build`  | Prompt 构建前 |
| <br />       | `agent_end`            | Agent 结束   |
| **LLM**      | `llm_input`            | LLM 输入     |
| <br />       | `llm_output`           | LLM 输出     |
| **Tool**     | `before_tool_call`     | 工具调用前      |
| <br />       | `after_tool_call`      | 工具调用后      |
| <br />       | `tool_result_persist`  | 工具结果持久化    |
| **Message**  | `message_received`     | 消息接收       |
| <br />       | `message_sending`      | 消息发送中      |
| <br />       | `message_sent`         | 消息已发送      |
| <br />       | `before_message_write` | 消息写入前      |
| **Context**  | `before_compaction`    | 上下文压缩前     |
| <br />       | `after_compaction`     | 上下文压缩后     |
| <br />       | `before_reset`         | 重置前        |
| **Session**  | `session_start`        | 会话开始       |
| <br />       | `session_end`          | 会话结束       |
| **Subagent** | `subagent_spawned`     | 子 Agent 创建 |
| <br />       | `subagent_ended`       | 子 Agent 结束 |
| **Gateway**  | `gateway_start`        | 网关启动       |
| <br />       | `gateway_stop`         | 网关停止       |

### 2.2 Token 使用追踪

通过 **Fetch 拦截器** 自动注入 `stream_options`，从任意 OpenAI 兼容 API 的 SSE 响应中捕获：

- `prompt_tokens` - 输入 Token 数
- `completion_tokens` - 输出 Token 数
- `cache_read` / `cache_write` - 缓存命中统计

### 2.3 双存储后端

| 模式           | 后端                 | 特点             |
| ------------ | ------------------ | -------------- |
| `local` (默认) | 嵌入式 DuckDB         | 零配置，开箱即用       |
| `remote`     | MySQL 5.7+/8.x/RDS | 支持远程数据库，适合生产环境 |

### 2.4 内置 Web Dashboard

提供四个核心页面：

- **Dashboard (Traces)** - 会话列表、瀑布图追踪视图、输入输出检查器
- **Analytics** - KPI 概览、时间序列图表、Token 使用分布、模型使用统计
- **Security** - 安全告警列表、告警生命周期管理
- **Metrics** - OTLP 指标可视化

### 2.5 安全扫描引擎

#### L1 规则引擎 (模式匹配)

实时扫描 15+ 规则：

| 规则 ID | 检测内容                                 | 严重级别             |
| ----- | ------------------------------------ | ---------------- |
| S001  | 阿里云 AccessKey 泄露                     | Critical         |
| S002  | AWS AccessKey 泄露                     | Critical         |
| S003  | 私钥泄露 (RSA/EC/SSH)                    | Critical         |
| S004  | JWT Token 泄露                         | Warning          |
| S005  | 数据库连接字符串泄露                           | Warning          |
| S006  | 通用 API Key 泄露                        | Warning          |
| S007  | GCP 服务账号密钥                           | Critical         |
| S008  | Azure 连接字符串泄露                        | Critical         |
| H001  | 危险 Shell 命令 (`rm -rf`, `curl \| sh`) | Critical         |
| H002  | 敏感文件路径访问 (`.ssh/`, `.env`)           | Warning          |
| H003  | 异常大数据输出 (>100KB)                     | Warning          |
| H004  | 批量环境变量访问                             | Warning          |
| H005  | 权限提升 (`sudo`, `su -`)                | Critical         |
| T003  | 外部网络请求 (非白名单域名)                      | Warning          |
| T005  | Prompt 注入攻击模式                        | Warning/Critical |

#### L2 行为链检测

跨动作行为分析：

| 链 ID      | 模式              | 严重级别     |
| --------- | --------------- | -------- |
| CHAIN-001 | 读取敏感文件 → 外发网络请求 | Critical |
| CHAIN-002 | 工具返回注入 → 执行敏感操作 | Critical |

### 2.6 自动脱敏

在存储前自动屏蔽敏感字段：

- API Key、密码、Token
- 私钥、凭证信息
- 支持自定义正则模式

### 2.7 异步批量缓冲

- 可配置批量大小 (`batchSize`)
- 可配置刷新间隔 (`flushIntervalMs`)
- 溢出保护机制

***

## 三、架构设计

```
OpenClaw Gateway
  │
  ├── Plugin Hooks (24 hooks)
  │     ├── llm_input / llm_output
  │     ├── before_tool_call / after_tool_call
  │     ├── session_start / session_end
  │     └── ... (agent, message, context, gateway)
  │
  ├── Fetch Interceptor
  │     └── 注入 stream_options → 解析 SSE usage
  │
  ├── Security Scanner
  │     ├── L1: Pattern rules (15+ rules)
  │     └── L2: Chain detector (2 chains)
  │
  ├── Async Batch Buffer
  │     └── batchSize / flushIntervalMs / overflow protection
  │
  ├── Storage Writer
  │     ├── DuckDBLocalWriter (local mode)
  │     └── MySQLWriter (remote mode)
  │
  └── Web Dashboard
        ├── GET /plugins/observability/          → SPA UI
        ├── GET /plugins/observability/api/stats
        ├── GET /plugins/observability/api/sessions
        ├── GET /plugins/observability/api/actions
        ├── GET /plugins/observability/api/alerts
        └── GET /plugins/observability/api/analytics
```

***

## 四、模块详解

### 4.1 入口模块 (`index.ts`)

**职责**: 插件组装，注册所有 Hooks，组装 capture → buffer → writer 管道

```typescript
interface PluginAPI {
    id: string;
    name: string;
    version: string;
    config?: Record<string, unknown>;
    pluginConfig?: Partial<AuditPluginConfig>;
    on(slot: string, handler: (...args: unknown[]) => unknown): void;
    registerHttpRoute?: (params: {...}) => void;
    registerGatewayMethod?: (method: string, handler: (...) => void) => void;
    runtime?: {
        events?: {
            onAgentEvent?: (listener: (evt: {...}) => void) => (() => void) | void;
        };
    };
}

declare function activate(api: PluginAPI): {
    deactivate: () => Promise<void>;
};
```

### 4.2 Hooks 模块 (`hooks/`)

#### `messages.ts` - 消息相关 Hooks

- `message_received` - 用户消息接收
- `message_sending` - 消息发送中
- `message_sent` - 消息已发送
- `before_message_write` - 消息写入前
- `llm_input` / `llm_output` - LLM 调用

#### `tools.ts` - 工具相关 Hooks

- `before_tool_call` - 工具调用前 (记录开始时间)
- `after_tool_call` - 工具调用后 (计算耗时)
- `tool_result_persist` - 工具结果持久化

#### `session.ts` - 会话相关 Hooks

- `session_start` - 会话开始 (初始化上下文)
- `session_end` - 会话结束 (刷新缓冲区)

#### `subagent.ts` - 子 Agent Hooks

- `subagent_spawned` - 子 Agent 创建
- `subagent_ended` - 子 Agent 结束

### 4.3 Runtime 模块 (`runtime/`)

#### `session-context.ts` - 会话上下文管理

```typescript
interface SessionContext {
    sessionId: string;
    userId: string;
    modelName: string;
    channelId: string;
}

interface ChannelContext {
    channelId?: string;
    channel?: string;
    messageProvider?: string;
    trigger?: string;
}
```

核心函数：

- `getSessionCtx(sessionId)` - 获取会话上下文
- `identifyChannel(ctx, metadata)` - 识别渠道
- `resolveSessionId()` / `resolveSessionIdWithRun()` - 解析会话 ID

#### `fetch-interceptor.ts` - Fetch 拦截器

```typescript
interface ConsumedUsage {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
    timestamp: number;
}
```

核心功能：

- `installFetchInterceptor()` - 安装全局 fetch 拦截
- `consumeSseUsageForRun()` - 从 SSE 缓存消费 usage 数据
- `computePromptFingerprint()` - 计算 Prompt 指纹

#### `payload-sanitizer.ts` - 载荷清理

```typescript
function sanitizePayloadForStorage(value: unknown, options?: {
    maxDepth?: number;
    maxArrayLength?: number;
}): unknown;
```

#### `session-transcript.ts` - 会话转录

```typescript
interface SessionTranscriptSummary {
    sessionFile: string;
    header: { id, version, timestamp, cwd, parentSession };
    entryCount: number;
    typeCounts: Record<string, number>;
    messageRoleCounts: Record<string, number>;
    roots: number;
    orphans: number;
    maxDepth: number;
}
```

### 4.4 Storage 模块 (`storage/`)

#### `writer.ts` - 存储写入器接口

```typescript
interface AuditWriter {
    initialize(maxRetries?: number, retryDelayMs?: number): Promise<void>;
    ensureReady(): Promise<boolean>;
    writeBatch(entries: BufferEntry[]): Promise<void>;
    writeAlerts(alerts: SecurityAlert[]): Promise<void>;
    writeMetricSamples?(samples: MetricSample[]): Promise<void>;
    getPool(): QueryPool | null;
    close(): Promise<void>;
}
```

#### `buffer.ts` - 异步批量缓冲

```typescript
type BufferEntry = {
    type: 'action';
    data: AuditAction;
} | {
    type: 'session';
    data: AuditSession;
};

class AsyncBatchBuffer {
    add(entry: BufferEntry): Promise<void>;
    addAction(action: AuditAction): Promise<void>;
    addSession(session: AuditSession): Promise<void>;
    flush(): Promise<void>;
    shutdown(): Promise<void>;
}
```

#### `duckdb-local-writer.ts` - DuckDB 本地写入器

- 嵌入式 DuckDB，零配置
- 自动创建表结构
- WAL 恢复机制
- 应用层 ID 生成器 (避免 SEQUENCE 冲突)

#### `mysql-writer.ts` - MySQL 写入器

- 连接池管理
- 自动创建数据库和表
- 重试机制

### 4.5 Security 模块 (`security/`)

#### `scanner.ts` - 安全扫描器

```typescript
interface SecurityConfig {
    customRegexRules: Array<{
        id: string;
        name: string;
        pattern: string;
        flags?: string;
        severity?: Severity;
        enabled?: boolean;
    }>;
    enabled: boolean;
    rules: {
        secretLeakage: boolean;
        highRiskOps: boolean;
        dataExfiltration: boolean;
        promptInjection: boolean;
        customRegex: boolean;
        chainDetection: boolean;
    };
    domainWhitelist: string[];
}

class SecurityScanner {
    scan(action: AuditAction): SecurityAlert[];
    getStats(): { scanned: number; alertsGenerated: number };
}
```

#### `rules.ts` - L1 规则定义

```typescript
interface SecurityRule {
    id: string;
    name: string;
    category: RuleCategory;
    severity: Severity;
    detect: (text: string, action: AuditAction, ctx?: RuleContext) => SecurityFinding[];
}
```

#### `chain-detector.ts` - L2 行为链检测

- 跨动作行为分析
- 检测敏感操作链

#### `types.ts` - 安全类型定义

```typescript
enum Severity { INFO, WARN, CRITICAL }
enum RuleCategory { 
    SecretLeakage, HighRiskOp, DataExfil, 
    PromptInjection, CustomRegex, SkillAnomaly 
}

interface SecurityAlert {
    alertId: string;
    sessionId: string;
    actionType: string;
    actionName: string;
    ruleId: string;
    ruleName: string;
    category: RuleCategory;
    severity: Severity;
    finding: string;
    context: string;
    status: 'open' | 'acknowledged' | 'resolved';
    userId: string;
    modelName: string;
    createdAt: Date;
}
```

### 4.6 Web 模块 (`web/`)

#### `routes.ts` - HTTP 路由注册

```typescript
function registerAuditRoutes(
    registerHttpRoute: RegisterHttpRoute,
    writer: AuditWriter,
    requiredToken: string | undefined,
    securityControl?: {
        getConfig: () => SecurityConfig;
        updateConfig: (patch: Partial<SecurityConfig>) => SecurityConfig;
    },
    metricsOptions?: {...}
): void;
```

#### `api.ts` - Web API 查询接口

```typescript
// 统计接口
function getStats(pool: QueryPool, params?: {...}): Promise<StatsResult>;

// 会话接口
function getSessions(pool: QueryPool, params: {...}): Promise<{sessions, total}>;
function getSessionActions(pool: QueryPool, sessionId: string, options?: {...}): Promise<ActionRow[]>;

// 告警接口
function getAlerts(pool: QueryPool, params: {...}): Promise<{alerts, total}>;
function getAlertStats(pool: QueryPool, params?: {...}): Promise<{...}>;
function updateAlertStatus(pool: QueryPool, alertId: string, status: string, resolvedBy?: string): Promise<boolean>;

// 分析接口
function getAnalytics(pool: QueryPool, params: {...}): Promise<AnalyticsResult>;

// 指标接口
function getMetricsOverview(pool: QueryPool, params?: {...}): Promise<MetricsOverviewResult>;
function getMetricSeries(pool: QueryPool, params: {...}): Promise<MetricSeriesResult>;
```

### 4.7 其他模块

#### `redaction.ts` - 敏感数据脱敏

```typescript
class Redactor {
    redact(value: unknown): unknown;
}
```

#### `llm/replay.ts` - LLM 回放功能

```typescript
interface ReplayRunParams {
    configPath: string;
    providerId?: string;
    model: string;
    userPrompt: string;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
}

function listReplayProviders(configPath: string): ReplayProviderInfo[];
function runReplayRequest(params: ReplayRunParams): Promise<ReplayRunResult>;
```

#### `gateway/register-observability-gateway.ts` - Gateway 方法注册

注册插件专用的 Gateway RPC 方法

#### `cloud/` - 云服务集成

- `auth.ts` - 认证
- `api-key-auth.ts` - API Key 认证
- `contracts.ts` - 契约定义
- `types.ts` - 类型定义

***

## 五、数据模型

### 5.1 ActionType 枚举

```typescript
enum ActionType {
    Message = "message",              // llm_output
    AssistantStream = "assistant_stream",  // runtime.events.onAgentEvent
    Thinking = "thinking",            // 推理进度
    ToolCall = "tool_call",           // after_tool_call
    ToolUpdate = "tool_update",       // 工具进度
    ToolPersist = "tool_persist",     // tool_result_persist
    ModelResolve = "model_resolve",   // before_model_resolve
    PromptBuild = "prompt_build",     // before_prompt_build
    AgentEnd = "agent_end",           // agent_end
    Compaction = "compaction",        // 上下文压缩
    Reset = "reset",                  // 重置
    UserMessage = "user_message",     // message_received
    MsgSending = "msg_sending",       // message_sending
    AssistantMsg = "assistant_msg",   // message_sent
    MsgWrite = "msg_write",           // before_message_write
    SessionStart = "session_start",   // session_start
    SessionEnd = "session_end",       // session_end
    SessionSnapshot = "session_snapshot", // 会话快照
    SubagentSpawn = "subagent_spawn", // subagent_spawned
    SubagentEnd = "subagent_end",     // subagent_ended
    GatewayStart = "gateway_start",   // gateway_start
    GatewayStop = "gateway_stop"      // gateway_stop
}
```

### 5.2 AuditAction - 审计动作记录

```typescript
interface AuditAction {
    sessionId: string;
    actionType: ActionType;
    actionName: string;
    modelName: string;
    inputParams: Record<string, unknown> | null;
    outputResult: Record<string, unknown> | null;
    promptTokens: number | null;
    completionTokens: number | null;
    durationMs: number | null;
    userId: string;
    channelId: string;
    createdAt: Date;
}
```

### 5.3 AuditSession - 会话摘要记录

```typescript
interface AuditSession {
    sessionId: string;
    userId: string;
    modelName: string;
    channelId: string;
    startTime: Date;
    endTime: Date | null;
    totalActions: number;
    totalTokens: number;
}
```

### 5.4 数据库表结构

插件自动创建三张表：

- **`audit_actions`** - 所有记录的动作
- **`audit_sessions`** - 会话摘要 (自动更新)
- **`audit_alerts`** - 安全告警记录

***

## 六、配置选项

### 6.1 完整配置 Schema

```typescript
interface AuditPluginConfig {
    mode: 'local' | 'remote';      // 存储模式
    duckdb: {
        path: string;              // DuckDB 文件路径
    };
    mysql: {
        host: string;              // MySQL 主机
        port: number;              // MySQL 端口
        user: string;              // 用户名
        password: string;          // 密码
        database: string;          // 数据库名
    };
    buffer: {
        batchSize: number;         // 批量写入阈值 (1-1000)
        flushIntervalMs: number;   // 刷新间隔 (1000-300000ms)
    };
    redaction: {
        enabled: boolean;          // 是否启用脱敏
        patterns: string[];        // 脱敏模式列表
    };
    security: {
        enabled: boolean;          // 是否启用安全扫描
        rules: {
            secretLeakage: boolean;
            highRiskOps: boolean;
            dataExfiltration: boolean;
            promptInjection: boolean;
            customRegex: boolean;
            chainDetection: boolean;
        };
        domainWhitelist: string[]; // 域名白名单
        customRegexRules: Array<{...}>;
    };
    ui: {
        accessToken?: string;      // 访问令牌
    };
    metrics: {
        enabled: boolean;          // 启用 OTLP 指标接收
        otlpPath: string;          // OTLP 路径
        maxPayloadBytes: number;   // 最大载荷大小
        retentionDays: number;     // 保留天数
    };
}
```

### 6.2 默认配置

```json
{
    "mode": "local",
    "duckdb": {
        "path": "~/.openclaw/data/observability.duckdb"
    },
    "mysql": {
        "host": "localhost",
        "port": 3306,
        "user": "root",
        "password": "",
        "database": "openclaw_observability"
    },
    "buffer": {
        "batchSize": 50,
        "flushIntervalMs": 5000
    },
    "redaction": {
        "enabled": true,
        "patterns": ["api_key", "api[-_]?secret", "password", "passwd", 
                     "access_token", "auth_token", "refresh_token", 
                     "bearer_token", "client_secret", "app_secret", 
                     "secret_key", "authorization", "private_key", "credential"]
    },
    "security": {
        "enabled": true,
        "rules": {
            "secretLeakage": true,
            "highRiskOps": true,
            "promptInjection": false,
            "chainDetection": false
        },
        "domainWhitelist": []
    },
    "metrics": {
        "enabled": true,
        "otlpPath": "/plugins/observability/api/otel",
        "maxPayloadBytes": 2097152,
        "retentionDays": 30
    }
}
```

***

## 七、Web API 端点

| 端点                                                | 方法    | 说明        |
| ------------------------------------------------- | ----- | --------- |
| `/plugins/observability/`                         | GET   | SPA UI 首页 |
| `/plugins/observability/api/stats`                | GET   | 统计摘要      |
| `/plugins/observability/api/sessions`             | GET   | 会话列表      |
| `/plugins/observability/api/sessions/:id/actions` | GET   | 会话动作      |
| `/plugins/observability/api/actions`              | GET   | 动作列表      |
| `/plugins/observability/api/alerts`               | GET   | 告警列表      |
| `/plugins/observability/api/alerts/:id`           | PATCH | 更新告警状态    |
| `/plugins/observability/api/analytics`            | GET   | 分析数据      |
| `/plugins/observability/api/metrics/overview`     | GET   | 指标概览      |
| `/plugins/observability/api/metrics/series`       | GET   | 指标时序      |
| `/plugins/observability/api/otel/v1/metrics`      | POST  | OTLP 指标接收 |

***

## 八、项目结构

```
src/
  index.ts                    # 插件入口 (activate/deactivate + wiring)
  config.ts                   # 配置 Schema 和默认值
  types.ts                    # 核心类型定义
  redaction.ts                # 敏感数据脱敏
  
  hooks/                      # OpenClaw Hook 注册
    index.ts                  # 导出
    messages.ts               # 消息相关 Hooks
    tools.ts                  # 工具相关 Hooks
    session.ts                # 会话相关 Hooks
    subagent.ts               # 子 Agent Hooks
    
  runtime/                    # 运行时基础设施
    index.ts                  # 导出
    fetch-interceptor.ts      # Fetch 拦截器
    session-context.ts        # 会话上下文管理
    session-transcript.ts     # 会话转录
    payload-sanitizer.ts      # 载荷清理
    
  storage/                    # 存储层
    writer.ts                 # 写入器接口
    buffer.ts                 # 异步批量缓冲
    schema.ts                 # MySQL Schema
    duckdb-local-writer.ts    # DuckDB 写入器
    mysql-writer.ts           # MySQL 写入器
    noop-writer.ts            # 空写入器
    structured-model.ts       # 结构化模型
    
  security/                   # 安全扫描
    scanner.ts                # 扫描器主入口
    rules.ts                  # L1 规则定义
    chain-detector.ts         # L2 行为链检测
    types.ts                  # 安全类型定义
    
  web/                        # Web Dashboard
    routes.ts                 # HTTP 路由注册
    api.ts                    # API 查询实现
    ui.ts                     # UI 资源
    
  gateway/                    # Gateway 方法
    register-observability-gateway.ts
    
  llm/                        # LLM 相关
    replay.ts                 # 回放功能
    
  cloud/                      # 云服务集成
    index.ts
    auth.ts
    api-key-auth.ts
    contracts.ts
    types.ts
```

***

## 九、关键设计决策

### 9.1 应用层 ID 生成

DuckDB 使用应用层 ID 计数器而非 SEQUENCE，避免多插件实例间的 WAL 写入冲突。

格式: `timestamp_ms * 10000 + counter % 10000` (每毫秒约 10,000 个唯一 ID)

### 9.2 双触发刷新机制

缓冲区基于两个阈值触发刷新：

- **数量阈值**: `batchSize` 条记录
- **时间阈值**: `flushIntervalMs` 毫秒

### 9.3 Fetch 拦截器

通过拦截全局 `fetch`，自动注入 `stream_options` 参数，从 SSE 响应中解析 Token 使用量，无需修改业务代码。

### 9.4 会话上下文管理

使用内存 Map 存储会话上下文，支持：

- Run ID 到 Session ID 的映射
- 渠道识别和持久化
- 工具调用计时

### 9.5 安全扫描分层

- **L1**: 单动作模式匹配 (实时)
- **L2**: 跨动作行为分析 (延迟检测)

***

## 十、总结

openclaw-observability 是一个功能完备的可观测性插件，核心价值在于：

1. **零侵入**: 通过 Hook 机制自动捕获所有事件
2. **零配置**: 默认使用嵌入式 DuckDB，开箱即用
3. **全链路**: 覆盖从用户消息到 LLM 调用到工具执行的完整链路
4. **安全审计**: 内置 15+ 安全规则和跨动作行为检测
5. **可视化**: 内置 Web Dashboard，无需外部依赖

