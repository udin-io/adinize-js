import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { sha256Hex } from '../src/sha256.js'

const reference = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

describe('sha256Hex', () => {
  it('matches the NIST vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
  })

  it('matches node:crypto across block boundaries and unicode', () => {
    const samples = ['a', '정', 'Valéry', '😀'.repeat(20), '١٢٣', ...[55, 56, 63, 64, 65, 119, 120, 1000].map((n) => 'x'.repeat(n))]
    for (const sample of samples) expect(sha256Hex(sample)).toBe(reference(sample))
  })
})
