import type {
  IAgentAdapter,
  AgentConfig,
  AgentEvent,
  ChatOptions,
  ChatChunk,
  SessionInfo,
  SessionDetail,
  CreateSessionOptions,
  ToolDefinition,
  ToolResult,
  ModelInfo,
  ChatMessage,
  SessionStats,
  SessionTreeInfo,
  SessionSearchOptions,
  AgentInfo,
  HealthSnapshot,
  AgentFileInfo,
  SystemStatus,
  TTSStatus,
  TTSConvertResult,
  ApprovalRequest,
  CronJob,
  SessionCompaction,
  ObservabilityStats,
  ObservabilitySession,
  PairingRequest,
  PairingResult,
  Skill,
  WizardState,
  VoiceWakeConfig,
  UpdateInfo,
  SecretInfo,
  UsageStats,
  Channel,
  LogEntry,
} from '@shared/types.js'
import { AgentStatus } from '@shared/types.js'
import { RpcClient } from './rpc-client.js'
import { randomUUID } from 'node:crypto'

type StreamEventType =
  | 'lifecycle_start'
  | 'lifecycle_end'
  | 'assistant_stream'
  | 'agent_tool_start'
  | 'agent_tool_result'
  | 'agent_state'
  | 'chat_started'
  | 'chat_delta'
  | 'chat_final'
  | 'chat_error'
  | 'chat_aborted'
  | 'error'
  | 'ignore'

interface ClassifiedEvent {
  type: StreamEventType
  source: 'agent' | 'chat'
  sessionKey?: string
  runId?: string
  chatSeq?: number
  agentPayload?: Record<string, unknown>
  chatPayload?: Record<string, unknown>
}

function classifyStreamEvent(msg: Record<string, unknown>): ClassifiedEvent | null {
  const evt = msg.event as string

  if (evt === 'agent') {
    const ap = (msg.payload || {}) as Record<string, unknown>
    const runId = typeof ap.runId === 'string' ? ap.runId : undefined
    const chatSeq = typeof ap.seq === 'number' ? ap.seq : undefined

    const base = {
      source: 'agent' as const,
      sessionKey: ap.sessionKey as string | undefined,
      runId,
      chatSeq,
      agentPayload: ap,
    }

    if (ap.stream === 'lifecycle') {
      const data = ap.data as Record<string, unknown> | undefined
      const phase = data?.phase
      if (phase === 'start') return { ...base, type: 'lifecycle_start' }
      if (phase === 'end' || phase === 'error') return { ...base, type: 'lifecycle_end' }
      return { ...base, type: 'ignore' }
    }

    if (ap.stream === 'assistant') {
      return { ...base, type: 'assistant_stream' }
    }

    if (ap.stream === 'tool') {
      const data = ap.data as Record<string, unknown> | undefined
      console.log('[OpenClawAdapter] tool stream data:', JSON.stringify(data))
      if (!data) {
        console.log('[OpenClawAdapter] tool stream ignored: no data')
        return { ...base, type: 'ignore' }
      }
      if (data.phase === 'start') {
        if (data.name && data.toolCallId) {
          console.log('[OpenClawAdapter] tool stream classified as: agent_tool_start')
          return { ...base, type: 'agent_tool_start' }
        } else {
          console.log('[OpenClawAdapter] tool stream start ignored: missing name or toolCallId', { name: data.name, toolCallId: data.toolCallId })
        }
      }
      if (data.phase === 'result') {
        if (data.toolCallId) {
          console.log('[OpenClawAdapter] tool stream classified as: agent_tool_result')
          return { ...base, type: 'agent_tool_result' }
        } else {
          console.log('[OpenClawAdapter] tool stream result ignored: missing toolCallId')
        }
      }
      console.log('[OpenClawAdapter] tool stream ignored: unknown phase', data.phase)
      return { ...base, type: 'ignore' }
    }

    const agentState = ap.state || ap.agentState
    if (agentState) {
      return { ...base, type: 'agent_state' }
    }

    return { ...base, type: 'ignore' }
  }
  
  if (evt === 'chat') {
    const cp = (msg.payload || {}) as Record<string, unknown>
    const base = {
      source: 'chat' as const,
      sessionKey: cp.sessionKey as string | undefined,
      runId: cp.runId as string | undefined,
      chatSeq: cp.seq as number | undefined,
      chatPayload: cp,
    }
    const state = cp.state as string | undefined

    if (state === 'started') return { ...base, type: 'chat_started' }
    if (state === 'delta') return { ...base, type: 'chat_delta' }
    if (state === 'final') return { ...base, type: 'chat_final' }
    if (state === 'aborted') return { ...base, type: 'chat_aborted' }
    if (state === 'error') return { ...base, type: 'chat_error' }

    return { ...base, type: 'ignore' }
  }
  
  if (evt === 'error') {
    const ep = (msg.payload || {}) as Record<string, unknown>
    return {
      type: 'error',
      source: 'agent',
      chatPayload: { errorMessage: (ep.message || ep.error || 'Unknown error') as string },
    }
  }
  
  return null
}

export class OpenClawAdapter implements IAgentAdapter {
  readonly type = 'openclaw' as const
  name = 'OpenClaw'

  private rpc = new RpcClient()
  private statusListeners = new Set<(status: AgentStatus) => void>()
  private eventListeners = new Set<(event: AgentEvent) => void>()
  private sessionCache = new Map<string, SessionDetail>()
  private cacheTTL = 5 * 60 * 1000

