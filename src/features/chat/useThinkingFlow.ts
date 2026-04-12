import { useState, useCallback, useRef, useEffect } from 'react'
import type { ActivityLogEntry, ThinkingFlowState, ThinkingPhaseState, ThinkingPhase } from '@shared/types'
import { PHASE_CATEGORIES, PHASE_LABELS } from '@shared/types'
import { useAgent } from '@/contexts/AgentContext'

const INITIAL_STATE: ThinkingFlowState = {
  phase: 'idle',
  runId: '',
  sessionKey: '',
  startTime: 0,
  thinkingContent: '',
  outputContent: '',
  toolCalls: [],
  activityLog: [],
}

const isBlindSpotPhase = (phase: ThinkingPhase): boolean => {
  return PHASE_CATEGORIES.blind_spot.includes(phase as typeof PHASE_CATEGORIES.blind_spot[number])
}

export function useThinkingFlow() {
  const [flowState, setFlowState] = useState<ThinkingFlowState>(INITIAL_STATE)
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([])
  const [currentTool, setCurrentTool] = useState<{ name: string; startedAt: number } | null>(null)
  const [elapsedTime, setElapsedTime] = useState(0)
  const [phaseState, setPhaseState] = useState<ThinkingPhaseState | null>(null)
  
  const startTimeRef = useRef<number>(0)
  const animationFrameRef = useRef<number | null>(null)
  const sseUnsubscribeRef = useRef<(() => void) | null>(null)
  
  const { currentAdapter } = useAgent()

  const reset = useCallback(() => {
    setFlowState(INITIAL_STATE)
    setActivityLog([])
    setCurrentTool(null)
    setElapsedTime(0)
    setPhaseState(null)
    startTimeRef.current = 0
    
    if (sseUnsubscribeRef.current) {
      sseUnsubscribeRef.current()
      sseUnsubscribeRef.current = null
    }
  }, [])

  const subscribeToThinkingPhase = useCallback((sessionId: string) => {
    if (!currentAdapter?.subscribeThinkingPhase) {
      console.log('[useThinkingFlow] subscribeThinkingPhase not available on adapter')
      return
    }

    if (sseUnsubscribeRef.current) {
      sseUnsubscribeRef.current()
    }

    console.log('[useThinkingFlow] Subscribing to thinking phase for session:', sessionId)
    
    const unsubscribe = currentAdapter.subscribeThinkingPhase(sessionId, (state: ThinkingPhaseState) => {
      console.log('[useThinkingFlow] Phase update:', state.phase, 'elapsed:', state.phaseElapsedTime)
      setPhaseState(state)
      
      if (isBlindSpotPhase(state.phase)) {
        setFlowState(prev => ({
          ...prev,
          phase: state.phase as ThinkingFlowState['phase'],
        }))
      }
    })
    
    sseUnsubscribeRef.current = unsubscribe
  }, [currentAdapter])

  const handleLifecycleStart = useCallback(() => {
    const now = Date.now()
    startTimeRef.current = now
    setFlowState(prev => ({
      ...prev,
      phase: 'thinking',
      startTime: now,
    }))
    // 不要清除 phaseState，保留 SSE 获取的盲区阶段状态
  }, [])

  const handleAssistantStream = useCallback((content: string, isThinking: boolean) => {
    setFlowState(prev => ({
      ...prev,
      phase: isThinking ? 'thinking' : 'responding',
      ...(isThinking 
        ? { thinkingContent: prev.thinkingContent + content }
        : { outputContent: prev.outputContent + content }
      ),
    }))
  }, [])

  const handleToolStart = useCallback((
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
    startedAt: number
  ) => {
    const description = describeToolUse(toolName, args)
    
    setFlowState(prev => ({
      ...prev,
      phase: 'tool_calling',
      toolCalls: [
        ...(prev.toolCalls || []),
        {
          id: toolCallId,
          name: toolName,
          status: 'running' as const,
          startedAt,
          args,
        },
      ],
    }))

    setActivityLog(prev => [
      ...prev,
      {
        id: toolCallId,
        toolName,
        description,
        startedAt,
        phase: 'running' as const,
        input: args,
      },
    ])

    setCurrentTool({ name: toolName, startedAt })
  }, [])

  const handleToolResult = useCallback((
    toolCallId: string,
    result: unknown,
    duration?: number
  ) => {
    const now = Date.now()
    
    setFlowState(prev => ({
      ...prev,
      toolCalls: (prev.toolCalls || []).map(tc =>
        tc.id === toolCallId
          ? { ...tc, status: 'success' as const, result, duration, endTime: now }
          : tc
      ),
    }))

    setActivityLog(prev => prev.map(entry =>
      entry.id === toolCallId
        ? {
          ...entry,
          phase: 'completed' as const,
          completedAt: now,
          duration: duration ?? (now - entry.startedAt),
          output: result,
        }
        : entry
    ))

    setCurrentTool(null)
  }, [])

  const handleLifecycleEnd = useCallback(() => {
    setFlowState(prev => ({
      ...prev,
      phase: 'completed',
    }))
    setCurrentTool(null)
    
    if (sseUnsubscribeRef.current) {
      sseUnsubscribeRef.current()
      sseUnsubscribeRef.current = null
    }
  }, [])

  useEffect(() => {
    if (flowState.phase === 'idle' || flowState.phase === 'completed') {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      return
    }

    const updateElapsed = () => {
      if (startTimeRef.current) {
        setElapsedTime(Date.now() - startTimeRef.current)
      }
      animationFrameRef.current = requestAnimationFrame(updateElapsed)
    }

    animationFrameRef.current = requestAnimationFrame(updateElapsed)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }
  }, [flowState.phase])

  useEffect(() => {
    return () => {
      if (sseUnsubscribeRef.current) {
        sseUnsubscribeRef.current()
      }
    }
  }, [])

  return {
    flowState,
    activityLog,
    currentTool,
    elapsedTime,
    phaseState,
    subscribeToThinkingPhase,
    handleLifecycleStart,
    handleAssistantStream,
    handleToolStart,
    handleToolResult,
    handleLifecycleEnd,
    reset,
    isBlindSpotPhase,
    getPhaseLabel: (phase: ThinkingPhase) => PHASE_LABELS[phase] || phase,
  }
}

function describeToolUse(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'read':
    case 'read_file':
      return `Reading ${args.path || args.file_path || 'file'}`
    case 'write':
    case 'write_file':
      return `Writing ${args.path || args.file_path || 'file'}`
    case 'exec':
      return `Running: ${args.command || 'command'}`
    case 'web_search':
      return `Searching: ${args.query || 'web'}`
    case 'web_fetch':
      return `Fetching: ${args.url || 'url'}`
    default:
      return `Using ${name}`
  }
}
