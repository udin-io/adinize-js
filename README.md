# adinize

TypeScript SDK for the adinize server events API, for React Native apps and
any JavaScript runtime with `fetch`. It reports conversions to adinize, which
attributes them to the ad click and forwards them to Meta, TikTok and Google
Ads. Personal data leaves the device only as SHA-256 hashes.

A port of [adinize-elixir](https://github.com/udin-io/adinize-elixir): same
event shape, hashing, phone rules, retry policy, batcher and telemetry.

## Install

```sh
npm install adinize
```

No runtime dependencies. `react` and `react-native` are optional peers, used
only by the `adinize/react-native` entry.

## The secret key

The API authenticates with a pixel secret key. The adinize contract says to
keep it on a server and never in a web page, and a mobile app binary is no
safer: anyone with the app can extract the key. Prefer calling this SDK from
your own backend, or from a thin proxy the app talks to. If you do ship a
key in the app, use a dedicated key you can revoke on the pixel's page.

## Send an event

```ts
import { Adinize } from 'adinize'

const adinize = new Adinize({ secretKey: SECRET_KEY, defaultCountry: 'EG' })

const result = await adinize.track('Purchase', {
  eventId: 'order_10482',
  user: { email: ' Jane@Example.com ', phone: '0100 123 4567' },
  data: { value: 129.5, currency: 'EGP', order_id: '10482' },
})
// { ok: true, value: { eventId: 'order_10482', status: 'accepted', errors: [] } }
```

- `email`, `phone`, `firstName`, `lastName` and `streetAddress` are hashed
  before sending. `data` goes as given, so any key in it, at any depth,
  named `*email*`, `*phone*`, `first_name`, `last_name`, `street_address`
  or their camelCase forms is refused with the key's path.
- `pageUrl` goes without its query string, which can hold an email or a
  token. Pass `queryString: true` to keep it.
- `eventId` defaults to a UUIDv4 and `eventTime` to now. Send your order
  number as `eventId` so a retry never counts twice: the server answers
  `duplicate` for an `eventId` it already holds.
- Phones become E.164 before hashing. A local number takes
  `defaultCountry`'s code; one without a `+`, a `00` prefix or a default
  country is left out. Arabic-Indic and Persian digits work, and for EG,
  SA, AE, GB and JO a `0` written after the country code is dropped.
- `phone` sends two hashes of the same E.164 number: `phone_hash` (with the
  `+`, read by Google Ads and TikTok) and `phone_digits_hash` (digits only,
  the form Meta matches). A number with no E.164 form sends neither.
- Pre-hashed keys (`emailHash`, `phoneHash`, `phoneDigitsHash`,
  `firstNameHash`, `lastNameHash`, `streetAddressHash`) take 64 lowercase
  hex characters. Pass both `phoneHash` and `phoneDigitsHash`; `phone`
  beside either is `INVALID_OPTION`.
- `platformEventNames: { tiktok: 'Contact' }` sends Meta or TikTok its own
  name instead of adinize's mapping. Only `meta` and `tiktok` are accepted.
- `trackMany` sends up to 100 events in one request:

```ts
await adinize.trackMany([
  { eventName: 'Lead', eventId: 'lead_1', user: { email: 'a@b.c' } },
  { eventName: 'Purchase', eventId: 'order_2', data: { value: 10, currency: 'EGP' } },
])
```

## App events

Meta takes an event from a mobile app only as an app event, with the
device's details. Set them once; every event then goes out with
`action_source: app` and `app_data`. `user` defaults merge into every event
the same way, so the install id and advertising id are set once too.

```ts
const adinize = new Adinize({
  secretKey: SECRET_KEY,
  defaultCountry: 'EG',
  appData: {
    os: 'ios',
    osVersion: '17.4',
    advertiserTrackingEnabled: attStatus === 'AUTHORIZED',
    attStatus,
    bundleId: 'com.bokra.app',
    appVersion: '3.2.0',
    deviceModel: 'iPhone15,2',
    locale: 'ar_EG',
    timezone: 'Africa/Cairo',
  },
  user: { anonId: installId, madid: idfa, externalId: userId },
})
```

- `os`, `osVersion` and `advertiserTrackingEnabled` are required on an app
  event. The other `appData` fields are optional strings of 1 to 128
  characters: `applicationTrackingEnabled`, `attStatus`, `bundleId`,
  `appVersion`, `appStoreId`, `deviceModel`, `locale`, `timezone`, `carrier`.
- `madid` (the IDFA or GAID), `idfv` and `anonId` (your own install id) go
  raw, never hashed, and only on app events. adinize drops `madid` itself
  when tracking is not authorized.
- A per-event `appData` or `user` overrides the defaults key by key, and
  `null` clears one key. Pass `actionSource: 'website'` on an event to send
  it without the app block, or `actionSource: 'app'` with a full `appData`
  when the config holds none.
- Sources in an Expo app: `expo-application` (bundle id, version),
  `expo-device` (os, version, model), `expo-tracking-transparency` (ATT
  status, IDFA), `expo-localization` (locale, timezone). Generate the
  install id once and persist it.
- TikTok and Google Ads do not receive app events yet; adinize records why.

Every user field in `user` maps to the API's snake_case name. `Hash` and
`Phone` are exported if you need a hash or an E.164 number elsewhere:

```ts
import { Hash, Phone } from 'adinize'

Hash.email(' Jane@Example.com ')      // '8c87b489…'
Phone.toE164('010-0123-4567', 'EG')   // '+201001234567'
```

## Results and errors

Every call returns a `Result` and never throws.

| You get | When |
|---|---|
| `{ ok: true, value: { status: 'accepted' } }` | stored |
| `{ ok: true, value: { status: 'duplicate' } }` | the pixel already held this `eventId` |
| `{ ok: true, value: { status: 'rejected', errors } }` | the server refused this event, with reasons |
| `{ ok: false, error: { status: 401, code: 'INVALID_KEY' } }` | the key is missing, unknown or revoked |
| `{ ok: false, error: { status: 429, retryAfter: 12 } }` | wait 12 seconds, then send the same events again |
| `{ ok: false, error: { code: 'INVALID_OPTION' } }` | a malformed option; nothing was sent |

SDK codes: `MISSING_SECRET_KEY`, `INVALID_OPTION`, `TOO_MANY_EVENTS`,
`QUEUE_FULL`, `TIMEOUT`, `TRANSPORT_ERROR`, `HTTP_ERROR`,
`INVALID_RESPONSE`, `CRASHED`. Server codes: `INVALID_REQUEST`,
`INVALID_KEY`, `PIXEL_INACTIVE`, `RATE_LIMITED`. The error never holds the
secret key, a raw personal field, the request or the response.

`track` and `trackMany` do not retry unless you pass `{ retry: true }`: a
429 waits `Retry-After`; a 5xx, a timeout or a transport error backs off
with jitter; up to 5 attempts total with the same `eventId`. A 400 or 401
is never retried.

## Sending in the background

```ts
const adinize = new Adinize({
  secretKey: SECRET_KEY,
  batcher: { flushIntervalMs: 1_000, maxBatch: 100, maxQueue: 10_000, shutdownMs: 5_000 },
})

adinize.trackAsync('Purchase', { eventId: 'order_10482', data: { value: 129.5, currency: 'EGP' } })
// { ok: true, value: undefined } once queued, never once sent

await adinize.flush()   // send everything queued now and wait for it
await adinize.close()   // one attempt per remaining chunk, within shutdownMs
```

- Sends every `flushIntervalMs` (default 1,000) or at `maxBatch` events
  (default 100, capped at 100). Past `maxQueue` (default 10,000) it refuses
  the newest event with `QUEUE_FULL` and emits telemetry.
- Each chunk uses the retry policy above. A chunk that fails for good is
  dropped with telemetry, never retried from the queue.

### React Native

Wrap the app once; the provider flushes the queue whenever the app leaves
the foreground, since JavaScript timers pause in the background.

```tsx
import { AdinizeProvider, useAdinize } from 'adinize/react-native'

export function App() {
  return (
    <AdinizeProvider client={adinize}>
      <Checkout />
    </AdinizeProvider>
  )
}

function Checkout() {
  const adinize = useAdinize()
  const onPaid = (order: Order) =>
    adinize.trackAsync('Purchase', { eventId: order.id, data: { value: order.total, currency: 'EGP' } })
}
```

## Telemetry

```ts
new Adinize({
  secretKey: SECRET_KEY,
  onTelemetry: (event) => {
    switch (event.type) {
      case 'request:start':   // { eventCount }
      case 'request:stop':    // { eventCount, durationMs, status, errorCode }
      case 'event:rejected':  // { eventId, eventName, field, code, message }
      case 'event:dropped':   // { eventId, eventName, reason }
    }
  },
})
```

Metadata never holds the secret key, a raw personal field or the
request/response. Drop reasons: `queue_full`, `retries_exhausted`,
`rejected_by_server`, `crashed`, `shutdown_timeout`.

## Config

| Option | Default | |
|---|---|---|
| `secretKey` | required | `adzsk_…` |
| `baseUrl` | `https://adinize.ai` | https only, or http for localhost |
| `timeoutMs` | `15000` | per request |
| `defaultCountry` | none | `AE BH EG GB JO KW OM QA SA US` |
| `appData` | none | device details; makes every event an app event |
| `user` | none | user fields merged into every event |
| `fetch` | `globalThis.fetch` | injectable for tests or a custom client |
| `onTelemetry` | none | see above |
| `batcher` | see above | |

## Contract

The API is described by one OpenAPI file:
<https://adinize.ai/api/server/v1/openapi.yaml>.

## License

MIT
