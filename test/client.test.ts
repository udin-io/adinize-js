import { describe, expect, it } from 'vitest'
import { accepted, client, hanging, json, results, SECRET, sentEvents, serverError, stubFetch, unwrap, unwrapError } from './support.js'

describe('Adinize.track over HTTP', () => {
  it('posts one event with the bearer key only in the header', async () => {
    const { fetch, calls } = stubFetch(accepted('order_1'))
    const { adinize, events } = client({ fetch, defaultCountry: 'EG' })
    const result = unwrap(await adinize.track('Purchase', { eventId: 'order_1', user: { email: 'a@b.c' }, data: { value: 1 } }))
    expect(result).toEqual({ eventId: 'order_1', status: 'accepted', errors: [] })
    expect(calls[0].url).toBe('https://adinize.ai/api/server/v1/events')
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.headers).toMatchObject({ authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' })
    expect(String(calls[0].init.body)).not.toContain(SECRET)
    expect(sentEvents(calls[0])[0]).toMatchObject({ event_id: 'order_1', event_name: 'Purchase', event_data: { value: 1 } })
    expect(events.map((event) => event.type)).toEqual(['request:start', 'request:stop'])
  })

  it('returns duplicate and rejected results, with rejected telemetry', async () => {
    const rejection = { field: 'user_data.email_hash', code: 'INVALID_HASH', message: 'bad' }
    const { fetch } = stubFetch(results({ event_id: 'o1', status: 'duplicate' }), results({ event_id: 'o2', status: 'rejected', errors: [rejection] }))
    const { adinize, events } = client({ fetch })
    expect(unwrap(await adinize.track('Purchase', { eventId: 'o1' })).status).toBe('duplicate')
    expect(unwrap(await adinize.track('Purchase', { eventId: 'o2' })).errors).toEqual([rejection])
    expect(events.filter((event) => event.type === 'event:rejected')).toEqual([{ type: 'event:rejected', eventId: 'o2', eventName: 'Purchase', ...rejection }])
  })

  it('maps server errors, Retry-After and odd responses', async () => {
    const cases: Array<[Parameters<typeof stubFetch>[0], Record<string, unknown>]> = [
      [serverError(401, 'INVALID_KEY'), { status: 401, code: 'INVALID_KEY', retryAfter: null }],
      [serverError(403, 'PIXEL_INACTIVE'), { status: 403, code: 'PIXEL_INACTIVE' }],
      [serverError(429, 'RATE_LIMITED', {}, { 'retry-after': '12' }), { status: 429, retryAfter: 12 }],
      [serverError(429, 'RATE_LIMITED', { retry_after: 7 }), { status: 429, retryAfter: 7 }],
      [serverError(429, 'RATE_LIMITED', {}, { 'retry-after': '-1' }), { status: 429, retryAfter: null }],
      [() => new Response('<html>bad gateway</html>', { status: 502 }), { status: 502, code: 'HTTP_ERROR' }],
      [json(202, { results: [] }), { status: 202, code: 'HTTP_ERROR' }],
      [json(200, { ok: true }), { status: 200, code: 'INVALID_RESPONSE' }],
      [() => new Response('not json', { status: 200 }), { status: 200, code: 'INVALID_RESPONSE' }],
      [results({ event_id: 'o1', status: 'weird' }), { status: 200, code: 'INVALID_RESPONSE' }],
      [accepted('o1', 'o2'), { status: 200, code: 'INVALID_RESPONSE' }],
    ]
    for (const [responder, expected] of cases) {
      const { adinize } = client({ fetch: stubFetch(responder).fetch })
      const error = unwrapError(await adinize.track('Purchase', { eventId: 'o1' }))
      expect(error).toMatchObject(expected)
      expect(JSON.stringify(error)).not.toContain(SECRET)
    }
  })

  it('reports a timeout and a failed connection without the key', async () => {
    const { adinize } = client({ fetch: stubFetch(hanging).fetch, timeoutMs: 20 })
    expect(unwrapError(await adinize.track('Purchase'))).toMatchObject({ status: null, code: 'TIMEOUT' })

    const failing = async () => {
      throw new TypeError(`Network request failed for Bearer ${SECRET}`)
    }
    const { adinize: offline } = client({ fetch: failing })
    const error = unwrapError(await offline.track('Purchase'))
    expect(error).toMatchObject({ status: null, code: 'TRANSPORT_ERROR', message: 'connection failed: TypeError' })
  })

  it('refuses bad config before anything is sent', async () => {
    const { fetch, calls } = stubFetch(accepted('o1'))
    const bad: Array<[Record<string, unknown>, string]> = [
      [{ secretKey: undefined }, 'MISSING_SECRET_KEY'],
      [{ secretKey: '' }, 'INVALID_OPTION'],
      [{ baseUrl: 'http://adinize.ai' }, 'INVALID_OPTION'],
      [{ timeoutMs: 0 }, 'INVALID_OPTION'],
      [{ defaultCountry: 'ZZ' }, 'INVALID_OPTION'],
      [{ batcher: { maxBatch: 101 } }, 'INVALID_OPTION'],
    ]
    for (const [override, code] of bad) {
      const { adinize } = client({ fetch, ...override })
      expect(unwrapError(await adinize.track('Purchase')).code).toBe(code)
      expect(unwrapError(adinize.trackAsync('Purchase')).code).toBe(code)
    }
    expect(calls).toHaveLength(0)
  })

  it('allows http for localhost and trims a trailing slash', async () => {
    const { fetch, calls } = stubFetch(accepted('o1'))
    const { adinize } = client({ fetch, baseUrl: 'http://localhost:4000/' })
    unwrap(await adinize.track('Purchase', { eventId: 'o1' }))
    expect(calls[0].url).toBe('http://localhost:4000/api/server/v1/events')
  })

  it('refuses data JSON cannot encode without sending', async () => {
    const { fetch, calls } = stubFetch(accepted('o1'))
    const { adinize } = client({ fetch })
    expect(unwrapError(await adinize.track('Purchase', { data: { big: 1n } })).code).toBe('INVALID_OPTION')
    expect(calls).toHaveLength(0)
  })
})

describe('Adinize.trackMany', () => {
  it('sends every event in one request and returns results in order', async () => {
    const { fetch, calls } = stubFetch(accepted('a', 'b'))
    const { adinize } = client({ fetch })
    const value = unwrap(await adinize.trackMany([{ eventName: 'Lead', eventId: 'a' }, { eventName: 'Purchase', eventId: 'b' }]))
    expect(value.map((result) => result.eventId)).toEqual(['a', 'b'])
    expect(sentEvents(calls[0]).map((event) => event.event_name)).toEqual(['Lead', 'Purchase'])
  })

  it('refuses more than 100 events, an empty list, and a bad event without sending', async () => {
    const { fetch, calls } = stubFetch(accepted())
    const { adinize } = client({ fetch })
    const many = Array.from({ length: 101 }, (_, i) => ({ eventName: 'Lead', eventId: `e${i}` }))
    expect(unwrapError(await adinize.trackMany(many)).code).toBe('TOO_MANY_EVENTS')
    expect(unwrapError(await adinize.trackMany([])).code).toBe('INVALID_OPTION')
    expect(unwrapError(await adinize.trackMany([{ eventName: 'Lead', user: { email: 1 as never } }])).code).toBe('INVALID_OPTION')
    expect(calls).toHaveLength(0)
  })
})
