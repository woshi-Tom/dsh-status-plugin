import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/rate-limit.js';

describe('RateLimiter', () => {
  it('allows requests up to the capacity', () => {
    const limiter = new RateLimiter(3);
    expect(limiter.allow('a', 0)).toBe(true);
    expect(limiter.allow('a', 0)).toBe(true);
    expect(limiter.allow('a', 0)).toBe(true);
    expect(limiter.allow('a', 0)).toBe(false);
  });

  it('tracks keys independently', () => {
    const limiter = new RateLimiter(1);
    expect(limiter.allow('a', 0)).toBe(true);
    expect(limiter.allow('a', 0)).toBe(false);
    expect(limiter.allow('b', 0)).toBe(true);
  });

  it('refills tokens over time', () => {
    const limiter = new RateLimiter(2); // 2 tokens/min
    expect(limiter.allow('a', 0)).toBe(true);
    expect(limiter.allow('a', 0)).toBe(true);
    expect(limiter.allow('a', 0)).toBe(false);
    // After 30 s one token has refilled.
    expect(limiter.allow('a', 30_000)).toBe(true);
    expect(limiter.allow('a', 30_000)).toBe(false);
  });

  it('does not accumulate beyond capacity', () => {
    const limiter = new RateLimiter(2);
    expect(limiter.allow('a', 0)).toBe(true);
    expect(limiter.allow('a', 0)).toBe(true);
    expect(limiter.allow('a', 0)).toBe(false);
    // 10 minutes later the bucket refills to exactly 2 tokens, not more.
    expect(limiter.allow('a', 600_000)).toBe(true);
    expect(limiter.allow('a', 600_000)).toBe(true);
    expect(limiter.allow('a', 600_000)).toBe(false);
  });

  it('is disabled by a non-positive capacity', () => {
    const limiter = new RateLimiter(0);
    for (let i = 0; i < 100; i++) expect(limiter.allow('a', 0)).toBe(true);
  });

  it('dispose clears every bucket', () => {
    const limiter = new RateLimiter(1);
    limiter.allow('a', 0);
    limiter.dispose();
    expect(limiter.allow('a', 0)).toBe(true);
  });
});
