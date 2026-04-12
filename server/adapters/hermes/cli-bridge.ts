import { spawn, type ChildProcess } from 'node:child_process'
import type { ChatChunk } from '@shared/types.js'

type OutputHandler = (line: string) => void

export class CliBridge {
  private process: ChildProcess | null = null
  private cliPath = 'hermes'
  private outputHandlers = new Set<OutputHandler>()
  private _running = false
  private buffer = ''

  get isRunning(): boolean {
    return this._running && this.process !== null && !this.process.killed
  }

  onOutput(handler: OutputHandler): () => void {
    this.outputHandlers.add(handler)
    return () => { this.outputHandlers.delete(handler) }
  }

  start(cliPath?: string, args?: string[]): void {
    if (this.isRunning) return
    this.cliPath = cliPath || this.cliPath || 'hermes'
    const cmdArgs = args || ['chat', '--non-interactive']

    this.process = spawn(this.cliPath, cmdArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    this._running = true

    this.process.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      this.buffer += text
      const lines = this.buffer.split('\n')
      this.buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed) {
          for (const handler of this.outputHandlers) {
            handler(trimmed)
          }
        }
      }
    })

    this.process.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      for (const handler of this.outputHandlers) {
        handler(`[STDERR] ${text}`)
      }
    })

    this.process.on('exit', () => {
      this._running = false
      this.process = null
    })

    this.process.on('error', (err: Error) => {
      this._running = false
      console.error(`[CliBridge] Process error:`, err.message)
    })

    console.log(`[CliBridge] Started: ${this.cliPath} ${cmdArgs.join(' ')}`)
  }

  stop(): void {
    if (this.process) {
      this.process.kill('SIGTERM')
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL')
        }
      }, 5000).unref()
    }
    this._running = false
  }

  sendMessage(message: string): void {
    if (!this.process?.stdin) {
      throw new Error('CLI bridge not running or stdin not available')
    }
    this.process.stdin.write(message + '\n')
  }

  async *chatStream(message: string): AsyncIterable<ChatChunk> {
    const chunkId = crypto.randomUUID()

    yield {
      id: chunkId,
      role: 'assistant',
      content: '',
      done: false,
      timestamp: Date.now(),
    }

    this.sendMessage(message)

    yield {
      id: chunkId,
      role: 'assistant',
      content: message,
      done: true,
      timestamp: Date.now(),
    }
  }
}
