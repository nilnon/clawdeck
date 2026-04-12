export type AgentType = 'openclaw' | 'hermes' | string

export interface AgentConfig {
  type: AgentType
  name: string

  gatewayUrl?: string
  httpUrl?: string
  deviceKey?: string

  acpUrl?: string
  cliPath?: string

  model?: string
  extra?: Record<string, unknown>
}

export enum AgentStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error',
  BUSY = 'busy',
}

export interface AgentEvent {
  type: 'status_change' | 'message' | 'tool_call' | 'error' | 'session_update' | 'health' | 'presence' | 'shutdown' | 'session_message' | 'session_tool' | 'update_available' | 'approval' | 'plugin_approval'
  agentId: string
  timestamp: number
  data: unknown
}

export interface ChatOptions {
  sessionId?: string
  model?: string
  stream?: boolean
  systemPrompt?: string
}

export type ChatChunkType = 
  | 'text'
  | 'tool_start'
  | 'tool_result'
  | 'thinking'
  | 'error'

export interface ChatChunk {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  done: boolean
  timestamp: number
  toolCalls?: ToolCallChunk[]
  metadata?: Record<string, unknown>
  chunkType?: ChatChunkType
  toolName?: string
  toolCallId?: string
  toolArgs?: Record<string, unknown>
  toolResult?: unknown
  toolStartedAt?: number
  toolDuration?: number
  thinking?: string
}

export interface ToolCallChunk {
  id: string
  name: string
  args: Record<string, unknown>
  status: 'started' | 'done' | 'error'
  result?: unknown
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp: number
  toolCalls?: ToolCallInfo[]
  model?: string
  tokens?: TokenUsage
}

export interface ToolCallInfo {
  id: string
  name: string
  args: Record<string, unknown>
  result?: string
  error?: string
}

export interface TokenUsage {
  input: number
  output: number
  total: number
}

export interface SessionInfo {
  id: string
  agentId: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  ownerAgentId?: string
  sessionType?: 'main' | 'dashboard' | 'subagent' | 'other'
}

export interface SessionDetail extends SessionInfo {
  messages: ChatMessage[]
  model?: string
  status: 'active' | 'paused' | 'archived'
}

export interface SessionTreeInfo extends SessionInfo {
  parentId?: string
  children: SessionTreeInfo[]
}

export interface SessionStats {
  sessionId: string
  totalTokens: number
  inputTokens: number
  outputTokens: number
  modelUsage: Record<string, number>
  toolCalls: number
  durationMs: number
}

export interface SessionSearchOptions {
  model?: string
  dateRange?: { start: number; end: number }
}

export interface CreateSessionOptions {
  title?: string
  model?: string
  systemPrompt?: string
  thinking?: 'light' | 'medium' | 'heavy'
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  category?: string
}

// Thinking process types
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

export interface ThinkingPhaseState {
  sessionId: string
  runId: string
  phase: ThinkingPhase
  phaseStartTime: number
  phaseElapsedTime: number
  previousPhase?: ThinkingPhase
  metadata?: {
    modelName?: string
    currentTool?: {
      name: string
      callId: string
    }
    error?: {
      message: string
      code?: string
    }
  }
  timeoutStatus?: {
    isTimeout: boolean
    threshold: number
    elapsed: number
  }
}

export interface ActivityLogEntry {
  id: string
  toolName: string
  description: string
  startedAt: number
  completedAt?: number
  duration?: number
  phase: 'running' | 'completed'
  input?: Record<string, unknown>
  output?: unknown
}

export interface TraceSection {
  id: string
  type: 'input' | 'thinking' | 'llm_call' | 'tool_call' | 'response'
  name: string
  description?: string
  startTime: number
  endTime?: number
  duration?: number
  status: 'running' | 'completed' | 'error'
  input?: Record<string, unknown>
  output?: unknown
}

export interface ThinkingFlowState {
  phase: ThinkingPhase
  runId: string
  sessionKey?: string
  startTime: number
  endTime?: number
  thinkingContent?: string
  outputContent?: string
  toolCalls?: Array<{
    id: string
    name: string
    status: 'running' | 'success' | 'error'
    startedAt: number
    endTime?: number
    duration?: number
    args?: Record<string, unknown>
    result?: unknown
  }>
  activityLog: ActivityLogEntry[]
}

export interface PairingRequest {
  id: string
  type: 'node' | 'device'
  name?: string
  status: 'pending' | 'approved' | 'rejected'
  createdAt: number
  expiresAt: number
  code?: string
}

export interface PairingResult {
  success: boolean
  token?: string
  error?: string
}

export interface Skill {
  id: string
  name: string
  description: string
  enabled: boolean
  trigger?: string
  actions?: Array<{
    type: string
    params: Record<string, unknown>
  }>
}

export interface WizardStep {
  id: string
  title: string
  description?: string
  type: 'info' | 'input' | 'choice' | 'confirm'
  options?: Array<{ label: string; value: string }>
  defaultValue?: unknown
  required?: boolean
}

export interface WizardState {
  wizardId: string
  currentStep: number
  totalSteps: number
  completed: boolean
  data: Record<string, unknown>
}

