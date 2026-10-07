import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..')

describe('the build script', () => {
  it('removes a stale file from dist, so a deleted source never ships', () => {
    const stale = join(root, 'dist', 'deleted-module.js')
    mkdirSync(join(root, 'dist'), { recursive: true })
    writeFileSync(stale, 'module.exports = {}\n')
    const { scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const PATH = `${join(root, 'node_modules', '.bin')}${delimiter}${process.env.PATH ?? ''}`
    execSync(scripts.build, { cwd: root, stdio: 'pipe', env: { ...process.env, PATH } })
    expect(existsSync(stale)).toBe(false)
    expect(existsSync(join(root, 'dist', 'index.js'))).toBe(true)
  }, 60_000)
})
