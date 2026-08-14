import { describe, expect, it } from 'vitest'
import { AlertMonitor, computeSystemUsage, type AlertEvent } from '../src/alerts.js'

const thresholds = { cpu: 0.8, memory: 0.85 }

function run(values: number[]): AlertEvent[] {
  const events: AlertEvent[] = []
  let index = 0
  const monitor = new AlertMonitor(thresholds, 0.1, event => events.push(event), {
    cpu: () => values[index++] ?? 0,
    memory: () => 0,
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
    })
    value = 0.9
    monitor.poll()
    value = 0.8
    monitor.poll()
    value = 0.76
    monitor.poll()
    expect(events.map(event => event.active)).toEqual([true, false])
  })

  it('current() reports active events with the last sampled value', () => {
    const monitor = new AlertMonitor(thresholds, 0.1, () => {}, { cpu: () => 0.9, memory: () => 0.5 })
    monitor.poll()
    expect(monitor.current()).toHaveLength(1)
    expect(monitor.current()[0]).toMatchObject({ active: true, reason: 'cpu', value: 0.9 })
  })

  it('current() is empty when no alert is active', () => {
    const monitor = new AlertMonitor(thresholds, 0.1, () => {}, { cpu: () => 0.1, memory: () => 0.2 })
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