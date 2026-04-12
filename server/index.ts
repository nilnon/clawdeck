import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { createServer } from 'node:http'
import { serve } from '@hono/node-server'
import dotenv from 'dotenv'
import agentsRoute from './routes/agents.js'
import chatRoute from './routes/chat.js'
import sessionsRoute from './routes/sessions.js'
import toolsRoute from './routes/tools.js'
import modelsRoute from './routes/models.js'
import { WsGateway } from './ws/gateway.js'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { initDb } from './db/index.js'
import { adapterRegistry } from './lib/adapter-registry.js'
import { getDb } from './db/index.js'

dotenv.config()

// 确保数据目录存在
if (process.env.DATABASE_PATH) {
  const dbDir = dirname(process.env.DATABASE_PATH)
  try {
    mkdirSync(dbDir, { recursive: true })
  } catch (err) {
    console.error(`Failed to create database directory: ${err}`)
  }
}

// 初始化数据库
try {
  initDb()
  
  // 从数据库加载已有的 Agents
  const db = getDb()
  const savedAgents = db.prepare('SELECT * FROM agents').all() as any[]
  console.log(`[Startup] Loading ${savedAgents.length} saved agents...`)
  
  for (const agent of savedAgents) {
    try {
      const config = { 
        ...JSON.parse(agent.config), 
        type: agent.type, 
        name: agent.name 
      }
      
      let adapter
      if (agent.type === 'openclaw') {
        const { OpenClawAdapter } = await import('./adapters/openclaw/index.js')
        adapter = new OpenClawAdapter()
      } else if (agent.type === 'hermes') {
        const { HermesAdapter } = await import('./adapters/hermes/index.js')
        adapter = new HermesAdapter()
      }
      
      if (adapter) {
        adapterRegistry.register(agent.id, adapter, config)
        adapter.connect(config).catch(err => {
          console.error(`[Startup] Failed to connect agent ${agent.id}:`, err.message)
        })
      }
    } catch (err) {
      console.error(`[Startup] Failed to load agent ${agent.id}:`, err)
    }
  }
} catch (err) {
  console.error(`Failed to initialize database or load agents: ${err}`)
}

const app = new Hono()

const _port = Number(process.env.PORT) || 4098
const _frontendUrl = process.env.FRONTEND_URL || `http://localhost:${process.env.VITE_DEV_PORT || '4096'}`

app.use('*', cors({
  origin: (origin) => {
    if (!origin) return '*'
    if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
      return origin
    }
    return _frontendUrl
  },
  allowHeaders: ['Content-Type', 'X-Agent-ID'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}))
app.use('*', logger())

app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }))
app.get('/api/ping', (c) => c.json({ message: 'ClawDeck is running' }))

app.route('/api/agents', agentsRoute)
app.route('/api/chat', chatRoute)
app.route('/api/sessions', sessionsRoute)
app.route('/api/tools', toolsRoute)
app.route('/api/models', modelsRoute)

const server = createServer()
const wsGateway = new WsGateway()

serve(
  {
    fetch: app.fetch,
    port: _port,
  },
  (info) => {
    wsGateway.attach(server)

    console.log(``)
    console.log(`🦞 ClawDeck 已启动`)
    console.log(`   Server: http://${info.address}:${info.port}`)
    console.log(`   WS:     ws://${info.address}:${info.port}/api/ws`)
    console.log(`   Health: http://${info.address}:${info.port}/health`)
    console.log(``)
  },
)

export default app
export { wsGateway }
