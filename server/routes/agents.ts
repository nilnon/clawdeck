import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import adapterRegistry from '../lib/adapter-registry.js'
import { getDb } from '../db/index.js'
import type { AgentConfig } from '@shared/types.js'

const agents = new Hono()

const createAgentSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['openclaw', 'hermes']),
  name: z.string().min(1),
  config: z.record(z.string(), z.unknown()).optional(),
})

const updateAgentSchema = z.object({
  name: z.string().min(1),
  config: z.record(z.string(), z.unknown()).optional(),
})

const validateAgentSchema = z.object({
  type: z.enum(['openclaw', 'hermes']),
  config: z.record(z.string(), z.unknown()),
})

agents.get('/', (c) => {
  const list = adapterRegistry.list()
  return c.json(list)
})

agents.get('/:id/status', (c) => {
  const id = c.req.param('id')
  const entry = adapterRegistry.getEntry(id)
  if (!entry) return c.json({ error: 'Agent not found' }, 404)

  return c.json({
    id,
    type: entry.adapter.type,
    name: entry.adapter.name,
    connected: entry.adapter.isConnected(),
  })
})

agents.post('/', zValidator('json', createAgentSchema), async (c) => {
  const body = c.req.valid('json')
  if (adapterRegistry.has(body.id)) {
    return c.json({ error: `Agent "${body.id}" already exists` }, 409)
  }

  let adapter
  const config = { type: body.type, name: body.name, ...(body.config || {}) }

  try {
    switch (body.type) {
      case 'openclaw': {
        const { OpenClawAdapter } = await import('../adapters/openclaw/index.js')
        adapter = new OpenClawAdapter()
        break
      }
      case 'hermes': {
        const { HermesAdapter } = await import('../adapters/hermes/index.js')
        adapter = new HermesAdapter()
        break
      }
      default:
        return c.json({ error: `Unknown agent type: ${body.type}` }, 400)
    }

    adapterRegistry.register(body.id, adapter, config)
    await adapter.connect(config)

    // 持久化到数据库
    try {
      const db = getDb()
      db.prepare(`
        INSERT INTO agents (id, type, name, config, updated_at)
        VALUES (?, ?, ?, ?, unixepoch())
        ON CONFLICT(id) DO UPDATE SET
          type=excluded.type,
          name=excluded.name,
          config=excluded.config,
          updated_at=excluded.updated_at
      `).run(body.id, body.type, body.name, JSON.stringify(body.config || {}))
    } catch (dbErr) {
      console.error('[AgentsRoute] Failed to persist agent to DB:', dbErr)
    }

    return c.json({ id: body.id, type: body.type, name: body.name, status: 'connected' })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to connect agent' }, 500)
  }
})

agents.put('/:id', zValidator('json', updateAgentSchema), async (c) => {
  const id = c.req.param('id')
  const body = c.req.valid('json')
  
  try {
    await adapterRegistry.update(id, body.name, body.config || {})
    
    // 更新数据库
    try {
      const db = getDb()
      db.prepare(`
        UPDATE agents 
        SET name = ?, config = ?, updated_at = unixepoch() 
        WHERE id = ?
      `).run(body.name, JSON.stringify(body.config || {}), id)
    } catch (dbErr) {
      console.error('[AgentsRoute] Failed to update agent in DB:', dbErr)
    }

    return c.json({ success: true, id })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to update agent' }, 500)
  }
})

agents.post('/validate', zValidator('json', validateAgentSchema), async (c) => {
  const body = c.req.valid('json')
  let adapter
  
  try {
    switch (body.type) {
      case 'openclaw': {
        const { OpenClawAdapter } = await import('../adapters/openclaw/index.js')
        adapter = new OpenClawAdapter()
        break
      }
      case 'hermes': {
        const { HermesAdapter } = await import('../adapters/hermes/index.js')
        adapter = new HermesAdapter()
        break
      }
      default:
        return c.json({ error: `Unknown agent type: ${body.type}` }, 400)
    }

    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 15000))
    
    try {
      await Promise.race([adapter.connect((body.config as unknown) as AgentConfig), timeout])
      await adapter.disconnect()
      return c.json({ success: true })
    } catch (err) {
      if (body.type === 'openclaw') {
        for (const entry of adapterRegistry.getAllEntries()) {
          if (entry.adapter.type === 'openclaw' && entry.adapter.isConnected()) {
            return c.json({ success: true })
          }
        }
      }
      throw err
    }
  } catch (err) {
    return c.json({ 
      success: false, 
      error: err instanceof Error ? err.message : 'Failed to connect agent' 
    }, 200)
  }
})

agents.post('/:id/reconnect', async (c) => {
  const id = c.req.param('id')
  const entry = adapterRegistry.getEntry(id)
  if (!entry) return c.json({ error: 'Agent not found' }, 404)

  try {
    await entry.adapter.disconnect()
    await entry.adapter.connect(entry.config)
    return c.json({ success: true, id })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to reconnect agent' }, 500)
  }
})

agents.delete('/:id', async (c) => {
  const id = c.req.param('id')
  await adapterRegistry.remove(id)

  // 从数据库删除
  try {
    const db = getDb()
    db.prepare('DELETE FROM agents WHERE id = ?').run(id)
  } catch (dbErr) {
    console.error('[AgentsRoute] Failed to delete agent from DB:', dbErr)
  }

  return c.json({ success: true, id })
})

export default agents