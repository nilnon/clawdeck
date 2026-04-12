import { Hono } from 'hono'
import adapterRegistry from '../lib/adapter-registry.js'

const models = new Hono()

models.get('/', async (c) => {
  const agentId = c.req.header('X-Agent-ID') || c.req.query('agentId') || 'default'
  const adapter = adapterRegistry.get(agentId)
  if (!adapter) return c.json({ error: `Agent "${agentId}" not found` }, 404)
  if (!adapter.isConnected()) return c.json({ error: 'Agent not connected' }, 503)

  const modelList = await adapter.listModels()
  return c.json(modelList)
})

export default models