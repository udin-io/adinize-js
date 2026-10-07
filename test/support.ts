import { Adinize } from '../src/adinize.js'
import type { AdinizeConfig, TelemetryEvent } from '../src/types.js'

export type Call = { url: string; init: RequestInit }

export type Responder = () => Response | Promise<Response>

export const SECRET = 'adzsk_test_secret'

const abortError = (): Error => Object.assign(new Error('aborted'), { name: 'AbortError' })

const untilAborted = (signal: AbortSignal | null | undefined): Promise<never> =>
  new Promise((_, reject) => signal?.addEventListener('abort', () => reject(abortError())))

export function stubFetch(...responders: Responder[]) {
  const calls: Call[] = []
  const fetch = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const responder = responders[Math.min(calls.length, responders.length - 1)]
    calls.push({ url: String(url), init: init ?? {} })
    return Promise.race([responder(), untilAborted(init?.signal)])
  }
  return { fetch, calls }
}

export const json =
  (status: number, body: unknown, headers: Record<string, string> = {}): Responder =>
  () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

export const results = (...rows: Array<{ event_id: string; status: string; errors?: unknown[] }>): Responder =>
  json(200, { results: rows })

export const accepted = (...ids: string[]): Responder => results(...ids.map((id) => ({ event_id: id, status: 'accepted' })))

export const serverError = (status: number, code: string, extra: Record<string, unknown> = {}, headers?: Record<string, string>): Responder =>
  json(status, { error: { code, message: `${code} happened`, ...extra } }, headers)

export const hanging: Responder = () => new Promise<Response>(() => undefined)

export function client(config: Partial<AdinizeConfig> & { fetch: typeof fetch }) {
  const events: TelemetryEvent[] = []
  const adinize = new Adinize({ secretKey: SECRET, onTelemetry: (event) => events.push(event), ...config })
  return { adinize, events }
}

export const sentBody = (call: Call): { events: Array<Record<string, unknown>> } => JSON.parse(String(call.init.body))

export const sentEvents = (call: Call): Array<Record<string, unknown>> => sentBody(call).events

export const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`)
  return result.value
}

export const unwrapError = <E>(result: { ok: true; value: unknown } | { ok: false; error: E }): E => {
  if (result.ok) throw new Error(`expected error, got ${JSON.stringify(result.value)}`)
  return result.error
}
