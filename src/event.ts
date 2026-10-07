import type {
  ActionSource,
  AppData,
  Country,
  EventData,
  EventOptions,
  PlatformEventNames,
  Result,
  UserData,
} from './types.js'
import { invalid, ok } from './result.js'
import { isEmpty, isPlainObject } from './object.js'
import * as Hash from './hash.js'

export type EventBody = {
  event_id: string
  event_name: string
  event_time: number
  action_source?: 'app'
  visitor_id?: string
  page_url?: string
  user_data?: Record<string, unknown>
  event_data?: EventData
  app_data?: Record<string, unknown>
  platform_event_names?: PlatformEventNames
}

export type EventDefaults = {
  country: Country | null
  user: UserData | null
  appData: AppData | null
}

type UserField =
  | { kind: 'hashed'; wire: string; hash: (value: string) => string | null }
  | { kind: 'phone' }
  | { kind: 'prehashed'; wire: string }
  | { kind: 'plain'; wire: string }
  | { kind: 'consent' }

const EVENT_KEYS = {
  eventId: true,
  eventTime: true,
  visitorId: true,
  pageUrl: true,
  queryString: true,
  actionSource: true,
  user: true,
  data: true,
  appData: true,
  platformEventNames: true,
} satisfies Record<keyof EventOptions, true>

const USER_FIELDS: Record<keyof UserData, UserField> = {
  email: { kind: 'hashed', wire: 'email_hash', hash: Hash.email },
  phone: { kind: 'phone' },
  firstName: { kind: 'hashed', wire: 'first_name_hash', hash: Hash.name },
  lastName: { kind: 'hashed', wire: 'last_name_hash', hash: Hash.name },
  streetAddress: { kind: 'hashed', wire: 'street_address_hash', hash: Hash.streetAddress },
  emailHash: { kind: 'prehashed', wire: 'email_hash' },
  phoneHash: { kind: 'prehashed', wire: 'phone_hash' },
  phoneDigitsHash: { kind: 'prehashed', wire: 'phone_digits_hash' },
  firstNameHash: { kind: 'prehashed', wire: 'first_name_hash' },
  lastNameHash: { kind: 'prehashed', wire: 'last_name_hash' },
  streetAddressHash: { kind: 'prehashed', wire: 'street_address_hash' },
  externalId: { kind: 'plain', wire: 'external_id' },
  clientIpAddress: { kind: 'plain', wire: 'client_ip_address' },
  clientUserAgent: { kind: 'plain', wire: 'client_user_agent' },
  fbp: { kind: 'plain', wire: 'fbp' },
  fbc: { kind: 'plain', wire: 'fbc' },
  ttp: { kind: 'plain', wire: 'ttp' },
  gclid: { kind: 'plain', wire: 'gclid' },
  ttclid: { kind: 'plain', wire: 'ttclid' },
  city: { kind: 'plain', wire: 'city' },
  state: { kind: 'plain', wire: 'state' },
  postalCode: { kind: 'plain', wire: 'postal_code' },
  countryCode: { kind: 'plain', wire: 'country_code' },
  madid: { kind: 'plain', wire: 'madid' },
  idfv: { kind: 'plain', wire: 'idfv' },
  anonId: { kind: 'plain', wire: 'anon_id' },
  consent: { kind: 'consent' },
}

const APP_ONLY_USER_WIRE = ['madid', 'idfv', 'anon_id']

const APP_DATA_WIRE = {
  os: 'os',
  osVersion: 'os_version',
  advertiserTrackingEnabled: 'advertiser_tracking_enabled',
  applicationTrackingEnabled: 'application_tracking_enabled',
  attStatus: 'att_status',
  bundleId: 'bundle_id',
  appVersion: 'app_version',
  appStoreId: 'app_store_id',
  deviceModel: 'device_model',
  locale: 'locale',
  timezone: 'timezone',
  carrier: 'carrier',
} satisfies Record<keyof AppData, string>