  async connect(config: AgentConfig): Promise<void> {
    this.name = config.name || 'OpenClaw'
    const gatewayUrl = config.gatewayUrl || process.env.VITE_OPENCLAW_GATEWAY_URL || 'ws://localhost:18789'
    const token = ((config as unknown) as Record<string, unknown>).token as string | undefined
    await this.rpc.connect(gatewayUrl, token)
    this.emitStatus(AgentStatus.CONNECTED)

    this.rpc.onMessage((data) => {
      const msg = data as Record<string, unknown>
      const eventType = msg.event as string | undefined

      if (msg.type === 'event') {
        if (eventType === 'session.update' || eventType === 'sessions.changed') {
          const payload = msg.payload as Record<string, unknown> | undefined
          this.sessionCache.delete(payload?.sessionKey as string)
          this.emitEvent({
            type: 'session_update',
            agentId: this.name,
            timestamp: Date.now(),
            data,
          })
        } else if (eventType === 'health') {
          this.emitEvent({
            type: 'health',
            agentId: this.name,
            timestamp: Date.now(),
            data,
          })
        } else if (eventType === 'presence') {
          this.emitEvent({
            type: 'presence',
            agentId: this.name,
            timestamp: Date.now(),
            data,
          })
        } else if (eventType === 'shutdown') {
          this.emitEvent({
            type: 'shutdown',
            agentId: this.name,
            timestamp: Date.now(),
            data,
          })
        } else if (eventType === 'session.message') {
          this.emitEvent({
            type: 'session_message',
            agentId: this.name,
            timestamp: Date.now(),
            data,
          })
        } else if (eventType === 'session.tool') {
          this.emitEvent({
            type: 'session_tool',
            agentId: this.name,
            timestamp: Date.now(),
            data,
          })
        } else if (eventType === 'update.available') {
          this.emitEvent({
            type: 'update_available',
            agentId: this.name,
            timestamp: Date.now(),
            data,
          })
        } else if (eventType === 'exec.approval.requested' || eventType === 'exec.approval.resolved') {
          this.emitEvent({
            type: 'approval',
            agentId: this.name,
            timestamp: Date.now(),
            data,
          })
        } else if (eventType === 'plugin.approval.requested' || eventType === 'plugin.approval.resolved') {
          this.emitEvent({
            type: 'plugin_approval',
            agentId: this.name,
            timestamp: Date.now(),
            data,
          })
        } else {
          this.emitEvent({
            type: 'message',
            agentId: this.name,
            timestamp: Date.now(),
            data,
          })
        }
      } else {
        this.emitEvent({
          type: 'message',
          agentId: this.name,
          timestamp: Date.now(),
          data,
        })
      }
    })
  }

  async disconnect(): Promise<void> {
    this.rpc.disconnect()
    this.sessionCache.clear()
    this.emitStatus(AgentStatus.DISCONNECTED)
  }

  isConnected(): boolean {
    return this.rpc.isConnected
  }

