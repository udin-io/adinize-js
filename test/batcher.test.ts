import { afterEach, describe, expect, it, vi } from 'vitest'
import { accepted, client, results, sentEvents, serverError, stubFetch, unwrap, unwrapError } from './support.js'

const ids = (count: number) => Array.from({ length: count }, (_, i) => `e${i}`)

afterEach(() => vi.useRealTimers())

describe('Adinize.trackAsync', () => {
  it('queues events and sends them in one request on flush', async () => {
    const { fetch, calls } = stubFetch(accepted('a', 'b'))
    const { adinize } = client({ fetch, batcher: { flushIntervalMs: 60_000 } })
    unwrap(adinize.trackAsync('Lead', { eventId: 'a' }))
    unwrap(adinize.trackAsync('Purchase', { eventId: 'b' }))
    expect(calls).toHaveLength(0)
    await adinize.flush()
    expect(sentEvents(calls[0]).map((event) => event.event_id)).toEqual(['a', 'b'])
    await adinize.close()
  })

  it('sends every flushIntervalMs on its own', async () => {
    const { fetch, calls } = stubFetch(accepted('a'))
    const { adinize } = client({ fetch, batcher: { flushIntervalMs: 10 } })
    unwrap(adinize.trackAsync('Lead', { eventId: 'a' }))
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(calls).toHaveLength(1)
    await adinize.close()
  })

  it('sends immediately at maxBatch, chunked, and the flush sweeps the rest', async () => {
    const { fetch, calls } = stubFetch(accepted(...ids(3)))
    const { adinize } = client({ fetch, batcher: { maxBatch: 3, flushIntervalMs: 60_000 } })
    for (const id of ids(7)) unwrap(adinize.trackAsync('Lead', { eventId: id }))
    expect(calls).toHaveLength(2)
    await adinize.flush()
    expect(calls.map((call) => sentEvents(call).length)).toEqual([3, 3, 1])
    await adinize.close()
  })

  it('refuses past maxQueue with QUEUE_FULL and dropped telemetry', async () => {
    const { fetch } = stubFetch(accepted('a'))
    const { adinize, events } = client({ fetch, batcher: { maxQueue: 1, flushIntervalMs: 60_000 } })
    unwrap(adinize.trackAsync('Lead', { eventId: 'a' }))
    expect(unwrapError(adinize.trackAsync('Lead', { eventId: 'b' })).code).toBe('QUEUE_FULL')
    expect(events).toEqual([{ type: 'event:dropped', eventId: 'b', eventName: 'Lead', reason: 'queue_full' }])
    await adinize.close()
  })

  it('never queues invalid options and stays usable', async () => {
    const { fetch, calls } = stubFetch(accepted('a'))
    const { adinize } = client({ fetch, batcher: { flushIntervalMs: 60_000 } })
    expect(unwrapError(adinize.trackAsync('Lead', { user: { phoneNumber: 'x' } as never })).code).toBe('INVALID_OPTION')
    unwrap(adinize.trackAsync('Lead', { eventId: 'a' }))
    await adinize.flush()
    expect(calls).toHaveLength(1)
    await adinize.close()
  })

  it('drops a chunk after one attempt on a 400 and reports rejections', async () => {
    const rejection = { field: 'event_time', code: 'TOO_OLD', message: 'old' }
    const { fetch, calls } = stubFetch(serverError(400, 'INVALID_REQUEST'), results({ event_id: 'b', status: 'rejected', errors: [rejection] }))
    const { adinize, events } = client({ fetch, batcher: { flushIntervalMs: 60_000 } })
    unwrap(adinize.trackAsync('Lead', { eventId: 'a' }))
    await adinize.flush()
    unwrap(adinize.trackAsync('Lead', { eventId: 'b' }))
    await adinize.flush()
    expect(calls).toHaveLength(2)
    expect(events.filter((event) => event.type.startsWith('event:'))).toEqual([
      { type: 'event:dropped', eventId: 'a', eventName: 'Lead', reason: 'rejected_by_server' },
      { type: 'event:rejected', eventId: 'b', eventName: 'Lead', ...rejection },
    ])
    await adinize.close()
  })

  it('retries a 500 up to 5 times with the same event_id, then drops', async () => {
    vi.useFakeTimers()
    const { fetch, calls } = stubFetch(serverError(500, 'BOOM'))
    const { adinize, events } = client({ fetch, batcher: { flushIntervalMs: 60_000 } })
    unwrap(adinize.trackAsync('Lead', { eventId: 'a' }))
    const flushed = adinize.flush()
    await vi.advanceTimersByTimeAsync(30_000)
    await flushed
    expect(calls).toHaveLength(5)
    expect(new Set(calls.map((call) => sentEvents(call)[0].event_id))).toEqual(new Set(['a']))
    expect(events.at(-1)).toEqual({ type: 'event:dropped', eventId: 'a', eventName: 'Lead', reason: 'retries_exhausted' })
  })

  it('drops a chunk at once when a 429 asks for more than a minute, so flush does not block', async () => {
    vi.useFakeTimers()
    const { fetch, calls } = stubFetch(serverError(429, 'RATE_LIMITED', {}, { 'retry-after': '3600' }))
    const { adinize, events } = client({ fetch, batcher: { flushIntervalMs: 60_000 } })
    unwrap(adinize.trackAsync('Lead', { eventId: 'a' }))
    void adinize.flush()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(calls).toHaveLength(1)
    expect(events.at(-1)).toEqual({ type: 'event:dropped', eventId: 'a', eventName: 'Lead', reason: 'retries_exhausted' })
  })

  it('drops the whole chunk when the result count does not match', async () => {
    const { fetch } = stubFetch(accepted('a'))
    const { adinize, events } = client({ fetch, batcher: { flushIntervalMs: 60_000 } })
    unwrap(adinize.trackAsync('Lead', { eventId: 'a' }))
    unwrap(adinize.trackAsync('Lead', { eventId: 'b' }))
    await adinize.flush()
    expect(events.filter((event) => event.type === 'event:dropped').map((event) => event.eventId)).toEqual(['a', 'b'])
    await adinize.close()
  })

  it('close sends what it holds once, and drops what the deadline cuts off', async () => {
    const { fetch, calls } = stubFetch(accepted('a'))
    const { adinize } = client({ fetch, batcher: { flushIntervalMs: 60_000 } })
    unwrap(adinize.trackAsync('Lead', { eventId: 'a' }))
    await adinize.close()
    expect(calls).toHaveLength(1)

    const slow = stubFetch(() => new Promise(() => undefined))
    const { adinize: stuck, events } = client({ fetch: slow.fetch, batcher: { flushIntervalMs: 60_000, shutdownMs: 20 } })
    unwrap(stuck.trackAsync('Lead', { eventId: 'z' }))
    await stuck.close()
    expect(events.at(-1)).toEqual({ type: 'event:dropped', eventId: 'z', eventName: 'Lead', reason: 'shutdown_timeout' })
  })
})
