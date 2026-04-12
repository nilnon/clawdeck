import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import type { SessionInfo, SessionDetail, SessionSearchOptions } from '@shared/types'

interface SessionContextValue {
  sessions: SessionInfo[]
  currentSessionId: string | null
  currentSessionDetail: SessionDetail | null
  setCurrentSessionId: (id: string | null) => void
  refreshSessions: () => Promise<void>
  isLoading: boolean
  isDetailLoading: boolean
  searchSessions: (query: string, options?: SessionSearchOptions) => Promise<void>
  updateSessionStatus: (sessionId: string, status: 'active' | 'paused' | 'archived') => Promise<void>
  setSessionModel: (sessionId: string, modelId: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  deleteSessions: (sessionIds: string[]) => Promise<void>
  archiveSessions: (sessionIds: string[]) => Promise<void>
  getSessionDetail: (sessionId: string) => Promise<SessionDetail | null>
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ agentId, children }: { agentId: string | null; children: ReactNode }) {
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [currentSessionDetail, setCurrentSessionDetail] = useState<SessionDetail | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isDetailLoading, setIsDetailLoading] = useState(false)
  const prevAgentIdRef = useRef<string | null>(agentId)

  console.log('[SessionProvider] Render with agentId:', agentId)

  const refreshSessions = useCallback(async () => {
    if (!agentId) {
      setSessions([])
      setCurrentSessionId(null)
      return
    }
    setIsLoading(true)
    try {
      const res = await fetch(`/api/sessions?agentId=${agentId}`)
      if (res.ok) {
        const data = (await res.json()) as SessionInfo[]
        setSessions(data)
      }
    } catch { /* ignore */ }
    finally { setIsLoading(false) }
  }, [agentId])

  const searchSessions = useCallback(async (query: string, options?: SessionSearchOptions) => {
    if (!agentId) {
      setSessions([])
      return
    }
    setIsLoading(true)
    try {
      const params = new URLSearchParams({ query })
      if (options?.model) params.set('model', options.model)
      if (options?.dateRange?.start) params.set('startDate', options.dateRange.start.toString())
      if (options?.dateRange?.end) params.set('endDate', options.dateRange.end.toString())
      params.set('agentId', agentId)
      
      const res = await fetch(`/api/sessions/search?${params}`)
      if (res.ok) {
        const data = (await res.json()) as SessionInfo[]
        setSessions(data)
      }
    } catch { /* ignore */ }
    finally { setIsLoading(false) }
  }, [agentId])

  const getSessionDetail = useCallback(async (sessionId: string): Promise<SessionDetail | null> => {
    setIsDetailLoading(true)
    try {
      const res = await fetch(`/api/sessions/${sessionId}`)
      if (res.ok) {
        const data = (await res.json()) as SessionDetail
        setCurrentSessionDetail(data)
        return data
      }
      return null
    } catch {
      return null
    } finally {
      setIsDetailLoading(false)
    }
  }, [])

  const updateSessionStatus = useCallback(async (sessionId: string, status: 'active' | 'paused' | 'archived') => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (res.ok) {
        await refreshSessions()
        if (currentSessionId === sessionId) {
          await getSessionDetail(sessionId)
        }
      }
    } catch { /* ignore */ }
  }, [refreshSessions, currentSessionId, getSessionDetail])

  const setSessionModel = useCallback(async (sessionId: string, modelId: string) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/model`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelId }),
      })
      if (res.ok) {
        await refreshSessions()
        if (currentSessionId === sessionId) {
          await getSessionDetail(sessionId)
        }
      }
    } catch { /* ignore */ }
  }, [refreshSessions, currentSessionId, getSessionDetail])

  const deleteSession = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' })
      if (res.ok) {
        await refreshSessions()
        if (currentSessionId === sessionId) {
          setCurrentSessionId(null)
          setCurrentSessionDetail(null)
        }
      }
    } catch { /* ignore */ }
  }, [refreshSessions, currentSessionId])

  const deleteSessions = useCallback(async (sessionIds: string[]) => {
    try {
      const res = await fetch('/api/sessions/batch/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionIds, agentId }),
      })
      if (res.ok) {
        await refreshSessions()
        if (sessionIds.includes(currentSessionId || '')) {
          setCurrentSessionId(null)
          setCurrentSessionDetail(null)
        }
      }
    } catch { /* ignore */ }
  }, [refreshSessions, currentSessionId, agentId])

  const archiveSessions = useCallback(async (sessionIds: string[]) => {
    try {
      const res = await fetch('/api/sessions/batch/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionIds, agentId }),
      })
      if (res.ok) {
        await refreshSessions()
      }
    } catch { /* ignore */ }
  }, [refreshSessions, agentId])

  useEffect(() => {
    refreshSessions()
  }, [refreshSessions])

  useEffect(() => {
    if (prevAgentIdRef.current !== agentId) {
      setCurrentSessionId(null)
      setCurrentSessionDetail(null)
      prevAgentIdRef.current = agentId
    }
  }, [agentId])

  useEffect(() => {
    if (currentSessionId) {
      getSessionDetail(currentSessionId)
    } else {
      setCurrentSessionDetail(null)
    }
  }, [currentSessionId])

  return (
    <SessionContext.Provider 
      value={{ 
        sessions, 
        currentSessionId, 
        currentSessionDetail,
        setCurrentSessionId, 
        refreshSessions, 
        isLoading,
        isDetailLoading,
        searchSessions,
        updateSessionStatus,
        setSessionModel,
        deleteSession,
        deleteSessions,
        archiveSessions,
        getSessionDetail,
      }}
    >
      {children}
    </SessionContext.Provider>
  )
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within SessionProvider')
  return ctx
}