export interface VoiceWakeConfig {
  enabled: boolean
  keyword?: string
  sensitivity?: number
}

export interface UpdateInfo {
  available: boolean
  version?: string
  releaseNotes?: string
  downloadUrl?: string
}

export interface SecretInfo {
  key: string
  exists: boolean
  createdAt?: number
  updatedAt?: number
}

export interface UsageStats {
  period: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  requestCount: number
  modelBreakdown: Record<string, { input: number; output: number }>
}

export interface Channel {
  id: string
  name: string
  type: 'websocket' | 'http' | 'webhook'
  config: Record<string, unknown>
  enabled: boolean
}

export interface LogEntry {
  timestamp: number
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  source?: string
  data?: unknown
}

export interface ToolResult {
  success: boolean
  data: unknown
  error?: string
  durationMs?: number
}

export interface ModelInfo {
  id: string
  name: string
  provider: string
  contextWindow?: number
  maxTokens?: number
  supportsThinking?: boolean
  supportsTools?: boolean
}

export interface AgentInfo {
  agentId: string
  workspaceDir: string
  model?: string
  status: 'running' | 'stopped'
  systemPrompt?: string
}

export interface HealthSnapshot {
  ok: boolean
  ts: number
  durationMs: number
  defaultAgentId?: string
  agents?: Array<{
    agentId: string
    status: string
  }>
  sessions?: {
    count: number
    recent: Array<{
      sessionKey: string
      messageCount: number
    }>
  }
}

export interface PresenceEntry {
  host: string
  ip?: string
  version: string
  platform: string
  mode: string
  roles?: string[]
  scopes?: string[]
  instanceId: string
  reason: string
  ts: number
  text?: string
}

export interface AgentSummary {
  id: string
  type: AgentType
  name: string
  status: AgentStatus
  config?: AgentConfig
  model?: string
  sessionCount: number
  connectedAt?: number
}

export interface IAgentAdapter {
  readonly type: AgentType
  readonly name: string

  connect(config: AgentConfig): Promise<void>

  disconnect(): Promise<void>

  isConnected(): boolean

  chat(message: string, options?: ChatOptions): AsyncIterable<ChatChunk>

  abort(runId: string): Promise<void>

  listSessions(): Promise<SessionInfo[]>

  getSession(sessionId: string): Promise<SessionDetail>

  createSession(options?: CreateSessionOptions): Promise<string>

  deleteSession(sessionId: string): Promise<void>

  resetSession(sessionId: string): Promise<void>

  listTools(): Promise<ToolDefinition[]>

  invokeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult>

  listModels(): Promise<ModelInfo[]>

  getStatus(): Promise<AgentStatus>

  onStatusChange(callback: (status: AgentStatus) => void): () => void

  onEvent(callback: (event: AgentEvent) => void): () => void

  updateSessionStatus?(sessionId: string, status: 'active' | 'paused' | 'archived'): Promise<void>

  pauseSession?(sessionId: string): Promise<void>

  archiveSession?(sessionId: string): Promise<void>

  activateSession?(sessionId: string): Promise<void>

  setSessionModel?(sessionId: string, modelId: string): Promise<void>

  setThinkingLevel?(sessionId: string, level: 'light' | 'medium' | 'heavy'): Promise<void>

  setSystemPrompt?(sessionId: string, prompt: string): Promise<void>

  createSubsession?(parentSessionId: string, options?: CreateSessionOptions): Promise<string>

  getSessionTree?(parentSessionId?: string): Promise<SessionTreeInfo[]>

  searchSessions?(query: string, options?: SessionSearchOptions): Promise<SessionInfo[]>

  listSessionsByModel?(modelId: string): Promise<SessionInfo[]>

  deleteSessions?(sessionIds: string[]): Promise<void>

  archiveSessions?(sessionIds: string[]): Promise<void>

  exportSessions?(sessionIds: string[]): Promise<Record<string, SessionDetail>>

  getSessionStats?(sessionId: string): Promise<SessionStats>

  getAllSessionsStats?(): Promise<{
    totalSessions: number
    activeSessions: number
    totalMessages: number
    totalTokens: number
    modelDistribution: Record<string, number>
  }>

  subscribeSessions?(sessionKeys?: string[]): Promise<void>

  unsubscribeSessions?(sessionKeys?: string[]): Promise<void>

  listAgents?(): Promise<AgentInfo[]>

  getHealth?(): Promise<HealthSnapshot>

  compactSession?(sessionId: string): Promise<void>

  subscribeMessages?(sessionKey: string): Promise<void>

  unsubscribeMessages?(sessionKey: string): Promise<void>

  listAgentFiles?(agentId: string, path?: string): Promise<AgentFileInfo[]>

  getAgentFile?(agentId: string, path: string): Promise<string>

  setAgentFile?(agentId: string, path: string, content: string): Promise<void>

  getConfig?(key?: string): Promise<unknown>

  setConfig?(key: string, value: unknown): Promise<void>

  getSystemStatus?(): Promise<SystemStatus>

  getTTSStatus?(): Promise<TTSStatus>

  enableTTS?(provider?: string): Promise<void>

