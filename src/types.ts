export type Country = 'AE' | 'BH' | 'EG' | 'GB' | 'JO' | 'KW' | 'OM' | 'QA' | 'SA' | 'US'

export type Consent = {
  analytics?: boolean
  marketing?: boolean
  functional?: boolean
}

export type UserData = {
  email?: string | null
  phone?: string | null
  firstName?: string | null
  lastName?: string | null
  streetAddress?: string | null
  emailHash?: string | null
  phoneHash?: string | null
  phoneDigitsHash?: string | null
  firstNameHash?: string | null
  lastNameHash?: string | null
  streetAddressHash?: string | null
  externalId?: string | null
  clientIpAddress?: string | null
  clientUserAgent?: string | null
  fbp?: string | null
  fbc?: string | null
  ttp?: string | null
  gclid?: string | null
  ttclid?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  countryCode?: string | null
  madid?: string | null
  idfv?: string | null
  anonId?: string | null
  consent?: Consent | null
}

export type ActionSource = 'website' | 'app'

export type MobileOs = 'ios' | 'android'

export type AttStatus = 'AUTHORIZED' | 'DENIED' | 'NOT_DETERMINED' | 'RESTRICTED' | 'NOT_APPLICABLE'

export type AppData = {
  os: MobileOs
  osVersion: string
  advertiserTrackingEnabled: boolean
  applicationTrackingEnabled?: boolean
  attStatus?: AttStatus
  bundleId?: string
  appVersion?: string
  appStoreId?: string
  deviceModel?: string
  locale?: string
  timezone?: string
  carrier?: string
}

export type EventData = Record<string, unknown>

export type PlatformEventNames = {
  meta?: string
  tiktok?: string
}

export type EventOptions = {
  eventId?: string
  eventTime?: Date | number
  visitorId?: string
  pageUrl?: string
  queryString?: boolean
  actionSource?: ActionSource
  user?: UserData
  data?: EventData
  appData?: Partial<AppData>
  platformEventNames?: PlatformEventNames
}

export type RetryOptions = {
  retry?: boolean
}

export type TrackOptions = EventOptions & RetryOptions

export type BatchEvent = EventOptions & { eventName: string }

export type EventStatus = 'accepted' | 'duplicate' | 'rejected'

export type EventError = {
  field: string | null
  code: string | null
  message: string | null
}

export type EventResult = {
  eventId: string | null
  status: EventStatus
  errors: EventError[]
}

export type SdkErrorCode =
  | 'MISSING_SECRET_KEY'
  | 'INVALID_OPTION'
  | 'TOO_MANY_EVENTS'
  | 'QUEUE_FULL'
  | 'TIMEOUT'
  | 'TRANSPORT_ERROR'
  | 'HTTP_ERROR'
  | 'INVALID_RESPONSE'
  | 'CRASHED'

export type ServerErrorCode = 'INVALID_REQUEST' | 'INVALID_KEY' | 'PIXEL_INACTIVE' | 'RATE_LIMITED'

export type ErrorCode = SdkErrorCode | ServerErrorCode | (string & {})

export type AdinizeError = {
  status: number | null
  code: ErrorCode
  message: string
  retryAfter: number | null
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: AdinizeError }

export type DropReason = 'queue_full' | 'retries_exhausted' | 'rejected_by_server' | 'crashed' | 'shutdown_timeout'

export type TelemetryEvent =
  | { type: 'request:start'; eventCount: number }
  | { type: 'request:stop'; eventCount: number; durationMs: number; status: 'ok' | 'error'; errorCode: string | null }
  | {
      type: 'event:rejected'
      eventId: string | null
      eventName: string
      field: string | null
      code: string | null
      message: string | null
    }
  | { type: 'event:dropped'; eventId: string; eventName: string; reason: DropReason }

export type TelemetryListener = (event: TelemetryEvent) => void

export type BatcherOptions = {
  flushIntervalMs?: number
  maxBatch?: number
  maxQueue?: number
  shutdownMs?: number
}

export type AdinizeConfig = {
  secretKey: string
  baseUrl?: string
  timeoutMs?: number
  defaultCountry?: Country
  user?: UserData
  appData?: AppData
  fetch?: typeof fetch
  onTelemetry?: TelemetryListener
  batcher?: BatcherOptions
}
