# Changelog

## 0.1.0 (2026-10-07)

First release. A port of adinize-elixir for React Native and Node.

- `track`, `trackMany` and `trackAsync`, with a background batcher and the
  same retry policy: `Retry-After` on a 429, jittered backoff on a 5xx, a
  timeout or a transport error, up to 5 attempts with the same `eventId`.
- Personal fields leave the device only as SHA-256 hashes; phones become
  E.164 first, verified against the vectors shared with the Elixir SDK.
- App events from the current contract: `actionSource`, `appData` and the
  raw device ids `madid`, `idfv` and `anonId`, set once in the config and
  merged into every event.
- Telemetry through `onTelemetry`; no runtime dependencies; optional React
  Native binding at `adinize/react-native`.
