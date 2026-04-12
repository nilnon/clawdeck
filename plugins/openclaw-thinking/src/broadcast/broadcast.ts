import type { IncomingMessage, ServerResponse } from 'node:http'
import type { PluginAPI, PhaseState, ThinkingPluginConfig } from '../types'
import { PhaseStateManager } from '../core'

export interface BroadcastOptions {
  phaseManager: PhaseStateManager
  config: ThinkingPluginConfig
  logger?: PluginAPI['logger']
}

export class BroadcastModule {
  private phaseManager: PhaseStateManager
  private config: ThinkingPluginConfig
  private logger?: PluginAPI['logger']
  private sseClients = new Map<string, Set<ServerResponse>>()
  private latestPhases = new Map<string, PhaseState>()

  constructor(options: BroadcastOptions) {
    this.phaseManager = options.phaseManager
    this.config = options.config
    this.logger = options.logger

    this.phaseManager.on('phase_change', this.onPhaseChange.bind(this))
  }

  private onPhaseChange(state: PhaseState): void {
    this.latestPhases.set(state.sessionId, state)

    this.broadcastViaSSE(state)
  }

  getLatestPhase(sessionId: string): PhaseState | undefined {
    const state = this.latestPhases.get(sessionId)
    if (state) {
      state.phaseElapsedTime = Date.now() - state.phaseStartTime
    }
    return state
  }

  getAllLatestPhases(): Map<string, PhaseState> {
    return new Map(this.latestPhases)
  }

  registerGatewayMethods(api: PluginAPI): void {
    if (!api.registerGatewayMethod) {
      this.logger?.warn?.('registerGatewayMethod not available')
      return
    }

    api.registerGatewayMethod('getThinkingPhase', (ctx) => {
      const params = ctx.params as { sessionId?: string } | undefined
      const sessionId = params?.sessionId

      if (sessionId) {
        const state = this.getLatestPhase(sessionId)
        ctx.respond(true, state || { phase: 'idle', sessionId })
      } else {
        const allStates = Object.fromEntries(this.getAllLatestPhases())
        ctx.respond(true, { sessions: allStates })
      }
    })

    api.registerGatewayMethod('getActiveThinkingSessions', (ctx) => {
      const activeSessions = this.phaseManager.getActiveSessions()
      ctx.respond(true, { sessions: activeSessions })
    })

    this.logger?.info?.('Gateway methods registered: getThinkingPhase, getActiveThinkingSessions')
  }

  registerSSERoute(api: PluginAPI): void {
    if (!api.registerHttpRoute) {
      this.logger?.warn?.('registerHttpRoute not available')
      return
    }

    api.registerHttpRoute({
      path: `${this.config.ui.basePath}/api/phase/stream`,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        return this.handleSSE(req, res)
      },
      auth: 'gateway',
      match: 'exact',
    })

    api.registerHttpRoute({
      path: `${this.config.ui.basePath}/api/phase`,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        return this.handlePhaseQuery(req, res)
      },
      auth: 'gateway',
      match: 'exact',
    })

    this.logger?.info?.('SSE routes registered')
  }

  private async handleSSE(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host}`)
    const sessionId = url.searchParams.get('sessionId')

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })

    res.write(': connected\n\n')

    if (sessionId) {
      if (!this.sseClients.has(sessionId)) {
        this.sseClients.set(sessionId, new Set())
      }
      this.sseClients.get(sessionId)!.add(res)

      const currentState = this.getLatestPhase(sessionId)
      if (currentState) {
        res.write(`event: phase_change\ndata: ${JSON.stringify(currentState)}\n\n`)
      }

      req.on('close', () => {
        this.sseClients.get(sessionId)?.delete(res)
        if (this.sseClients.get(sessionId)?.size === 0) {
          this.sseClients.delete(sessionId)
        }
      })
    }

    const heartbeatInterval = setInterval(() => {
      res.write(`event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`)
    }, this.config.broadcast.sse.heartbeatInterval)

    req.on('close', () => {
      clearInterval(heartbeatInterval)
    })
  }

  private async handlePhaseQuery(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host}`)
    const sessionId = url.searchParams.get('sessionId')

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    })

    if (sessionId) {
      const state = this.getLatestPhase(sessionId)
      res.end(JSON.stringify(state || { phase: 'idle', sessionId }))
    } else {
      const activeSessions = this.phaseManager.getActiveSessions()
      res.end(JSON.stringify({ sessions: activeSessions }))
    }
  }

  private broadcastViaSSE(state: PhaseState): void {
    const clients = this.sseClients.get(state.sessionId)
    if (!clients || clients.size === 0) return

    const data = JSON.stringify(state)
    const message = `event: phase_change\ndata: ${data}\n\n`

    clients.forEach(res => {
      try {
        res.write(message)
      } catch (error) {
        this.logger?.warn?.(`Failed to broadcast to SSE client: ${error}`)
      }
    })
  }

  close(): void {
    this.sseClients.forEach(clients => {
      clients.forEach(res => {
        try {
          res.end()
        } catch {
          // ignore
        }
      })
    })
    this.sseClients.clear()
  }
}
