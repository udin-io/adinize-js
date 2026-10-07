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
      [serverError(429, 'RATE_LIMITED', {}, { 'retry-after': '9'.repeat(400) }), { status: 429, retryAfter: Number.MAX_SAFE_INTEGER }],
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

  it('refuses every baseUrl form that could send the key to another host', async () => {
    const { fetch, calls } = stubFetch(accepted('o1'))
    const refused = [
      'https://adinize.ai@evil.example',
      'https://user:pass@adinize.ai',
      'https://adinize.ai\\@evil.example',
      'https://adinize.ai?next=https://evil.example',
      'https://adinize.ai#evil',
      'https://adinize.ai/%2e%2e',
      'https://Adinize.ai',
      ' https://adinize.ai',
      'https://adinize.ai/ x',
      'http://localhost.evil.example',
      'http://localhost@evil.example',
      'http://127.0.0.1.evil.example',
      'ftp://adinize.ai',
      'https://0x7f.1',
      'https://2130706433',
      'https://0177.0.0.1',
      'https://1.2.3',
      'https://adinize.ai:99999',
      'https://adinize.ai:0443',
      'https://adinize.ai:0',
      'https://adinize.ai:',
    ]
    for (const baseUrl of refused) {
      const { adinize } = client({ fetch, baseUrl })
      expect(unwrapError(await adinize.track('Purchase')), baseUrl).toMatchObject({ code: 'INVALID_OPTION' })
    }
    expect(calls).toHaveLength(0)
  })

  it('takes an https host with a port or a path prefix, and http on 127.0.0.1', async () => {
    const allowed: Array<[string, string]> = [
      ['https://api.example.com/adinize/', 'https://api.example.com/adinize/api/server/v1/events'],
      ['https://adinize.ai:8443', 'https://adinize.ai:8443/api/server/v1/events'],
      ['https://adinize.ai:65535', 'https://adinize.ai:65535/api/server/v1/events'],
      ['http://127.0.0.1:4000', 'http://127.0.0.1:4000/api/server/v1/events'],
    ]
    for (const [baseUrl, url] of allowed) {
      const { fetch, calls } = stubFetch(accepted('o1'))
      const { adinize } = client({ fetch, baseUrl })
      unwrap(await adinize.track('Purchase', { eventId: 'o1' }))
      expect(calls[0].url).toBe(url)
    }
  })

  it('refuses an answer that came from a redirect, and does not retry it', async () => {
    const answered = (props: { url?: string; redirected?: boolean }) => () =>
      Object.defineProperties(new Response(JSON.stringify({ results: [{ event_id: 'o1', status: 'accepted' }] }), { status: 200 }), {
        url: { value: props.url ?? '' },
        redirected: { value: props.redirected ?? false },
      })
    for (const props of [{ url: 'https://evil.example/api/server/v1/events' }, { redirected: true }]) {
      const { fetch, calls } = stubFetch(answered(props))
      const { adinize } = client({ fetch })
      expect(unwrapError(await adinize.track('Purchase', { eventId: 'o1', retry: true }))).toMatchObject({ status: null, code: 'HTTP_ERROR' })
      expect(calls).toHaveLength(1)
    }
    for (const url of ['https://adinize.ai/api/server/v1/events', 'https://ADINIZE.ai:443/api/server/v1/events']) {
      const { adinize } = client({ fetch: stubFetch(answered({ url })).fetch })
      expect(unwrap(await adinize.track('Purchase', { eventId: 'o1' })).status).toBe('accepted')
    }
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
