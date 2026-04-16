import { useState } from 'react'
import { Send, Square, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AgentResponsePanel } from './AgentResponsePanel'
import { useCompareChat } from './useCompareChat'

export function ComparePanel() {
  const { state, sendMessage, reset } = useCompareChat()
  const [input, setInput] = useState('')

  const isStreaming = state.openclaw.isStreaming || state.hermes.isStreaming

  const handleSend = () => {
    if (!input.trim() || isStreaming) return
    sendMessage(input.trim())
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleReset = () => {
    reset()
    setInput('')
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 flex gap-4 p-4 overflow-hidden min-h-0">
        <AgentResponsePanel
          title="OpenClaw"
          agentType="openclaw"
          messages={state.openclaw.messages}
          isStreaming={state.openclaw.isStreaming}
          stats={state.openclaw.stats}
          error={state.openclaw.error}
          themeColor="blue"
        />
        <AgentResponsePanel
          title="Hermes"
          agentType="hermes"
          messages={state.hermes.messages}
          isStreaming={state.hermes.isStreaming}
          stats={state.hermes.stats}
          error={state.hermes.error}
          themeColor="green"
        />
      </div>

      <div className="border-t border-border p-4 bg-card/50 backdrop-blur-sm">
        <div className="w-full max-w-5xl mx-auto">
          <div className="flex gap-3 items-end">
            <div className="flex-1 relative">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入消息，同时发送到 OpenClaw 和 Hermes..."
                rows={1}
                disabled={isStreaming}
                className="w-full resize-none rounded-xl border border-input bg-background px-4 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
              />
            </div>
            <Button
              onClick={handleReset}
              variant="outline"
              className="rounded-xl h-11 px-4"
              title="重置"
            >
              <RotateCcw className="w-4 h-4" />
            </Button>
            <Button
              onClick={handleSend}
              disabled={!input.trim() || isStreaming}
              className="rounded-xl h-11 w-11 p-0"
            >
              {isStreaming ? (
                <Square className="w-4 h-4" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
