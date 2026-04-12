import { Hono } from 'hono'
import adapterRegistry from '../lib/adapter-registry.js'

const tools = new Hono()

tools.get('/', async (c) => {
  const agentId = c.req.header('X-Agent-ID') || c.req.query('agentId') || 'default'
  const adapter = adapterRegistry.get(agentId)
  if (!adapter) return c.json({ error: `Agent "${agentId}" not found` }, 404)
  if (!adapter.isConnected()) return c.json({ error: 'Agent not connected' }, 503)

  const toolsList = await adapter.listTools()
  return c.json(toolsList)
})

tools.post('/invoke', async (c) => {
  const agentId = c.req.header('X-Agent-ID') || 'default'
  const body = await c.req.json<{ toolName: string; args?: Record<string, unknown> }>()
  const adapter = adapterRegistry.get(agentId)
  if (!adapter) return c.json({ error: `Agent "${agentId}" not found` }, 404)
  if (!adapter.isConnected()) return c.json({ error: 'Agent not connected' }, 503)

  const result = await adapter.invokeTool(body.toolName, body.args || {})
  return c.json(result)
})

export default tools