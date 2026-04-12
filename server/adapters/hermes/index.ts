import type {
  IAgentAdapter,
  AgentConfig,
  AgentEvent,
  ChatOptions,
  ChatChunk,
  SessionInfo,
  SessionDetail,
  CreateSessionOptions,
  ToolDefinition,
  ToolResult,
  ModelInfo,
} from '@shared/types.js'
import { AgentStatus } from '@shared/types.js'
import { AcpClient } from './acp-client.js'
import { CliBridge } from './cli-bridge.js'
import { randomUUID } from 'node:crypto'

export class HermesAdapter implements IAgentAdapter {
  readonly type = 'hermes' as const
  name = 'Hermes'

  private acp = new AcpClient()
  private cli = new CliBridge()
  private useCli = false
  private statusListeners = new Set<(status: AgentStatus) => void>()
  private eventListeners = new Set<(event: AgentEvent) => void>()

  async connect(config: AgentConfig): Promise<void> {
    this.name = config.name || 'Hermes'
    const acpUrl = config.acpUrl || process.env.VITE_HERMES_ACP_URL || 'http://localhost:8642'
    const apiKey = ((config as unknown) as Record<string, unknown>).apiKey as string | undefined

    this.emitStatus(AgentStatus.CONNECTING)

    try {
      await this.acp.connect(acpUrl, apiKey)
      this.useCli = false
      console.log(`[HermesAdapter] Connected via ACP to ${acpUrl}`)
      this.emitStatus(AgentStatus.CONNECTED)
    } catch {
      console.log('[HermesAdapter] ACP unavailable, falling back to CLI')
      const cliPath = config.cliPath || process.env.VITE_HERMES_CLI_PATH || 'hermes'
      this.cli.start(cliPath)
      this.useCli = true
      this.emitStatus(AgentStatus.CONNECTED)
    }
  }

  async disconnect(): Promise<void> {
    this.acp.disconnect()
    if (this.cli.isRunning) {
      this.cli.stop()
    }
    this.emitStatus(AgentStatus.DISCONNECTED)
  }

  isConnected(): boolean {
    return this.useCli ? this.cli.isRunning : this.acp.isConnected
  }

  async *chat(message: string, options?: ChatOptions): AsyncIterable<ChatChunk> {
    const chunkId = randomUUID()

    if (!this.useCli && this.acp.isConnected) {
      try {
        for await (const part of this.acp.chatStream(message, options?.sessionId)) {
          yield {
            id: chunkId,
            role: 'assistant',
            content: part.content,
            done: part.done,
            timestamp: Date.now(),
          }
        }
        return
      } catch (err) {
        yield {
          id: chunkId,
          role: 'assistant',
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
          done: true,
          timestamp: Date.now(),
        }
        return
      }
    }

    if (this.cli.isRunning) {
      for await (const chunk of this.cli.chatStream(message)) {
        yield chunk
      }
      return
    }

    throw new Error('Hermes not connected')
  }

  async listSessions(): Promise<SessionInfo[]> {
    if (!this.useCli && this.acp.isConnected) {
      return this.acp.listSessions()
    }
    return []
  }

  async getSession(sessionId: string): Promise<SessionDetail> {
    if (!this.useCli && this.acp.isConnected) {
      const detail = await this.acp.getSessionDetail(sessionId)
      if (detail) return detail
    }
    return {
      id: sessionId,
      agentId: this.name,
      title: 'Unknown Session',
      createdAt: 0,
      updatedAt: 0,
      messageCount: 0,
      messages: [],
      status: 'active' as const,
    }
  }

  async createSession(_options?: CreateSessionOptions): Promise<string> {
    if (!this.useCli && this.acp.isConnected) {
      return this.acp.newSession()
    }
    return randomUUID()
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (!this.useCli && this.acp.isConnected) {
      await this.acp.deleteSession(sessionId)
    }
  }

  async resetSession(sessionId: string): Promise<void> {
    if (!this.useCli && this.acp.isConnected) {
      await this.acp.deleteSession(sessionId)
      await this.acp.newSession()
    }
  }

  async abort(_runId: string): Promise<void> {
    if (!this.useCli && this.acp.isConnected) {
      // ACP does not have abort, best effort
    }
  }

  async listTools(): Promise<ToolDefinition[]> {
    if (!this.useCli && this.acp.isConnected) {
      return this.acp.listTools()
    }
    return []
  }

  async invokeTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    const start = Date.now()
    if (!this.useCli && this.acp.isConnected) {
      try {
        const data = await this.acp.callTool(toolName, args)
        return { success: true, data, durationMs: Date.now() - start }
      } catch (err) {
        return { success: false, data: null, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start }
      }
    }
    return { success: false, data: null, error: 'Tool invocation not available in CLI mode', durationMs: Date.now() - start }
  }

  async listModels(): Promise<ModelInfo[]> {
    if (!this.useCli && this.acp.isConnected) {
      return this.acp.listModels()
    }
    return [{ id: 'default', name: 'Default', provider: 'hermes', supportsTools: true }]
  }

  async getStatus(): Promise<AgentStatus> {
    if (this.useCli) {
      return this.cli.isRunning ? AgentStatus.CONNECTED : AgentStatus.DISCONNECTED
    }
    return this.acp.isConnected ? AgentStatus.CONNECTED : AgentStatus.DISCONNECTED
  }

  onStatusChange(callback: (status: AgentStatus) => void): () => void {
    this.statusListeners.add(callback)
    return () => { this.statusListeners.delete(callback) }
  }

  onEvent(callback: (event: AgentEvent) => void): () => void {
    this.eventListeners.add(callback)
    return () => { this.eventListeners.delete(callback) }
  }

  private emitStatus(status: AgentStatus): void {
    for (const cb of this.statusListeners) {
      try { cb(status) } catch { /* ignore */ }
    }
  }

}