  disableTTS?(): Promise<void>

  convertTTS?(text: string): Promise<TTSConvertResult>

  listApprovals?(): Promise<ApprovalRequest[]>

  approveRequest?(approvalId: string): Promise<void>

  denyRequest?(approvalId: string): Promise<void>

  listCronJobs?(): Promise<CronJob[]>

  addCronJob?(job: Omit<CronJob, 'id'>): Promise<string>

  removeCronJob?(jobId: string): Promise<void>

  runCronJob?(jobId: string): Promise<void>

  listCompactions?(sessionKey: string): Promise<SessionCompaction[]>

  restoreCompaction?(sessionKey: string, compactionId: string): Promise<void>

  branchCompaction?(sessionKey: string, compactionId: string): Promise<string>

  createAgent?(agentId: string, config?: { model?: string; systemPrompt?: string }): Promise<void>

  updateAgent?(agentId: string, config: { model?: string; systemPrompt?: string; heartbeat?: { enabled: boolean; every: string; prompt: string } }): Promise<void>

  deleteAgent?(agentId: string): Promise<void>

  getEffectiveTools?(sessionKey?: string): Promise<ToolDefinition[]>

  getObservabilityStats?(): Promise<ObservabilityStats>

  getObservabilitySessions?(): Promise<ObservabilitySession[]>

  // Node pairing
  initiateNodePairing?(name?: string): Promise<PairingRequest>

  getNodePairingRequests?(): Promise<PairingRequest[]>

  approveNodePairing?(requestId: string): Promise<PairingResult>

  rejectNodePairing?(requestId: string): Promise<void>

  // Device pairing
  initiateDevicePairing?(name?: string): Promise<PairingRequest>

  getDevicePairingRequests?(): Promise<PairingRequest[]>

  approveDevicePairing?(requestId: string): Promise<PairingResult>

  rejectDevicePairing?(requestId: string): Promise<void>

  // Skills
  listSkills?(): Promise<Skill[]>

  getSkill?(skillId: string): Promise<Skill>

  createSkill?(skill: Omit<Skill, 'id'>): Promise<string>

  updateSkill?(skillId: string, skill: Partial<Skill>): Promise<void>

  deleteSkill?(skillId: string): Promise<void>

  // Wizard
  startWizard?(wizardType: string): Promise<WizardState>

  getWizardState?(wizardId: string): Promise<WizardState>

  submitWizardStep?(wizardId: string, stepId: string, value: unknown): Promise<WizardState>

  cancelWizard?(wizardId: string): Promise<void>

  // Voice wake
  getVoiceWakeConfig?(): Promise<VoiceWakeConfig>

  setVoiceWakeConfig?(config: VoiceWakeConfig): Promise<void>

  // Update
  checkForUpdate?(): Promise<UpdateInfo>

  runUpdate?(): Promise<void>

  // Secrets
  getSecret?(key: string): Promise<SecretInfo>

  setSecret?(key: string, value: string): Promise<void>

  deleteSecret?(key: string): Promise<void>

  // Usage
  getUsageStats?(period?: string): Promise<UsageStats>

  // Channels
  listChannels?(): Promise<Channel[]>

  createChannel?(channel: Omit<Channel, 'id'>): Promise<string>

  updateChannel?(channelId: string, channel: Partial<Channel>): Promise<void>

  deleteChannel?(channelId: string): Promise<void>

  // Logs
  tailLogs?(options?: { level?: string; source?: string; limit?: number }): Promise<LogEntry[]>

  // Node invoke
  invokeNode?(nodeId: string, method: string, params?: unknown): Promise<unknown>

  // Gateway method
  callGatewayMethod?<T = unknown>(method: string, params?: unknown): Promise<T>

  // Thinking phase SSE
  subscribeThinkingPhase?(sessionId: string, callback: (phase: ThinkingPhaseState) => void): () => void
}

export interface AgentFileInfo {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  modifiedAt?: number
}

export interface SystemStatus {
  version: string
  uptime: number
  connections: number
  memory: {
    used: number
    total: number
  }
}

export interface TTSStatus {
  enabled: boolean
  provider?: string
  providers?: string[]
}

export interface TTSConvertResult {
  audioUrl?: string
  audioData?: string
  duration?: number
}

export interface ApprovalRequest {
  id: string
  type: 'exec' | 'plugin'
  toolName?: string
  arguments?: Record<string, unknown>
  pluginId?: string
  message: string
  createdAt: number
  status: 'pending' | 'approved' | 'denied'
}

export interface CronJob {
  id: string
  name: string
  schedule: string
  command: string
  enabled: boolean
  lastRun?: number
  nextRun?: number
}

export interface SessionCompaction {
  id: string
  sessionKey: string
  createdAt: number
  messageCount: number
  summary?: string
}

export interface ObservabilityStats {
  totalSessions: number
  activeSessions: number
  totalMessages: number
  totalTokens: number
  modelUsage: Record<string, number>
  toolCalls: number
  averageResponseTime: number
}

export interface ObservabilitySession {
  sessionKey: string
  agentId: string
  status: string
  messageCount: number
  lastActivity: number
  model?: string
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  category?: string
}