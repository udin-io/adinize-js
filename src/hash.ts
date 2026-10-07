import { sha256Hex } from './sha256.js'
import { toE164 } from './phone.js'

type Text = string | null | undefined

export const sha256 = (value: Text): string | null => (value ? sha256Hex(value) : null)

const text = (value: Text): string | null => (typeof value === 'string' ? value.trim().toLowerCase() : null)

export const email = (value: Text): string | null => sha256(text(value))

export const name = (value: Text): string | null => sha256(text(value))

export const streetAddress = (value: Text): string | null => sha256(text(value))

export const phone = (value: Text, defaultCountry: string | null = null): string | null =>
  sha256(toE164(value, defaultCountry))

export const phoneDigits = (value: Text, defaultCountry: string | null = null): string | null =>
  sha256(toE164(value, defaultCountry)?.slice(1))