  async *chat(message: string, options?: ChatOptions): AsyncIterable<ChatChunk> {
    const chunkId = randomUUID()
    const sessionKey = options?.sessionId
    
    if (!sessionKey) {
      yield {
        id: chunkId,
        role: 'assistant',
        content: 'Error: No session selected',
        done: true,
        timestamp: Date.now(),
      }
      return
    }

    const idempotencyKey = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    type QueueItem = {
      content: string
      done: boolean
      chunkType?: 'text' | 'tool_start' | 'tool_result' | 'thinking' | 'error'
      toolName?: string
      toolCallId?: string
      toolArgs?: Record<string, unknown>
      toolResult?: unknown
      toolStartedAt?: number
      toolDuration?: number
      thinking?: string
    }
    const responseQueue: QueueItem[] = []
    let isComplete = false
    let error: string | null = null
    const startTime = Date.now()
    const timeout = 120000

    const messageHandler = (data: unknown) => {
      const msg = data as Record<string, unknown>
      if (msg.type !== 'event') return

      console.log('[OpenClawAdapter] Raw event received:', msg.event, 'payload:', JSON.stringify(msg.payload))

      const classified = classifyStreamEvent(msg)
      if (!classified) {
        console.log('[OpenClawAdapter] Event classified as: null (ignored)')
        return
      }

      console.log('[OpenClawAdapter] Event classified:', classified.type, 'sessionKey:', classified.sessionKey, 'expected:', sessionKey)

      if (classified.sessionKey !== sessionKey) return

      const { type, source, agentPayload, chatPayload } = classified

      if (source === 'agent') {
        if (type === 'lifecycle_start') {
        } else if (type === 'lifecycle_end') {
          isComplete = true
        } else if (type === 'assistant_stream') {
          const data = agentPayload?.data
          console.log('[OpenClawAdapter] assistant_stream data:', JSON.stringify(data))
          if (data && typeof data === 'object') {
            const dataObj = data as Record<string, unknown>
            const delta = dataObj.delta as string | undefined
            const thinking = dataObj.thinking as string | undefined
            console.log('[OpenClawAdapter] delta:', delta?.substring(0, 50))
            console.log('[OpenClawAdapter] thinking:', thinking?.substring(0, 50))
            if (delta) {
              responseQueue.push({ content: delta, done: false, chunkType: 'text' })
            }
            if (thinking) {
              responseQueue.push({ content: '', done: false, chunkType: 'thinking', thinking })
            }
          }
        } else if (type === 'agent_tool_start') {
          console.log('[OpenClawAdapter] agent_tool_start:', JSON.stringify(agentPayload?.data))
          const data = agentPayload?.data as Record<string, unknown> | undefined
          if (data) {
            responseQueue.push({
              content: '',
              done: false,
              chunkType: 'tool_start',
              toolName: data.name as string,
              toolCallId: data.toolCallId as string,
              toolArgs: (data.arguments || data.args) as Record<string, unknown>,
              toolStartedAt: Date.now(),
            })
          }
        } else if (type === 'agent_tool_result') {
          console.log('[OpenClawAdapter] agent_tool_result:', JSON.stringify(agentPayload?.data))
          const data = agentPayload?.data as Record<string, unknown> | undefined
          if (data) {
            responseQueue.push({
              content: '',
              done: false,
              chunkType: 'tool_result',
              toolCallId: data.toolCallId as string,
              toolResult: data.result,
              toolDuration: data.duration as number | undefined,
            })
          }
        }
      } else if (source === 'chat') {
        // 优先使用 agent 事件，忽略 chat 事件的内容
        // 因为 agent 事件包含更详细的信息（thinking, tool 等）
        if (type === 'chat_started') {
        } else if (type === 'chat_final') {
          isComplete = true
        } else if (type === 'chat_aborted') {
          isComplete = true
        } else if (type === 'chat_error') {
          error = (chatPayload?.errorMessage || chatPayload?.error || 'Chat error') as string
          isComplete = true
        }
      } else if (type === 'error') {
        error = (chatPayload?.errorMessage || 'Unknown error') as string
        isComplete = true
      }
    }

    const unsubscribe = this.rpc.onMessage(messageHandler)

    try {
      const ack = await this.rpc.call('chat.send', {
        sessionKey,
        message,
        idempotencyKey,
        deliver: false,
      }) as { runId?: string; status?: string }

      if (!ack.runId) {
        yield {
          id: chunkId,
          role: 'assistant',
          content: 'Error: Failed to start chat',
          done: true,
          timestamp: Date.now(),
        }
        return
      }

      let lastYieldTime = Date.now()
      const yieldInterval = 50

      while (!isComplete && !error && Date.now() - startTime < timeout) {
        const now = Date.now()

        if (responseQueue.length > 0 && now - lastYieldTime >= yieldInterval) {
          const chunks = responseQueue.splice(0, responseQueue.length)
          for (const chunk of chunks) {
            lastYieldTime = now
            if (chunk.chunkType === 'tool_start') {
              yield {
                id: chunkId,
                role: 'assistant',
                content: '',
                done: false,
                timestamp: now,
                chunkType: 'tool_start',
                toolName: chunk.toolName,
                toolCallId: chunk.toolCallId,
                toolArgs: chunk.toolArgs,
                toolStartedAt: chunk.toolStartedAt,
              }
            } else if (chunk.chunkType === 'tool_result') {
              yield {
                id: chunkId,
                role: 'assistant',
                content: '',
                done: false,
                timestamp: now,
                chunkType: 'tool_result',
                toolCallId: chunk.toolCallId,
                toolResult: chunk.toolResult,
                toolDuration: chunk.toolDuration,
              }
            } else if (chunk.chunkType === 'thinking') {
              yield {
                id: chunkId,
                role: 'assistant',
                content: '',
                done: false,
                timestamp: now,
                chunkType: 'thinking',
                thinking: chunk.thinking,
              }
            } else if (chunk.content) {
              yield {
                id: chunkId,
                role: 'assistant',
                content: chunk.content,
                done: chunk.done,
                timestamp: now,
                chunkType: chunk.chunkType || 'text',
              }
            }
          }
        }

        await new Promise(resolve => setTimeout(resolve, 20))
      }

      if (responseQueue.length > 0) {
        const chunks = responseQueue.splice(0, responseQueue.length)
        for (const chunk of chunks) {
          if (chunk.chunkType === 'tool_start') {
            yield {
              id: chunkId,
              role: 'assistant',
              content: '',
              done: false,
              timestamp: Date.now(),
              chunkType: 'tool_start',
              toolName: chunk.toolName,
              toolCallId: chunk.toolCallId,
              toolArgs: chunk.toolArgs,
              toolStartedAt: chunk.toolStartedAt,
            }
          } else if (chunk.chunkType === 'tool_result') {
            yield {
              id: chunkId,
              role: 'assistant',
              content: '',
              done: false,
              timestamp: Date.now(),
              chunkType: 'tool_result',
              toolCallId: chunk.toolCallId,
              toolResult: chunk.toolResult,
              toolDuration: chunk.toolDuration,
            }
          } else if (chunk.chunkType === 'thinking') {
            yield {
              id: chunkId,
              role: 'assistant',
              content: '',
              done: false,
              timestamp: Date.now(),
              chunkType: 'thinking',
              thinking: chunk.thinking,
            }
          } else if (chunk.content) {
            yield {
              id: chunkId,
              role: 'assistant',
              content: chunk.content,
              done: chunk.done,
              timestamp: Date.now(),
              chunkType: chunk.chunkType || 'text',
            }
          }
        }
      }

      if (error) {
        yield {
          id: chunkId,
          role: 'assistant',
          content: `\n[Error: ${error}]`,
          done: true,
          timestamp: Date.now(),
        }
      } else if (!isComplete) {
        yield {
          id: chunkId,
          role: 'assistant',
          content: '\n[Response timeout]',
          done: true,
          timestamp: Date.now(),
        }
      } else {
        yield {
          id: chunkId,
          role: 'assistant',
          content: '',
          done: true,
          timestamp: Date.now(),
        }
      }
    } catch (err) {
      yield {
        id: chunkId,
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        done: true,
        timestamp: Date.now(),
      }
    } finally {
      unsubscribe()
    }
  }

  async abort(runId: string): Promise<void> {
    await this.rpc.call('chat.abort', { runId })
  }