const APP_DATA_KEYS = Object.keys(APP_DATA_WIRE) as (keyof AppData)[]
const APP_DATA_REQUIRED: readonly (keyof AppData)[] = ['os', 'osVersion', 'advertiserTrackingEnabled']
const APP_DATA_BOOLEANS: ReadonlySet<string> = new Set(['advertiserTrackingEnabled', 'applicationTrackingEnabled'])
const APP_DATA_ENUMS: Partial<Record<keyof AppData, ReadonlySet<string>>> = {
  os: new Set(['ios', 'android']),
  attStatus: new Set(['AUTHORIZED', 'DENIED', 'NOT_DETERMINED', 'RESTRICTED', 'NOT_APPLICABLE']),
}

const PREHASHED_PHONE_KEYS: readonly (keyof UserData)[] = ['phoneHash', 'phoneDigitsHash']
const CONSENT_KEYS: ReadonlySet<string> = new Set(['analytics', 'marketing', 'functional'])
const PLATFORMS: ReadonlySet<string> = new Set(['meta', 'tiktok'])
const PERSONAL_NAMES: ReadonlySet<string> = new Set([
  'first_name',
  'last_name',
  'street_address',
  'firstname',
  'lastname',
  'streetaddress',
])
const SHA256_HEX = /^[0-9a-f]{64}$/

