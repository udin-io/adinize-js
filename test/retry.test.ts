import { describe, expect, it } from 'vitest'
import { isRetryable, withRetry } from '../src/retry.js'
import { fail, failWith, ok } from '../src/result.js'
import { accepted, client, sentEvents, serverError, stubFetch, unwrap, unwrapError } from './support.js'

const error = (status: number | null, code = 'X') => failWith({ status, code, message: '', retryAfter: null })

describe('isRetryable', () => {
  it('classifies every status the design names', () => {
    for (const retryable of [error(429), error(500), error(503), fail('TIMEOUT', ''), fail('TRANSPORT_ERROR', '')]) {
      expect(isRetryable(retryable.ok ? (null as never) : retryable.error)).toBe(true)
    }
    for (const final of [error(400), error(401), fail('INVALID_OPTION', ''), fail('MISSING_SECRET_KEY', '')]) {
      expect(isRetryable(final.ok ? (null as never) : final.error)).toBe(false)
    }
  })
})

describe('withRetry', () => {
  it('returns the first success without waiting', async () => {
    const waits: number[] = []
    expect(await withRetry(async () => ok('done'), async (ms) => void waits.push(ms))).toEqual({ ok: true, value: 'done' })
    expect(waits).toEqual([])
  })

  it('returns a non-retryable error after one attempt', async () => {
    let calls = 0
    const result = await withRetry(async () => (calls++, error(400)), async () => undefined)
    expect(result).toMatchObject({ ok: false, error: { status: 400 } })
    expect(calls).toBe(1)
  })

  it('backs off with jitter up to 5 attempts, and waits Retry-After on a 429', async () => {
    const waits: number[] = []
    let calls = 0
    const result = await withRetry(async () => (calls++, error(500)), async (ms) => void waits.push(ms))
    expect(result).toMatchObject({ ok: false, error: { status: 500 } })
    expect(calls).toBe(5)
    expect(waits).toHaveLength(4)
    for (const [i, ms] of waits.entries()) {
      expect(ms).toBeGreaterThanOrEqual(1)
      expect(ms).toBeLessThanOrEqual(200 * 2 ** i)
    }

    const after: number[] = []
    const rateLimited = failWith({ status: 429, code: 'RATE_LIMITED', message: '', retryAfter: 3 })
    const responses = [rateLimited, ok('sent')]
    expect(await withRetry(async () => responses.shift() ?? ok('sent'), async (ms) => void after.push(ms))).toEqual(ok('sent'))
    expect(after).toEqual([3000])
  })
})

describe('Adinize.track with retry', () => {
  it('does not retry a 500 unless asked, then retries with the same event_id', async () => {
    const { fetch, calls } = stubFetch(serverError(500, 'BOOM'), accepted('o1'))
    const { adinize } = client({ fetch })
    expect(unwrapError(await adinize.track('Purchase', { eventId: 'o1' })).status).toBe(500)
    expect(calls).toHaveLength(1)

    const { fetch: retryingFetch, calls: retried } = stubFetch(serverError(500, 'BOOM'), accepted('o1'))
    const { adinize: retrying } = client({ fetch: retryingFetch })
    expect(unwrap(await retrying.track('Purchase', { eventId: 'o1', retry: true })).status).toBe('accepted')
    expect(retried).toHaveLength(2)
    expect(sentEvents(retried[0])[0].event_id).toBe(sentEvents(retried[1])[0].event_id)
  })

  it('never retries a 401', async () => {
    const { fetch, calls } = stubFetch(serverError(401, 'INVALID_KEY'))
    const { adinize } = client({ fetch })
    expect(unwrapError(await adinize.track('Purchase', { retry: true })).code).toBe('INVALID_KEY')
    expect(calls).toHaveLength(1)
  })
})
