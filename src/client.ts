import type { Result } from './types.js'
import type { ResolvedConfig } from './config.js'
import type { EventBody } from './event.js'
import { fail, failWith, invalid, ok } from './result.js'
import { isPlainObject } from './object.js'

const EVENTS_PATH = '/api/server/v1/events'

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const nonNegativeInteger = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null

const retryAfter = (header: string | null, body: unknown): number | null => {
  const fromHeader = header !== null && /^\d+$/.test(header) ? Number(header) : null
  const seconds = fromHeader ?? nonNegativeInteger(body)
  return seconds === null ? null : Math.min(seconds, Number.MAX_SAFE_INTEGER)
}

function handle(status: number, retryAfterHeader: string | null, json: unknown): Result<unknown[]> {
  if (status === 200) {
    const results = isPlainObject(json) ? json.results : undefined
    return Array.isArray(results) ? ok(results) : fail('INVALID_RESPONSE', 'the 200 response carried no results list', 200)
  }
  const error = isPlainObject(json) && isPlainObject(json.error) ? json.error : null
  if (error !== null && typeof error.code === 'string') {
    return failWith({
      status,
      code: error.code,
      message: typeof error.message === 'string' ? error.message : '',
      retryAfter: retryAfter(retryAfterHeader, error.retry_after),
    })
  }
  return fail('HTTP_ERROR', `the API answered HTTP ${status}`, status)
}

const DEFAULT_PORTS: Record<string, string> = { 'https:': ':443', 'http:': ':80' }

const origin = (url: string): string => {
  const [, scheme = '', authority = ''] = /^([a-z][a-z0-9+.-]*:)\/\/([^/?#]*)/i.exec(url) ?? []
  const lower = authority.toLowerCase()
  const port = DEFAULT_PORTS[scheme.toLowerCase()]
  return `${scheme.toLowerCase()}//${port !== undefined && lower.endsWith(port) ? lower.slice(0, -port.length) : lower}`
}

// React Native's fetch (whatwg-fetch over XMLHttpRequest) ignores `redirect: 'error'`
// and follows redirects; its Response has no `redirected`, only the final `url`.
const redirectedAway = (response: Response, url: string): boolean =>
  response.redirected === true || (typeof response.url === 'string' && response.url !== '' && origin(response.url) !== origin(url))

const transportError = (error: unknown): Result<never> => {
  const name = error instanceof Error ? error.name : typeof error
  return name === 'AbortError'
    ? fail('TIMEOUT', 'no response in time')
    : fail('TRANSPORT_ERROR', `connection failed: ${name}`)
}

async function request(body: string, config: ResolvedConfig): Promise<Result<unknown[]>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  try {
    const url = `${config.baseUrl}${EVENTS_PATH}`
    const response = await config.fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${config.secretKey}`,
      },
      body,
      signal: controller.signal,
      redirect: 'error',
    })
    if (redirectedAway(response, url)) return fail('HTTP_ERROR', 'the API redirected the request')
    return handle(response.status, response.headers.get('retry-after'), parseJson(await response.text()))
  } catch (error) {
    return transportError(error)
  } finally {
    clearTimeout(timer)
  }
}

export function postEvents(events: EventBody[], config: ResolvedConfig): Promise<Result<unknown[]>> {
  let body: string
  try {
    body = JSON.stringify({ events })
  } catch {
    return Promise.resolve(invalid('data holds a value JSON cannot encode'))
  }
  return config.telemetry.span(events.length, () => request(body, config))
}
