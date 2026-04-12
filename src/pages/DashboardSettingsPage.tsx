import { useState, useEffect } from 'react'
import { useAgent, type AgentSummary } from '@/contexts/AgentContext'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Trash2, CheckCircle, Loader2, Terminal, Zap, AlertCircle,
  XCircle, MessageSquare, Clock, Cpu, Pencil, Plug,
  LayoutDashboard, Settings
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

// 从环境变量读取默认配置
const DEFAULT_CONFIG = {
  openclaw: {
    gatewayUrl: import.meta.env.VITE_OPENCLAW_GATEWAY_URL || 'ws://localhost:18789',
    httpUrl: import.meta.env.VITE_OPENCLAW_HTTP_URL || 'http://localhost:18789',
    token: import.meta.env.VITE_OPENCLAW_GATEWAY_TOKEN || '',
  },
  hermes: {
    acpUrl: import.meta.env.VITE_HERMES_ACP_URL || 'http://localhost:8642',
    cliPath: import.meta.env.VITE_HERMES_CLI_PATH || 'hermes',
  }
}

export default function DashboardSettingsPage() {
  const { agents, refreshAgents, isLoading } = useAgent()
  const navigate = useNavigate()

  // Settings state
  const [showForm, setShowForm] = useState(false)
  const [formType, setFormType] = useState<'openclaw' | 'hermes'>('openclaw')
  const [formName, setFormName] = useState('OpenClaw')
  const [formId, setFormId] = useState('openclaw')
  const [formUrl, setFormUrl] = useState(DEFAULT_CONFIG.openclaw.gatewayUrl)
  const [formToken, setFormToken] = useState(DEFAULT_CONFIG.openclaw.token)
  const [formApiKey, setFormApiKey] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null)
  const [reconnectingAgentId, setReconnectingAgentId] = useState<string | null>(null)

  const testConnection = async (showMessage = false): Promise<boolean> => {
    setIsTesting(true)
    try {
      const agentConfig: Record<string, string> = { name: formName }
      if (formType === 'openclaw') {
        agentConfig.gatewayUrl = formUrl || DEFAULT_CONFIG.openclaw.gatewayUrl
        agentConfig.httpUrl = formUrl?.replace('ws://', 'http://') || DEFAULT_CONFIG.openclaw.httpUrl
        if (formToken) {
          agentConfig.token = formToken
        }
      } else {
        agentConfig.acpUrl = formUrl || DEFAULT_CONFIG.hermes.acpUrl
        agentConfig.cliPath = DEFAULT_CONFIG.hermes.cliPath
        if (formApiKey) {
          agentConfig.apiKey = formApiKey
        }
      }

      const res = await fetch('/api/agents/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: formType,
          config: agentConfig
        })
      })

      const data = await res.json()
      const success = data.success === true

      if (showMessage) {
        setMessage({
          type: success ? 'success' : 'error',
          text: success ? '连接测试成功' : `连接测试失败: ${data.error || '无法建立连接'}`
        })
      }
      return success
    } catch (err) {
      if (showMessage) {
        setMessage({ type: 'error', text: `连接测试请求失败: ${err instanceof Error ? err.message : '网络错误'}` })
      }
      return false
    } finally {
      setIsTesting(false)
    }
  }

  const resetForm = () => {
    setFormType('openclaw')
    setFormId('openclaw')
    setFormName('OpenClaw')
    setFormUrl(DEFAULT_CONFIG.openclaw.gatewayUrl)
    setFormToken(DEFAULT_CONFIG.openclaw.token)
  }

  const handleEdit = (agent: AgentSummary) => {
    setEditingAgentId(agent.id)
    setFormType(agent.type as 'openclaw' | 'hermes')
    setFormId(agent.id)
    setFormName(agent.name)
    const url = agent.type === 'openclaw' 
      ? agent.config?.gatewayUrl || DEFAULT_CONFIG.openclaw.gatewayUrl
      : agent.config?.acpUrl || DEFAULT_CONFIG.hermes.acpUrl
    const token = agent.type === 'openclaw' 
      ? agent.config?.token || DEFAULT_CONFIG.openclaw.token
      : ''
    const apiKey = agent.type === 'hermes' 
      ? agent.config?.apiKey || ''
      : ''
    setFormUrl(url)
    setFormToken(token)
    setFormApiKey(apiKey)
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!formName.trim() || !formId.trim()) return
    setIsSaving(true)
    setMessage(null)

    const isEditing = editingAgentId !== null

    try {
      if (!isEditing) {
        const isConnected = await testConnection()
        if (!isConnected) {
          setMessage({ type: 'error', text: '无法连接到 Agent，请检查 URL 是否正确' })
          setIsSaving(false)
          return
        }
      }

      const agentConfig: Record<string, string> = { name: formName }
      if (formType === 'openclaw') {
        agentConfig.gatewayUrl = formUrl || DEFAULT_CONFIG.openclaw.gatewayUrl
        agentConfig.httpUrl = formUrl?.replace('ws://', 'http://') || DEFAULT_CONFIG.openclaw.httpUrl
        agentConfig.token = formToken
      } else {
        agentConfig.acpUrl = formUrl || DEFAULT_CONFIG.hermes.acpUrl
        agentConfig.cliPath = DEFAULT_CONFIG.hermes.cliPath
        if (formApiKey) {
          agentConfig.apiKey = formApiKey
        }
      }

      const url = isEditing ? `/api/agents/${editingAgentId}` : '/api/agents'
      const method = isEditing ? 'PUT' : 'POST'
      const body = isEditing
        ? JSON.stringify({ name: formName, config: agentConfig })
        : JSON.stringify({ id: formId, type: formType, name: formName, config: agentConfig })

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body,
      })

      if (res.ok) {
        setMessage({ type: 'success', text: `Agent "${formName}" ${isEditing ? '已更新' : '已连接'}` })
        setShowForm(false)
        setEditingAgentId(null)
        resetForm()
        refreshAgents()
      } else {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }))
        setMessage({ type: 'error', text: err.error || (isEditing ? '更新失败' : '连接失败') })
      }
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '网络错误' })
    } finally {
      setIsSaving(false)
    }
  }

  const handleReconnect = async (agentId: string) => {
    setReconnectingAgentId(agentId)
    try {
      const res = await fetch(`/api/agents/${agentId}/reconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (res.ok) {
        refreshAgents()
      }
    } catch { /* ignore */ } finally {
      setReconnectingAgentId(null)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/agents/${id}`, { method: 'DELETE' })
      refreshAgents()
    } catch { /* ignore */ }
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">设置</h2>
          <p className="text-muted-foreground mt-1">控制台 — 管理 Agent 连接配置与状态</p>
        </div>
        <Button onClick={() => {
          if (showForm) {
            setShowForm(false)
            setEditingAgentId(null)
            resetForm()
          } else {
            setShowForm(true)
          }
        }} variant={showForm ? "secondary" : "default"} className="rounded-xl px-6">
          {showForm ? '取消' : (
            <>
              <Plus className="w-4 h-4 mr-2" />
              添加 Agent
            </>
          )}
        </Button>
      </div>

      {/* Message */}
      {message && (
        <div className={cn(
          "mb-6 flex items-center gap-3 px-4 py-3 rounded-xl text-sm animate-in fade-in slide-in-from-top-2",
          message.type === 'success'
            ? "bg-[var(--color-green)]/15 text-[var(--color-green)] border border-[var(--color-green)]/30"
            : "bg-destructive/15 text-destructive border border-destructive/30"
        )}>
          {message.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {message.text}
          <button onClick={() => setMessage(null)} className="ml-auto opacity-50 hover:opacity-100">×</button>
        </div>
      )}

      {/* Form Section */}
      {showForm && (
        <Card className="mb-8 border-primary/20 shadow-lg shadow-primary/5">
          <CardHeader>
            <CardTitle className="text-lg">{editingAgentId ? '编辑 Agent' : '添加新 Agent'}</CardTitle>
            <CardDescription>配置连接参数以接入 AI Agent</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">类型</label>
                <select
                  value={formType}
                  onChange={(e) => {
                    const newType = e.target.value as 'openclaw' | 'hermes'
                    setFormType(newType)
                    if (!editingAgentId) {
                      setFormId(newType)
                      setFormName(newType === 'openclaw' ? 'OpenClaw' : 'Hermes')
                    }
                    setFormUrl(newType === 'openclaw' ? DEFAULT_CONFIG.openclaw.gatewayUrl : DEFAULT_CONFIG.hermes.acpUrl)
                  }}
                  disabled={editingAgentId !== null}
                  className="w-full h-11 rounded-xl border border-input bg-background px-4 text-sm focus:ring-2 focus:ring-primary/20 transition-all outline-none disabled:opacity-50"
                >
                  <option value="openclaw">OpenClaw</option>
                  <option value="hermes">Hermes</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">标识 (ID)</label>
                <Input 
                  value={formId} 
                  onChange={(e) => setFormId(e.target.value)} 
                  placeholder="my-agent" 
                  disabled={editingAgentId !== null}
                  className="h-11 rounded-xl focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">显示名称</label>
                <Input 
                  value={formName} 
                  onChange={(e) => setFormName(e.target.value)} 
                  placeholder="My OpenClaw" 
                  className="h-11 rounded-xl focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                连接地址 {formType === 'openclaw' ? '(WebSocket 网关)' : '(ACP 服务)'}
              </label>
              <Input 
                value={formUrl} 
                onChange={(e) => setFormUrl(e.target.value)}
                placeholder={formType === 'openclaw' ? DEFAULT_CONFIG.openclaw.gatewayUrl : DEFAULT_CONFIG.hermes.acpUrl}
                className="h-11 rounded-xl focus:ring-2 focus:ring-primary/20"
              />
            </div>
            {formType === 'openclaw' && (
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Gateway Token
                </label>
                <div className="relative">
                  <Input 
                    value={formToken} 
                    onChange={(e) => setFormToken(e.target.value)}
                    placeholder="OpenClaw Gateway Token"
                    type="password"
                    className="h-11 rounded-xl pr-32 focus:ring-2 focus:ring-primary/20"
                  />
                  <div className="absolute right-2 top-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => testConnection(true)}
                      disabled={isTesting || !formUrl.trim()}
                      className="h-8 rounded-lg text-xs"
                    >
                      {isTesting ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> : <Plug className="w-3 h-3 mr-1.5" />}
                      测试连接
                    </Button>
                  </div>
                </div>
              </div>
            )}
            {formType === 'hermes' && (
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  API Key (可选)
                </label>
                <div className="relative">
                  <Input 
                    value={formApiKey} 
                    onChange={(e) => setFormApiKey(e.target.value)}
                    placeholder="API_SERVER_KEY (用于认证)"
                    type="password"
                    className="h-11 rounded-xl pr-32 focus:ring-2 focus:ring-primary/20"
                  />
                  <div className="absolute right-2 top-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => testConnection(true)}
                      disabled={isTesting || !formUrl.trim()}
                      className="h-8 rounded-lg text-xs"
                    >
                      {isTesting ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> : <Plug className="w-3 h-3 mr-1.5" />}
                      测试连接
                    </Button>
                  </div>
                </div>
              </div>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="ghost" onClick={() => {
                setShowForm(false)
                setEditingAgentId(null)
                resetForm()
              }} className="rounded-xl">取消</Button>
              <Button onClick={handleSave} disabled={isSaving || !formName.trim() || !formId.trim()} className="rounded-xl px-8 shadow-md shadow-primary/20">
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle className="w-4 h-4 mr-2" />}
                {editingAgentId ? '保存更改' : '立即连接'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Agents List Section */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-semibold">我的 Agents</h3>
          <div className="text-sm text-muted-foreground">
            共 {agents.length} 个 Agent · {agents.filter(a => a.status === 'connected').length} 个在线
          </div>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-8 h-8 animate-spin mb-4" />
            <p>加载 Agent 列表中...</p>
          </div>
        ) : agents.length === 0 ? (
          <Card className="border-dashed bg-muted/30">
            <CardContent className="flex flex-col items-center justify-center py-20">
              <div className="w-20 h-20 rounded-3xl bg-muted flex items-center justify-center mb-6">
                <Zap className="w-10 h-10 text-muted-foreground" />
              </div>
              <h4 className="text-xl font-medium mb-2">尚未配置任何 Agent</h4>
              <p className="text-sm text-muted-foreground mb-8 max-w-xs text-center">
                ClawDeck 需要至少连接一个 AI Agent 才能开始工作。
              </p>
              {!showForm && (
                <Button onClick={() => setShowForm(true)} className="rounded-xl px-8">
                  <Plus className="w-4 h-4 mr-2" />
                  立即添加
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {agents.map((agent) => (
              <Card key={agent.id} className="group overflow-hidden border-border/60 hover:border-primary/40 transition-all hover:shadow-xl hover:shadow-primary/5 flex flex-col">
                <div className={cn(
                  "h-1.5 w-full",
                  agent.status === 'connected' ? "bg-[var(--color-green)]" : 
                  agent.status === 'error' ? "bg-destructive" : "bg-muted-foreground/30"
                )} />
                <CardHeader className="pb-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
                        agent.status === 'connected' ? "bg-[var(--color-green)]/10" : "bg-muted"
                      )}>
                        <Terminal className={cn(
                          "w-5 h-5",
                          agent.status === 'connected' ? "text-[var(--color-green)]" : "text-muted-foreground"
                        )} />
                      </div>
                      <div>
                        <CardTitle className="text-base line-clamp-1">{agent.name}</CardTitle>
                        <CardDescription className="text-[10px] uppercase font-bold tracking-widest mt-0.5 opacity-70">
                          {agent.type}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button 
                        variant="ghost" 
                        size="icon"
                        onClick={() => handleEdit(agent)} 
                        className="w-8 h-8 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon"
                        onClick={() => handleDelete(agent.id)} 
                        className="w-8 h-8 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div className="p-3 rounded-xl bg-muted/50 space-y-1">
                      <div className="text-muted-foreground">状态</div>
                      <div className={cn(
                        "font-medium capitalize flex items-center gap-1.5",
                        agent.status === 'connected' ? "text-[var(--color-green)]" : "text-muted-foreground"
                      )}>
                        <div className={cn(
                          "w-1.5 h-1.5 rounded-full",
                          agent.status === 'connected' ? "bg-[var(--color-green)]" : "bg-muted-foreground"
                        )} />
                        {agent.status}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-muted/50 space-y-1">
                      <div className="text-muted-foreground">会话数</div>
                      <div className="font-medium text-foreground">{agent.sessionCount}</div>
                    </div>
                  </div>

                  {agent.model && (
                    <div className="p-3 rounded-xl bg-muted/50 space-y-1 text-xs">
                      <div className="text-muted-foreground">当前模型</div>
                      <div className="font-mono text-primary truncate">{agent.model}</div>
                    </div>
                  )}

                  <div className="space-y-2 pt-2">
                    {agent.status !== 'connected' ? (
                      <Button 
                        variant="outline"
                        className="w-full rounded-xl h-10 border-primary/30 text-primary hover:bg-primary/5"
                        onClick={() => handleReconnect(agent.id)}
                        disabled={reconnectingAgentId === agent.id}
                      >
                        {reconnectingAgentId === agent.id ? (
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        ) : (
                          <Plug className="w-4 h-4 mr-2" />
                        )}
                        {reconnectingAgentId === agent.id ? '重新连接中...' : '重新连接'}
                      </Button>
                    ) : (
                      <Button 
                        className="w-full rounded-xl h-10 shadow-sm transition-all hover:translate-y-[-1px]"
                        onClick={() => navigate('/chat')}
                      >
                        <MessageSquare className="w-4 h-4 mr-2" />
                        进入对话
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
