import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import adapterRegistry from '../lib/adapter-registry.js'

const chat = new Hono()

const chatSchema = z.object({
  message: z.string().min(1),
  sessionId: z.string().optional(),
  model: z.string().optional(),
})

chat.post('/', zValidator('json', chatSchema), async (c) => {
  const agentId = c.req.header('X-Agent-ID') || 'default'
  const body = c.req.valid('json')

  const adapter = adapterRegistry.get(agentId)
  if (!adapter) {
    return c.json({ error: `Agent "${agentId}" not found` }, 404)
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of adapter.chat(body.message, {
          sessionId: body.sessionId,
          model: body.model,
        })) {
          const data = `data: ${JSON.stringify(chunk)}\n\n`
          controller.enqueue(new TextEncoder().encode(data))
        }
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      } catch (err) {
        const errorData = JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
          done: true,
        })
        controller.enqueue(new TextEncoder().encode(`data: ${errorData}\n\n`))
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
})

export default chat