  async listSessions(): Promise<SessionInfo[]> {
    const result = await this.rpc.call('sessions.list') as Record<string, unknown>
    const sessions = (result.sessions as Array<Record<string, unknown>>) || []
    
    return sessions.map((s) => {
      const sessionKey = (s.key as string) || (s.id as string) || ''
      
      const match = sessionKey.match(/^agent:([^:]+):([^:]+)(?::(.+))?$/)
      const ownerAgentId = match?.[1] || 'unknown'
      const sessionTypePart = match?.[2] || 'other'
      const sessionIdPart = match?.[3]
      
      let sessionType: SessionInfo['sessionType'] = 'other'
      if (sessionTypePart === 'main' && !sessionIdPart) {
        sessionType = 'main'
      } else if (sessionTypePart === 'dashboard') {
        sessionType = 'dashboard'
      } else if (sessionTypePart === 'subagent') {
        sessionType = 'subagent'
      }
      
      let title: string
      if (sessionType === 'main') {
        title = 'main'
      } else if (sessionIdPart) {
        title = `${sessionTypePart}:${sessionIdPart}`
      } else {
        title = sessionTypePart
      }
      
      return {
        id: sessionKey,
        agentId: this.name,
        title,
        createdAt: Number(s.createdAt || s.startedAt || 0),
        updatedAt: Number(s.updatedAt || 0),
        messageCount: Number(s.messageCount || 0),
        ownerAgentId,
        sessionType,
      }
    })
  }

  async getSession(sessionId: string): Promise<SessionDetail> {
    const cached = this.sessionCache.get(sessionId)
    if (cached && Date.now() - cached.updatedAt < this.cacheTTL) {
      return cached
    }

    const session = await this.rpc.call('sessions.preview', { keys: [sessionId] }) as Record<string, unknown>
    
    let messages: ChatMessage[] = []
    try {
      const history = await this.rpc.call('chat.history', { sessionKey: sessionId, limit: 100 }) as Record<string, unknown>
      const historyMessages = (history.messages as Array<Record<string, unknown>>) || []
      messages = historyMessages.map((msg) => {
        const tokensData = msg.tokens as Record<string, unknown> | undefined
        const content = msg.content
        let contentStr = ''
        if (typeof content === 'string') {
          contentStr = content
        } else if (Array.isArray(content)) {
          contentStr = content
            .map(block => {
              if (typeof block === 'string') return block
              if (block && typeof block === 'object' && 'text' in block) {
                return (block as Record<string, unknown>).text as string
              }
              return ''
            })
            .filter(Boolean)
            .join('')
        }
        return {
          id: msg.id as string || randomUUID(),
          role: msg.role as 'user' | 'assistant' | 'system',
          content: contentStr,
          timestamp: Number(msg.timestamp || Date.now()),
          tokens: tokensData ? {
            input: Number(tokensData.input || 0),
            output: Number(tokensData.output || 0),
            total: Number(tokensData.total || (Number(tokensData.input || 0) + Number(tokensData.output || 0))),
          } : undefined,
        }
      })
    } catch {
    }

    const detail: SessionDetail = {
      id: sessionId,
      agentId: this.name,
      title: (session.label as string) || 'Untitled',
      createdAt: Number(session.createdAt || 0),
      updatedAt: Date.now(),
      messageCount: messages.length,
      messages,
      model: session.model as string,
      status: 'active',
    }

    this.sessionCache.set(sessionId, detail)
    return detail
  }

  async createSession(options?: CreateSessionOptions): Promise<string> {
    const params: Record<string, unknown> = {}
    if (options?.model) {
      params.model = options.model
    }
    const result = await this.rpc.call('sessions.create', params) as any

    if (result && typeof result === 'object') {
      if (result.key) return result.key as string
      if (result.sessionKey) return result.sessionKey as string
    }

    if (typeof result === 'string') return result

    throw new Error(`Invalid response from OpenClaw (sessions.create): ${JSON.stringify(result)}`)
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.rpc.call('sessions.delete', { sessionKey: sessionId })
    this.sessionCache.delete(sessionId)
  }

  async resetSession(sessionId: string): Promise<void> {
    await this.rpc.call('sessions.reset', { sessionKey: sessionId })
    this.sessionCache.delete(sessionId)
  }

  async updateSessionStatus(sessionId: string, status: 'active' | 'paused' | 'archived'): Promise<void> {
    await this.rpc.call('sessions.patch', { sessionKey: sessionId, status })
    this.sessionCache.delete(sessionId)
  }

  async setSessionModel(sessionId: string, modelId: string): Promise<void> {
    await this.rpc.call('sessions.patch', { sessionKey: sessionId, model: modelId })
    this.sessionCache.delete(sessionId)
  }

  async setThinkingLevel(sessionId: string, level: 'light' | 'medium' | 'heavy'): Promise<void> {
    await this.rpc.call('sessions.patch', { sessionKey: sessionId, thinking: level })
    this.sessionCache.delete(sessionId)
  }

  async setSystemPrompt(sessionId: string, prompt: string): Promise<void> {
    await this.rpc.call('sessions.patch', { sessionKey: sessionId, systemPrompt: prompt })
    this.sessionCache.delete(sessionId)
  }

  async createSubsession(parentSessionId: string, options?: CreateSessionOptions): Promise<string> {
    const params: Record<string, unknown> = {
      parentSessionKey: parentSessionId,
    }
    if (options?.model) {
      params.model = options.model
    }
    const result = await this.rpc.call('sessions.create', params) as any

    if (result && typeof result === 'object') {
      if (result.key) return result.key as string
      if (result.sessionKey) return result.sessionKey as string
    }

    if (typeof result === 'string') return result

    throw new Error(`Invalid response from OpenClaw (sessions.create subsession): ${JSON.stringify(result)}`)
  }

