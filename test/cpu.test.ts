import { describe, expect, it } from 'vitest'
import { computeCpuPercent, cpuUtilization, type CpuSnapshot, type CpuTimes } from '../src/cpu.js'

function times(user = 0, nice = 0, sys = 0, idle = 0, irq = 0): CpuTimes {
  return { user, nice, sys, idle, irq }
}

function snapshots(...cores: CpuTimes[]): CpuSnapshot {
  return cores.map(times => ({ times }))
}

describe('computeCpuPercent', () => {
  it('returns 0 when nothing changed', () => {
    const a = snapshots(times(100, 0, 20, 800, 0))
    expect(computeCpuPercent(a, a)).toBe(0)
  })

  it('returns 100 when all added time is busy', () => {
    const a = snapshots(times(100, 0, 20, 800, 0))
    const b = snapshots(times(300, 0, 120, 800, 0))
    expect(computeCpuPercent(a, b)).toBe(100)
  })

  it('returns 50 when busy and idle grow equally', () => {
    const a = snapshots(times(100, 0, 20, 800, 0))
    const b = snapshots(times(200, 0, 20, 900, 0))
    expect(computeCpuPercent(a, b)).toBe(50)
  })

  it('clamps negative deltas from counter rollover', () => {
    const a = snapshots(times(100, 0, 20, 800, 0))
    const b = snapshots(times(10, 0, 80, 700, 0))
    expect(computeCpuPercent(a, b)).toBe(100)
  })

  it('ignores cores present in only one snapshot', () => {
    const a = snapshots(times(100, 0, 20, 800, 0), times(50, 0, 10, 900, 0))
    const b = snapshots(times(200, 0, 20, 800, 0))
    expect(computeCpuPercent(a, b)).toBe(100)
  })

  it('returns 0 for empty snapshots', () => {
    expect(computeCpuPercent([], [])).toBe(0)
  })
})

describe('cpuUtilization', () => {
  it('returns a percentage in [0, 100]', () => {
    const percent = cpuUtilization()
    expect(percent).toBeGreaterThanOrEqual(0)
    expect(percent).toBeLessThanOrEqual(100)
  })
})