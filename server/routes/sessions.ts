import { Hono } from 'hono'
import adapterRegistry from '../lib/adapter-registry.js'

const sessions = new Hono()

sessions.get('/', async (c) => {
  const agentId = c.req.query('agentId')
  if (agentId) {
    const adapter = adapterRegistry.get(agentId)
    if (!adapter) return c.json([], 200)
    return adapter.listSessions().then((list) => c.json(list))
  }

  const allSessions: unknown[] = []
  for (const summary of adapterRegistry.list()) {
    const adapter = adapterRegistry.get(summary.id)
    if (adapter?.isConnected()) {
      try {
        const list = await adapter.listSessions()
        allSessions.push(...list)
      } catch { /* skip */ }
    }
  }
  return c.json(allSessions)
})

sessions.get('/:id', async (c) => {
  const sessionId = c.req.param('id')

  for (const summary of adapterRegistry.list()) {
    const adapter = adapterRegistry.get(summary.id)
    if (adapter?.isConnected()) {
      try {
        const detail = await adapter.getSession(sessionId)
        if (detail) return c.json(detail)
      } catch { /* continue */ }
    }
  }

  return c.json({ error: 'Session not found' }, 404)
})

sessions.delete('/:id', async (c) => {
  const sessionId = c.req.param('id')
  for (const summary of adapterRegistry.list()) {
    const adapter = adapterRegistry.get(summary.id)
    if (adapter?.isConnected()) {
      try {
        await adapter.deleteSession(sessionId)
        return c.json({ success: true, sessionId })
      } catch { /* continue */ }
    }
  }
  return c.json({ error: 'Session not found or unable to delete' }, 404)
})

sessions.post('/', async (c) => {
  try {
    const body = await c.req.json<{ agentId?: string; title?: string; model?: string; systemPrompt?: string; thinking?: 'light' | 'medium' | 'heavy' }>()
    const agentId = body?.agentId || 'default'
    const adapter = adapterRegistry.get(agentId)

    if (!adapter) {
      return c.json({ error: `Agent "${agentId}" not found` }, 404)
    }

    const sessionId = await adapter.createSession({
      title: body?.title,
      model: body?.model,
      systemPrompt: body?.systemPrompt,
      thinking: body?.thinking || 'medium',
    })
    if (!sessionId) {
      throw new Error('Agent failed to create session (empty ID returned)')
    }

    return c.json({ sessionId })
  } catch (err) {
    console.error('[SessionsRoute] Create session error:', err)
    return c.json({
      error: err instanceof Error ? err.message : 'Internal server error'
    }, 500)
  }
})

sessions.patch('/:id/status', async (c) => {
  const sessionId = c.req.param('id')
  const body = await c.req.json<{ status: 'active' | 'paused' | 'archived' }>()
  const status = body?.status

  if (!status || !['active', 'paused', 'archived'].includes(status)) {
    return c.json({ error: 'Invalid status. Must be active, paused, or archived' }, 400)
  }

  for (const summary of adapterRegistry.list()) {
    const adapter = adapterRegistry.get(summary.id)
    if (adapter?.isConnected() && typeof adapter.updateSessionStatus === 'function') {
      try {
        await adapter.updateSessionStatus(sessionId, status)
        return c.json({ success: true, sessionId, status })
      } catch { /* continue */ }
    }
  }
  return c.json({ error: 'Session not found or update not supported' }, 404)
})

sessions.patch('/:id/model', async (c) => {
  const sessionId = c.req.param('id')
  const body = await c.req.json<{ model: string }>()
  const modelId = body?.model

  if (!modelId) {
    return c.json({ error: 'Model ID is required' }, 400)
  }

  for (const summary of adapterRegistry.list()) {
    const adapter = adapterRegistry.get(summary.id)
    if (adapter?.isConnected() && typeof adapter.setSessionModel === 'function') {
      try {
        await adapter.setSessionModel(sessionId, modelId)
        return c.json({ success: true, sessionId, model: modelId })
      } catch { /* continue */ }
    }
  }
  return c.json({ error: 'Session not found or model change not supported' }, 404)
})

sessions.patch('/:id/thinking', async (c) => {
  const sessionId = c.req.param('id')
  const body = await c.req.json<{ level: 'light' | 'medium' | 'heavy' }>()
  const level = body?.level

  if (!level || !['light', 'medium', 'heavy'].includes(level)) {
    return c.json({ error: 'Invalid thinking level. Must be light, medium, or heavy' }, 400)
  }

  for (const summary of adapterRegistry.list()) {
    const adapter = adapterRegistry.get(summary.id)
    if (adapter?.isConnected() && typeof adapter.setThinkingLevel === 'function') {
      try {
        await adapter.setThinkingLevel(sessionId, level)
        return c.json({ success: true, sessionId, thinkingLevel: level })
      } catch { /* continue */ }
    }
  }
  return c.json({ error: 'Session not found or thinking level change not supported' }, 404)
})

