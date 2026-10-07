import type { DropReason, EventResult, Result, TelemetryEvent, TelemetryListener } from './types.js'

export type Telemetry = {
  rejected(result: EventResult, eventName: string): void
  dropped(eventId: string, eventName: string, reason: DropReason): void
  span<T>(eventCount: number, send: () => Promise<Result<T>>): Promise<Result<T>>
}

export function createTelemetry(listener?: TelemetryListener): Telemetry {
  const emit = (event: TelemetryEvent): void => {
    try {
      listener?.(event)
    } catch {
      return
    }
  }

  return {
    rejected(result, eventName) {
      for (const { field, code, message } of result.errors) {
        emit({ type: 'event:rejected', eventId: result.eventId, eventName, field, code, message })
      }
    },
    dropped(eventId, eventName, reason) {
      emit({ type: 'event:dropped', eventId, eventName, reason })
    },
    async span(eventCount, send) {
      emit({ type: 'request:start', eventCount })
      const started = Date.now()
      const result = await send()
      emit({
        type: 'request:stop',
        eventCount,
        durationMs: Date.now() - started,
        status: result.ok ? 'ok' : 'error',
        errorCode: result.ok ? null : result.error.code,
      })
      return result
    },
  }
}