  async getSessionTree(parentSessionId?: string): Promise<SessionTreeInfo[]> {
    const result = await this.rpc.call('sessions.tree', { sessionKey: parentSessionId }) as Record<string, unknown>
    const sessions = (result.sessions as Array<Record<string, unknown>>) || []

    return sessions.map((s) => ({
      id: s.id as string,
      agentId: this.name,
      title: (s.label as string) || 'Untitled',
      createdAt: Number(s.createdAt || 0),
      updatedAt: Number(s.updatedAt || 0),
      messageCount: Number(s.messageCount || 0),
      parentId: s.parentId as string | undefined,
      children: [],
    }))
  }

  async searchSessions(query: string, options?: SessionSearchOptions): Promise<SessionInfo[]> {
    const result = await this.rpc.call('sessions.search', {
      query,
      agentId: options?.model,
      model: options?.model,
      startDate: options?.dateRange?.start,
      endDate: options?.dateRange?.end,
    }) as Record<string, unknown>
    const sessions = (result.sessions as Array<Record<string, unknown>>) || []

    return sessions.map((s) => ({
      id: (s.key as string) || (s.id as string),
      agentId: this.name,
      title: (s.label as string) || 'Untitled',
      createdAt: Number(s.createdAt || 0),
      updatedAt: Number(s.updatedAt || 0),
      messageCount: Number(s.messageCount || 0),
    }))
  }

  async deleteSessions(sessionIds: string[]): Promise<void> {
    await Promise.all(sessionIds.map(id => this.deleteSession(id)))
  }

  async archiveSessions(sessionIds: string[]): Promise<void> {
    await Promise.all(sessionIds.map(id => this.updateSessionStatus(id, 'archived')))
  }

  async exportSessions(sessionIds: string[]): Promise<Record<string, SessionDetail>> {
    const exports: Record<string, SessionDetail> = {}
    for (const id of sessionIds) {
      exports[id] = await this.getSession(id)
    }
    return exports
  }

  async getSessionStats(sessionId: string): Promise<SessionStats> {
    const stats = await this.rpc.call('sessions.stats', { sessionKey: sessionId }) as Record<string, unknown>
    return {
      sessionId,
      totalTokens: Number(stats.totalTokens || 0),
      inputTokens: Number(stats.inputTokens || 0),
      outputTokens: Number(stats.outputTokens || 0),
      modelUsage: stats.modelUsage as Record<string, number> || {},
      toolCalls: Number(stats.toolCalls || 0),
      durationMs: Number(stats.durationMs || 0),
    }
  }

  async getAllSessionsStats(): Promise<{
    totalSessions: number
    activeSessions: number
    totalMessages: number
    totalTokens: number
    modelDistribution: Record<string, number>
  }> {
    const stats = await this.rpc.call('sessions.stats.all') as Record<string, unknown>
    return {
      totalSessions: Number(stats.total || 0),
      activeSessions: Number(stats.active || 0),
      totalMessages: Number(stats.totalMessages || 0),
      totalTokens: Number(stats.totalTokens || 0),
      modelDistribution: stats.models as Record<string, number> || {},
    }
  }

  async getModels(): Promise<ModelInfo[]> {
    const result = await this.rpc.call('models.list') as Record<string, unknown>
    const models = (result.models as Array<Record<string, unknown>>) || []
    return models.map((m) => ({
      id: m.id as string,
      name: (m.name as string) || (m.id as string),
      provider: m.provider as string,
      contextWindow: m.contextWindow as number | undefined,
    }))
  }

  async getTools(): Promise<ToolDefinition[]> {
    const result = await this.rpc.call('tools.catalog') as Record<string, unknown>
    const tools = (result.tools as Array<Record<string, unknown>>) || []
    return tools.map((t) => ({
      name: t.name as string,
      description: t.description as string,
      parameters: t.parameters as Record<string, unknown>,
    }))
  }

  async listTools(): Promise<ToolDefinition[]> {
    return this.getTools()
  }