sessions.patch('/:id/system-prompt', async (c) => {
  const sessionId = c.req.param('id')
  const body = await c.req.json<{ prompt: string }>()
  const prompt = body?.prompt

  if (prompt === undefined) {
    return c.json({ error: 'Prompt is required' }, 400)
  }

  for (const summary of adapterRegistry.list()) {
    const adapter = adapterRegistry.get(summary.id)
    if (adapter?.isConnected() && typeof adapter.setSystemPrompt === 'function') {
      try {
        await adapter.setSystemPrompt(sessionId, prompt)
        return c.json({ success: true, sessionId })
      } catch { /* continue */ }
    }
  }
  return c.json({ error: 'Session not found or system prompt change not supported' }, 404)
})

sessions.post('/:id/subsession', async (c) => {
  const parentSessionId = c.req.param('id')
  const body = await c.req.json<{ agentId?: string; title?: string; model?: string }>()
  const agentId = body?.agentId || 'default'
  const adapter = adapterRegistry.get(agentId)

  if (!adapter) {
    return c.json({ error: `Agent "${agentId}" not found` }, 404)
  }

  if (typeof adapter.createSubsession !== 'function') {
    return c.json({ error: 'Subsession creation not supported' }, 400)
  }

  try {
    const sessionId = await adapter.createSubsession(parentSessionId, {
      title: body?.title,
      model: body?.model,
    })
    return c.json({ sessionId, parentSessionId })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to create subsession' }, 500)
  }
})

sessions.get('/:id/tree', async (c) => {
  const sessionId = c.req.param('id')

  for (const summary of adapterRegistry.list()) {
    const adapter = adapterRegistry.get(summary.id)
    if (adapter?.isConnected() && typeof adapter.getSessionTree === 'function') {
      try {
        const tree = await adapter.getSessionTree(sessionId)
        return c.json(tree)
      } catch { /* continue */ }
    }
  }
  return c.json({ error: 'Session not found or tree not supported' }, 404)
})

sessions.get('/tree', async (c) => {
  const agentId = c.req.query('agentId')

  if (agentId) {
    const adapter = adapterRegistry.get(agentId)
    if (!adapter) return c.json([], 200)
    if (typeof adapter.getSessionTree !== 'function') {
      return c.json({ error: 'Tree not supported' }, 400)
    }
    return adapter.getSessionTree().then((tree) => c.json(tree))
  }

  const allTrees: unknown[] = []
  for (const summary of adapterRegistry.list()) {
    const adapter = adapterRegistry.get(summary.id)
    if (adapter?.isConnected() && typeof adapter.getSessionTree === 'function') {
      try {
        const tree = await adapter.getSessionTree()
        allTrees.push(...tree)
      } catch { /* skip */ }
    }
  }
  return c.json(allTrees)
})

sessions.get('/search', async (c) => {
  const query = c.req.query('query') || ''
  const model = c.req.query('model') || undefined
  const startDate = c.req.query('startDate') ? Number(c.req.query('startDate')) : undefined
  const endDate = c.req.query('endDate') ? Number(c.req.query('endDate')) : undefined
  const agentId = c.req.query('agentId')

  const options = {
    model,
    dateRange: startDate !== undefined || endDate !== undefined ? {
      start: startDate || 0,
      end: endDate || Date.now(),
    } : undefined,
  }

  if (agentId) {
    const adapter = adapterRegistry.get(agentId)
    if (!adapter) return c.json([], 200)
    if (typeof adapter.searchSessions !== 'function') {
      return c.json({ error: 'Search not supported' }, 400)
    }
    return adapter.searchSessions(query, options).then((results) => c.json(results))
  }

  const allResults: unknown[] = []
  for (const summary of adapterRegistry.list()) {
    const adapter = adapterRegistry.get(summary.id)
    if (adapter?.isConnected() && typeof adapter.searchSessions === 'function') {
      try {
        const results = await adapter.searchSessions(query, options)
        allResults.push(...results)
      } catch { /* skip */ }
    }
  }
  return c.json(allResults)
})

sessions.post('/batch/delete', async (c) => {
  const body = await c.req.json<{ sessionIds: string[]; agentId?: string }>()
  const sessionIds = body?.sessionIds || []
  const agentId = body?.agentId

  if (!sessionIds || sessionIds.length === 0) {
    return c.json({ error: 'No session IDs provided' }, 400)
  }

  if (agentId) {
    const adapter = adapterRegistry.get(agentId)
    if (!adapter) return c.json({ error: `Agent "${agentId}" not found` }, 404)
    if (typeof adapter.deleteSessions !== 'function') {
      return c.json({ error: 'Batch delete not supported' }, 400)
    }
    try {
      await adapter.deleteSessions(sessionIds)
      return c.json({ success: true, deletedCount: sessionIds.length })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to delete sessions' }, 500)
    }
  }

  let deletedCount = 0
  for (const id of sessionIds) {
    for (const summary of adapterRegistry.list()) {
      const adapter = adapterRegistry.get(summary.id)
      if (adapter?.isConnected()) {
        try {
          await adapter.deleteSession(id)
          deletedCount++
          break
        } catch { /* continue */ }
      }
    }
  }
  return c.json({ success: true, deletedCount })
})

