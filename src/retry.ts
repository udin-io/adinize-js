import type { AdinizeError, Result } from './types.js'

const MAX_ATTEMPTS = 5
const BASE_MS = 200
const CAP_MS = 10_000

export const isRetryable = ({ status, code }: AdinizeError): boolean => {
  if (status !== null) return status === 429 || status >= 500
  return code === 'TIMEOUT' || code === 'TRANSPORT_ERROR'
}

const delayMs = (error: AdinizeError, attempt: number): number => {
  if (error.status === 429 && error.retryAfter !== null) return error.retryAfter * 1000
  const ceiling = Math.min(CAP_MS, BASE_MS * 2 ** (attempt - 1))
  return 1 + Math.floor(Math.random() * ceiling)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export async function withRetry<T>(
  send: () => Promise<Result<T>>,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<Result<T>> {
  for (let attempt = 1; ; attempt++) {
    const result = await send()
    if (result.ok || attempt >= MAX_ATTEMPTS || !isRetryable(result.error)) return result
    await wait(delayMs(result.error, attempt))
  }
}
