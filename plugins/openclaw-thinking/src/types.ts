export type ThinkingPhase =
  | 'idle'
  | 'model_resolving'
  | 'prompt_building'
  | 'llm_connecting'
  | 'llm_first_token'
  | 'thinking'
  | 'generating'
  | 'tool_calling'
  | 'tool_executing'
  | 'tool_complete'
  | 'completed'
  | 'error'
  | 'cancelled'

export const PHASE_CATEGORIES = {
  blind_spot: ['model_resolving', 'prompt_building', 'llm_connecting', 'llm_first_token'] as const,
  visible: ['thinking', 'generating', 'tool_calling', 'tool_executing', 'tool_complete'] as const,
  terminal: ['completed', 'error', 'cancelled'] as const,
  idle: ['idle'] as const,
}

export const PHASE_LABELS: Record<ThinkingPhase, string> = {
  idle: '空闲',
  model_resolving: '模型解析中',
  prompt_building: '提示词构建中',
  llm_connecting: 'LLM 连接中',
  llm_first_token: '等待首个 Token',
  thinking: '思考中',
  generating: '生成回复中',
  tool_calling: '工具调用中',
  tool_executing: '工具执行中',
  tool_complete: '工具完成',
  completed: '已完成',
  error: '错误',
  cancelled: '已取消',
}

export const PHASE_ICONS: Record<ThinkingPhase, string> = {
  idle: '⚪',
  model_resolving: '🔍',
  prompt_building: '📝',
  llm_connecting: '🔌',
  llm_first_token: '⏳',
  thinking: '🧠',
  generating: '✍️',
  tool_calling: '🔧',
  tool_executing: '⚙️',
  tool_complete: '✅',
  completed: '✔️',
  error: '❌',
  cancelled: '🚫',
}

export interface PhaseTransition {
  from: ThinkingPhase
  to: ThinkingPhase
  timestamp: number
  duration: number
  trigger: 'hook' | 'agent_event' | 'timeout' | 'user_action'
  metadata?: Record<string, unknown>
}

export interface ToolInfo {
  name: string
  callId: string
  args?: Record<string, unknown>
  startTime: number
}

export interface CompletedTool {
  name: string
  callId: string
  duration: number
  success: boolean
}

export interface TokenStats {
  prompt: number
  completion: number
  cacheRead?: number
  cacheWrite?: number
}

export interface TimingInfo {
  modelResolveTime?: number
  promptBuildTime?: number
  llmConnectTime?: number
  firstTokenTime?: number
  totalDuration?: number
}

export interface ErrorInfo {
  message: string
  code?: string
  stack?: string
}

export interface PhaseMetadata {
  modelName?: string
  modelProvider?: string
  currentTool?: ToolInfo
  completedTools: CompletedTool[]
  tokens?: TokenStats
  error?: ErrorInfo
  timing?: TimingInfo
}

export interface TimeoutStatus {
  isTimeout: boolean
  threshold: number
  elapsed: number
}

export interface PhaseState {
  sessionId: string
  runId: string
  userId?: string
  phase: ThinkingPhase
  phaseStartTime: number
  phaseElapsedTime: number
  previousPhase?: ThinkingPhase
  phaseHistory: PhaseTransition[]
  metadata: PhaseMetadata
  timeoutStatus?: TimeoutStatus
}

export type ActionType =
  | 'phase_transition'
  | 'llm_input'
  | 'llm_output'
  | 'tool_call'
  | 'tool_result'
  | 'user_message'
  | 'assistant_message'
  | 'thinking_content'
  | 'session_start'
  | 'session_end'
  | 'subagent_spawn'
  | 'subagent_end'

export interface ActionRecord {
  id: string
  sessionId: string
  runId?: string
  actionType: ActionType
  actionName: string
  inputParams?: Record<string, unknown>
  outputResult?: Record<string, unknown>
  promptTokens?: number
  completionTokens?: number
  durationMs?: number
  userId: string
  modelName: string
  channelId?: string
  createdAt: number
  securityFlags?: {
    hasAlerts: boolean
    alertIds?: string[]
  }
}

export interface SessionSummary {
  sessionId: string
  userId: string
  modelName: string
  channelId?: string
  startTime: number
  endTime?: number
  totalActions: number
  totalTokens: number
  totalToolCalls: number
  phaseStats: Record<ThinkingPhase, {
    count: number
    totalDuration: number
    avgDuration: number
  }>
  finalPhase: ThinkingPhase
  success: boolean
  errorMessage?: string
}

export interface HookContext {
  sessionId?: string
  runId?: string
  userId?: string
  modelName?: string
  channelId?: string
  payload?: Record<string, unknown>
  [key: string]: unknown
}

export interface AgentEvent {
  runId: string
  stream: 'lifecycle' | 'assistant' | 'tool'
  ts: number
  data: Record<string, unknown>
  sessionKey?: string
}

export interface PluginAPI {
  id: string
  name: string
  version: string
  config?: Record<string, unknown>
  pluginConfig?: Partial<ThinkingPluginConfig>
  on(slot: string, handler: (...args: unknown[]) => unknown): void
  logger?: {
    info?: (msg: string) => void
    warn?: (msg: string) => void
    error?: (msg: string) => void
  }
  registerHttpRoute?: (params: {
    path: string
    handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<boolean | void> | boolean | void
    auth: 'gateway' | 'plugin'
    match?: 'exact' | 'prefix'
    replaceExisting?: boolean
  }) => void
  registerGatewayMethod?: (method: string, handler: (ctx: {
    params?: unknown
    respond: (ok: boolean, payload: unknown) => void
    [key: string]: unknown
  }) => void | Promise<void>) => void
  runtime?: {
    events?: {
      onAgentEvent?: (listener: (evt: AgentEvent) => void) => (() => void) | void
    }
  }
  [key: string]: unknown
}

export interface ThinkingPluginConfig {
  modules: {
    phaseTracking: boolean
    realtimeBroadcast: boolean
    storage: boolean
    security: boolean
    webDashboard: boolean
  }
  phaseTracking: {
    historyRetention: number
    maxHistoryPerSession: number
  }
  broadcast: {
    mode: 'gateway_method' | 'sse' | 'websocket' | 'both'
    sse: {
      heartbeatInterval: number
    }
  }
  storage: {
    enabled: boolean
    mode: 'local' | 'remote'
    duckdb: {
      path: string
    }
    mysql: {
      host: string
      port: number
      user: string
      password: string
      database: string
    }
    buffer: {
      batchSize: number
      flushIntervalMs: number
    }
    retention: {
      actions: number
      sessions: number
    }
  }
  security: {
    enabled: boolean
    rules: {
      secretLeakage: boolean
      highRiskOps: boolean
      dataExfiltration: boolean
      promptInjection: boolean
      customRegex: boolean
      chainDetection: boolean
    }
    domainWhitelist: string[]
    customRegexRules: Array<{
      id: string
      name: string
      pattern: string
      severity: 'info' | 'warning' | 'critical'
    }>
  }
  timeouts: Partial<Record<ThinkingPhase, number>>
  ui: {
    accessToken?: string
    basePath: string
  }
}
