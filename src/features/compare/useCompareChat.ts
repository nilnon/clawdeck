import { useState, useCallback } from 'react'

interface ToolCall {
  id: string
  name: string
  args?: Record<string, unknown>
  status: 'running' | 'success' | 'error'
  startTime?: number
  result?: unknown
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  isStreaming?: boolean
  thinking?: string
  toolCalls?: ToolCall[]
}

interface CompareStats {
  totalTime: number
  firstTokenTime?: number
  tokenCount: number
  toolCallCount: number
  startTime: number
}

interface AgentState {
  messages: Message[]
  isStreaming: boolean
  stats: CompareStats
  error?: string
}

interface CompareState {
  openclaw: AgentState
  hermes: AgentState
}

const initialStats: CompareStats = {
  totalTime: 0,
  firstTokenTime: undefined,
  tokenCount: 0,
  toolCallCount: 0,
  startTime: 0,
}

const initialAgentState: AgentState = {
  messages: [],
  isStreaming: false,
  stats: { ...initialStats },
}

const initialState: CompareState = {
  openclaw: { ...initialAgentState },
  hermes: { ...initialAgentState },
}

export function useCompareChat() {
  const [state, setState] = useState<CompareState>(initialState)

  const sendMessage = useCallback(async (
    message: string,
    openclawSessionId?: string,
    hermesSessionId?: string
  ) => {
    const startTime = Date.now()

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
      timestamp: startTime,
    }

    setState({
      openclaw: {
        messages: [userMessage],
        isStreaming: true,
        stats: { ...initialStats, startTime },
      },
      hermes: {
        messages: [userMessage],
        isStreaming: true,
        stats: { ...initialStats, startTime },
      },
    })

    console.log('[useCompareChat] Sending message:', message)

    try {
      const res = await fetch('/api/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, openclawSessionId, hermesSessionId }),
      })

      console.log('[useCompareChat] Response status:', res.status)

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || `HTTP ${res.status}`)
      }

      if (!res.body) throw new Error('No response body')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          console.log('[useCompareChat] Stream done')
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data: ')) continue

          const data = trimmed.slice(6)
          if (data === '[DONE]') {
            console.log('[useCompareChat] Received [DONE]')
            continue
          }

          try {
            const chunk = JSON.parse(data)
            console.log('[useCompareChat] Received chunk:', chunk.source, chunk.chunkType || 'text', chunk.done ? 'done' : '')
            const source = chunk.source as 'openclaw' | 'hermes'

            setState(prev => ({
              ...prev,
              [source]: updateAgentState(prev[source], chunk, startTime),
            }))
          } catch (err) {
            console.error('[useCompareChat] Parse error:', err)
          }
        }
      }

      console.log('[useCompareChat] Stream complete')
    } catch (err) {
      console.error('[useCompareChat] Error:', err)
      const errorMsg = err instanceof Error ? err.message : String(err)
      setState(prev => ({
        openclaw: { ...prev.openclaw, isStreaming: false, error: errorMsg },
        hermes: { ...prev.hermes, isStreaming: false, error: errorMsg },
      }))
    }
  }, [])

  const reset = useCallback(() => {
    setState(initialState)
  }, [])

  return { state, sendMessage, reset }
}

function updateAgentState(prev: AgentState, chunk: any, startTime: number): AgentState {
  const now = Date.now()
  let messages = [...prev.messages]
  let stats = { ...prev.stats }

  if (chunk.error) {
    let assistantMsg = messages.find(m => m.role === 'assistant')
    if (!assistantMsg) {
      assistantMsg = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Error: ${chunk.error}`,
        timestamp: now,
        isStreaming: false,
      }
      messages.push(assistantMsg)
    } else {
      const msgIndex = messages.findIndex(m => m.id === assistantMsg!.id)
      messages[msgIndex] = {
        ...assistantMsg,
        content: assistantMsg.content + `\nError: ${chunk.error}`,
        isStreaming: false,
      }
    }
    return {
      messages,
      isStreaming: false,
      stats: { ...stats, totalTime: now - startTime },
      error: chunk.error,
    }
  }

  let assistantMsg = messages.find(m => m.role === 'assistant')
  if (!assistantMsg) {
    assistantMsg = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: now,
      isStreaming: true,
      thinking: '',
      toolCalls: [],
    }
    messages.push(assistantMsg)
  }

  const msgIndex = messages.findIndex(m => m.id === assistantMsg!.id)
  const currentMsg = messages[msgIndex]

  if (chunk.chunkType === 'thinking' && chunk.thinking) {
    messages[msgIndex] = {
      ...currentMsg,
      thinking: (currentMsg.thinking || '') + chunk.thinking,
    }
  } else if (chunk.chunkType === 'tool_start') {
    const newToolCall: ToolCall = {
      id: chunk.toolCallId || crypto.randomUUID(),
      name: chunk.toolName || 'unknown',
      args: chunk.toolArgs,
      status: 'running',
      startTime: chunk.toolStartedAt || now,
    }
    messages[msgIndex] = {
      ...currentMsg,
      toolCalls: [...(currentMsg.toolCalls || []), newToolCall],
    }
    stats.toolCallCount++
  } else if (chunk.chunkType === 'tool_result') {
    messages[msgIndex] = {
      ...currentMsg,
      toolCalls: currentMsg.toolCalls?.map(tc =>
        tc.id === chunk.toolCallId
          ? { ...tc, status: 'success' as const, result: chunk.toolResult }
          : tc
      ),
    }
  } else if (chunk.content) {
    if (!stats.firstTokenTime) {
      stats.firstTokenTime = now - startTime
    }
    stats.tokenCount++

    messages[msgIndex] = {
      ...currentMsg,
      content: currentMsg.content + chunk.content,
    }
  }

  if (chunk.done) {
    messages[msgIndex] = { ...messages[msgIndex], isStreaming: false }
    stats.totalTime = now - startTime
    return { messages, isStreaming: false, stats }
  }

  return { messages, isStreaming: true, stats }
}