sessions.post('/batch/archive', async (c) => {
  const body = await c.req.json<{ sessionIds: string[]; agentId?: string }>()
  const sessionIds = body?.sessionIds || []
  const agentId = body?.agentId

  if (!sessionIds || sessionIds.length === 0) {
    return c.json({ error: 'No session IDs provided' }, 400)
  }

  if (agentId) {
    const adapter = adapterRegistry.get(agentId)
    if (!adapter) return c.json({ error: `Agent "${agentId}" not found` }, 404)
    if (typeof adapter.archiveSessions !== 'function') {
      return c.json({ error: 'Batch archive not supported' }, 400)
    }
    try {
      await adapter.archiveSessions(sessionIds)
      return c.json({ success: true, archivedCount: sessionIds.length })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to archive sessions' }, 500)
    }
  }

  let archivedCount = 0
  for (const id of sessionIds) {
    for (const summary of adapterRegistry.list()) {
      const adapter = adapterRegistry.get(summary.id)
      if (adapter?.isConnected() && typeof adapter.archiveSession === 'function') {
        try {
          await adapter.archiveSession(id)
          archivedCount++
          break
        } catch { /* continue */ }
      }
    }
  }
  return c.json({ success: true, archivedCount })
})

sessions.post('/batch/export', async (c) => {
  const body = await c.req.json<{ sessionIds: string[]; agentId?: string }>()
  const sessionIds = body?.sessionIds || []
  const agentId = body?.agentId

  if (!sessionIds || sessionIds.length === 0) {
    return c.json({ error: 'No session IDs provided' }, 400)
  }

  const exports: Record<string, unknown> = {}

  if (agentId) {
    const adapter = adapterRegistry.get(agentId)
    if (!adapter) return c.json({ error: `Agent "${agentId}" not found` }, 404)
    if (typeof adapter.exportSessions !== 'function') {
      return c.json({ error: 'Export not supported' }, 400)
    }
    try {
      const result = await adapter.exportSessions(sessionIds)
      return c.json(result)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to export sessions' }, 500)
    }
  }

  for (const id of sessionIds) {
    for (const summary of adapterRegistry.list()) {
      const adapter = adapterRegistry.get(summary.id)
      if (adapter?.isConnected()) {
        try {
          const detail = await adapter.getSession(id)
          exports[id] = detail
          break
        } catch { /* continue */ }
      }
    }
  }
  return c.json(exports)
})

sessions.get('/:id/stats', async (c) => {
  const sessionId = c.req.param('id')

  for (const summary of adapterRegistry.list()) {
    const adapter = adapterRegistry.get(summary.id)
    if (adapter?.isConnected() && typeof adapter.getSessionStats === 'function') {
      try {
        const stats = await adapter.getSessionStats(sessionId)
        return c.json(stats)
      } catch { /* continue */ }
    }
  }
  return c.json({ error: 'Session not found or stats not supported' }, 404)
})

sessions.get('/stats', async (c) => {
  const agentId = c.req.query('agentId')

  if (agentId) {
    const adapter = adapterRegistry.get(agentId)
    if (!adapter) return c.json({ error: `Agent "${agentId}" not found` }, 404)
    if (typeof adapter.getAllSessionsStats !== 'function') {
      return c.json({ error: 'Stats not supported' }, 400)
    }
    return adapter.getAllSessionsStats().then((stats) => c.json(stats))
  }

  let totalSessions = 0
  let activeSessions = 0
  let totalMessages = 0
  let totalTokens = 0
  const modelDistribution: Record<string, number> = {}

  for (const summary of adapterRegistry.list()) {
    const adapter = adapterRegistry.get(summary.id)
    if (adapter?.isConnected() && typeof adapter.getAllSessionsStats === 'function') {
      try {
        const stats = await adapter.getAllSessionsStats()
        totalSessions += stats.totalSessions
        activeSessions += stats.activeSessions
        totalMessages += stats.totalMessages
        totalTokens += stats.totalTokens
        for (const [model, count] of Object.entries(stats.modelDistribution)) {
          modelDistribution[model] = (modelDistribution[model] || 0) + count
        }
      } catch { /* skip */ }
    }
  }

  return c.json({
    totalSessions,
    activeSessions,
    totalMessages,
    totalTokens,
    modelDistribution,
  })
})

sessions.get('/model/:modelId', async (c) => {
  const modelId = c.req.param('modelId')
  const agentId = c.req.query('agentId')

  if (agentId) {
    const adapter = adapterRegistry.get(agentId)
    if (!adapter) return c.json([], 200)
    if (typeof adapter.listSessionsByModel !== 'function') {
      return c.json({ error: 'Filter by model not supported' }, 400)
    }
    return adapter.listSessionsByModel(modelId).then((results) => c.json(results))
  }

  const allResults: unknown[] = []
  for (const summary of adapterRegistry.list()) {
    const adapter = adapterRegistry.get(summary.id)
    if (adapter?.isConnected() && typeof adapter.listSessionsByModel === 'function') {
      try {
        const results = await adapter.listSessionsByModel(modelId)
        allResults.push(...results)
      } catch { /* skip */ }
    }
  }
  return c.json(allResults)
})

export default sessions