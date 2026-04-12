import { useState, useMemo, useCallback } from 'react'
import { Wrench, Check, AlertCircle, ChevronDown, ChevronRight, Brain, Copy, User, Bot, Radio, Loader2, Search, FileText, Plug, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ActivityLogEntry, TraceSection, ThinkingPhase } from '@shared/types'
import { PHASE_LABELS } from '@shared/types'

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  result?: unknown
  status: 'running' | 'success' | 'error'
  startTime: number
  endTime?: number
  duration?: number
}

function formatDuration(ms: number): string {
  if (ms < 1) return '<1ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const mins = Math.floor(ms / 60000)
  const secs = ((ms % 60000) / 1000).toFixed(1)
  return `${mins}m ${secs}s`
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-GB', { 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit',
    hour12: false 
  }) + '.' + String(timestamp % 1000).padStart(3, '0')
}

function describeToolUse(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'read':
    case 'read_file':
      return `Reading ${args.path || args.file_path || 'file'}`
    case 'write':
    case 'write_file':
      return `Writing ${args.path || args.file_path || 'file'}`
    case 'edit':
    case 'edit_file':
      return `Editing ${args.path || args.file_path || 'file'}`
    case 'exec':
    case 'execute':
      return `Running: ${args.command || 'command'}`
    case 'web_search':
      return `Searching: ${args.query || 'web'}`
    case 'web_fetch':
      return `Fetching: ${args.url || 'url'}`
    case 'list_directory':
    case 'ls':
      return `Listing: ${args.path || 'directory'}`
    case 'glob':
      return `Finding: ${args.pattern || 'files'}`
    case 'grep':
      return `Searching in files: ${args.pattern || 'pattern'}`
    default:
      return `Using ${name}`
  }
}

interface ToolCallBlockProps {
  toolCall: ToolCall
}

