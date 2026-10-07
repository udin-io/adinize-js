import type { Country } from './types.js'

type CountryEntry = { code: string; trunk: string | null }

const COUNTRIES: Record<Country, CountryEntry> = {
  AE: { code: '971', trunk: '0' },
  BH: { code: '973', trunk: null },
  EG: { code: '20', trunk: '0' },
  GB: { code: '44', trunk: '0' },
  JO: { code: '962', trunk: '0' },
  KW: { code: '965', trunk: null },
  OM: { code: '968', trunk: null },
  QA: { code: '974', trunk: null },
  SA: { code: '966', trunk: '0' },
  US: { code: '1', trunk: '1' },
}

const TRUNK_ZERO_CODES = Object.values(COUNTRIES)
  .filter((entry) => entry.trunk === '0')
  .map((entry) => entry.code)

export const countries: readonly Country[] = (Object.keys(COUNTRIES) as Country[]).sort()

const lookup = (country: string): CountryEntry | undefined => {
  const key = country.toUpperCase()
  return Object.hasOwn(COUNTRIES, key) ? COUNTRIES[key as Country] : undefined
}

export const isCountry = (value: unknown): value is Country => typeof value === 'string' && lookup(value) !== undefined

export const countryCode = (country: string): string | null => lookup(country)?.code ?? null

const asciiDigits = (value: string): string =>
  value.replace(/[٠-٩۰-۹]/g, (digit) => String(digit.charCodeAt(0) & 0xf))

const valid = (digits: string): string | null =>
  digits.length >= 7 && digits.length <= 15 && !digits.startsWith('0') ? `+${digits}` : null

const international = (digits: string): string | null => {
  const code = TRUNK_ZERO_CODES.find((candidate) => digits.startsWith(`${candidate}0`))
  return valid(code === undefined ? digits : code + digits.slice(code.length + 1))
}

const dropTrunk = (digits: string, trunk: string | null): string =>
  trunk !== null && digits.startsWith(trunk) ? digits.slice(trunk.length) : digits

const local = (digits: string, country: string | null): string | null => {
  if (country === null || digits === '') return null
  const entry = lookup(country)
  if (entry === undefined) return null
  if (entry.trunk === '0' && digits.startsWith(entry.code)) return international(digits)
  return valid(entry.code + dropTrunk(digits, entry.trunk))
}

export function toE164(value: string | null | undefined, defaultCountry: string | null = null): string | null {
  if (typeof value !== 'string') return null
  const number = asciiDigits(value)
    .replace(/＋/g, '+')
    .split(/ext\.?|x|#|;/i)[0]
    .replace(/\(\s*0\s*\)/g, '')
  const digits = number.replace(/\D/g, '')
  if (/^[^0-9]*\+/.test(number)) return international(digits)
  if (digits.startsWith('00')) return international(digits.slice(2))
  return local(digits, defaultCountry)
}
