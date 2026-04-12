import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Activity, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface AgentSummary {
  id: string
  type: string
  name: string
  status: 'disconnected' | 'connecting' | 'connected' | 'error' | 'busy'
  config?: any
  model?: string
  sessionCount: number
  connectedAt?: number
}

interface AgentContextValue {
  agents: AgentSummary[]
  currentAgentId: string | null
  setCurrentAgentId: (id: string | null) => void
  refreshAgents: () => Promise<void>
  isLoading: boolean
}

const AgentContext = createContext<AgentContextValue | null>(null)

const API_BASE = '/api'

export function AgentProvider({ children }: { children: ReactNode }) {
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [currentAgentId, setCurrentAgentId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const refreshAgents = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/agents`)
      if (res.ok) {
        const data = (await res.json()) as AgentSummary[]
        setAgents(data)
        if (data.length > 0 && !currentAgentId) {
          const first = data[0]
          if (first) setCurrentAgentId(first.id)
        }
      }
    } catch { /* ignore */ }
    finally { setIsLoading(false) }
  }, [currentAgentId])

  useEffect(() => {
    refreshAgents()
    const interval = setInterval(refreshAgents, 10000)
    return () => clearInterval(interval)
  }, [refreshAgents])

  return (
    <AgentContext.Provider value={{ agents, currentAgentId, setCurrentAgentId, refreshAgents, isLoading }}>
      {children}
    </AgentContext.Provider>
  )
}

export function useAgent() {
  const ctx = useContext(AgentContext)
  if (!ctx) throw new Error('useAgent must be used within AgentProvider')
  return ctx
}

export function AgentSwitcher() {
  const { agents, currentAgentId, setCurrentAgentId } = useAgent()
  const [isOpen, setIsOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const currentAgent = agents.find(a => a.id === currentAgentId)

  const statusColors: Record<string, string> = {
    connected: 'bg-[var(--color-green)]',
    disconnected: 'bg-muted-foreground',
    connecting: 'bg-[var(--color-orange)] animate-pulse',
    error: 'bg-[var(--color-red)]',
    busy: 'bg-[var(--color-info)] animate-pulse',
  }

  const openDropdown = () => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPosition({
      top: rect.bottom + window.scrollY + 4,
      left: rect.left + window.scrollX,
    })
    setIsOpen(true)
  }

  const closeDropdown = () => setIsOpen(false)

  const handleSelect = (id: string) => {
    console.log('[AgentSwitcher] SELECT:', id, 'prev:', currentAgentId)
    closeDropdown()
    setCurrentAgentId(id || null)
  }

  useEffect(() => {
    if (!isOpen) return
    const onDocClick = (e: MouseEvent) => {
      if (triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
        closeDropdown()
      }
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('touchstart', onDocClick as EventListener)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('touchstart', onDocClick as EventListener)
    }
  }, [isOpen])

  const dropdownContent = (
    <div
      className="fixed w-64 bg-popover border border-border rounded-xl shadow-xl z-[9999] py-1"
      style={{ top: position.top, left: position.left }}
    >
      {agents.length === 0 ? (
        <div className="px-3 py-2 text-sm text-muted-foreground">暂无 Agent</div>
      ) : (
        agents.map((agent) => (
          <button
            key={agent.id}
            onMouseDown={(e) => { e.preventDefault() }}
            onClick={() => handleSelect(agent.id)}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors cursor-pointer",
              currentAgentId === agent.id && "bg-primary/10"
            )}
          >
            <span className={cn("w-2 h-2 rounded-full shrink-0", statusColors[agent.status])} />
            <span className="flex-1 text-left">{agent.name}</span>
            <span className="text-xs text-muted-foreground uppercase shrink-0">{agent.type}</span>
            {currentAgentId === agent.id && <Check className="w-4 h-4 text-primary shrink-0" />}
          </button>
        ))
      )}
    </div>
  )

  return (
    <>
      <button
        ref={triggerRef}
        onClick={openDropdown}
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-background border border-input hover:border-ring transition-colors cursor-pointer"
      >
        <Activity className="w-4 h-4 text-muted-foreground shrink-0" />
        {currentAgent && (
          <span className={cn("w-2 h-2 rounded-full", statusColors[currentAgent.status])} />
        )}
        <span className="text-sm font-medium">
          {currentAgent?.name || '选择 Agent'}
        </span>
        <span className="text-xs text-muted-foreground uppercase">
          {currentAgent?.type}
        </span>
        <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform shrink-0", isOpen && "rotate-180")} />
      </button>
      {isOpen && typeof document !== 'undefined' && createPortal(dropdownContent, document.body)}
    </>
  )
}
