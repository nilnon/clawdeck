import type { PluginAPI, AgentEvent, ThinkingPluginConfig } from './types'
import { mergeConfig } from './config'
import { PhaseStateManager } from './core'
import { registerPhaseHooks } from './hooks'
import { BroadcastModule } from './broadcast'

export interface PluginState {
  config: ThinkingPluginConfig
  phaseManager: PhaseStateManager
  broadcastModule: BroadcastModule | null
  unsubscribeAgentEvent?: () => void
  timeoutCheckInterval?: NodeJS.Timeout
}

export function activate(api: PluginAPI): { deactivate: () => Promise<void> } {
  const config = mergeConfig(api.pluginConfig)
  const logger = api.logger

  logger?.info?.(`[openclaw-thinking] Activating plugin v2026.4.1`)
  logger?.info?.(`[openclaw-thinking] Config: modules=${JSON.stringify(config.modules)}`)

  const phaseManager = new PhaseStateManager(config)

  let broadcastModule: BroadcastModule | null = null

  if (config.modules.realtimeBroadcast) {
    broadcastModule = new BroadcastModule({
      phaseManager,
      config,
      logger,
    })

    if (config.broadcast.mode === 'gateway_method' || config.broadcast.mode === 'both') {
      broadcastModule.registerGatewayMethods(api)
    }

    if (config.broadcast.mode === 'sse' || config.broadcast.mode === 'both') {
      broadcastModule.registerSSERoute(api)
    }
  }

  if (config.modules.phaseTracking) {
    registerPhaseHooks(api, {
      phaseManager,
      logger,
    })
  }

  let unsubscribeAgentEvent: (() => void) | undefined
  if (api.runtime?.events?.onAgentEvent) {
    const unsub = api.runtime.events.onAgentEvent((event: AgentEvent) => {
      try {
        phaseManager.onAgentEvent(event)
      } catch (error) {
        logger?.error?.(
          `[openclaw-thinking] Error processing agent event: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    })
    if (typeof unsub === 'function') {
      unsubscribeAgentEvent = unsub
    }
    logger?.info?.('[openclaw-thinking] Subscribed to agent events')
  }

  const timeoutCheckInterval = setInterval(() => {
    const timeouts = phaseManager.checkTimeouts()
    if (timeouts.length > 0) {
      logger?.warn?.(`[openclaw-thinking] Phase timeouts detected: ${JSON.stringify(timeouts)}`)
    }
  }, 1000)

  logger?.info?.('[openclaw-thinking] Plugin activated successfully')

  const state: PluginState = {
    config,
    phaseManager,
    broadcastModule,
    unsubscribeAgentEvent,
    timeoutCheckInterval,
  }

  return {
    deactivate: async () => {
      logger?.info?.('[openclaw-thinking] Deactivating plugin')

      if (timeoutCheckInterval) {
        clearInterval(timeoutCheckInterval)
      }

      if (unsubscribeAgentEvent) {
        unsubscribeAgentEvent()
      }

      if (broadcastModule) {
        broadcastModule.close()
      }

      logger?.info?.('[openclaw-thinking] Plugin deactivated')
    },
  }
}

export default activate

export type {
  ThinkingPhase,
  PhaseState,
  PhaseTransition,
  PhaseMetadata,
  ThinkingPluginConfig,
  AgentEvent,
  PluginAPI,
} from './types'

export { PHASE_CATEGORIES, PHASE_LABELS, PHASE_ICONS } from './types'
export { PhaseStateManager, HOOK_TO_PHASE } from './core'
export { BroadcastModule } from './broadcast'
