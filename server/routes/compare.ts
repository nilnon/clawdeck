import { Hono } from 'hono'
import adapterRegistry from '../lib/adapter-registry.js'
import { randomUUID } from 'node:crypto'

const compare = new Hono()

compare.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const { message, openclawSessionId, hermesSessionId } = body

  if (!message || typeof message !== 'string') {
    return c.json({ error: 'Message is required' }, 400)
  }

  const openclaw = adapterRegistry.get('openclaw')
  const hermes = adapterRegistry.get('hermes')

  // 检查至少有一个 Agent 可用
  const openclawAvailable = openclaw && openclaw.isConnected()
  const hermesAvailable = hermes && hermes.isConnected()

  if (!openclawAvailable && !hermesAvailable) {
    return c.json({ 
      error: 'No agents are connected',
      openclaw: !!openclawAvailable,
      hermes: !!hermesAvailable,
    }, 400)
  }

  // 获取或创建会话
  let actualOpenclawSessionId: string | undefined = openclawSessionId
  let actualHermesSessionId: string | undefined = hermesSessionId

  try {
    if (openclawAvailable && !actualOpenclawSessionId) {
      // 尝试获取第一个会话
      const sessions = await openclaw.listSessions()
      const mainSession = sessions.find(s => s.sessionType === 'main')
      if (mainSession) {
        actualOpenclawSessionId = mainSession.id
      } else if (sessions.length > 0) {
        actualOpenclawSessionId = sessions[0].id
      } else {
        // 创建新会话
        actualOpenclawSessionId = await openclaw.createSession()
      }
    }

    // Hermes CLI 模式不支持会话，使用随机 ID
    if (hermesAvailable && !actualHermesSessionId) {
      actualHermesSessionId = `hermes-session-${randomUUID()}`
    }
  } catch (err) {
    return c.json({ 
      error: 'Failed to get or create sessions',
      details: err instanceof Error ? err.message : String(err),
    }, 500)
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      let openclawDone = !openclawAvailable
      let hermesDone = !hermesAvailable

      const sendChunk = (source: string, chunk: Record<string, unknown>) => {
        try {
          const data = `data: ${JSON.stringify({ source, ...chunk })}\n\n`
          controller.enqueue(encoder.encode(data))
        } catch {
          // ignore encoding errors
        }
      }

      const checkComplete = () => {
        if (openclawDone && hermesDone) {
          try {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
          } catch {
            // controller might already be closed
          }
        }
      }

      const runAgent = async (
        name: 'openclaw' | 'hermes',
        adapter: typeof openclaw,
        sessionId: string
      ) => {
        try {
          for await (const chunk of adapter.chat(message, { sessionId })) {
            sendChunk(name, chunk as Record<string, unknown>)
            if (chunk.done) {
              break
            }
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          sendChunk(name, {
            error: errorMsg,
            done: true,
            timestamp: Date.now(),
          })
        } finally {
          if (name === 'openclaw') {
            openclawDone = true
          } else {
            hermesDone = true
          }
          checkComplete()
        }
      }

      const promises: Promise<void>[] = []
      
      if (openclawAvailable && actualOpenclawSessionId) {
        promises.push(runAgent('openclaw', openclaw, actualOpenclawSessionId))
      }
      
      if (hermesAvailable && actualHermesSessionId) {
        promises.push(runAgent('hermes', hermes, actualHermesSessionId))
      }

      await Promise.all(promises)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
})

export default compare
