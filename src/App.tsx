import { BrowserRouter, Routes, Route, useParams, useNavigate } from 'react-router-dom'
import { AgentProvider, useAgent } from './contexts/AgentContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { SessionProvider } from './contexts/SessionContext'
import MainLayout from './layouts/MainLayout'
import DashboardSettingsPage from './pages/DashboardSettingsPage'
import ChatPage from './pages/ChatPage'
import ComparePage from './pages/ComparePage'
import { useEffect } from 'react'

function ChatWithSession() {
  const { agentId: urlAgentId } = useParams<{ agentId?: string }>()
  const { currentAgentId, setCurrentAgentId, agents } = useAgent()
  const navigate = useNavigate()

  // 同步 URL 参数中的 agentId 到 AgentContext
  useEffect(() => {
    if (urlAgentId && urlAgentId !== currentAgentId) {
      // 检查 URL 中的 agentId 是否有效
      const agentExists = agents.some(a => a.id === urlAgentId)
      if (agentExists) {
        console.log('[ChatWithSession] Sync URL agentId to context:', urlAgentId)
        setCurrentAgentId(urlAgentId)
      } else if (agents.length > 0 && !currentAgentId) {
        // 如果 URL 中的 agentId 无效，且当前没有选中的 agent，选择第一个
        const firstAgent = agents[0]
        if (firstAgent) {
          console.log('[ChatWithSession] URL agentId invalid, using first agent:', firstAgent.id)
          setCurrentAgentId(firstAgent.id)
          navigate(`/chat/${firstAgent.id}`, { replace: true })
        }
      }
    }
  }, [urlAgentId, currentAgentId, agents, setCurrentAgentId, navigate])

  console.log('[ChatWithSession] Render with currentAgentId:', currentAgentId, 'urlAgentId:', urlAgentId)
  return (
    <SessionProvider agentId={currentAgentId}>
      <ChatPage />
    </SessionProvider>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <AgentProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<MainLayout />}>
              <Route path="/" element={<DashboardSettingsPage />} />
              <Route path="/chat/:agentId?" element={<ChatWithSession />} />
              <Route path="/compare" element={<ComparePage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AgentProvider>
    </ThemeProvider>
  )
}