export function ToolCallBlock({ toolCall }: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(false)
  const duration = toolCall.duration || (toolCall.endTime 
    ? toolCall.endTime - toolCall.startTime 
    : Date.now() - toolCall.startTime)

  return (
    <div className="my-2 rounded-lg border border-border bg-muted/50 overflow-hidden">
      <div 
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/80"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        )}
        
        <Wrench className={cn(
          "w-4 h-4",
          toolCall.status === 'running' && "text-blue-500 animate-pulse",
          toolCall.status === 'success' && "text-green-500",
          toolCall.status === 'error' && "text-red-500"
        )} />
        
        <span className="font-medium text-sm">{describeToolUse(toolCall.name, toolCall.args)}</span>
        
        {toolCall.status === 'running' && (
          <span className="text-xs text-blue-500 ml-auto">执行中...</span>
        )}
        {toolCall.status === 'success' && (
          <span className="text-xs text-green-500 ml-auto">
            {formatDuration(duration)}
          </span>
        )}
        {toolCall.status === 'error' && (
          <span className="text-xs text-red-500 ml-auto">失败</span>
        )}
      </div>
      
      {expanded && (
        <div className="border-t border-border">
          <div className="p-3">
            <div className="text-xs text-muted-foreground mb-1">参数</div>
            <pre className="text-xs bg-background rounded p-2 overflow-auto max-h-40">
              {JSON.stringify(toolCall.args, null, 2)}
            </pre>
          </div>
          
          {toolCall.result !== undefined && (
            <div className="p-3 border-t border-border">
              <div className="text-xs text-muted-foreground mb-1">结果</div>
              <pre className="text-xs bg-background rounded p-2 overflow-auto max-h-60">
                {typeof toolCall.result === 'string' 
                  ? toolCall.result 
                  : JSON.stringify(toolCall.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface ThinkingBlockProps {
  thinking: string
  isStreaming?: boolean
  activityLog?: ActivityLogEntry[]
  thinkingDuration?: number
}

export function ThinkingBlock({ thinking, isStreaming, activityLog = [], thinkingDuration }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(true)

  if (!thinking && activityLog.length === 0) return null

  return (
    <div className="my-2 rounded-lg border border-amber-500/30 bg-amber-500/5 overflow-hidden">
      <div 
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-amber-500/10"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-amber-500" />
        ) : (
          <ChevronRight className="w-4 h-4 text-amber-500" />
        )}
        
        <Brain className="w-4 h-4 text-amber-500" />
        
        <span className="font-medium text-sm text-amber-600">思考过程</span>
        
        {thinkingDuration && (
          <span className={cn(
            "text-xs tabular-nums ml-2",
            thinkingDuration > 5000 ? "text-red-500" : 
            thinkingDuration > 2000 ? "text-orange-500" : 
            "text-amber-500/80"
          )}>
            {formatDuration(thinkingDuration)}
          </span>
        )}
        
        {isStreaming && (
          <span className="text-xs text-amber-500 ml-auto animate-pulse">思考中...</span>
        )}
        
        {!isStreaming && activityLog.length > 0 && !expanded && (
          <span className="text-xs text-muted-foreground ml-auto">
            {activityLog.length} tool call{activityLog.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      
      {expanded && (
        <div className="border-t border-amber-500/20">
          {activityLog.length > 0 && (
            <div className="p-3 border-b border-amber-500/10">
              <ActivityLog entries={activityLog} maxVisible={10} />
            </div>
          )}
          
          {thinking && (
            <div className="p-3">
              <pre className="text-sm text-amber-900/80 whitespace-pre-wrap font-sans">
                {thinking}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface ActivityLogProps {
  entries: ActivityLogEntry[]
  maxVisible?: number
}

export function ActivityLog({ entries, maxVisible = 4 }: ActivityLogProps) {
  if (entries.length === 0) return null

  const visible = entries.slice(-maxVisible)
  const lastIdx = visible.length - 1

  return (
    <div className="flex flex-col text-xs font-mono" style={{ lineHeight: 1.6 }}>
      {visible.map((entry, i) => {
        const isLast = i === lastIdx
        const connector = isLast ? '└' : '├'
        const hasOutput = entry.phase === 'completed' && 
          entry.output && 
          typeof entry.output === 'object' && 
          entry.output !== null &&
          Object.keys(entry.output).length > 0

        return (
          <div key={entry.id}>
            <div
              className={cn(
                "flex items-center gap-1.5",
                entry.phase === 'completed' ? 'text-muted-foreground' : 'text-green-500'
              )}
            >
              <span className="text-border select-none">{connector}</span>
              <span className="break-all">{entry.description}</span>
              {entry.phase === 'completed' && (
                <span className="text-green-500 text-xs shrink-0">✓</span>
              )}
              {entry.phase === 'running' && (
                <span className="inline-flex text-green-500 text-xs shrink-0">
                  <span className="animate-pulse">...</span>
                </span>
              )}
              {entry.duration !== undefined && (
                <span className="text-muted-foreground/60 text-xs ml-auto">
                  {formatDuration(entry.duration)}
                </span>
              )}
            </div>
            {hasOutput ? (
              <div className="flex items-start gap-1.5 text-muted-foreground/70 ml-3 mt-0.5">
                <span className="text-border select-none">│</span>
                <span className="break-all text-xs italic truncate max-w-[300px]">
                  → {extractOutputSummary(entry.output as Record<string, unknown>)}
                </span>
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function extractOutputSummary(output: Record<string, unknown>): string {
  if (!output) return ''
  
  if (typeof output.content === 'string') {
    return output.content.slice(0, 100) + (output.content.length > 100 ? '...' : '')
  }
  if (typeof output.result === 'string') {
    return output.result.slice(0, 100) + (output.result.length > 100 ? '...' : '')
  }
  if (typeof output.text === 'string') {
    return output.text.slice(0, 100) + (output.text.length > 100 ? '...' : '')
  }
  if (output.success === true && output.message) {
    return String(output.message).slice(0, 100)
  }
  
  const jsonStr = JSON.stringify(output)
  if (jsonStr.length > 100) {
    return jsonStr.slice(0, 100) + '...'
  }
  return jsonStr
}

const SECTION_ICONS: Record<TraceSection['type'], React.ReactNode> = {
  input: <User size={14} className="text-blue-500" />,
  thinking: <Brain size={14} className="text-amber-500" />,
  llm_call: <Bot size={14} className="text-purple-500" />,
  tool_call: <Wrench size={14} className="text-orange-500" />,
  response: <Radio size={14} className="text-green-500" />,
}

const SECTION_COLORS: Record<TraceSection['type'], string> = {
  input: 'text-blue-500 border-blue-500/30 bg-blue-500/5',
  thinking: 'text-amber-500 border-amber-500/30 bg-amber-500/5',
  llm_call: 'text-purple-500 border-purple-500/30 bg-purple-500/5',
  tool_call: 'text-orange-500 border-orange-500/30 bg-orange-500/5',
  response: 'text-green-500 border-green-500/30 bg-green-500/5',
}

interface TraceViewProps {
  sections: TraceSection[]
  thinkingText?: string
}

export function TraceView({ sections, thinkingText }: TraceViewProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState(false)
  const [now] = useState(Date.now())

  const toggleSection = useCallback((id: string) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev)
      if (newSet.has(id)) {
        newSet.delete(id)
      } else {
        newSet.add(id)
      }
      return newSet
    })
  }, [])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(sections, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }, [sections])

  if (sections.length === 0) {
    return (
      <div className="trace-view-empty">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          <span>Waiting for trace data...</span>
        </div>
      </div>
    )
  }

  const firstSection = sections[0]!
  const lastSection = sections[sections.length - 1]!
  const totalDuration = lastSection.endTime 
    ? lastSection.endTime - firstSection.startTime
    : now - firstSection.startTime

  return (
    <div className="trace-view border border-border rounded-lg overflow-hidden bg-card">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">Trace</span>
          <span className="text-xs text-muted-foreground">
            {sections.length} section{sections.length !== 1 ? 's' : ''}
          </span>
          {totalDuration > 0 && (
            <span className="text-xs font-mono text-primary tabular-nums">
              Total: {formatDuration(totalDuration)}
            </span>
          )}
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted"
          title="Copy trace as JSON"
        >
          {copied ? (
            <>
              <Check size={12} className="text-green-500" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      <div className="px-3 py-1.5 border-b border-border bg-muted/10 text-xs text-muted-foreground flex items-center gap-2">
        <span>Start: {formatTime(firstSection.startTime)}</span>
        <span className="flex-1 border-b border-dashed border-border/50" />
        <span>End: {lastSection.endTime ? formatTime(lastSection.endTime) : '--'}</span>
      </div>

      <div className="divide-y divide-border/50">
        {sections.map((section) => {
          const isExpanded = expandedSections.has(section.id)
          const hasDetails = section.input || section.output || section.type === 'thinking'
          const duration = section.endTime 
            ? (section.duration ?? now - section.startTime)
            : now - section.startTime

          return (
            <div key={section.id} className="group">
              <div
                className={cn(
                  "flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors hover:bg-muted/20",
                  isExpanded && "bg-muted/10"
                )}
                onClick={() => hasDetails && toggleSection(section.id)}
              >
                <span className="text-muted-foreground w-4">
                  {hasDetails ? (
                    <ChevronRight 
                      size={14} 
                      className={cn("transition-transform", isExpanded && "rotate-90")}
                    />
                  ) : (
                    <span className="w-4" />
                  )}
                </span>

                <span className="shrink-0">
                  {SECTION_ICONS[section.type]}
                </span>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">
                      {section.name}
                    </span>
                    {section.description && (
                      <span className="text-xs text-muted-foreground truncate">
                        {section.description}
                      </span>
                    )}
                  </div>
                </div>

                <span className={cn(
                  "text-xs font-mono font-semibold tabular-nums shrink-0",
                  section.status === 'running' ? 'text-primary animate-pulse' : 
                  (duration ?? 0) > 5000 ? 'text-red-500' : 
                  (duration ?? 0) > 2000 ? 'text-orange-500' : 
                  'text-muted-foreground'
                )}>
                  {formatDuration(duration ?? 0)}
                </span>

                <div className="w-5 text-center shrink-0">
                  {section.status === 'running' ? (
                    <span className="inline-block w-2 h-2 bg-primary rounded-full animate-pulse" />
                  ) : section.status === 'error' ? (
                    <span className="text-red-500 text-xs">✗</span>
                  ) : (
                    <span className="text-green-500 text-xs">✓</span>
                  )}
                </div>
              </div>

              {isExpanded && hasDetails && (
                <div className="px-3 pb-2 pt-1">
                  <div className={cn("rounded border overflow-hidden", SECTION_COLORS[section.type])}>
                    <div className="px-2 py-1 border-b border-border/30 bg-muted/30 flex gap-4 text-xs text-muted-foreground">
                      <span>Start: {formatTime(section.startTime)}</span>
                      {section.endTime && (
                        <span>End: {formatTime(section.endTime)}</span>
                      )}
                      <span>Duration: {formatDuration(duration ?? 0)}</span>
                    </div>

                    <div className="p-2 space-y-2">
                      {section.type === 'thinking' && thinkingText && (
                        <div className="text-xs text-foreground whitespace-pre-wrap">
                          {thinkingText}
                        </div>
                      )}

                      {section.input && Object.keys(section.input).length > 0 && (
                        <div className="space-y-1">
                          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Input
                          </div>
                          <pre className="text-xs bg-background/50 rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                            {JSON.stringify(section.input, null, 2)}
                          </pre>
                        </div>
                      )}

                      {section.output && typeof section.output === 'object' && section.output !== null && Object.keys(section.output).length > 0 && section.type !== 'thinking' ? (
                        <div className="space-y-1">
                          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Output
                          </div>
                          <pre className="text-xs bg-background/50 rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                            {JSON.stringify(section.output, null, 2)}
                          </pre>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function buildTraceSectionsFromActivityLog(
  entries: ActivityLogEntry[],
  thinkingDuration?: number,
  thinkingStartTime?: number
): TraceSection[] {
  const sections: TraceSection[] = []

  if (entries.length === 0) {
    if (thinkingDuration && thinkingStartTime) {
      sections.push({
        id: 'thinking',
        type: 'thinking',
        name: 'Thinking',
        description: 'Reasoning process',
        startTime: thinkingStartTime,
        endTime: thinkingStartTime + thinkingDuration,
        duration: thinkingDuration,
        status: 'completed',
      })
    }
    return sections
  }

  const sortedEntries = [...entries].sort((a, b) => a.startedAt - b.startedAt)
  const firstEntry = sortedEntries[0]!

  if (thinkingStartTime && firstEntry.startedAt > thinkingStartTime) {
    sections.push({
      id: 'thinking',
      type: 'thinking',
      name: 'Thinking',
      description: 'Reasoning process',
      startTime: thinkingStartTime,
      endTime: firstEntry.startedAt,
      duration: thinkingDuration || (firstEntry.startedAt - thinkingStartTime),
      status: 'completed',
    })
  }

  for (const entry of sortedEntries) {
    const entryEnd = entry.completedAt || (entry.startedAt + (entry.duration || 0))
    
    sections.push({
      id: entry.id,
      type: 'tool_call',
      name: entry.toolName,
      description: entry.description,
      startTime: entry.startedAt,
      endTime: entry.phase === 'completed' ? entryEnd : undefined,
      duration: entry.duration || (entryEnd - entry.startedAt),
      status: entry.phase === 'completed' ? 'completed' : 'running',
      input: entry.input,
      output: entry.output,
    })
  }

  return sections
}

interface ThinkingBubbleProps {
  thinkingContent: string
  activityLog: ActivityLogEntry[]
  thinkingDuration?: number
  thinkingStartTime?: number
  isCollapsed: boolean
  onToggle: () => void
}

export function ThinkingBubble({
  thinkingContent,
  activityLog,
  thinkingDuration,
  thinkingStartTime,
  isCollapsed,
  onToggle,
}: ThinkingBubbleProps) {
  const sections = useMemo(() => {
    return buildTraceSectionsFromActivityLog(activityLog, thinkingDuration, thinkingStartTime)
  }, [activityLog, thinkingDuration, thinkingStartTime])

  const timeStr = thinkingStartTime 
    ? new Date(thinkingStartTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : ''

  return (
    <div className="thinking-bubble relative max-w-full break-words mr-auto overflow-hidden my-1">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!isCollapsed}
        className="flex items-center py-2.5 gap-2.5 cursor-pointer select-none transition-all duration-200 px-4 sm:px-5 hover:bg-gradient-to-r hover:from-primary/[0.05] hover:to-transparent rounded-xl -mx-1 border border-transparent hover:border-primary/[0.15]"
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
      >
        <span className={cn("text-primary text-sm shrink-0 w-3.5 transition-transform duration-200", !isCollapsed && "rotate-90")}>›</span>
        <span className="shrink-0 text-[0.8rem]">💭</span>
        <span className="shrink-0 text-[0.8rem] font-semibold text-foreground">Thinking</span>
        
        {thinkingDuration && (
          <span className={cn(
            "shrink-0 text-[0.7rem] tabular-nums font-semibold",
            thinkingDuration > 5000 ? "text-red-500" : 
            thinkingDuration > 2000 ? "text-orange-500" : 
            "text-primary/80"
          )}>
            • {thinkingDuration >= 1000
              ? `${(thinkingDuration / 1000).toFixed(1)}s`
              : `${thinkingDuration}ms`}
          </span>
        )}
        
        {isCollapsed && activityLog.length > 0 && (
          <span className="min-w-0 flex-1 truncate text-[0.7rem] italic text-muted-foreground ml-2">
            {activityLog.length} tool call{activityLog.length !== 1 ? 's' : ''}
          </span>
        )}
        
        {isCollapsed && activityLog.length === 0 && thinkingContent && (
          <span className="min-w-0 flex-1 truncate text-[0.7rem] italic text-muted-foreground ml-2">
            {thinkingContent.slice(0, 100)}{thinkingContent.length > 100 ? '…' : ''}
          </span>
        )}
        
        {timeStr && (
          <span className="shrink-0 font-mono text-[0.7rem] tabular-nums text-muted-foreground/70 ml-auto">{timeStr}</span>
        )}
      </div>
      
      {!isCollapsed && (
        <div className="relative pb-3 px-4 sm:px-5 animate-in fade-in slide-in-from-top-2 duration-200">
          {sections.length > 0 && (
            <TraceView
              sections={sections}
              thinkingText={thinkingContent}
            />
          )}
          
          {thinkingContent && (
            <div className="mt-3 border-l border-primary/12 px-3 pb-2 pt-1 text-[0.8rem] text-foreground/70">
              <pre className="whitespace-pre-wrap font-sans">
                {thinkingContent}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface AgentStatusIndicatorProps {
  phase: 'idle' | 'thinking' | 'generating' | 'tool_calling' | 'completed' | 'error'
  toolName?: string
  duration?: number
}

export function AgentStatusIndicator({ phase, toolName, duration }: AgentStatusIndicatorProps) {
  const phaseConfig = {
    idle: { icon: null, label: '', color: '' },
    thinking: { icon: Brain, label: '思考中...', color: 'text-amber-500' },
    generating: { icon: null, label: '生成回复...', color: 'text-blue-500' },
    tool_calling: { icon: Wrench, label: `调用工具: ${toolName}`, color: 'text-purple-500' },
    completed: { icon: Check, label: '完成', color: 'text-green-500' },
    error: { icon: AlertCircle, label: '出错了', color: 'text-red-500' },
  }

  const config = phaseConfig[phase]
  if (!config.icon) return null

  const Icon = config.icon

  return (
    <div className={cn("flex items-center gap-2 text-sm", config.color)}>
      <Icon className={cn(
        "w-4 h-4",
        (phase === 'thinking' || phase === 'tool_calling') && "animate-pulse"
      )} />
      <span>{config.label}</span>
      {duration && <span className="text-xs opacity-60">({formatDuration(duration)})</span>}
    </div>
  )
}

interface ProcessingIndicatorProps {
  phase: ThinkingPhase
  elapsedMs: number
  currentTool?: { name: string; startedAt: number } | null
  activityLog: ActivityLogEntry[]
  phaseLabel?: string
  isBlindSpot?: boolean
}

const PHASE_ICONS: Record<ThinkingPhase, React.ReactNode> = {
  idle: null,
  model_resolving: <Search className="w-4 h-4" />,
  prompt_building: <FileText className="w-4 h-4" />,
  llm_connecting: <Plug className="w-4 h-4" />,
  llm_first_token: <Zap className="w-4 h-4" />,
  thinking: <Brain className="w-4 h-4" />,
  generating: <Radio className="w-4 h-4" />,
  tool_calling: <Wrench className="w-4 h-4" />,
  tool_executing: <Loader2 className="w-4 h-4" />,
  tool_complete: <Check className="w-4 h-4" />,
  completed: <Check className="w-4 h-4" />,
  error: <AlertCircle className="w-4 h-4" />,
  cancelled: null,
}

const PHASE_COLORS: Record<ThinkingPhase, string> = {
  idle: '',
  model_resolving: 'text-purple-500',
  prompt_building: 'text-indigo-500',
  llm_connecting: 'text-cyan-500',
  llm_first_token: 'text-yellow-500',
  thinking: 'text-amber-500',
  generating: 'text-blue-500',
  tool_calling: 'text-purple-500',
  tool_executing: 'text-orange-500',
  tool_complete: 'text-green-500',
  completed: 'text-green-500',
  error: 'text-red-500',
  cancelled: 'text-gray-500',
}

export function ProcessingIndicator({ 
  phase, 
  elapsedMs, 
  currentTool, 
  activityLog,
  phaseLabel,
  isBlindSpot = false,
}: ProcessingIndicatorProps) {
  const icon = PHASE_ICONS[phase]
  const color = PHASE_COLORS[phase]
  const label = phaseLabel || PHASE_LABELS[phase] || phase
  
  if (!icon || phase === 'idle') return null

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className={cn("flex items-center gap-2 text-sm font-semibold", color)}>
          <span className={cn(phase !== 'completed' && phase !== 'error' && "animate-pulse")}>
            {icon}
          </span>
          <span className="text-xs font-medium">
            {label}
          </span>
          {isBlindSpot && (
            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              盲区
            </span>
          )}
          <span className="mx-1 text-muted-foreground">──</span>
          <span className="font-mono tabular-nums text-muted-foreground">
            {formatDuration(elapsedMs)}
          </span>
        </span>
      </div>

      {currentTool && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground pl-6">
          <Wrench className="w-3 h-3" />
          <span>{currentTool.name}</span>
          <span className="text-primary animate-pulse">...</span>
        </div>
      )}

      {activityLog.length > 0 && (
        <div className="pl-6">
          <ActivityLog entries={activityLog.slice(-4)} maxVisible={4} />
        </div>
      )}
    </div>
  )
}