  async invokeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    return this.executeTool(toolName, args)
  }

  async executeTool(toolName: string, params: Record<string, unknown>): Promise<ToolResult> {
    const result = await this.rpc.call('tools.execute', { name: toolName, params }) as Record<string, unknown>
    return {
      success: result.success as boolean,
      data: result.result,
      error: result.error as string | undefined,
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.getModels()
  }

  async getStatus(): Promise<AgentStatus> {
    return this.rpc.isConnected ? AgentStatus.CONNECTED : AgentStatus.DISCONNECTED
  }

  async subscribeSessions(sessionKeys?: string[]): Promise<void> {
    await this.rpc.call('sessions.subscribe', { sessionKeys })
  }

  async unsubscribeSessions(sessionKeys?: string[]): Promise<void> {
    await this.rpc.call('sessions.unsubscribe', { sessionKeys })
  }

  async listAgents(): Promise<AgentInfo[]> {
    const result = await this.rpc.call('agents.list') as Record<string, unknown>
    const agents = (result.agents as Array<Record<string, unknown>>) || []
    return agents.map((a) => ({
      agentId: a.agentId as string,
      workspaceDir: a.workspaceDir as string,
      model: a.model as string | undefined,
      status: a.status as 'running' | 'stopped',
      systemPrompt: a.systemPrompt as string | undefined,
    }))
  }

  async getHealth(): Promise<HealthSnapshot> {
    const result = await this.rpc.call('health') as Record<string, unknown>
    return {
      ok: result.ok as boolean,
      ts: result.ts as number,
      durationMs: result.durationMs as number,
      defaultAgentId: result.defaultAgentId as string | undefined,
      agents: (result.agents as Array<{ agentId: string; status: string }>) || undefined,
      sessions: result.sessions as HealthSnapshot['sessions'],
    }
  }

  async compactSession(sessionId: string): Promise<void> {
    await this.rpc.call('sessions.compact', { sessionKey: sessionId })
    this.sessionCache.delete(sessionId)
  }

  async subscribeMessages(sessionKey: string): Promise<void> {
    await this.rpc.call('sessions.messages.subscribe', { sessionKey })
  }

  async unsubscribeMessages(sessionKey: string): Promise<void> {
    await this.rpc.call('sessions.messages.unsubscribe', { sessionKey })
  }

  async listAgentFiles(agentId: string, path?: string): Promise<AgentFileInfo[]> {
    const result = await this.rpc.call('agents.files.list', { agentId, path }) as Record<string, unknown>
    const files = (result.files as Array<Record<string, unknown>>) || []
    return files.map((f) => ({
      name: f.name as string,
      path: f.path as string,
      type: f.type as 'file' | 'directory',
      size: f.size as number | undefined,
      modifiedAt: f.modifiedAt as number | undefined,
    }))
  }

  async getAgentFile(agentId: string, path: string): Promise<string> {
    const result = await this.rpc.call('agents.files.get', { agentId, path }) as Record<string, unknown>
    return result.content as string
  }

  async setAgentFile(agentId: string, path: string, content: string): Promise<void> {
    await this.rpc.call('agents.files.set', { agentId, path, content })
  }

  async getConfig(key?: string): Promise<unknown> {
    const result = await this.rpc.call('config.get', { key }) as Record<string, unknown>
    return result.value ?? result
  }

  async setConfig(key: string, value: unknown): Promise<void> {
    await this.rpc.call('config.set', { key, value })
  }

  async getSystemStatus(): Promise<SystemStatus> {
    const result = await this.rpc.call('status') as Record<string, unknown>
    return {
      version: result.version as string,
      uptime: result.uptime as number,
      connections: result.connections as number,
      memory: result.memory as SystemStatus['memory'],
    }
  }

  async getTTSStatus(): Promise<TTSStatus> {
    const result = await this.rpc.call('tts.status') as Record<string, unknown>
    return {
      enabled: result.enabled as boolean,
      provider: result.provider as string | undefined,
      providers: result.providers as string[] | undefined,
    }
  }

  async enableTTS(provider?: string): Promise<void> {
    await this.rpc.call('tts.enable', { provider })
  }

  async disableTTS(): Promise<void> {
    await this.rpc.call('tts.disable')
  }

  async convertTTS(text: string): Promise<TTSConvertResult> {
    const result = await this.rpc.call('tts.convert', { text }) as Record<string, unknown>
    return {
      audioUrl: result.audioUrl as string | undefined,
      audioData: result.audioData as string | undefined,
      duration: result.duration as number | undefined,
    }
  }

  async listApprovals(): Promise<ApprovalRequest[]> {
    const result = await this.rpc.call('exec.approval.list') as Record<string, unknown>
    const approvals = (result.approvals as Array<Record<string, unknown>>) || []
    return approvals.map((a) => ({
      id: a.id as string,
      type: a.type as 'exec' | 'plugin',
      toolName: a.toolName as string | undefined,
      arguments: a.arguments as Record<string, unknown> | undefined,
      pluginId: a.pluginId as string | undefined,
      message: a.message as string,
      createdAt: a.createdAt as number,
      status: a.status as 'pending' | 'approved' | 'denied',
    }))
  }

  async approveRequest(approvalId: string): Promise<void> {
    await this.rpc.call('exec.approval.resolve', { approvalId, decision: 'approved' })
  }

  async denyRequest(approvalId: string): Promise<void> {
    await this.rpc.call('exec.approval.resolve', { approvalId, decision: 'denied' })
  }

  async listCronJobs(): Promise<CronJob[]> {
    const result = await this.rpc.call('cron.list') as Record<string, unknown>
    const jobs = (result.jobs as Array<Record<string, unknown>>) || []
    return jobs.map((j) => ({
      id: j.id as string,
      name: j.name as string,
      schedule: j.schedule as string,
      command: j.command as string,
      enabled: j.enabled as boolean,
      lastRun: j.lastRun as number | undefined,
      nextRun: j.nextRun as number | undefined,
    }))
  }

  async addCronJob(job: Omit<CronJob, 'id'>): Promise<string> {
    const result = await this.rpc.call('cron.add', job) as Record<string, unknown>
    return result.id as string
  }

  async removeCronJob(jobId: string): Promise<void> {
    await this.rpc.call('cron.remove', { jobId })
  }

  async runCronJob(jobId: string): Promise<void> {
    await this.rpc.call('cron.run', { jobId })
  }

  async listCompactions(sessionKey: string): Promise<SessionCompaction[]> {
    const result = await this.rpc.call('sessions.compaction.list', { sessionKey }) as Record<string, unknown>
    const compactions = (result.compactions as Array<Record<string, unknown>>) || []
    return compactions.map((c) => ({
      id: c.id as string,
      sessionKey: c.sessionKey as string,
      createdAt: c.createdAt as number,
      messageCount: c.messageCount as number,
      summary: c.summary as string | undefined,
    }))
  }

  async restoreCompaction(sessionKey: string, compactionId: string): Promise<void> {
    await this.rpc.call('sessions.compaction.restore', { sessionKey, compactionId })
  }

  async branchCompaction(sessionKey: string, compactionId: string): Promise<string> {
    const result = await this.rpc.call('sessions.compaction.branch', { sessionKey, compactionId }) as Record<string, unknown>
    return result.sessionKey as string
  }

  async createAgent(agentId: string, config?: { model?: string; systemPrompt?: string }): Promise<void> {
    await this.rpc.call('agents.create', { agentId, ...config })
  }

  async updateAgent(agentId: string, config: { model?: string; systemPrompt?: string; heartbeat?: { enabled: boolean; every: string; prompt: string } }): Promise<void> {
    await this.rpc.call('agents.update', { agentId, ...config })
  }

  async deleteAgent(agentId: string): Promise<void> {
    await this.rpc.call('agents.delete', { agentId })
  }

  async getEffectiveTools(sessionKey?: string): Promise<ToolDefinition[]> {
    const result = await this.rpc.call('tools.effective', { sessionKey }) as Record<string, unknown>
    const tools = (result.tools as Array<Record<string, unknown>>) || []
    return tools.map((t) => ({
      name: t.name as string,
      description: t.description as string,
      parameters: t.parameters as Record<string, unknown>,
      category: t.category as string | undefined,
    }))
  }

  async getObservabilityStats(): Promise<ObservabilityStats> {
    const result = await this.rpc.call('observability.stats') as Record<string, unknown>
    return {
      totalSessions: result.totalSessions as number,
      activeSessions: result.activeSessions as number,
      totalMessages: result.totalMessages as number,
      totalTokens: result.totalTokens as number,
      modelUsage: result.modelUsage as Record<string, number>,
      toolCalls: result.toolCalls as number,
      averageResponseTime: result.averageResponseTime as number,
    }
  }

  async getObservabilitySessions(): Promise<ObservabilitySession[]> {
    const result = await this.rpc.call('observability.sessions') as Record<string, unknown>
    const sessions = (result.sessions as Array<Record<string, unknown>>) || []
    return sessions.map((s) => ({
      sessionKey: s.sessionKey as string,
      agentId: s.agentId as string,
      status: s.status as string,
      messageCount: s.messageCount as number,
      lastActivity: s.lastActivity as number,
      model: s.model as string | undefined,
    }))
  }

  // Node pairing
  async initiateNodePairing(name?: string): Promise<PairingRequest> {
    const result = await this.rpc.call('node.pair.initiate', { name }) as Record<string, unknown>
    return this.parsePairingRequest(result)
  }

  async getNodePairingRequests(): Promise<PairingRequest[]> {
    const result = await this.rpc.call('node.pair.list') as Record<string, unknown>
    const requests = (result.requests as Array<Record<string, unknown>>) || []
    return requests.map((r) => this.parsePairingRequest(r))
  }

  async approveNodePairing(requestId: string): Promise<PairingResult> {
    const result = await this.rpc.call('node.pair.approve', { requestId }) as Record<string, unknown>
    return {
      success: result.success as boolean,
      token: result.token as string | undefined,
      error: result.error as string | undefined,
    }
  }

  async rejectNodePairing(requestId: string): Promise<void> {
    await this.rpc.call('node.pair.reject', { requestId })
  }

  // Device pairing
  async initiateDevicePairing(name?: string): Promise<PairingRequest> {
    const result = await this.rpc.call('device.pair.initiate', { name }) as Record<string, unknown>
    return this.parsePairingRequest(result)
  }

  async getDevicePairingRequests(): Promise<PairingRequest[]> {
    const result = await this.rpc.call('device.pair.list') as Record<string, unknown>
    const requests = (result.requests as Array<Record<string, unknown>>) || []
    return requests.map((r) => this.parsePairingRequest(r))
  }

  async approveDevicePairing(requestId: string): Promise<PairingResult> {
    const result = await this.rpc.call('device.pair.approve', { requestId }) as Record<string, unknown>
    return {
      success: result.success as boolean,
      token: result.token as string | undefined,
      error: result.error as string | undefined,
    }
  }

  async rejectDevicePairing(requestId: string): Promise<void> {
    await this.rpc.call('device.pair.reject', { requestId })
  }

  private parsePairingRequest(r: Record<string, unknown>): PairingRequest {
    return {
      id: r.id as string,
      type: r.type as 'node' | 'device',
      name: r.name as string | undefined,
      status: r.status as 'pending' | 'approved' | 'rejected',
      createdAt: r.createdAt as number,
      expiresAt: r.expiresAt as number,
      code: r.code as string | undefined,
    }
  }

  // Skills
  async listSkills(): Promise<Skill[]> {
    const result = await this.rpc.call('skills.list') as Record<string, unknown>
    const skills = (result.skills as Array<Record<string, unknown>>) || []
    return skills.map((s) => this.parseSkill(s))
  }

  async getSkill(skillId: string): Promise<Skill> {
    const result = await this.rpc.call('skills.get', { skillId }) as Record<string, unknown>
    return this.parseSkill(result)
  }

  async createSkill(skill: Omit<Skill, 'id'>): Promise<string> {
    const result = await this.rpc.call('skills.create', skill) as Record<string, unknown>
    return result.id as string
  }

  async updateSkill(skillId: string, skill: Partial<Skill>): Promise<void> {
    await this.rpc.call('skills.update', { skillId, ...skill })
  }

  async deleteSkill(skillId: string): Promise<void> {
    await this.rpc.call('skills.delete', { skillId })
  }

  private parseSkill(s: Record<string, unknown>): Skill {
    return {
      id: s.id as string,
      name: s.name as string,
      description: s.description as string,
      enabled: s.enabled as boolean,
      trigger: s.trigger as string | undefined,
      actions: s.actions as Skill['actions'],
    }
  }

  // Wizard
  async startWizard(wizardType: string): Promise<WizardState> {
    const result = await this.rpc.call('wizard.start', { wizardType }) as Record<string, unknown>
    return this.parseWizardState(result)
  }

  async getWizardState(wizardId: string): Promise<WizardState> {
    const result = await this.rpc.call('wizard.state', { wizardId }) as Record<string, unknown>
    return this.parseWizardState(result)
  }

  async submitWizardStep(wizardId: string, stepId: string, value: unknown): Promise<WizardState> {
    const result = await this.rpc.call('wizard.submit', { wizardId, stepId, value }) as Record<string, unknown>
    return this.parseWizardState(result)
  }

  async cancelWizard(wizardId: string): Promise<void> {
    await this.rpc.call('wizard.cancel', { wizardId })
  }

  private parseWizardState(s: Record<string, unknown>): WizardState {
    return {
      wizardId: s.wizardId as string,
      currentStep: s.currentStep as number,
      totalSteps: s.totalSteps as number,
      completed: s.completed as boolean,
      data: s.data as Record<string, unknown>,
    }
  }

  // Voice wake
  async getVoiceWakeConfig(): Promise<VoiceWakeConfig> {
    const result = await this.rpc.call('voicewake.get') as Record<string, unknown>
    return {
      enabled: result.enabled as boolean,
      keyword: result.keyword as string | undefined,
      sensitivity: result.sensitivity as number | undefined,
    }
  }

  async setVoiceWakeConfig(config: VoiceWakeConfig): Promise<void> {
    await this.rpc.call('voicewake.set', { ...config })
  }

  // Update
  async checkForUpdate(): Promise<UpdateInfo> {
    const result = await this.rpc.call('update.check') as Record<string, unknown>
    return {
      available: result.available as boolean,
      version: result.version as string | undefined,
      releaseNotes: result.releaseNotes as string | undefined,
      downloadUrl: result.downloadUrl as string | undefined,
    }
  }

  async runUpdate(): Promise<void> {
    await this.rpc.call('update.run')
  }

  // Secrets
  async getSecret(key: string): Promise<SecretInfo> {
    const result = await this.rpc.call('secrets.get', { key }) as Record<string, unknown>
    return {
      key: result.key as string,
      exists: result.exists as boolean,
      createdAt: result.createdAt as number | undefined,
      updatedAt: result.updatedAt as number | undefined,
    }
  }

  async setSecret(key: string, value: string): Promise<void> {
    await this.rpc.call('secrets.set', { key, value })
  }

  async deleteSecret(key: string): Promise<void> {
    await this.rpc.call('secrets.delete', { key })
  }

  // Usage
  async getUsageStats(period?: string): Promise<UsageStats> {
    const result = await this.rpc.call('usage.stats', { period }) as Record<string, unknown>
    return {
      period: result.period as string,
      inputTokens: result.inputTokens as number,
      outputTokens: result.outputTokens as number,
      totalTokens: result.totalTokens as number,
      requestCount: result.requestCount as number,
      modelBreakdown: result.modelBreakdown as UsageStats['modelBreakdown'],
    }
  }

  // Channels
  async listChannels(): Promise<Channel[]> {
    const result = await this.rpc.call('channels.list') as Record<string, unknown>
    const channels = (result.channels as Array<Record<string, unknown>>) || []
    return channels.map((c) => ({
      id: c.id as string,
      name: c.name as string,
      type: c.type as 'websocket' | 'http' | 'webhook',
      config: c.config as Record<string, unknown>,
      enabled: c.enabled as boolean,
    }))
  }

  async createChannel(channel: Omit<Channel, 'id'>): Promise<string> {
    const result = await this.rpc.call('channels.create', channel) as Record<string, unknown>
    return result.id as string
  }

  async updateChannel(channelId: string, channel: Partial<Channel>): Promise<void> {
    await this.rpc.call('channels.update', { channelId, ...channel })
  }

  async deleteChannel(channelId: string): Promise<void> {
    await this.rpc.call('channels.delete', { channelId })
  }

  // Logs
  async tailLogs(options?: { level?: string; source?: string; limit?: number }): Promise<LogEntry[]> {
    const result = await this.rpc.call('logs.tail', options || {}) as Record<string, unknown>
    const logs = (result.logs as Array<Record<string, unknown>>) || []
    return logs.map((l) => ({
      timestamp: l.timestamp as number,
      level: l.level as 'debug' | 'info' | 'warn' | 'error',
      message: l.message as string,
      source: l.source as string | undefined,
      data: l.data,
    }))
  }

  // Node invoke
  async invokeNode(nodeId: string, method: string, params?: unknown): Promise<unknown> {
    return this.rpc.call('node.invoke', { nodeId, method, params })
  }

  // Gateway method - call plugin registered gateway methods
  async callGatewayMethod<T = unknown>(method: string, params?: unknown): Promise<T> {
    return this.rpc.call('gateway.method', { method, params }) as Promise<T>
  }

  // Thinking phase SSE subscription
  subscribeThinkingPhase(
    sessionId: string,
    callback: (phase: import('@shared/types.js').ThinkingPhaseState) => void
  ): () => void {
    const gatewayUrl = process.env.VITE_OPENCLAW_GATEWAY_URL || 'ws://localhost:18789'
    const baseUrl = gatewayUrl.replace(/^ws/, 'http')
    const sseUrl = `${baseUrl}/plugins/thinking/api/phase/stream?sessionId=${sessionId}`
    
    const es = new EventSource(sseUrl)
    
    es.addEventListener('phase_change', (e: MessageEvent) => {
      try {
        const state = JSON.parse(e.data)
        callback(state)
      } catch {
        // ignore parse errors
      }
    })
    
    return () => {
      es.close()
    }
  }

  onStatusChange(callback: (status: AgentStatus) => void): () => void {
    return this.onStatus(callback)
  }

  onStatus(listener: (status: AgentStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => { this.statusListeners.delete(listener) }
  }

  onEvent(listener: (event: AgentEvent) => void): () => void {
    this.eventListeners.add(listener)
    return () => { this.eventListeners.delete(listener) }
  }

  private emitStatus(status: AgentStatus): void {
    for (const listener of this.statusListeners) {
      try { listener(status) } catch { }
    }
  }

  private emitEvent(event: AgentEvent): void {
    for (const listener of this.eventListeners) {
      try { listener(event) } catch { }
    }
  }
}
