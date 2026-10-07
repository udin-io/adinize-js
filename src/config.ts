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
// An allow-list, not `new URL()`: React Native's URL (Libraries/Blob/URL.js) is a
// regex shim whose getters disagree with WHATWG parsing. No user, query, fragment,
// backslash or percent sign gets through, so every parser reads the same host. The
// last label starts with a letter, so numeric hosts such as https://0x7f.1 that
// WHATWG rewrites to an IPv4 address are refused; ports run 1 to 65535, no leading 0.
const PORT = '(?::(?:[1-9]\\d{0,3}|[1-5]\\d{4}|6[0-4]\\d{3}|65[0-4]\\d{2}|655[0-2]\\d|6553[0-5]))?'
const HOST = '(?:https:\\/\\/(?:[a-z0-9-]+\\.)*[a-z][a-z0-9-]*|http:\\/\\/(?:localhost|127\\.0\\.0\\.1))'
const BASE_URL = new RegExp(`^${HOST}${PORT}(?:\\/[A-Za-z0-9._~-]*)*$`)

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
  if (typeof baseUrl !== 'string' || !BASE_URL.test(baseUrl)) {
    return invalid('baseUrl must be an https URL with a lowercase host and no user, query or fragment')
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
