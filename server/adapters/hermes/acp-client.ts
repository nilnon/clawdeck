import type { ToolDefinition, ModelInfo, SessionInfo, SessionDetail } from '@shared/types.js'

export class AcpClient {
  private baseUrl = ''
  private apiKey = ''
  private initialized = false

  get isConnected(): boolean {
    return this.initialized
  }

  async connect(url: string, apiKey?: string): Promise<void> {
    this.baseUrl = url.replace(/\/$/, '')
    this.apiKey = apiKey || ''
    try {
      const headers: Record<string, string> = {}
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`
      }
      const res = await fetch(`${this.baseUrl}/v1/health`, { method: 'GET', headers })
      if (!res.ok) throw new Error(`ACP server returned ${res.status}`)
      this.initialized = true
      console.log(`[AcpClient] Connected to ${url}`)
    } catch (err) {
      this.initialized = false
      throw new Error(`Failed to connect to ACP server: ${err instanceof Error ? err.message : err}`)
    }
  }

  disconnect(): void {
    this.initialized = false
    this.baseUrl = ''
  }

  async initialize(): Promise<Record<string, unknown>> {
    return this.post('/initialize', {}) as Promise<Record<string, unknown>>
  }

  async newSession(cwd?: string): Promise<string> {
    const result = await this.post('/session/new', { cwd }) as Record<string, unknown>
    return result.sessionId as string
  }

  async loadSession(sessionId: string): Promise<void> {
    await this.post(`/session/${sessionId}/load`, {})
  }

  async resumeSession(sessionId: string): Promise<void> {
    await this.post(`/session/${sessionId}/resume`, {})
  }

  async listSessions(): Promise<SessionInfo[]> {
    try {
      const result = await this.get('/session/list') as { sessions?: SessionInfo[] }
      return result.sessions || []
    } catch {
      return []
    }
  }

  async getSessionDetail(sessionId: string): Promise<SessionDetail | null> {
    try {
      return await this.get(`/session/${sessionId}`) as Promise<SessionDetail>
    } catch {
      return null
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.post(`/session/${sessionId}/delete`, {})
  }

  async forkSession(sessionId: string): Promise<string> {
    const result = await this.post(`/session/${sessionId}/fork`, {}) as Record<string, unknown>
    return result.newSessionId as string
  }

  async listTools(): Promise<ToolDefinition[]> {
    try {
      const result = await this.get('/tools/list') as { tools?: ToolDefinition[] }
      return result.tools || []
    } catch {
      return []
    }
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    return this.post('/tools/call', { toolName, args })
  }

  async *chatStream(message: string, sessionId?: string): AsyncIterable<{ content: string; done: boolean }> {
    const body = JSON.stringify({ message, sessionId })
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }

    const res = await fetch(`${this.baseUrl}/chat/stream`, {
      method: 'POST',
      headers,
      body,
    })

    if (!res.ok || !res.body) {
      const errorText = await res.text().catch(() => 'Unknown error')
      yield { content: `Error: ${errorText}`, done: true }
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue

          const data = trimmed.slice(6)
          if (data === '[DONE]') {
            yield { content: '', done: true }
            return
          }

          try {
            const parsed = JSON.parse(data)
            yield {
              content: parsed.content || parsed.text || '',
              done: parsed.done || false,
            }
          } catch {
            yield { content: data, done: false }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { id: 'default', name: 'Default', provider: 'hermes', supportsTools: true },
    ]
  }

  private async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`POST ${path} failed (${res.status}): ${text}`)
    }
    return res.json()
  }

  private async get(path: string): Promise<unknown> {
    const headers: Record<string, string> = {}
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }
    const res = await fetch(`${this.baseUrl}${path}`, { headers })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`GET ${path} failed (${res.status}): ${text}`)
    }
    return res.json()
  }
}