const uuid4 = (): string => {
  const bytes = new Uint8Array(16)
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function knownKeys(value: unknown, allowed: Record<string, unknown>, what: string): Result<Record<string, unknown>> {
  if (!isPlainObject(value)) return invalid(`${what}s must be an object`)
  const unknown = Object.keys(value).filter((key) => !Object.hasOwn(allowed, key))
  return unknown.length === 0 ? ok(value) : invalid(`unknown ${what}: ${unknown.join(', ')}`)
}

function parseEventId(value: unknown): Result<string> {
  if (value === undefined || value === null) return ok(uuid4())
  if (typeof value === 'string' && value !== '') return ok(value)
  return invalid('eventId must be a non-empty string')
}

function parseEventTime(value: unknown): Result<number> {
  if (value === undefined || value === null) return ok(Math.floor(Date.now() / 1000))
  if (value instanceof Date && !Number.isNaN(value.getTime())) return ok(Math.floor(value.getTime() / 1000))
  if (typeof value === 'number' && Number.isInteger(value)) return ok(value)
  return invalid('eventTime must be a Date or Unix seconds')
}

function optionalString(value: unknown, name: string): Result<string | null> {
  if (value === undefined || value === null) return ok(null)
  return typeof value === 'string' ? ok(value) : invalid(`${name} must be a string`)
}

// Matches every userinfo form a WHATWG parser still reads as one, slashes or
// backslashes in any number after the scheme (`https:jane:pw@host`, `https:\\jane@host`).
const USERINFO = /^(?:([a-z][a-z0-9+.-]*:)[\\/]*|[\\/]{2})[^\\/?#]*@/i

// The query and the fragment can hold an email or a token; the userinfo holds a password.
// Leading control characters and spaces, tabs and newlines go first, as a browser drops them.
const cleanPageUrl = (url: string, keepQuery: boolean): string => {
  const trimmed = url.replace(/^[\u0000-\u0020]+/, '').replace(/[\t\n\r]/g, '')
  const withoutUser = trimmed.replace(USERINFO, (_, scheme: string | undefined) => `${scheme ?? ''}//`)
  return keepQuery ? withoutUser : withoutUser.replace(/[?#].*$/s, '')
}

function parseActionSource(value: unknown, fallback: ActionSource): Result<ActionSource> {
  if (value === undefined || value === null) return ok(fallback)
  return value === 'website' || value === 'app' ? ok(value) : invalid('actionSource must be website or app')
}

function merged(defaults: object | null, override: unknown, what: string): Result<Record<string, unknown>> {
  if (override !== undefined && override !== null && !isPlainObject(override)) return invalid(`${what}s must be an object`)
  return ok({ ...defaults, ...(override ?? {}) })
}

const isBoundedText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '' && [...value].length <= 128

const appDataProblem = (key: keyof AppData, value: unknown): string | null => {
  if (APP_DATA_BOOLEANS.has(key)) return typeof value === 'boolean' ? null : `appData ${key} must be a boolean`
  const allowed = APP_DATA_ENUMS[key]
  if (allowed !== undefined) {
    return typeof value === 'string' && allowed.has(value) ? null : `appData ${key} must be one of ${[...allowed].join(', ')}`
  }
  return isBoundedText(value) ? null : `appData ${key} must be 1 to 128 characters`
}

function parseAppData(value: Record<string, unknown>): Result<Record<string, unknown>> {
  const known = knownKeys(value, APP_DATA_WIRE, 'appData field')
  if (!known.ok) return known
  const data: Record<string, unknown> = {}
  for (const key of APP_DATA_KEYS) {
    const field = known.value[key]
    if (field === undefined || field === null) {
      if (APP_DATA_REQUIRED.includes(key)) return invalid(`appData ${key} is required for an app event`)
      continue
    }
    const problem = appDataProblem(key, field)
    if (problem !== null) return invalid(problem)
    data[APP_DATA_WIRE[key]] = field
  }
  return ok(data)
}

function parseAppDataFor(
  actionSource: ActionSource,
  defaults: AppData | null,
  override: unknown,
): Result<Record<string, unknown> | null> {
  if (actionSource === 'website') {
    return override === undefined || override === null ? ok(null) : invalid('appData is for app events; pass actionSource app')
  }
  const app = merged(defaults, override, 'appData field')
  return app.ok ? parseAppData(app.value) : app
}

const isConsent = (value: unknown): boolean =>
  isPlainObject(value) && Object.entries(value).every(([key, flag]) => CONSENT_KEYS.has(key) && typeof flag === 'boolean')

function userField(key: keyof UserData, value: unknown, defaultCountry: Country | null): Result<Record<string, unknown>> {
  const field = USER_FIELDS[key]
  switch (field.kind) {
    case 'phone': {
      if (typeof value !== 'string') return invalid('user phone must be a string')
      const phoneHash = Hash.phone(value, defaultCountry)
      const phoneDigitsHash = Hash.phoneDigits(value, defaultCountry)
      return ok(phoneHash && phoneDigitsHash ? { phone_hash: phoneHash, phone_digits_hash: phoneDigitsHash } : {})
    }
    case 'hashed': {
      if (typeof value !== 'string') return invalid(`user ${key} must be a string`)
      const hash = field.hash(value)
      return ok(hash ? { [field.wire]: hash } : {})
    }
    case 'prehashed':
      return typeof value === 'string' && SHA256_HEX.test(value)
        ? ok({ [field.wire]: value })
        : invalid(`user ${key} must be 64 lowercase hex characters`)
    case 'plain':
      return typeof value === 'string' ? ok({ [field.wire]: value }) : invalid(`user ${key} has the wrong type`)
    case 'consent':
      return isConsent(value) ? ok({ consent: value }) : invalid('user consent takes analytics, marketing and functional booleans')
  }
}

function parseUser(user: unknown, defaultCountry: Country | null): Result<Record<string, unknown>> {
  const known = knownKeys(user, USER_FIELDS, 'user field')
  if (!known.ok) return known
  const fields = known.value
  const present = (key: keyof UserData): boolean => fields[key] !== undefined && fields[key] !== null
  if (present('phone') && PREHASHED_PHONE_KEYS.some(present)) {
    return invalid('user phone cannot be sent with phoneHash or phoneDigitsHash; pass one')
  }
  const data: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue
    const parsed = userField(key as keyof UserData, value, defaultCountry)
    if (!parsed.ok) return parsed
    Object.assign(data, parsed.value)
  }
  return ok(data)
}

const isPersonalName = (key: string): boolean => {
  const name = key.trim().toLowerCase()
  return name.includes('email') || name.includes('phone') || PERSONAL_NAMES.has(name)
}

function personalKeyPath(value: unknown, path: string): string | null {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = personalKeyPath(item, `${path}[${index}]`)
      if (found !== null) return found
    }
    return null
  }
  if (!isPlainObject(value)) return null
  for (const [key, child] of Object.entries(value)) {
    const keyPath = `${path}.${key}`
    if (isPersonalName(key)) return keyPath
    const found = personalKeyPath(child, keyPath)
    if (found !== null) return found
  }
  return null
}

function parseData(data: unknown): Result<EventData> {
  if (!isPlainObject(data)) return invalid('data must be an object')
  const path = personalKeyPath(data, 'data')
  return path === null ? ok(data) : invalid(`data must not hold ${path}; pass it under user so it is hashed`)
}

const hasPlatformNameValues = (value: Record<string, unknown>): value is PlatformEventNames =>
  Object.values(value).every((name) => typeof name === 'string' && name !== '')

function parsePlatformEventNames(names: unknown): Result<PlatformEventNames> {
  if (!isPlainObject(names)) return invalid('platformEventNames must be an object')
  const unknown = Object.keys(names).filter((platform) => !PLATFORMS.has(platform))
  if (unknown.length > 0) return invalid(`platformEventNames takes only meta and tiktok, not ${unknown.join(', ')}`)
  return hasPlatformNameValues(names) ? ok(names) : invalid('platformEventNames values must be non-empty strings')
}

export function buildEvent(name: unknown, options: unknown, defaults: EventDefaults): Result<EventBody> {
  if (typeof name !== 'string' || name === '') return invalid('event name must be a non-empty string')
  const known = knownKeys(options ?? {}, EVENT_KEYS, 'event option')
  if (!known.ok) return known
  const opts = known.value

  const eventId = parseEventId(opts.eventId)
  if (!eventId.ok) return eventId
  const eventTime = parseEventTime(opts.eventTime)
  if (!eventTime.ok) return eventTime
  const visitorId = optionalString(opts.visitorId, 'visitorId')
  if (!visitorId.ok) return visitorId
  const pageUrl = optionalString(opts.pageUrl, 'pageUrl')
  if (!pageUrl.ok) return pageUrl
  const actionSource = parseActionSource(opts.actionSource, defaults.appData === null ? 'website' : 'app')
  if (!actionSource.ok) return actionSource
  const user = merged(defaults.user, opts.user, 'user field')
  if (!user.ok) return user
  const userData = parseUser(user.value, defaults.country)
  if (!userData.ok) return userData
  if (actionSource.value === 'website' && APP_ONLY_USER_WIRE.some((wire) => Object.hasOwn(userData.value, wire))) {
    return invalid('user madid, idfv and anonId are app events only; pass actionSource app')
  }
  const appData = parseAppDataFor(actionSource.value, defaults.appData, opts.appData)
  if (!appData.ok) return appData
  const eventData = parseData(opts.data ?? {})
  if (!eventData.ok) return eventData
  const platformNames = parsePlatformEventNames(opts.platformEventNames ?? {})
  if (!platformNames.ok) return platformNames

  const body: EventBody = { event_id: eventId.value, event_name: name, event_time: eventTime.value }
  if (actionSource.value === 'app') body.action_source = 'app'
  if (visitorId.value !== null) body.visitor_id = visitorId.value
  if (pageUrl.value !== null) body.page_url = cleanPageUrl(pageUrl.value, opts.queryString === true)
  if (!isEmpty(userData.value)) body.user_data = userData.value
  if (!isEmpty(eventData.value)) body.event_data = eventData.value
  if (appData.value !== null) body.app_data = appData.value
  if (!isEmpty(platformNames.value)) body.platform_event_names = platformNames.value
  return ok(body)
}
