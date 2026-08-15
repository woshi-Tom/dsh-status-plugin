import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Mutable fake histogram the mocked `node:perf_hooks` returns. */
const histogram = vi.hoisted(() => ({
  mean: 0,
  reset: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
}))

vi.mock('node:perf_hooks', () => ({
  monitorEventLoopDelay: () => histogram,
}))

let el: typeof import('../src/event-loop.js')

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
  histogram.mean = 0
  histogram.reset.mockClear()
  histogram.enable.mockClear()
  // Re-instantiate the module so its window start uses the fake clock.
  vi.resetModules()
  el = await import('../src/event-loop.js')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('eventLoopDelayMs', () => {
  it('returns 0 before the first window elapses', () => {
    expect(el.eventLoopDelayMs()).toBe(0)
    expect(histogram.reset).not.toHaveBeenCalled()
  })

  it('converts the histogram mean from nanoseconds to milliseconds', () => {
    histogram.mean = 5_000_000 // 5 ms expressed in ns
    vi.advanceTimersByTime(5_000)
    expect(el.eventLoopDelayMs()).toBe(5)
    expect(histogram.reset).toHaveBeenCalledTimes(1)
  })

  it('caches the window value for every caller in the same window', () => {
    histogram.mean = 5_000_000
    vi.advanceTimersByTime(5_000)
    expect(el.eventLoopDelayMs()).toBe(5)
    histogram.mean = 9_000_000
    // Same window: the cached mean is returned, no second reset.
    expect(el.eventLoopDelayMs()).toBe(5)
    expect(histogram.reset).toHaveBeenCalledTimes(1)
    // Next window recomputes.
    vi.advanceTimersByTime(5_000)
    expect(el.eventLoopDelayMs()).toBe(9)
    expect(histogram.reset).toHaveBeenCalledTimes(2)
  })

  it('reports 0 when the histogram has no samples (NaN mean)', () => {
    histogram.mean = Number.NaN
    vi.advanceTimersByTime(5_000)
    expect(el.eventLoopDelayMs()).toBe(0)
    expect(histogram.reset).toHaveBeenCalledTimes(1)
  })
})
