import type {
  ThinkingPhase,
  PhaseState,
  PhaseTransition,
  PhaseMetadata,
  HookContext,
  AgentEvent,
  ThinkingPluginConfig,
} from '../types'
import { getPhaseTimeout, DEFAULT_PHASE_TIMEOUTS } from '../config'

export const HOOK_TO_PHASE: Record<string, {
  phase: ThinkingPhase
  priority: number
  description: string
}> = {
  'before_model_resolve': {
    phase: 'model_resolving',
    priority: 1,
    description: '模型解析开始',
  },
  'before_prompt_build': {
    phase: 'prompt_building',
    priority: 2,
    description: '提示词构建开始',
  },
  'before_agent_start': {
    phase: 'llm_connecting',
    priority: 3,
    description: 'Agent 启动',
  },
  'agent_end': {
    phase: 'completed',
    priority: 99,
    description: 'Agent 结束',
  },
  'llm_input': {
    phase: 'llm_connecting',
    priority: 4,
    description: 'LLM 输入',
  },
  'llm_output': {
    phase: 'thinking',
    priority: 5,
    description: 'LLM 开始输出',
  },
  'before_tool_call': {
    phase: 'tool_calling',
    priority: 10,
    description: '工具调用开始',
  },
  'after_tool_call': {
    phase: 'tool_executing',
    priority: 11,
    description: '工具调用完成',
  },
  'tool_result_persist': {
    phase: 'tool_complete',
    priority: 12,
    description: '工具结果持久化',
  },
  'message_received': {
    phase: 'idle',
    priority: 0,
    description: '用户消息接收',
  },
  'message_sending': {
    phase: 'model_resolving',
    priority: 1,
    description: '消息发送中',
  },
  'message_sent': {
    phase: 'completed',
    priority: 98,
    description: '消息已发送',
  },
  'before_message_write': {
    phase: 'generating',
    priority: 6,
    description: '消息写入前',
  },
  'before_compaction': {
    phase: 'prompt_building',
    priority: 2,
    description: '上下文压缩前',
  },
  'after_compaction': {
    phase: 'prompt_building',
    priority: 2,
    description: '上下文压缩后',
  },
  'before_reset': {
    phase: 'idle',
    priority: 0,
    description: '重置前',
  },
  'session_start': {
    phase: 'idle',
    priority: 0,
    description: '会话开始',
  },
  'session_end': {
    phase: 'completed',
    priority: 100,
    description: '会话结束',
  },
  'subagent_spawning': {
    phase: 'tool_calling',
    priority: 10,
    description: '子 Agent 创建中',
  },
  'subagent_delivery_target': {
    phase: 'tool_executing',
    priority: 11,
    description: '子 Agent 目标投递',
  },
  'subagent_spawned': {
    phase: 'tool_executing',
    priority: 11,
    description: '子 Agent 已创建',
  },
  'subagent_ended': {
    phase: 'tool_complete',
    priority: 12,
    description: '子 Agent 结束',
  },
  'gateway_start': {
    phase: 'idle',
    priority: 0,
    description: '网关启动',
  },
  'gateway_stop': {
    phase: 'idle',
    priority: 0,
    description: '网关停止',
  },
  'inbound_claim': {
    phase: 'idle',
    priority: 0,
    description: '入站声明',
  },
  'before_dispatch': {
    phase: 'model_resolving',
    priority: 1,
    description: '调度前',
  },
}

export interface PhaseManagerEvents {
  phase_change: (state: PhaseState, transition: PhaseTransition) => void
  phase_timeout: (state: PhaseState) => void
  session_clear: (sessionId: string) => void
}

export class PhaseStateManager {
  private sessions = new Map<string, PhaseState>()
  private config: ThinkingPluginConfig
  private listeners = new Map<string, Set<Function>>()
  private lastActivity = new Map<string, number>()

  constructor(config: ThinkingPluginConfig) {
    this.config = config
  }

