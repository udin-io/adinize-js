import type { AdinizeConfig, BatchEvent, EventOptions, EventResult, Result, RetryOptions, TrackOptions } from './types.js'
import { MAX_BATCH, resolveConfig, type ResolvedConfig } from './config.js'
import { buildEvent, type EventBody } from './event.js'
import { postEvents } from './client.js'
import { withRetry } from './retry.js'
import { Batcher } from './batcher.js'
import { fail, invalid, ok, parseResults } from './result.js'
import { isPlainObject } from './object.js'

type State = { config: ResolvedConfig; batcher: Batcher }

async function send(config: ResolvedConfig, bodies: EventBody[], names: string[], retry: boolean): Promise<Result<EventResult[]>> {
  const post = (): Promise<Result<unknown[]>> => postEvents(bodies, config)
  const results = await (retry ? withRetry(post) : post())
  return results.ok ? parseResults(results.value, names, config.telemetry) : results
}

const wantsRetry = (options: unknown): boolean => isPlainObject(options) && options.retry === true

export class Adinize {
  private readonly state: Result<State>

  constructor(config: AdinizeConfig) {
    const resolved = resolveConfig(config)
    this.state = resolved.ok ? ok({ config: resolved.value, batcher: new Batcher(resolved.value) }) : resolved
  }

  async track(eventName: string, options: TrackOptions = {}): Promise<Result<EventResult>> {
    if (!this.state.ok) return this.state
    if (!isPlainObject(options)) return invalid('options must be an object')
    const { retry, ...eventOptions } = options
    const body = buildEvent(eventName, eventOptions, this.state.value.config.defaults)
    if (!body.ok) return body
    const results = await send(this.state.value.config, [body.value], [eventName], retry === true)
    return results.ok ? ok(results.value[0]) : results
  }

  async trackMany(events: BatchEvent[], options: RetryOptions = {}): Promise<Result<EventResult[]>> {
    if (!this.state.ok) return this.state
    if (!Array.isArray(events) || events.length === 0) return invalid('events must be a non-empty array')
    if (events.length > MAX_BATCH) return fail('TOO_MANY_EVENTS', `send at most ${MAX_BATCH} events a request`)
    const bodies: EventBody[] = []
    const names: string[] = []
    for (const event of events) {
      if (!isPlainObject(event)) return invalid('each event must be an object with an eventName')
      const { eventName, ...eventOptions } = event
      const body = buildEvent(eventName, eventOptions, this.state.value.config.defaults)
      if (!body.ok) return body
      bodies.push(body.value)
      names.push(eventName)
    }
    return send(this.state.value.config, bodies, names, wantsRetry(options))
  }

  trackAsync(eventName: string, options: EventOptions = {}): Result<void> {
    if (!this.state.ok) return this.state
    const body = buildEvent(eventName, options, this.state.value.config.defaults)
    return body.ok ? this.state.value.batcher.enqueue(eventName, body.value) : body
  }

  flush(): Promise<void> {
    return this.state.ok ? this.state.value.batcher.flush() : Promise.resolve()
  }

  close(): Promise<void> {
    return this.state.ok ? this.state.value.batcher.stop() : Promise.resolve()
  }
}
