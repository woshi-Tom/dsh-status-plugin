import { describe, expect, it } from 'vitest'
import { lineLooksLikeApiKey } from '../src/status.js'

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