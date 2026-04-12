import WebSocket from 'ws'
import { createDeviceBlock } from './device-identity.js'
import { appendFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const DEBUG_LOG_DIR = join(homedir(), '.clawdeck', 'debug-logs')
const DEBUG_LOG_FILE = join(DEBUG_LOG_DIR, `events-${new Date().toISOString().slice(0, 10)}.jsonl`)

function debugLog(event: Record<string, unknown>): void {
  try {
    if (!existsSync(DEBUG_LOG_DIR)) {
      mkdirSync(DEBUG_LOG_DIR, { recursive: true })
    }
    const logEntry = JSON.stringify({
      timestamp: new Date().toISOString(),
      ...event
    }) + '\n'
    appendFileSync(DEBUG_LOG_FILE, logEntry, 'utf-8')
  } catch {
  }
}

interface PendingCall {
  resolve: (data: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type MessageHandler = (data: unknown) => void

export class RpcClient {
  private ws: WebSocket | null = null
  private url = ''
  private token = ''
  private pendingCalls = new Map<string, PendingCall>()
  private messageId = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null
  private _connected = false
  private _connecting = false
  private _handshaked = false
  private connectPromise: Promise<void> | null = null
  private messageHandlers: Set<MessageHandler> = new Set()
  private reconnectDelay = 1000
  private maxReconnectDelay = 30000
  private connectNonce: string | null = null
  private connectChallengeTimer: ReturnType<typeof setTimeout> | null = null

  get isConnected(): boolean {
    return this._connected && this._handshaked && this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler)
    return () => { this.messageHandlers.delete(handler) }
  }

  async connect(url: string, token?: string): Promise<void> {
    this.token = token || process.env.OPENCLAW_GATEWAY_TOKEN || '33adf087441f8d055d65f497dc11c4605555484d9e00f523'
    if (this.isConnected) return
    if (this._connecting && this.connectPromise) return this.connectPromise

    this.url = url
    this._connecting = true
    this._handshaked = false
    this.connectNonce = null
    
    this.connectPromise = new Promise((resolve, reject) => {
      try {
        console.log(`[RpcClient] Connecting to ${url}...`)
        if (this.ws) {
          this.ws.removeAllListeners()
          this.ws.close()
        }

        this.ws = new WebSocket(url)
        
        const onOpen = () => {
          console.log(`[RpcClient] WebSocket connected to ${url}`)
          this.armConnectChallengeTimeout()
        }

        const onError = (err: Error) => {
          console.error(`[RpcClient] Connection error:`, err.message)
          this._connecting = false
          this._handshaked = false
          this.connectPromise = null
          this.clearConnectChallengeTimeout()
          reject(err)
        }

        const onClose = (code: number, reason: Buffer) => {
          console.log(`[RpcClient] Connection closed: ${code} ${reason.toString()}`)
          this._connected = false
          this._handshaked = false
          this.connectPromise = null
          this.clearConnectChallengeTimeout()
          this.handleDisconnect()
          if (this._connecting) {
            reject(new Error(`Connection closed during handshake: ${code}`))
          }
        }

        const onMessage = (raw: WebSocket.Data) => {
          try {
            const rawStr = raw.toString()
            console.log(`[RpcClient] Received message:`, rawStr)
            const data = JSON.parse(rawStr)
            this.handleMessage(data, resolve, reject)
          } catch (err) {
            console.error(`[RpcClient] Parse error:`, err)
          }
        }

        this.ws.on('open', onOpen)
        this.ws.on('error', onError)
        this.ws.on('close', onClose)
        this.ws.on('message', onMessage)
      } catch (err) {
        this._connecting = false
        this._handshaked = false
        this.connectPromise = null
        this.clearConnectChallengeTimeout()
        reject(err)
      }
    })

    return this.connectPromise
  }

  disconnect(): void {
    this.stopHeartbeat()
    this.clearReconnectTimer()
    this.clearConnectChallengeTimeout()
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this._connected = false
    this._connecting = false
    this._handshaked = false
    this.rejectAllPending(new Error('Disconnected'))
  }

  async call(method: string, params?: Record<string, unknown>, timeoutMs = 30000): Promise<unknown> {
    if (!this.isConnected) {
      console.log(`[RpcClient] Call "${method}" - Connection lost, attempting recovery...`)
      try {
        await this.connect(this.url)
      } catch (err) {
        throw new Error(`RPC recovery failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    
    const id = `req-${++this.messageId}-${Date.now()}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCalls.delete(id)
        reject(new Error(`RPC call "${method}" timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      
      this.pendingCalls.set(id, { resolve, reject, timer })
      
      try {
        const message = JSON.stringify({ type: 'req', id, method, params: params ?? {} })
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(message, (err) => {
            if (err) {
              this.pendingCalls.delete(id)
              clearTimeout(timer)
              reject(new Error(`WebSocket send error: ${err.message}`))
            }
          })
        } else {
          throw new Error('WebSocket is not in OPEN state')
        }
      } catch (err) {
        this.pendingCalls.delete(id)
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  notify(method: string, params?: Record<string, unknown>): void {
    if (!this.isConnected) return
    const message = JSON.stringify({ type: 'req', id: `notify-${Date.now()}`, method, params: params ?? {} })
    this.ws!.send(message)
  }

  private handleMessage(data: unknown, resolve?: (value: void) => void, reject?: (err: Error) => void): void {
    if (!data || typeof data !== 'object') return
    const msg = data as Record<string, unknown>

    debugLog(msg as Record<string, unknown>)

    if (msg.type === 'event') {
      const event = msg.event as string

      if (event === 'connect.challenge') {
        const payload = msg.payload as Record<string, unknown>
        const nonce = payload?.nonce as string
        if (nonce && nonce.trim()) {
          this.connectNonce = nonce.trim()
          this.sendConnect(resolve, reject)
        } else {
          const err = new Error('Missing connect challenge nonce')
          console.error(`[RpcClient] ${err.message}`)
          reject?.(err)
          this.ws?.close(1008, err.message)
        }
        return
      }

      if (event === 'hello-ok') {
        this._handshaked = true
        this._connected = true
        this._connecting = false
        this.connectPromise = null
        this.clearConnectChallengeTimeout()
        this.reconnectDelay = 1000
        this.startHeartbeat()
        console.log(`[RpcClient] Handshake complete (event hello-ok)`)
        resolve?.()
        return
      }
    }

    // Handle response messages (type: 'res')
    this.handleResponse(data, resolve, reject)

    for (const handler of this.messageHandlers) {
      try { handler(data) } catch { }
    }
  }
  
  private handleResponse(data: unknown, resolve?: (value: void) => void, _reject?: (err: Error) => void): void {
    if (!data || typeof data !== 'object') return
    const msg = data as Record<string, unknown>

    if (msg.type === 'res') {
      const id = msg.id as string
      if (id && typeof id === 'string') {
        const pending = this.pendingCalls.get(id)
        if (pending) {
          clearTimeout(pending.timer)
          this.pendingCalls.delete(id)
          if (msg.ok === false && msg.error) {
            const error = msg.error as Record<string, unknown>
            pending.reject(new Error(error.message as string || 'RPC error'))
          } else {
            pending.resolve(msg.payload)
          }
        }

        if (id?.startsWith('connect-') && msg.ok === true) {
          const payload = msg.payload as Record<string, unknown>
          if (payload?.type === 'hello-ok') {
            this._handshaked = true
            this._connected = true
            this._connecting = false
            this.connectPromise = null
            this.clearConnectChallengeTimeout()
            this.reconnectDelay = 1000
            this.startHeartbeat()
            console.log(`[RpcClient] Handshake complete (connect response)`)
            resolve?.()
          }
        }
      }
    }
  }

  private sendConnect(_resolve?: (value: void) => void, reject?: (err: Error) => void): void {
    if (!this.connectNonce) {
      const err = new Error('Missing connect nonce')
      console.error(`[RpcClient] ${err.message}`)
      reject?.(err)
      return
    }

    const clientId = 'gateway-client'
    const clientMode = 'backend'
    const role = 'operator'
    const scopes = ['operator.admin', 'operator.write', 'operator.read']

    const device = createDeviceBlock({
      clientId,
      clientMode,
      role,
      scopes,
      token: this.token,
      nonce: this.connectNonce,
    })

    const connectParams = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: clientId,
        version: '0.1.0',
        platform: process.platform,
        mode: clientMode,
      },
      role,
      scopes,
      auth: {
        token: this.token,
      },
      device,
    }

    const id = `connect-${Date.now()}`
    const timer = setTimeout(() => {
      const err = new Error('Connect timeout')
      console.error(`[RpcClient] ${err.message}`)
      reject?.(err)
      this.ws?.close(1008, err.message)
    }, 5000)

    this.pendingCalls.set(id, {
      resolve: () => {
        clearTimeout(timer)
      },
      reject: (err) => {
        clearTimeout(timer)
        reject?.(err)
      },
      timer,
    })

    const message = JSON.stringify({ type: 'req', id, method: 'connect', params: connectParams })
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(message, (err) => {
        if (err) {
          this.pendingCalls.delete(id)
          clearTimeout(timer)
          const sendErr = new Error(`Connect send error: ${err.message}`)
          console.error(`[RpcClient] ${sendErr.message}`)
          reject?.(sendErr)
        }
      })
    } else {
      const err = new Error('WebSocket not open for connect')
      console.error(`[RpcClient] ${err.message}`)
      reject?.(err)
    }
  }

  private handleDisconnect(): void {
    this._connected = false
    this._handshaked = false
    this.stopHeartbeat()
    this.rejectAllPending(new Error('Connection closed'))
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    console.log(`[RpcClient] Reconnecting in ${this.reconnectDelay}ms...`)
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      try {
        await this.connect(this.url)
      } catch {
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay)
        this.scheduleReconnect()
      }
    }, this.reconnectDelay)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private armConnectChallengeTimeout(): void {
    this.clearConnectChallengeTimeout()
    this.connectChallengeTimer = setTimeout(() => {
      const err = new Error('Connect challenge timeout')
      console.error(`[RpcClient] ${err.message}`)
      this.ws?.close(1008, err.message)
    }, 5000)
  }

  private clearConnectChallengeTimeout(): void {
    if (this.connectChallengeTimer) {
      clearTimeout(this.connectChallengeTimer)
      this.connectChallengeTimer = null
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    // Gateway sends 'tick' events automatically, no need for manual ping
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private rejectAllPending(err: Error): void {
    for (const [_id, pending] of this.pendingCalls) {
      clearTimeout(pending.timer)
      pending.reject(err)
    }
    this.pendingCalls.clear()
  }
  
}