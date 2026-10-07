import type { AdinizeConfig, Result } from './types.js'
import type { EventDefaults } from './event.js'
import { fail, invalid, ok } from './result.js'
import { isPlainObject } from './object.js'
import { countries, isCountry } from './phone.js'
import { createTelemetry, type Telemetry } from './telemetry.js'

export const MAX_BATCH = 100

export type ResolvedBatcherOptions = {
  flushIntervalMs: number
  maxBatch: number
  maxQueue: number
  shutdownMs: number
}

export type ResolvedConfig = {
  secretKey: string
  baseUrl: string
  timeoutMs: number
  defaults: EventDefaults
  fetch: typeof fetch
  telemetry: Telemetry
  batcher: ResolvedBatcherOptions
}

const DEFAULT_BASE_URL = 'https://adinize.ai'
const DEFAULT_TIMEOUT_MS = 15_000
const HTTPS_URL = /^https:\/\/[^/?#\s]+/
const LOCAL_HTTP_URL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/

const bounded = (value: unknown, name: string, min: number, max: number | null): Result<number> => {
  const inRange = typeof value === 'number' && Number.isInteger(value) && value >= min && (max === null || value <= max)
  const range = max === null ? `>= ${min}` : `between ${min} and ${max}`
  return inRange ? ok(value) : invalid(`${name} must be an integer ${range}`)
}

export function resolveConfig(config: AdinizeConfig): Result<ResolvedConfig> {
  if (typeof config !== 'object' || config === null) return invalid('config must be an object')
  const {
    secretKey,
    baseUrl = DEFAULT_BASE_URL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    defaultCountry = null,
    user = null,
    appData = null,
    fetch = globalThis.fetch,
    onTelemetry,
    batcher = {},
  } = config

  if (secretKey === undefined || secretKey === null) return fail('MISSING_SECRET_KEY', 'set secretKey in the Adinize config')
  if (typeof secretKey !== 'string' || secretKey === '') return invalid('secretKey must be a non-empty string')
  if (typeof baseUrl !== 'string' || !(HTTPS_URL.test(baseUrl) || LOCAL_HTTP_URL.test(baseUrl))) {
    return invalid('baseUrl must be an https URL')
  }
  if (!(typeof timeoutMs === 'number' && Number.isInteger(timeoutMs) && timeoutMs > 0)) {
    return invalid('timeoutMs must be a positive integer')
  }
  if (defaultCountry !== null && !isCountry(defaultCountry)) {
    return invalid(`defaultCountry must be one of ${countries.join(', ')}`)
  }
  if (user !== null && !isPlainObject(user)) return invalid('user must be an object')
  if (appData !== null && !isPlainObject(appData)) return invalid('appData must be an object')
  if (typeof fetch !== 'function') return invalid('fetch must be a function')

  const flushIntervalMs = bounded(batcher.flushIntervalMs ?? 1_000, 'flushIntervalMs', 1, null)
  if (!flushIntervalMs.ok) return flushIntervalMs
  const maxBatch = bounded(batcher.maxBatch ?? MAX_BATCH, 'maxBatch', 1, MAX_BATCH)
  if (!maxBatch.ok) return maxBatch
  const maxQueue = bounded(batcher.maxQueue ?? 10_000, 'maxQueue', 1, null)
  if (!maxQueue.ok) return maxQueue
  const shutdownMs = bounded(batcher.shutdownMs ?? 5_000, 'shutdownMs', 1, null)
  if (!shutdownMs.ok) return shutdownMs

  return ok({
    secretKey,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    timeoutMs,
    defaults: { country: defaultCountry, user, appData },
    fetch,
    telemetry: createTelemetry(onTelemetry),
    batcher: {
      flushIntervalMs: flushIntervalMs.value,
      maxBatch: maxBatch.value,
      maxQueue: maxQueue.value,
      shutdownMs: shutdownMs.value,
    },
  })
}
