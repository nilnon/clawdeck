import { Bot, User, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

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

interface AgentResponsePanelProps {
  title: string
  agentType: 'openclaw' | 'hermes'
  messages: Message[]
  isStreaming: boolean
  stats: CompareStats
  error?: string
  themeColor: 'blue' | 'green'
}

const themeClasses = {
  blue: {
    border: 'border-blue-500/30',
    bg: 'bg-blue-500/5',
    text: 'text-blue-500',
    indicator: 'bg-blue-500',
  },
  green: {
    border: 'border-green-500/30',
    bg: 'bg-green-500/5',
    text: 'text-green-500',
    indicator: 'bg-green-500',
  },
}

export function AgentResponsePanel({
  title,
  agentType,
  messages,
  isStreaming,
  stats,
  error,
  themeColor,
}: AgentResponsePanelProps) {
  const theme = themeClasses[themeColor]

  return (
    <div className={cn(
      "flex-1 flex flex-col rounded-xl border overflow-hidden min-w-0",
      theme.border
    )}>
      <div className={cn("px-4 py-3 border-b flex items-center justify-between", theme.bg)}>
        <div className="flex items-center gap-2">
          <span className={cn(
            "w-2 h-2 rounded-full",
            theme.indicator,
            isStreaming && "animate-pulse"
          )} />
          <span className="font-medium text-sm">{title}</span>
          <span className="text-xs text-muted-foreground uppercase">({agentType})</span>
        </div>
        {isStreaming && (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        )}
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
            <Bot className="w-12 h-12 mb-2 opacity-20" />
            <p className="text-sm">等待输入...</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex gap-3",
                msg.role === 'user' ? "flex-row-reverse" : "flex-row"
              )}
            >
              <div className={cn(
                "w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
                msg.role === 'user'
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              )}>
                {msg.role === 'user' ? (
                  <User className="w-3.5 h-3.5" />
                ) : (
                  <Bot className="w-3.5 h-3.5" />
                )}
              </div>

              <div className={cn(
                "flex-1 max-w-[90%]",
                msg.role === 'user' ? "text-right" : "text-left"
              )}>
                {msg.role === 'assistant' && (
                  <>
                    {msg.thinking && (
                      <div className="mb-2 p-2 rounded-lg bg-muted/50 text-xs text-muted-foreground">
                        <div className="font-medium mb-1">💭 思考过程</div>
                        <div className="italic line-clamp-3">{msg.thinking}</div>
                      </div>
                    )}
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div className="space-y-1 mb-2">
                        {msg.toolCalls.map((tc) => (
                          <div
                            key={tc.id}
                            className={cn(
                              "text-xs rounded px-2 py-1 flex items-center gap-1",
                              tc.status === 'running'
                                ? "bg-yellow-500/10 text-yellow-600"
                                : "bg-muted/50"
                            )}
                          >
                            {tc.status === 'running' ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <span>✓</span>
                            )}
                            <span>🔧 {tc.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}

                <div className={cn(
                  "inline-block rounded-xl px-3 py-2 text-sm",
                  msg.role === 'user'
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                )}>
                  <pre className="whitespace-pre-wrap font-sans break-words">
                    {msg.content || (msg.isStreaming ? '...' : '')}
                  </pre>
                  {msg.isStreaming && !msg.thinking && (
                    <span className="inline-block w-1.5 h-4 bg-primary/50 ml-0.5 animate-pulse" />
                  )}
                </div>

                {error && msg.role === 'assistant' && !msg.content && (
                  <div className="text-xs text-destructive mt-1">
                    {error}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className={cn("px-4 py-2 border-t text-xs text-muted-foreground", theme.bg)}>
        <div className="flex justify-between flex-wrap gap-2">
          <span>耗时: {stats.totalTime}ms</span>
          {stats.firstTokenTime !== undefined && (
            <span>首Token: {stats.firstTokenTime}ms</span>
          )}
          <span>Tokens: {stats.tokenCount}</span>
          <span>工具: {stats.toolCallCount}</span>
        </div>
      </div>
    </div>
  )
}
