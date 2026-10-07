import type { AdinizeError, ErrorCode, EventError, EventResult, EventStatus, Result } from './types.js'
import type { Telemetry } from './telemetry.js'
import { isPlainObject } from './object.js'

export const ok = <T>(value: T): Result<T> => ({ ok: true, value })

export const fail = (code: ErrorCode, message: string, status: number | null = null): Result<never> => ({
  ok: false,
  error: { status, code, message, retryAfter: null },
})

export const failWith = (error: AdinizeError): Result<never> => ({ ok: false, error })

export const invalid = (message: string): Result<never> => fail('INVALID_OPTION', message)

const invalidResponse = (): Result<never> => fail('INVALID_RESPONSE', 'the results do not match the events sent', 200)

const STATUSES: ReadonlySet<string> = new Set<EventStatus>(['accepted', 'duplicate', 'rejected'])

const string = (value: unknown): string | null => (typeof value === 'string' ? value : null)

const eventError = (value: unknown): EventError =>
  isPlainObject(value)
    ? { field: string(value.field), code: string(value.code), message: string(value.message) }
    : { field: null, code: null, message: null }

export function parseEventResult(json: unknown): EventResult | null {
  if (!isPlainObject(json) || typeof json.status !== 'string' || !STATUSES.has(json.status)) return null
  const errors = Array.isArray(json.errors) ? json.errors : []
  return { eventId: string(json.event_id), status: json.status as EventStatus, errors: errors.map(eventError) }
}

export function parseResults(results: unknown[], eventNames: string[], telemetry: Telemetry): Result<EventResult[]> {
  if (results.length !== eventNames.length) return invalidResponse()
  const parsed: EventResult[] = []
  for (const [index, json] of results.entries()) {
    const result = parseEventResult(json)
    if (result === null) return invalidResponse()
    if (result.status === 'rejected') telemetry.rejected(result, eventNames[index])
    parsed.push(result)
  }
  return ok(parsed)
}
