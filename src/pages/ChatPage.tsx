import { useAgent, AgentSwitcher } from '@/contexts/AgentContext'
import { useSession } from '@/contexts/SessionContext'
import ChatPanel from '@/features/chat/ChatPanel'
import { Plus, MessageSquare, Trash2, ChevronDown, ChevronRight, Bot } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useState, useMemo, useEffect } from 'react'
import type { SessionInfo } from '@shared/types'

interface AgentGroup {
  ownerAgentId: string
  mainSession: SessionInfo
  childSessions: SessionInfo[]
}

function AgentSidebar() {
  const { currentAgentId } = useAgent()
  const { sessions, currentSessionId, setCurrentSessionId, refreshSessions } = useSession()
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set())

  // Group sessions by ownerAgentId
  const agentGroups = useMemo(() => {
    const groups = new Map<string, AgentGroup>()
    
    sessions.forEach((session) => {
      const ownerId = session.ownerAgentId || 'unknown'
      
      if (!groups.has(ownerId)) {
        groups.set(ownerId, {
          ownerAgentId: ownerId,
          mainSession: null as any,
          childSessions: []
        })
      }
      
      const group = groups.get(ownerId)!
      if (session.sessionType === 'main') {
        group.mainSession = session
      } else {
        group.childSessions.push(session)
      }
    })
    
    // Sort child sessions by updatedAt desc
    groups.forEach((group) => {
      group.childSessions.sort((a, b) => b.updatedAt - a.updatedAt)
    })
    
    // Convert to array and sort: main first, then others alphabetically
    return Array.from(groups.values()).sort((a, b) => {
      if (a.ownerAgentId === 'main') return -1
      if (b.ownerAgentId === 'main') return 1
      return a.ownerAgentId.localeCompare(b.ownerAgentId)
    })
  }, [sessions])

  // Auto-expand agents that have the current session
  useMemo(() => {
    const currentSession = sessions.find(s => s.id === currentSessionId)
    if (currentSession?.ownerAgentId && currentSession.sessionType !== 'main') {
      setExpandedAgents(prev => new Set([...prev, currentSession.ownerAgentId!]))
    }
  }, [currentSessionId, sessions])

  const toggleAgent = (agentId: string) => {
    setExpandedAgents(prev => {
      const newSet = new Set(prev)
      if (newSet.has(agentId)) {
        newSet.delete(agentId)
      } else {
        newSet.add(agentId)
      }
      return newSet
    })
  }

  const createSession = async () => {
    if (!currentAgentId) {
      alert('请先在顶部选择一个 Agent')
      return
    }
    
    try {
      console.log(`[ChatPage] Creating session for agent: ${currentAgentId}`)
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: currentAgentId, thinking: 'medium' })
      })
      
      if (res.ok) {
        const { sessionId } = await res.json()
        console.log(`[ChatPage] Session created: ${sessionId}`)
        setCurrentSessionId(sessionId)
        await refreshSessions()
      } else {
        const err = await res.json().catch(() => ({}))
        console.error('[ChatPage] Failed to create session:', err)
        alert(`创建会话失败: ${err.error || '服务器错误'}`)
      }
    } catch (err) {
      console.error('[ChatPage] Create session network error:', err)
      alert('创建会话失败: 网络连接错误')
    }
  }

  const deleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' })
      if (res.ok) {
        if (currentSessionId === id) setCurrentSessionId(null)
        refreshSessions()
      }
    } catch { /* ignore */ }
  }

  // Format child session title for display
  const formatChildSessionTitle = (session: SessionInfo) => {
    const match = session.title.match(/^(dashboard|subagent):(.+)$/)
    if (match) {
      const [, type, id] = match
      const shortId = id?.slice(0, 8) ?? ''
      return `${type} ${shortId}`
    }
    return session.title
  }

  // Format agent display name
  const formatAgentName = (ownerAgentId: string) => {
    if (ownerAgentId === 'main') return 'Agent (main)'
    if (ownerAgentId.includes('guest-')) return `Agent ${ownerAgentId}`
    return ownerAgentId
  }

  return (
    <div className="w-56 border-r border-border bg-card/30 backdrop-blur-sm flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-border flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-muted-foreground" />
          会话列表
        </h3>
        <button
          onClick={createSession}
          className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          title="新建会话"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-auto p-2 space-y-1">
        {sessions.length === 0 ? (
          <div className="text-center py-8 px-4">
            <p className="text-xs text-muted-foreground">暂无会话</p>
          </div>
        ) : (
          agentGroups.map(({ ownerAgentId, mainSession, childSessions }) => (
            <div key={ownerAgentId}>
              {/* Agent Header (represents main session) */}
              <div
                onClick={() => mainSession && setCurrentSessionId(mainSession.id)}
                className={cn(
                  "group flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm font-medium cursor-pointer transition-all",
                  currentSessionId === mainSession?.id
                    ? "bg-primary/15 text-primary"
                    : "text-foreground hover:bg-accent"
                )}
              >
                {childSessions.length > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleAgent(ownerAgentId)
                    }}
                    className="p-0.5 rounded hover:bg-accent"
                  >
                    {expandedAgents.has(ownerAgentId) ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}
                {!childSessions.length && <span className="w-5" />}
                <Bot className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate flex-1 text-xs">
                  {formatAgentName(ownerAgentId)}
                </span>
              </div>
              
              {/* Child Sessions */}
              {expandedAgents.has(ownerAgentId) && childSessions.length > 0 && (
                <div className="ml-4 pl-2 border-l border-border/50 space-y-0.5 mt-0.5">
                  {childSessions.map((s) => (
                    <div
                      key={s.id}
                      onClick={() => setCurrentSessionId(s.id)}
                      className={cn(
                        "group flex items-center gap-2 px-2 py-1.5 rounded-md text-xs cursor-pointer transition-all",
                        currentSessionId === s.id
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      )}
                    >
                      <MessageSquare className="w-3 h-3 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="truncate">
                          {formatChildSessionTitle(s)}
                        </div>
                      </div>
                      <button
                        onClick={(e) => deleteSession(s.id, e)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/10 hover:text-destructive transition-all"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function ChatContent() {
  const { currentAgentId } = useAgent()
  const { currentSessionId, setCurrentSessionId, sessions } = useSession()

  // 页面刷新后，如果有会话列表但没有选中的会话，自动选择第一个
  useEffect(() => {
    if (sessions.length > 0 && !currentSessionId) {
      // 优先选择当前 agent 的主会话
      const currentAgentSession = sessions.find(s => 
        s.ownerAgentId === currentAgentId && s.sessionType === 'main'
      )
      if (currentAgentSession) {
        console.log('[ChatContent] Auto-select main session:', currentAgentSession.id)
        setCurrentSessionId(currentAgentSession.id)
      } else {
        // 否则选择第一个会话
        const firstSession = sessions[0]
        if (firstSession) {
          console.log('[ChatContent] Auto-select first session:', firstSession.id)
          setCurrentSessionId(firstSession.id)
        }
      }
    }
  }, [sessions, currentSessionId, currentAgentId, setCurrentSessionId])

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left Sidebar - Agent/Session List */}
      <AgentSidebar />

      {/* Chat Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="border-b border-border bg-card/50 backdrop-blur-sm">
          <div className="w-full px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-sm font-medium">在线</span>
            </div>
            <AgentSwitcher />
          </div>
        </header>

        <div className="flex-1 overflow-hidden relative">
          {currentAgentId ? (
            <ChatPanel key={`${currentAgentId}-${currentSessionId}`} sessionId={currentSessionId} />
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
              <MessageSquare className="w-12 h-12 mb-4 opacity-20" />
              <p>请选择一个 Agent 开始对话</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ChatPage() {
  return <ChatContent />
}
