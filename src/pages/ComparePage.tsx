import { ComparePanel } from '@/features/compare/ComparePanel'

export default function ComparePage() {
  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="w-full px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">OpenClaw vs Hermes 对比</h1>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>同一输入，对比两个 Agent 的响应</span>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        <ComparePanel />
      </div>
    </div>
  )
}