  on<K extends keyof PhaseManagerEvents>(
    event: K,
    listener: PhaseManagerEvents[K]
  ): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(listener as Function)
  }

  off<K extends keyof PhaseManagerEvents>(
    event: K,
    listener: PhaseManagerEvents[K]
  ): void {
    this.listeners.get(event)?.delete(listener as Function)
  }

  private emit<K extends keyof PhaseManagerEvents>(
    event: K,
    ...args: Parameters<PhaseManagerEvents[K]>
  ): void {
    this.listeners.get(event)?.forEach(fn => fn(...args))
  }

  resolveSessionId(context: HookContext): string {
    return context.sessionId || context.runId || 'unknown'
  }

  onHookEvent(hookName: string, context: HookContext): PhaseState | null {
    const mapping = HOOK_TO_PHASE[hookName]
    if (!mapping) return null

    const sessionId = this.resolveSessionId(context)
    const currentState = this.sessions.get(sessionId)

    const newState = this.transition(
      sessionId,
      mapping.phase,
      'hook',
      {
        hookName,
        ...this.extractMetadata(hookName, context),
      }
    )

    return newState
  }

  onAgentEvent(event: AgentEvent): PhaseState | null {
    const sessionId = event.sessionKey || event.runId

    let newPhase: ThinkingPhase | null = null

    if (event.stream === 'lifecycle') {
      if (event.data?.status === 'end') {
        newPhase = 'completed'
      } else if (event.data?.status === 'start') {
        newPhase = 'llm_first_token'
      }
    } else if (event.stream === 'assistant') {
      if (event.data?.thinking && !event.data?.delta) {
        newPhase = 'thinking'
      } else if (event.data?.delta) {
        newPhase = 'generating'
      }
    } else if (event.stream === 'tool') {
      if (event.data?.name && !event.data?.result) {
        newPhase = 'tool_calling'
      } else if (event.data?.result) {
        newPhase = 'tool_complete'
      }
    }

    if (!newPhase) return null

    return this.transition(sessionId, newPhase, 'agent_event', event.data)
  }

  private transition(
    sessionId: string,
    toPhase: ThinkingPhase,
    trigger: PhaseTransition['trigger'],
    metadata?: Record<string, unknown>
  ): PhaseState {
    const now = Date.now()
    const current = this.sessions.get(sessionId)

    if (current && current.phase === toPhase) {
      return current
    }

    const transition: PhaseTransition = {
      from: current?.phase || 'idle',
      to: toPhase,
      timestamp: now,
      duration: current ? now - current.phaseStartTime : 0,
      trigger,
      metadata,
    }

    const newMetadata = this.mergeMetadata(current?.metadata, metadata)

    const newState: PhaseState = {
      sessionId,
      runId: metadata?.runId as string || current?.runId || '',
      userId: metadata?.userId as string || current?.userId,
      phase: toPhase,
      phaseStartTime: now,
      phaseElapsedTime: 0,
      previousPhase: current?.phase,
      phaseHistory: [
        ...(current?.phaseHistory || []),
        transition,
      ].slice(-this.config.phaseTracking.maxHistoryPerSession),
      metadata: newMetadata,
    }

    this.sessions.set(sessionId, newState)
    this.lastActivity.set(sessionId, now)
    this.emit('phase_change', newState, transition)

    // 如果是终态，安排清理
    if (['completed', 'error', 'cancelled'].includes(toPhase)) {
      setTimeout(() => this.clearSession(sessionId), 60000) // 1分钟后清理
    }

    return newState
  }

  private extractMetadata(
    hookName: string,
    context: HookContext
  ): Record<string, unknown> {
    const metadata: Record<string, unknown> = {}

    if (context.modelName) {
      metadata.modelName = context.modelName
    }
    if (context.userId) {
      metadata.userId = context.userId
    }
    if (context.runId) {
      metadata.runId = context.runId
    }

    if (hookName === 'before_tool_call' && context.payload) {
      metadata.currentTool = {
        name: context.payload.toolName || context.payload.name,
        callId: context.payload.toolCallId || context.payload.callId,
        args: context.payload.arguments || context.payload.args,
        startTime: Date.now(),
      }
    }

    if (hookName === 'after_tool_call' && context.payload) {
      metadata.toolResult = context.payload.result
    }

    return metadata
  }

  private mergeMetadata(
    current?: PhaseMetadata,
    updates?: Record<string, unknown>
  ): PhaseMetadata {
    const base: PhaseMetadata = current || {
      completedTools: [],
    }

    if (!updates) return base

    const merged: PhaseMetadata = { ...base }

    if (updates.modelName) {
      merged.modelName = updates.modelName as string
    }
    if (updates.modelProvider) {
      merged.modelProvider = updates.modelProvider as string
    }
    if (updates.currentTool) {
      merged.currentTool = updates.currentTool as PhaseMetadata['currentTool']
    }
    if (updates.completedTools) {
      merged.completedTools = updates.completedTools as PhaseMetadata['completedTools']
    }
    if (updates.tokens) {
      merged.tokens = updates.tokens as PhaseMetadata['tokens']
    }
    if (updates.timing) {
      merged.timing = {
        ...merged.timing,
        ...updates.timing,
      } as PhaseMetadata['timing']
    }
    if (updates.error) {
      merged.error = updates.error as PhaseMetadata['error']
    }

    return merged
  }

  getState(sessionId: string): PhaseState | undefined {
    const state = this.sessions.get(sessionId)
    if (state) {
      state.phaseElapsedTime = Date.now() - state.phaseStartTime
    }
    return state
  }

  getAllStates(): Map<string, PhaseState> {
    return new Map(this.sessions)
  }

  getActiveSessions(): PhaseState[] {
    const activePhases: ThinkingPhase[] = [
      'model_resolving', 'prompt_building', 'llm_connecting',
      'llm_first_token', 'thinking', 'generating',
      'tool_calling', 'tool_executing', 'tool_complete',
    ]

    return Array.from(this.sessions.values())
      .filter(s => activePhases.includes(s.phase))
      .map(s => {
        s.phaseElapsedTime = Date.now() - s.phaseStartTime
        return s
      })
  }

  checkTimeouts(): Array<{ sessionId: string; phase: ThinkingPhase; elapsed: number; threshold: number }> {
    const now = Date.now()
    const timeouts: Array<{ sessionId: string; phase: ThinkingPhase; elapsed: number; threshold: number }> = []
    const expiredSessions: string[] = []

    for (const state of this.sessions.values()) {
      const lastActive = this.lastActivity.get(state.sessionId) || state.phaseStartTime
      const inactiveTime = now - lastActive

      // 清理超过10分钟没有活动的会话
      if (inactiveTime > 600000) {
        expiredSessions.push(state.sessionId)
        continue
      }

      // 终态会话超过5分钟清理
      if (['completed', 'error', 'cancelled'].includes(state.phase) && inactiveTime > 300000) {
        expiredSessions.push(state.sessionId)
        continue
      }

      const threshold = getPhaseTimeout(this.config, state.phase)
      if (threshold <= 0) continue

      const elapsed = now - state.phaseStartTime
      // 只报告一次超时，避免重复日志
      if (elapsed > threshold && !state.timeoutStatus?.isTimeout) {
        state.timeoutStatus = {
          isTimeout: true,
          threshold,
          elapsed,
        }
        timeouts.push({
          sessionId: state.sessionId,
          phase: state.phase,
          elapsed,
          threshold,
        })
        this.emit('phase_timeout', state)
      }
    }

    // 清理过期会话
    for (const sessionId of expiredSessions) {
      this.clearSession(sessionId)
    }

    return timeouts
  }

  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId)
    this.lastActivity.delete(sessionId)
    this.emit('session_clear', sessionId)
  }

  setError(sessionId: string, error: { message: string; code?: string }): PhaseState | null {
    return this.transition(sessionId, 'error', 'hook', { error })
  }

  cancelSession(sessionId: string): PhaseState | null {
    return this.transition(sessionId, 'cancelled', 'user_action', {})
  }

  completeTool(sessionId: string, toolName: string, callId: string, success: boolean): void {
    const state = this.sessions.get(sessionId)
    if (!state) return

    const duration = Date.now() - (state.metadata.currentTool?.startTime || Date.now())

    state.metadata.completedTools.push({
      name: toolName,
      callId,
      duration,
      success,
    })

    state.metadata.currentTool = undefined
  }
}

export { DEFAULT_PHASE_TIMEOUTS }
