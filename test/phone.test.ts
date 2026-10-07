import { describe, expect, it } from 'vitest'
import * as Hash from '../src/hash.js'
import * as Phone from '../src/phone.js'
import vectors from './phone_vectors.json'

describe('Phone.toE164 and the phone hashes', () => {
  for (const row of vectors) {
    it(`${row.note}: ${JSON.stringify(row.input)} with ${row.default_country}`, () => {
      expect(Phone.toE164(row.input, row.default_country)).toBe(row.e164)
      expect(Hash.phone(row.input, row.default_country)).toBe(row.sha256)
      expect(Hash.phoneDigits(row.input, row.default_country)).toBe(row.digits_sha256)
    })
  }

  it('the US row equals the hash Meta documents', () => {
    expect(Hash.phoneDigits('(650) 555-1212', 'US')).toBe('e323ec626319ca94ee8bff2e4c87cf613be6ea19919ed1364124e16807ab3176')
  })

  it('an unknown default country is never a guess', () => {
    expect(Phone.countryCode('ZZ')).toBeNull()
    expect(Phone.countryCode('eg')).toBe('20')
    expect(Phone.isCountry('constructor')).toBe(false)
    expect(Phone.countries).toEqual(['AE', 'BH', 'EG', 'GB', 'JO', 'KW', 'OM', 'QA', 'SA', 'US'])
  })

  it('non-string input has no E.164 form', () => {
    expect(Phone.toE164(null, 'EG')).toBeNull()
    expect(Phone.toE164(undefined)).toBeNull()
  })
})

describe('Hash', () => {
  it("matches Meta's email example and trims and lowercases", () => {
    expect(Hash.email('John_Smith@gmail.com')).toBe('62a14e44f765419d10fea99367361a727c12365e2520f32218d505ed9aa0f62f')
    expect(Hash.email(' Jane@Example.com ')).toBe('8c87b489ce35cf2e2f39f80e282cb2e804932a56a213983eeeb428407d43b52d')
  })

  it("matches Meta's name examples with UTF-8 kept", () => {
    expect(Hash.name('Mary')).toBe('6915771be1c5aa0c886870b6951b03d7eafc121fea0e80a5ea83beb7c449f4ec')
    expect(Hash.name('정')).toBe('8fa8cd9c440be61d0151429310034083132b35975c4bea67fdd74158eb51db14')
    expect(Hash.name('Valéry')).toBe('08e1996b5dd49e62a4b4c010d44e4345592a863bb9f8e3976219bac29417149c')
  })

  it('a street address is trimmed and lowercased', () => {
    expect(Hash.streetAddress(' 1 Nile St ')).toBe(Hash.streetAddress('1 nile st'))
  })

  it('blank or missing input hashes to null', () => {
    expect(Hash.email('   ')).toBeNull()
    expect(Hash.email(null)).toBeNull()
    expect(Hash.name('')).toBeNull()
    expect(Hash.phoneDigits(undefined)).toBeNull()
  })
})
