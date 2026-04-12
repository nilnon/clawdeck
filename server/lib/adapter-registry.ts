import type { IAgentAdapter, AgentConfig, AgentSummary, AgentStatus } from '@shared/types.js'

type StatusCallback = (status: AgentStatus) => void
type EventCallback = (event: import('@shared/types.js').AgentEvent) => void

interface AdapterEntry {
  adapter: IAgentAdapter
  config: AgentConfig
  connectedAt?: number
  statusListeners: Set<StatusCallback>
  eventListeners: Set<EventCallback>
}

class AdapterRegistryImpl {
  private adapters = new Map<string, AdapterEntry>()

  register(id: string, adapter: IAgentAdapter, config: AgentConfig): void {
    if (this.adapters.has(id)) {
      throw new Error(`Adapter "${id}" already registered`)
    }
    this.adapters.set(id, {
      adapter,
      config,
      statusListeners: new Set(),
      eventListeners: new Set(),
    })
  }

  get(id: string): IAgentAdapter | undefined {
    return this.adapters.get(id)?.adapter
  }

  getEntry(id: string): AdapterEntry | undefined {
    return this.adapters.get(id)
  }

  list(): AgentSummary[] {
    const summaries: AgentSummary[] = []
    for (const [id, entry] of this.adapters) {
      summaries.push({
        id,
        type: entry.adapter.type,
        name: entry.adapter.name,
        status: entry.adapter.isConnected() ? ('connected' as AgentStatus) : ('disconnected' as AgentStatus),
        config: entry.config,
        sessionCount: 0,
        connectedAt: entry.connectedAt,
      })
    }
    return summaries
  }

  async remove(id: string): Promise<void> {
    const entry = this.adapters.get(id)
    if (!entry) return
    try {
      await entry.adapter.disconnect()
    } catch { /* ignore disconnect errors */ }
    this.adapters.delete(id)
  }

  async update(id: string, name: string, config: Record<string, any>): Promise<void> {
    const entry = this.adapters.get(id)
    if (!entry) throw new Error(`Agent "${id}" not found`)

    // Update config and name
    entry.config = { ...entry.config, ...config, name }
    
    // Reconnect with new config
    await entry.adapter.disconnect()
    await entry.adapter.connect(entry.config)
  }

  onStatusChange(id: string, callback: StatusCallback): () => void {
    const entry = this.adapters.get(id)
    if (!entry) return () => {}
    entry.statusListeners.add(callback)
    return () => { entry.statusListeners.delete(callback) }
  }

  onEvent(id: string, callback: EventCallback): () => void {
    const entry = this.adapters.get(id)
    if (!entry) return () => {}
    entry.eventListeners.add(callback)
    return () => { entry.eventListeners.delete(callback) }
  }

  emitStatusChange(id: string, status: AgentStatus): void {
    const entry = this.adapters.get(id)
    if (!entry) return
    for (const cb of entry.statusListeners) {
      try { cb(status) } catch { /* ignore callback errors */ }
    }
  }

  emitEvent(event: import('@shared/types.js').AgentEvent): void {
    const entry = this.adapters.get(event.agentId)
    if (!entry) return
    for (const cb of entry.eventListeners) {
      try { cb(event) } catch { /* ignore callback errors */ }
    }
  }

  has(id: string): boolean {
    return this.adapters.has(id)
  }

  size(): number {
    return this.adapters.size
  }

  getAllEntries(): AdapterEntry[] {
    return Array.from(this.adapters.values())
  }
}

export const adapterRegistry = new AdapterRegistryImpl()
export default adapterRegistry