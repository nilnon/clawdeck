import type { ThinkingPluginConfig, ThinkingPhase } from './types'

export const DEFAULT_PHASE_TIMEOUTS: Record<ThinkingPhase, number> = {
  idle: 0,
  model_resolving: 5000,
  prompt_building: 10000,
  llm_connecting: 30000,
  llm_first_token: 60000,
  thinking: 120000,
  generating: 60000,
  tool_calling: 30000,
  tool_executing: 120000,
  tool_complete: 5000,
  completed: 0,
  error: 0,
  cancelled: 0,
}

export const DEFAULT_CONFIG: ThinkingPluginConfig = {
  modules: {
    phaseTracking: true,
    realtimeBroadcast: true,
    storage: true,
    security: true,
    webDashboard: true,
  },
  phaseTracking: {
    historyRetention: 3600000,
    maxHistoryPerSession: 100,
  },
  broadcast: {
    mode: 'gateway_method',
    sse: {
      heartbeatInterval: 15000,
    },
  },
  storage: {
    enabled: true,
    mode: 'local',
    duckdb: {
      path: '~/.openclaw/data/thinking.duckdb',
    },
    mysql: {
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: '',
      database: 'openclaw_thinking',
    },
    buffer: {
      batchSize: 50,
      flushIntervalMs: 5000,
    },
    retention: {
      actions: 30,
      sessions: 90,
    },
  },
  security: {
    enabled: true,
    rules: {
      secretLeakage: true,
      highRiskOps: true,
      dataExfiltration: true,
      promptInjection: false,
      customRegex: false,
      chainDetection: false,
    },
    domainWhitelist: [],
    customRegexRules: [],
  },
  timeouts: {},
  ui: {
    basePath: '/plugins/thinking',
  },
}

export function mergeConfig(
  pluginConfig?: Partial<ThinkingPluginConfig>
): ThinkingPluginConfig {
  if (!pluginConfig) {
    return { ...DEFAULT_CONFIG }
  }

  return {
    modules: {
      ...DEFAULT_CONFIG.modules,
      ...pluginConfig.modules,
    },
    phaseTracking: {
      ...DEFAULT_CONFIG.phaseTracking,
      ...pluginConfig.phaseTracking,
    },
    broadcast: {
      ...DEFAULT_CONFIG.broadcast,
      ...pluginConfig.broadcast,
      sse: {
        ...DEFAULT_CONFIG.broadcast.sse,
        ...pluginConfig.broadcast?.sse,
      },
    },
    storage: {
      ...DEFAULT_CONFIG.storage,
      ...pluginConfig.storage,
      duckdb: {
        ...DEFAULT_CONFIG.storage.duckdb,
        ...pluginConfig.storage?.duckdb,
      },
      mysql: {
        ...DEFAULT_CONFIG.storage.mysql,
        ...pluginConfig.storage?.mysql,
      },
      buffer: {
        ...DEFAULT_CONFIG.storage.buffer,
        ...pluginConfig.storage?.buffer,
      },
      retention: {
        ...DEFAULT_CONFIG.storage.retention,
        ...pluginConfig.storage?.retention,
      },
    },
    security: {
      ...DEFAULT_CONFIG.security,
      ...pluginConfig.security,
      rules: {
        ...DEFAULT_CONFIG.security.rules,
        ...pluginConfig.security?.rules,
      },
    },
    timeouts: {
      ...DEFAULT_CONFIG.timeouts,
      ...pluginConfig.timeouts,
    },
    ui: {
      ...DEFAULT_CONFIG.ui,
      ...pluginConfig.ui,
    },
  }
}

export function getPhaseTimeout(
  config: ThinkingPluginConfig,
  phase: ThinkingPhase
): number {
  return config.timeouts[phase] ?? DEFAULT_PHASE_TIMEOUTS[phase] ?? 60000
}
