import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>()
  return { ...original, homedir: vi.fn(original.homedir) }
})

const os = await import('node:os')

import { detectApiKey, detectApiKeyUncached, lineLooksLikeApiKey, resetApiKeyCache } from '../src/status.js'

describe('lineLooksLikeApiKey', () => {
  it('accepts plain, exported, quoted, and unquoted assignments', () => {
    expect(lineLooksLikeApiKey('DEEPSEEK_API_KEY=sk-abc123')).toBe(true)
    expect(lineLooksLikeApiKey('export DEEPSEEK_API_KEY=sk-abc123')).toBe(true)
    expect(lineLooksLikeApiKey('DEEPSEEK_API_KEY="sk-abc123"')).toBe(true)
    expect(lineLooksLikeApiKey("DEEPSEEK_API_KEY='sk-abc123'")).toBe(true)
    expect(lineLooksLikeApiKey('  DEEPSEEK_API_KEY=sk-abc123')).toBe(true)
    expect(lineLooksLikeApiKey('DEEPSEEK_API_KEY= sk-abc123')).toBe(true)
  })

  it('rejects empty and missing values', () => {
    expect(lineLooksLikeApiKey('DEEPSEEK_API_KEY=')).toBe(false)
    expect(lineLooksLikeApiKey('DEEPSEEK_API_KEY=""')).toBe(false)
    expect(lineLooksLikeApiKey("DEEPSEEK_API_KEY=''")).toBe(false)
    expect(lineLooksLikeApiKey('DEEPSEEK_API_KEY=   ')).toBe(false)
    expect(lineLooksLikeApiKey('DEEPSEEK_API_KEY')).toBe(false)
    expect(lineLooksLikeApiKey('# DEEPSEEK_API_KEY=sk-abc123')).toBe(false)
    expect(lineLooksLikeApiKey('OTHER_KEY=value')).toBe(false)
  })
})

describe('detectApiKey', () => {
  const ENV_KEY = 'DEEPSEEK_API_KEY'

  afterEach(() => {
    delete process.env[ENV_KEY]
    delete process.env.DSH_HOME
    resetApiKeyCache()
    vi.clearAllMocks()
  })

  it('reports env when the key is set in the process environment', () => {
    process.env[ENV_KEY] = 'sk-env'
    expect(detectApiKey()).toEqual({ configured: true, source: 'env' })
  })

  it('caches the result within the TTL', () => {
    process.env[ENV_KEY] = 'sk-env'
    expect(detectApiKey()).toEqual({ configured: true, source: 'env' })
    delete process.env[ENV_KEY]
    // Cached: still reports configured until the cache is reset.
    expect(detectApiKey()).toEqual({ configured: true, source: 'env' })
    resetApiKeyCache()
    expect(detectApiKey()).toEqual({ configured: false, source: null })
  })

  it('does not read ~/.env: only cwd/.env and $DSH_HOME/.env count', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-status-home-'))
    const dshHome = mkdtempSync(join(tmpdir(), 'dsh-status-dsh-'))
    writeFileSync(join(home, '.env'), 'DEEPSEEK_API_KEY=sk-home\n')
    try {
      ;(os.homedir as Mock).mockReturnValue(home)
      process.env.DSH_HOME = dshHome
      // The key in ~/.env must NOT count (dsh never loads that layer).
      expect(detectApiKeyUncached()).toEqual({ configured: false, source: null })
      writeFileSync(join(dshHome, '.env'), 'DEEPSEEK_API_KEY=sk-dsh\n')
      expect(detectApiKeyUncached()).toEqual({ configured: true, source: 'file' })
    } finally {
      rmSync(home, { recursive: true, force: true })
      rmSync(dshHome, { recursive: true, force: true })
    }
  })
})
