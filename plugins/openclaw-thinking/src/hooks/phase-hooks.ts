import type { PluginAPI, HookContext } from '../types'
import { PhaseStateManager, HOOK_TO_PHASE } from '../core'

export interface HookRegistrationOptions {
  phaseManager: PhaseStateManager
  logger?: PluginAPI['logger']
}

const PHASE_HOOKS = [
  'before_model_resolve',
  'before_prompt_build',
  'before_agent_start',
  'agent_end',
  'llm_input',
  'llm_output',
  'before_tool_call',
  'after_tool_call',
  'tool_result_persist',
  'message_received',
  'message_sending',
  'message_sent',
  'before_message_write',
  'before_compaction',
  'after_compaction',
  'before_reset',
  'session_start',
  'session_end',
  'subagent_spawning',
  'subagent_delivery_target',
  'subagent_spawned',
  'subagent_ended',
  'gateway_start',
  'gateway_stop',
  'inbound_claim',
  'before_dispatch',
]

export function registerPhaseHooks(
  api: PluginAPI,
  options: HookRegistrationOptions
): void {
  const { phaseManager, logger } = options

  for (const hookName of PHASE_HOOKS) {
    const mapping = HOOK_TO_PHASE[hookName]
    if (!mapping) {
      logger?.warn?.(`Unknown hook: ${hookName}`)
      continue
    }

    api.on(hookName, (...args: unknown[]) => {
      try {
        const context = parseHookContext(hookName, args)
        const state = phaseManager.onHookEvent(hookName, context)

        if (state && logger) {
          logger.info?.(
            `[${hookName}] session=${state.sessionId} phase=${state.phase}`
          )
        }
      } catch (error) {
        logger?.error?.(
          `Error in hook ${hookName}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    })
  }
}

function parseHookContext(hookName: string, args: unknown[]): HookContext {
  if (!args || args.length === 0) {
    return {}
  }

  const firstArg = args[0]

  if (typeof firstArg === 'object' && firstArg !== null) {
    const ctx = firstArg as Record<string, unknown>

    return {
      sessionId: ctx.sessionId as string | undefined,
      runId: ctx.runId as string | undefined,
      userId: ctx.userId as string | undefined,
      modelName: ctx.modelName as string | undefined,
      channelId: ctx.channelId as string | undefined,
      payload: ctx.payload as Record<string, unknown> | undefined,
      ...ctx,
    }
  }

  if (typeof firstArg === 'string') {
    return { sessionId: firstArg }
  }

  return {}
}

export function getRegisteredHooks(): string[] {
  return [...PHASE_HOOKS]
}
