# Changelog

## 0.1.0 (2026-10-07)

First release. A port of adinize-elixir for React Native and Node.

- Requires Node 22 or later (Node 20 reached end of life in April 2026).

- `track`, `trackMany` and `trackAsync`, with a background batcher and the
  same retry policy: `Retry-After` on a 429, jittered backoff on a 5xx, a
  timeout or a transport error, up to 5 attempts with the same `eventId`.
- Email, phone, names and street address leave only as SHA-256 hashes;
  phones become E.164 first, verified against the vectors shared with the
  Elixir SDK. The other user fields go as given, as the contract expects.
- A 429 whose `Retry-After` is over 60 seconds is returned, not waited out,
  and every 429 wait carries up to 1 s of jitter.
- `baseUrl` takes https with no user, query or fragment (http for
  localhost); an answer that came from a redirect is `HTTP_ERROR`.
- `pageUrl` drops its user and password, and its query string and fragment
  unless `queryString: true`.
- App events from the current contract: `actionSource`, `appData` and the
  raw device ids `madid`, `idfv` and `anonId`, set once in the config and
  merged into every event.
- Telemetry through `onTelemetry`; no runtime dependencies; optional React
  Native binding at `adinize/react-native`.
