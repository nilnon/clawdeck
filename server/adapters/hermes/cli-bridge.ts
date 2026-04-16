import { spawn, type ChildProcess } from 'node:child_process'
import type { ChatChunk } from '@shared/types.js'
import { randomUUID } from 'node:crypto'

export class CliBridge {
  private cliPath = 'hermes'

  constructor(cliPath?: string) {
    this.cliPath = cliPath || 'hermes'
  }

  get isRunning(): boolean {
    // 对于单次命令模式，总是返回 true
    return true
  }

  async *chatStream(message: string): AsyncIterable<ChatChunk> {
    const chunkId = randomUUID()
    const startTime = Date.now()

    console.log(`[CliBridge] Starting chat with message: ${message.substring(0, 50)}...`)

    // 使用 spawn 执行 hermes chat 命令，将消息通过 stdin 传入
    const proc = spawn(this.cliPath, ['chat'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    let output = ''
    let stderrOutput = ''

    // 收集 stdout
    proc.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })

    // 收集 stderr
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrOutput += chunk.toString()
    })

    // 发送消息到 stdin
    try {
      proc.stdin?.write(message + '\n')
      proc.stdin?.end()
    } catch (err) {
      console.error(`[CliBridge] Error writing to stdin:`, err)
    }

    // 等待进程完成
    const exitCode = await new Promise<number | null>((resolve) => {
      proc.on('close', (code) => {
        resolve(code)
      })
      proc.on('error', (err) => {
        console.error(`[CliBridge] Process error:`, err)
        resolve(-1)
      })
    })

    console.log(`[CliBridge] Process exited with code: ${exitCode}`)
    console.log(`[CliBridge] Output length: ${output.length}`)
    console.log(`[CliBridge] Stderr: ${stderrOutput.substring(0, 200)}`)

    if (exitCode !== 0 && exitCode !== null) {
      yield {
        id: chunkId,
        role: 'assistant',
        content: `Error: Hermes CLI exited with code ${exitCode}\n${stderrOutput}`,
        done: true,
        timestamp: Date.now(),
      }
      return
    }

    // 返回输出
    if (output.trim()) {
      yield {
        id: chunkId,
        role: 'assistant',
        content: output.trim(),
        done: false,
        timestamp: Date.now(),
      }
    }

    yield {
      id: chunkId,
      role: 'assistant',
      content: '',
      done: true,
      timestamp: Date.now(),
    }
  }

  start(): void {
    // 单次命令模式，不需要保持进程运行
    console.log(`[CliBridge] Single-command mode, no persistent process needed`)
  }

  stop(): void {
    // 单次命令模式，不需要停止进程
  }
}
