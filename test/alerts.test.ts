import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>()
  return { ...original, totalmem: vi.fn(original.totalmem), freemem: vi.fn(original.freemem) }
})
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>()
  return { ...original, readFileSync: vi.fn(original.readFileSync) }
})

const os = await import('node:os')
const fs = await import('node:fs')

import { AlertMonitor, computeSystemUsage, systemMemoryUsage, type AlertEvent } from '../src/alerts.js'

const thresholds = { cpu: 0.8, memory: 0.85, eventLoop: 100 }

function run(values: number[]): AlertEvent[] {
  const events: AlertEvent[] = []
  let index = 0
  const monitor = new AlertMonitor(thresholds, 0.1, event => events.push(event), {
    cpu: () => values[index++] ?? 0,
    memory: () => 0,
    eventLoop: () => 0,
  })
  for (const _ of values) monitor.poll()
  return events
}

describe('AlertMonitor hysteresis', () => {
  it('enters above the threshold', () => {
    const events = run([0.5, 0.9])
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ active: true, reason: 'cpu', value: 0.9, threshold: 0.8 })
  })

  it('stays active inside the hysteresis band', () => {
    const events = run([0.9, 0.75])
    expect(events).toHaveLength(1)
  })

  it('recovers only below the hysteresis band', () => {
    const events = run([0.9, 0.7])
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ active: false, reason: 'cpu', value: 0.7 })
  })

  it('re-enters after a recovery', () => {
    const events = run([0.9, 0.7, 0.9])
    expect(events).toHaveLength(3)
    expect(events[2]).toMatchObject({ active: true })
  })

  it('emits nothing while unchanged', () => {
    expect(run([0.5, 0.5, 0.6])).toHaveLength(0)
    expect(run([0.9, 0.9, 0.75])).toHaveLength(1)
  })

  it('applies the band to memory too', () => {
    const events: AlertEvent[] = []
    let value = 0
    const monitor = new AlertMonitor(thresholds, 0.1, event => events.push(event), {
      cpu: () => 0,
      memory: () => value,
      eventLoop: () => 0,
    })
    value = 0.9
    monitor.poll()
    value = 0.8
    monitor.poll()
    value = 0.76
    monitor.poll()
    expect(events.map(event => event.active)).toEqual([true, false])
  })

  it('alerts on event-loop delay and recovers below the band', () => {
    const events: AlertEvent[] = []
    let delay = 0
    const monitor = new AlertMonitor(thresholds, 0.1, event => events.push(event), {
      cpu: () => 0,
      memory: () => 0,
      eventLoop: () => delay,
    })
    delay = 250
    monitor.poll()
    delay = 120
    monitor.poll()
    delay = 80
    monitor.poll()
    expect(events.map(event => event.active)).toEqual([true, false])
  })

  it('current() reports active events with the last sampled value', () => {
    const monitor = new AlertMonitor(thresholds, 0.1, () => {}, { cpu: () => 0.9, memory: () => 0.5, eventLoop: () => 0 })
    monitor.poll()
    expect(monitor.current()).toHaveLength(1)
    expect(monitor.current()[0]).toMatchObject({ active: true, reason: 'cpu', value: 0.9 })
  })

  it('current() is empty when no alert is active', () => {
    const monitor = new AlertMonitor(thresholds, 0.1, () => {}, { cpu: () => 0.1, memory: () => 0.2, eventLoop: () => 0 })
    monitor.poll()
    expect(monitor.current()).toEqual([])
  })
})

describe('computeSystemUsage', () => {
  it('is the share of used memory', () => {
    expect(computeSystemUsage(16, 4)).toBe(0.75)
  })

  it('guards a zero total', () => {
    expect(computeSystemUsage(0, 0)).toBe(0)
  })
})

describe('systemMemoryUsage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('reads MemAvailable on Linux instead of freemem', () => {
    vi.stubGlobal('process', { ...process, platform: 'linux' })
    ;(os.totalmem as Mock).mockReturnValue(16 * 1024 ** 3)
    ;(fs.readFileSync as Mock).mockReturnValue(
      'MemTotal:       16777216 kB\nMemAvailable:    4194304 kB\n',
    )
    // 12 GB used of 16 GB -> 0.75
    expect(systemMemoryUsage()).toBeCloseTo(0.75, 5)
  })

  it('falls back to freemem when meminfo is unreadable', () => {
    vi.stubGlobal('process', { ...process, platform: 'linux' })
    ;(os.totalmem as Mock).mockReturnValue(16 * 1024 ** 3)
    ;(os.freemem as Mock).mockReturnValue(4 * 1024 ** 3)
    ;(fs.readFileSync as Mock).mockImplementation(() => { throw new Error('EACCES') })
    expect(systemMemoryUsage()).toBeCloseTo(0.75, 5)
  })
})
