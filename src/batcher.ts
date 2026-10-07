import type { AdinizeError, DropReason, Result } from './types.js'
import type { ResolvedConfig } from './config.js'
import type { EventBody } from './event.js'
import { fail, ok, parseResults } from './result.js'
import { postEvents } from './client.js'
import { isRetryable, withRetry } from './retry.js'

type Entry = { eventName: string; body: EventBody }

const crashed = (error: unknown): Result<never> =>
  fail('CRASHED', `the send crashed: ${error instanceof Error ? error.name : typeof error}`)

const dropReason = (error: AdinizeError): DropReason => {
  if (error.code === 'CRASHED') return 'crashed'
  return isRetryable(error) ? 'retries_exhausted' : 'rejected_by_server'
}

export class Batcher {
  private queue: Entry[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly inFlight = new Map<Promise<void>, Entry[]>()

  constructor(private readonly config: ResolvedConfig) {}

  enqueue(eventName: string, body: EventBody): Result<void> {
    const { maxQueue, maxBatch, flushIntervalMs } = this.config.batcher
    if (this.queue.length >= maxQueue) {
      this.config.telemetry.dropped(body.event_id, eventName, 'queue_full')
      return fail('QUEUE_FULL', `the queue already holds ${maxQueue} events`)
    }
    this.queue.push({ eventName, body })
    if (this.queue.length >= maxBatch) this.send(this.queue.splice(0, maxBatch), true)
    this.timer ??= setInterval(() => this.tick(), flushIntervalMs)
    return ok(undefined)
  }

  flush(): Promise<void> {
    this.sendAll(true)
    return this.settled()
  }

  async stop(): Promise<void> {
    this.stopTimer()
    this.sendAll(false)
    let deadline: ReturnType<typeof setTimeout> | undefined
    const expired = new Promise<void>((resolve) => {
      deadline = setTimeout(resolve, this.config.batcher.shutdownMs)
    })
    await Promise.race([this.settled(), expired])
    clearTimeout(deadline)
    for (const chunk of this.inFlight.values()) this.drop(chunk, 'shutdown_timeout')
    this.inFlight.clear()
  }

  private tick(): void {
    if (this.queue.length === 0) {
      this.stopTimer()
      return
    }
    this.sendAll(true)
  }

  private stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  private sendAll(retry: boolean): void {
    while (this.queue.length > 0) this.send(this.queue.splice(0, this.config.batcher.maxBatch), retry)
  }

  private settled(): Promise<void> {
    return Promise.all(this.inFlight.keys()).then(() => undefined)
  }

  private send(chunk: Entry[], retry: boolean): void {
    const bodies = chunk.map((entry) => entry.body)
    const post = (): Promise<Result<unknown[]>> => postEvents(bodies, this.config)
    const promise: Promise<void> = (retry ? withRetry(post) : post())
      .then(
        (result) => this.report(promise, chunk, result),
        (error: unknown) => this.report(promise, chunk, crashed(error)),
      )
      .finally(() => this.inFlight.delete(promise))
    this.inFlight.set(promise, chunk)
  }

  private report(promise: Promise<void>, chunk: Entry[], result: Result<unknown[]>): void {
    if (!this.inFlight.has(promise)) return
    if (!result.ok) {
      this.drop(chunk, dropReason(result.error))
      return
    }
    const names = chunk.map((entry) => entry.eventName)
    const parsed = parseResults(result.value, names, this.config.telemetry)
    if (!parsed.ok) this.drop(chunk, 'rejected_by_server')
  }

  private drop(chunk: Entry[], reason: DropReason): void {
    for (const { eventName, body } of chunk) this.config.telemetry.dropped(body.event_id, eventName, reason)
  }
}
