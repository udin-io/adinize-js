import { describe, expect, it } from 'vitest'
import { buildEvent } from '../src/event.js'
import * as Hash from '../src/hash.js'
import { unwrap, unwrapError } from './support.js'

const build = (options: unknown, country: 'EG' | null = 'EG') =>
  buildEvent('Purchase', options, { country, user: null, appData: null })

const APP = { os: 'ios', osVersion: '17.4', advertiserTrackingEnabled: true } as const

describe('buildEvent', () => {
  it('defaults eventId to a UUIDv4 and eventTime to now in seconds', () => {
    const body = unwrap(build({}))
    expect(body.event_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(Math.abs(body.event_time - Date.now() / 1000)).toBeLessThan(2)
    expect(body).not.toHaveProperty('user_data')
    expect(body).not.toHaveProperty('event_data')
  })

  it('sends a Date eventTime as Unix seconds', () => {
    expect(unwrap(build({ eventTime: new Date('2026-10-01T00:00:00Z') })).event_time).toBe(1790812800)
    expect(unwrapError(build({ eventTime: new Date('nope') })).code).toBe('INVALID_OPTION')
    expect(unwrapError(build({ eventTime: 1.5 })).code).toBe('INVALID_OPTION')
  })

  it('hashes email and sends both phone hashes from one E.164 number', () => {
    const body = unwrap(build({ user: { email: ' Jane@Example.com ', phone: '0100 123 4567' } }))
    expect(body.user_data).toEqual({
      email_hash: '8c87b489ce35cf2e2f39f80e282cb2e804932a56a213983eeeb428407d43b52d',
      phone_hash: '9476e557c9e413deae474978709659f5b4f1c6a18553eddff8f042702843d0c7',
      phone_digits_hash: '6993ec5cc979510592725a267129b73cee2e99c29488027fe094dd24a9e1bfb3',
    })
    expect(JSON.stringify(body)).not.toContain('jane')
    expect(JSON.stringify(body)).not.toContain('4567')
  })

  it('leaves out a phone with no E.164 form and a blank name', () => {
    const body = unwrap(build({ user: { phone: '0100 123 4567', firstName: '  ' } }, null))
    expect(body).not.toHaveProperty('user_data')
  })

  it('refuses a raw phone beside a pre-hashed phone key', () => {
    const hash = Hash.phone('+201001234567')
    const error = unwrapError(build({ user: { phone: '0100', phoneHash: hash } }))
    expect(error.message).toContain('phoneHash')
    expect(error.message).not.toContain('0100')
    expect(unwrap(build({ user: { phone: null, phoneHash: hash } })).user_data).toEqual({ phone_hash: hash })
  })

  it('takes pre-hashed keys only as 64 lowercase hex characters', () => {
    const error = unwrapError(build({ user: { emailHash: 'ABC' } }))
    expect(error.message).toBe('user emailHash must be 64 lowercase hex characters')
  })

  it('maps plain fields to their wire names and validates consent', () => {
    const body = unwrap(
      build({ user: { clientIpAddress: '203.0.113.7', postalCode: '11511', ttp: 'ttp1', consent: { marketing: true } } }),
    )
    expect(body.user_data).toEqual({ client_ip_address: '203.0.113.7', postal_code: '11511', ttp: 'ttp1', consent: { marketing: true } })
    expect(unwrapError(build({ user: { consent: { marketing: 'yes' } } })).code).toBe('INVALID_OPTION')
  })

  it('refuses unknown option and user keys without echoing values', () => {
    expect(unwrapError(build({ user: { phoneNumber: '0100' } })).message).toBe('unknown user field: phoneNumber')
    expect(unwrapError(build({ userData: {} })).message).toBe('unknown event option: userData')
    expect(unwrapError(build('nope')).code).toBe('INVALID_OPTION')
    expect(unwrapError(buildEvent('', {}, { country: null, user: null, appData: null })).code).toBe('INVALID_OPTION')
  })

  it('refuses personal keys in data at any depth, naming the path only', () => {
    const cases: Array<[unknown, string]> = [
      [{ email: 'jane@example.com' }, 'data.email'],
      [{ customer: { Phone_Number: '0100' } }, 'data.customer.Phone_Number'],
      [{ items: [{ sku: 'a' }, { firstName: 'Jane' }] }, 'data.items[1].firstName'],
      [{ ' email': 'jane@example.com' }, 'data. email'],
      [{ street_address: '1 Nile St' }, 'data.street_address'],
    ]
    for (const [data, path] of cases) {
      const error = unwrapError(build({ data }))
      expect(error.message).toContain(path)
      expect(error.message).not.toContain('jane')
      expect(error.message).not.toContain('Nile')
    }
  })

  it('lets look-alike data keys and class instances through', () => {
    const data = { value: 1, contents: [{ id: 'a', quantity: 2 }], shipping_name: 'x', at: new Date(0) }
    expect(unwrap(build({ data })).event_data).toBe(data)
  })

  it('drops the query string from pageUrl unless asked, keeping the fragment', () => {
    expect(unwrap(build({ pageUrl: 'https://shop.example.com/thanks?email=a@b.c#top' })).page_url).toBe(
      'https://shop.example.com/thanks#top',
    )
    expect(unwrap(build({ pageUrl: 'https://shop.example.com/thanks?x=1', queryString: true })).page_url).toBe(
      'https://shop.example.com/thanks?x=1',
    )
  })

  it('validates platformEventNames', () => {
    expect(unwrap(build({ platformEventNames: { tiktok: 'Contact' } })).platform_event_names).toEqual({ tiktok: 'Contact' })
    expect(unwrap(build({ platformEventNames: {} }))).not.toHaveProperty('platform_event_names')
    expect(unwrapError(build({ platformEventNames: { google: 'x' } })).message).toContain('google')
    expect(unwrapError(build({ platformEventNames: { meta: '' } })).code).toBe('INVALID_OPTION')
  })
})

describe('buildEvent for app events', () => {
  it('sends action_source app and app_data in snake_case, merging config defaults with the event', () => {
    const defaults = { country: null, user: { anonId: 'inst_9f2', externalId: 'u1' }, appData: { ...APP, bundleId: 'com.bokra.app' } }
    const body = unwrap(
      buildEvent('Purchase', { user: { madid: 'IDFA-1', externalId: null }, appData: { appVersion: '3.2.0', attStatus: 'AUTHORIZED' } }, defaults),
    )
    expect(body.action_source).toBe('app')
    expect(body.app_data).toEqual({
      os: 'ios',
      os_version: '17.4',
      advertiser_tracking_enabled: true,
      att_status: 'AUTHORIZED',
      bundle_id: 'com.bokra.app',
      app_version: '3.2.0',
    })
    expect(body.user_data).toEqual({ anon_id: 'inst_9f2', madid: 'IDFA-1' })
  })

  it('stays a website event without app defaults, and keeps app-only fields off it', () => {
    expect(unwrap(build({}))).not.toHaveProperty('action_source')
    expect(unwrapError(build({ appData: APP })).message).toContain('actionSource')
    expect(unwrapError(build({ user: { madid: 'IDFA-1' } })).message).toContain('app events only')
    const body = unwrap(build({ actionSource: 'app', appData: APP, user: { idfv: 'v1' } }))
    expect(body).toMatchObject({ action_source: 'app', user_data: { idfv: 'v1' } })
  })

  it('lets an event opt back out of app defaults with actionSource website', () => {
    const defaults = { country: null, user: null, appData: APP }
    expect(unwrap(buildEvent('Purchase', { actionSource: 'website' }, defaults))).not.toHaveProperty('app_data')
    expect(unwrapError(buildEvent('Purchase', { actionSource: 'web' }, defaults)).code).toBe('INVALID_OPTION')
  })

  it('validates appData the way the server does, naming the field only', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ osVersion: '17.4', advertiserTrackingEnabled: true }, 'os is required'],
      [{ ...APP, os: 'windows' }, 'os must be one of ios, android'],
      [{ ...APP, osVersion: '' }, 'osVersion must be 1 to 128'],
      [{ ...APP, deviceModel: 'x'.repeat(129) }, 'deviceModel must be 1 to 128'],
      [{ ...APP, advertiserTrackingEnabled: 'yes' }, 'advertiserTrackingEnabled must be a boolean'],
      [{ ...APP, attStatus: 'MAYBE' }, 'attStatus must be one of'],
      [{ ...APP, idfa: 'secret-id' }, 'unknown appData field: idfa'],
    ]
    for (const [appData, message] of cases) {
      const error = unwrapError(build({ actionSource: 'app', appData }))
      expect(error.message).toContain(message)
      expect(error.message).not.toContain('secret-id')
    }
  })
})
