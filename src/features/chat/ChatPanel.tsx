import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Square, Bot, User, Loader2 } from 'lucide-react'
import { useAgent } from '@/contexts/AgentContext'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ChatChunk, ActivityLogEntry, ThinkingPhase } from '@shared/types'
import { PHASE_LABELS } from '@shared/types'
import { 
  ToolCallBlock, 
  ThinkingBubble, 
  ProcessingIndicator,
  type ToolCall 
} from './MessageBlocks'
import { useThinkingFlow } from './useThinkingFlow'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  isStreaming?: boolean
  thinking?: string
  thinkingDuration?: number
  thinkingStartTime?: number
  toolCalls?: ToolCall[]
  activityLog?: ActivityLogEntry[]
}

export default function ChatPanel({ sessionId }: { sessionId?: string | null }) {
  const { currentAgentId, agents } = useAgent()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
  const [collapsedMessages, setCollapsedMessages] = useState<Set<string>>(new Set())
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const currentAgent = agents.find(a => a.id === currentAgentId)

  const {
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
    reset: resetThinkingFlow,
    isBlindSpotPhase,
    getPhaseLabel,
  } = useThinkingFlow()

  useEffect(() => {
    if (!sessionId) {
      console.log('[ChatPanel] No sessionId, clearing messages')
      setMessages([])
      resetThinkingFlow()
      return
    }

    // 当 sessionId 变化时，立即订阅 thinking phase SSE
    // 这样可以捕获盲区阶段（model_resolving, prompt_building, llm_connecting）
    if (subscribeToThinkingPhase) {
      console.log('[ChatPanel] Subscribing to thinking phase for session:', sessionId)
      subscribeToThinkingPhase(sessionId)
    }

    const loadMessages = async () => {
      console.log('[ChatPanel] Loading messages for session:', sessionId)
      setIsLoadingMessages(true)
      try {
        const res = await fetch(`/api/sessions/${sessionId}`)
        console.log('[ChatPanel] Load messages response:', res.status)
        if (res.ok) {
          const data = await res.json()
          console.log('[ChatPanel] Session data:', data)
          if (data.messages && Array.isArray(data.messages)) {
            const mappedMessages = data.messages.map((m: any) => ({
              id: m.id || crypto.randomUUID(),
              role: m.role,
              content: m.content,
              timestamp: m.timestamp || Date.now(),
              thinking: m.thinking,
              thinkingDuration: m.thinkingDuration,
              thinkingStartTime: m.thinkingStartTime,
              toolCalls: m.toolCalls,
              activityLog: m.activityLog,
            }))
            console.log('[ChatPanel] Loaded messages count:', mappedMessages.length)
            setMessages(mappedMessages)
          } else {
            console.log('[ChatPanel] No messages in session data')
            setMessages([])
          }
        } else {
          console.error('[ChatPanel] Failed to load messages:', res.status, await res.text().catch(() => ''))
          setMessages([])
        }
      } catch (err) {
        console.error('[ChatPanel] Error loading messages:', err)
        setMessages([])
      } finally {
        setIsLoadingMessages(false)
      }
    }

    loadMessages()
  }, [sessionId, resetThinkingFlow])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => { scrollToBottom() }, [messages])

  const toggleMessageCollapse = useCallback((msgId: string) => {
    setCollapsedMessages(prev => {
      const newSet = new Set(prev)
      if (newSet.has(msgId)) {
        newSet.delete(msgId)
      } else {
        newSet.add(msgId)
      }
      return newSet
    })
  }, [])

  const sendMessage = useCallback(async () => {
    if (!input.trim() || !currentAgentId || isStreaming) return

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    }

    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setIsStreaming(true)
    handleLifecycleStart()

    const assistantMsg: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
      thinking: '',
      toolCalls: [],
      activityLog: [],
    }
    setMessages((prev) => [...prev, assistantMsg])
    
    // 如果还没有订阅，在这里订阅（兜底）
    // 正常情况在 useEffect 中已经订阅了
    if (sessionId && subscribeToThinkingPhase && !phaseState) {
      subscribeToThinkingPhase(sessionId)
    }

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-ID': currentAgentId,
        },
        body: JSON.stringify({ message: userMsg.content, sessionId }),
      })

      if (!res.body) throw new Error('No response body')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data: ')) continue

          const data = trimmed.slice(6)
          if (data === '[DONE]') break

          try {
            const chunk: ChatChunk & { error?: string } = JSON.parse(data)
            
            if (chunk.error) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsg.id
                    ? { ...m, content: m.content + `\nError: ${chunk.error}`, isStreaming: false }
                    : m,
                ),
              )
              setIsStreaming(false)
              break
            }

            console.log('[ChatPanel] Received chunk:', chunk.chunkType, chunk)

            switch (chunk.chunkType) {
              case 'thinking':
                console.log('[ChatPanel] Processing thinking chunk')
                handleAssistantStream(chunk.thinking || '', true)
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsg.id
                      ? { 
                        ...m, 
                        thinking: (m.thinking || '') + (chunk.thinking || ''),
                        thinkingStartTime: m.thinkingStartTime || Date.now(),
                      }
                      : m,
                  ),
                )
                break

              case 'tool_start':
                console.log('[ChatPanel] Processing tool_start chunk:', chunk.toolName, chunk.toolCallId)
                handleToolStart(
                  chunk.toolCallId || '',
                  chunk.toolName || 'unknown',
                  chunk.toolArgs || {},
                  chunk.toolStartedAt || Date.now()
                )
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsg.id
                      ? {
                        ...m,
                        toolCalls: [
                          ...(m.toolCalls || []),
                          {
                            id: chunk.toolCallId || crypto.randomUUID(),
                            name: chunk.toolName || 'unknown',
                            args: chunk.toolArgs || {},
                            status: 'running' as const,
                            startTime: chunk.toolStartedAt || Date.now(),
                          },
                        ],
                        activityLog: [
                          ...(m.activityLog || []),
                          {
                            id: chunk.toolCallId || crypto.randomUUID(),
                            toolName: chunk.toolName || 'unknown',
                            description: describeToolUse(chunk.toolName || 'unknown', chunk.toolArgs || {}),
                            startedAt: chunk.toolStartedAt || Date.now(),
                            phase: 'running' as const,
                            input: chunk.toolArgs,
                          },
                        ],
                      }
                      : m,
                  ),
                )
                break

              case 'tool_result':
                console.log('[ChatPanel] Processing tool_result chunk:', chunk.toolCallId)
                handleToolResult(
                  chunk.toolCallId || '',
                  chunk.toolResult,
                  chunk.toolDuration
                )
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsg.id
                      ? {
                        ...m,
                        toolCalls: m.toolCalls?.map(tc =>
                          tc.id === chunk.toolCallId
                            ? {
                              ...tc,
                              result: chunk.toolResult,
                              status: 'success' as const,
                              endTime: Date.now(),
                              duration: chunk.toolDuration || (Date.now() - tc.startTime),
                            }
                            : tc,
                        ),
                        activityLog: m.activityLog?.map(entry =>
                          entry.id === chunk.toolCallId
                            ? {
                              ...entry,
                              phase: 'completed' as const,
                              completedAt: Date.now(),
                              duration: chunk.toolDuration || (Date.now() - entry.startedAt),
                              output: chunk.toolResult,
                            }
                            : entry,
                        ),
                      }
                      : m,
                  ),
                )
                break

              case 'text':
              default:
                console.log('[ChatPanel] Processing text chunk, length:', chunk.content?.length)
                if (chunk.content) {
                  handleAssistantStream(chunk.content, false)
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMsg.id
                        ? { ...m, content: m.content + chunk.content }
                        : m,
                    ),
                  )
                }
                break
            }

            if (chunk.done) {
              handleLifecycleEnd()
              setIsStreaming(false)
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsg.id
                  ? {
                    ...m,
                    isStreaming: false,
                    thinkingDuration: m.thinkingStartTime 
                      ? Date.now() - m.thinkingStartTime 
                      : undefined,
                  }
                  : m,
                ),
              )
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, content: `Error: ${err instanceof Error ? err.message : String(err)}`, isStreaming: false }
            : m,
        ),
      )
    } finally {
      setIsStreaming(false)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id ? { ...m, isStreaming: false } : m,
        ),
      )
    }
  }, [input, currentAgentId, isStreaming, handleLifecycleStart, handleAssistantStream, handleToolStart, handleToolResult, handleLifecycleEnd])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  if (!currentAgentId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
        <div className="w-20 h-20 rounded-2xl bg-muted flex items-center justify-center mb-4">
          <Bot className="w-10 h-10" />
        </div>
        <p className="text-lg font-medium mb-1">未选择 Agent</p>
        <p className="text-sm">从下拉菜单选择一个 Agent 开始对话</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="flex-1 overflow-auto p-6">
        <div className="w-full max-w-5xl mx-auto space-y-6">
          {isLoadingMessages ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin mb-2" />
              <p className="text-sm">加载消息记录...</p>
            </div>
          ) : messages.length === 0 && (
            <div className="text-center py-20">
              <div className="w-16 h-16 rounded-2xl bg-primary/15 flex items-center justify-center mx-auto mb-4">
                <Bot className="w-8 h-8 text-primary" />
              </div>
              <p className="text-lg font-medium mb-1">开始对话</p>
              <p className="text-sm text-muted-foreground">
                发送消息给 {currentAgent?.name || 'Agent'} 开始对话
              </p>
            </div>
          )}

          {messages.map((msg) => {
            const isCollapsed = collapsedMessages.has(msg.id)
            
            return (
              <div
                key={msg.id}
                className={cn(
                  "flex gap-4",
                  msg.role === 'user' ? "flex-row-reverse" : "flex-row"
                )}
              >
                <div className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                  msg.role === 'user'
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                )}>
                  {msg.role === 'user' ? (
                    <User className="w-4 h-4" />
                  ) : (
                    <Bot className="w-4 h-4" />
                  )}
                </div>

                <div className={cn(
                  "flex-1 max-w-[85%]",
                  msg.role === 'user' ? "text-right" : "text-left"
                )}>
                  {msg.role === 'assistant' && (
                    <>
                      {msg.thinking && (
                        <ThinkingBubble
                          thinkingContent={msg.thinking}
                          activityLog={msg.activityLog || []}
                          thinkingDuration={msg.thinkingDuration}
                          thinkingStartTime={msg.thinkingStartTime}
                          isCollapsed={isCollapsed}
                          onToggle={() => toggleMessageCollapse(msg.id)}
                        />
                      )}

                      {msg.toolCalls && msg.toolCalls.length > 0 && (
                        <div className="space-y-2 mb-2">
                          {msg.toolCalls.map((toolCall) => (
                            <ToolCallBlock key={toolCall.id} toolCall={toolCall} />
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {(msg.content || msg.isStreaming) && (
                    <div className={cn(
                      "inline-block rounded-2xl px-4 py-3 text-sm",
                      msg.role === 'user'
                        ? "bg-primary text-primary-foreground rounded-tr-md"
                        : "bg-muted rounded-tl-md"
                    )}>
                      <pre className="whitespace-pre-wrap font-sans">
                        {msg.content || (msg.isStreaming ? '...' : '')}
                      </pre>
                      {msg.isStreaming && !msg.thinking && msg.toolCalls?.every(tc => tc.status !== 'running') && (
                        <span className="inline-block w-1.5 h-4 bg-primary/50 ml-0.5 animate-pulse" />
                      )}
                    </div>
                  )}
                  
                  <div className={cn(
                    "text-xs text-muted-foreground mt-1",
                    msg.role === 'user' ? "text-right" : "text-left"
                  )}>
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {isStreaming && (flowState.phase !== 'idle' || (phaseState && isBlindSpotPhase(phaseState.phase))) && (
        <div className="border-t border-border px-6 py-3 bg-card/50">
          <ProcessingIndicator
            phase={phaseState?.phase || flowState.phase}
            elapsedMs={phaseState?.phaseElapsedTime || elapsedTime}
            currentTool={currentTool}
            activityLog={activityLog}
            phaseLabel={phaseState ? getPhaseLabel(phaseState.phase) : undefined}
            isBlindSpot={phaseState ? isBlindSpotPhase(phaseState.phase) : false}
          />
        </div>
      )}

      <div className="border-t border-border p-4 bg-card/50 backdrop-blur-sm">
        <div className="w-full max-w-5xl mx-auto">
          <div className="flex gap-3 items-end">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入消息..."
                rows={1}
                className="w-full resize-none rounded-xl border border-input bg-background px-4 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>
            <Button
              onClick={sendMessage}
              disabled={!input.trim() || isStreaming}
              className="rounded-xl h-11 w-11 p-0"
            >
              {isStreaming ? (
                <Square className="w-4 h-4" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
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
