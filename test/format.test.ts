import { describe, expect, it } from 'vitest'
import { formatBytes, formatPercent, formatUptime } from '../src/client/status.js'

describe('formatBytes', () => {
  it('formats bytes and binary units', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1024)).toBe('1.0 KiB')
    expect(formatBytes(1536)).toBe('1.5 KiB')
    expect(formatBytes(1024 * 1024)).toBe('1.0 MiB')
    expect(formatBytes(1024 ** 3)).toBe('1.0 GiB')
  })
})

describe('formatUptime', () => {
  it('shows seconds under a minute', () => {
    expect(formatUptime(0)).toBe('0s')
    expect(formatUptime(45)).toBe('45s')
    expect(formatUptime(59)).toBe('59s')
  })

  it('shows minutes up to an hour', () => {
    expect(formatUptime(60)).toBe('1m')
    expect(formatUptime(61)).toBe('1m')
    expect(formatUptime(3599)).toBe('59m')
  })

  it('shows hours and minutes beyond', () => {
    expect(formatUptime(3600)).toBe('1h 0m')
    expect(formatUptime(3661)).toBe('1h 1m')
    expect(formatUptime(9000)).toBe('2h 30m')
  })

  it('clamps negative input', () => {
    expect(formatUptime(-5)).toBe('0s')
  })
})

describe('formatPercent', () => {
  it('formats fractions with one decimal', () => {
    expect(formatPercent(0.856)).toBe('85.6%')
    expect(formatPercent(1)).toBe('100.0%')
    expect(formatPercent(0)).toBe('0.0%')
  })
})