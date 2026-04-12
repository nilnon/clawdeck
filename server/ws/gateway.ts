import { WebSocketServer, type WebSocket } from 'ws'
import type { Server } from 'node:http'
import adapterRegistry from '../lib/adapter-registry.js'

interface ClientConnection {
  ws: WebSocket
  agentId: string | null
  heartbeatTimer?: ReturnType<typeof setInterval>
}

export class WsGateway {
  private wss!: WebSocketServer
  private clients = new Map<WebSocket, ClientConnection>()

  attach(server: Server): void {
    this.wss = new WebSocketServer({ noServer: true })

    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url || '/', `http://${req.headers.host}`)
      if (url.pathname === '/api/ws') {
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.wss.emit('connection', ws, req)
        })
      } else {
        socket.destroy()
      }
    })

    this.wss.on('connection', (ws) => {
      const client: ClientConnection = { ws, agentId: null }
      this.clients.set(ws, client)

      client.heartbeatTimer = setInterval(() => {
        if (ws.readyState === ws.OPEN) {
          ws.ping()
        }
      }, 30000)

      ws.on('pong', () => { /* alive */ })

      ws.on('message', async (raw) => {
        try {
          const msg = JSON.parse(raw.toString())
          await this.handleMessage(ws, msg as Record<string, unknown>)
        } catch {
          ws.send(JSON.stringify({ error: 'Invalid message format' }))
        }
      })

      ws.on('close', () => {
        if (client.heartbeatTimer) clearInterval(client.heartbeatTimer)
        this.clients.delete(ws)
      })

      ws.send(JSON.stringify({
        type: 'connected',
        timestamp: Date.now(),
        message: 'ClawDeck WebSocket connected',
      }))
    })

    console.log('[WsGateway] WebSocket endpoint at /api/ws')
  }

  private async handleMessage(ws: WebSocket, msg: Record<string, unknown>): Promise<void> {
    const client = this.clients.get(ws)
    if (!client) return

    switch (msg.type) {
      case 'join': {
        const agentId = typeof msg.agentId === 'string' ? msg.agentId : null
        client.agentId = agentId
        ws.send(JSON.stringify({ type: 'joined', agentId, timestamp: Date.now() }))
        break
      }

      case 'status': {
        const summaries = adapterRegistry.list()
        ws.send(JSON.stringify({ type: 'status_list', data: summaries, timestamp: Date.now() }))
        break
      }

      default:
        ws.send(JSON.stringify({ error: `Unknown message type: ${msg.type}` }))
    }
  }

  broadcast(agentId: string | null, data: Record<string, unknown>): void {
    for (const [ws, client] of this.clients) {
      if (ws.readyState !== ws.OPEN) continue
      if (agentId && client.agentId !== agentId) continue

      ws.send(JSON.stringify({ ...data, timestamp: Date.now() }))
    }
  }

  get clientCount(): number {
    let count = 0
    for (const [ws] of this.clients) {
      if (ws.readyState === ws.OPEN) count++
    }
    return count
  }
}
