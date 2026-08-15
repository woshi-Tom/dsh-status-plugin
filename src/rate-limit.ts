/**
 * Minimal per-key token-bucket rate limiter for the status endpoints.
 *
 * The SSE hub already caps concurrent streams; this bounds how fast *new*
 * requests (JSON polls and SSE connects) can arrive from one client so a
 * runaway or hostile peer cannot hammer the handlers. Tokens refill at the
 * configured rate; a bucket that is exhausted rejects until it refills.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; last: number }>();

  /**
   * Create the limiter.
   * @param capacity - burst size and refill-per-minute rate in requests.
   *   Zero or negative disables limiting entirely.
   */
  constructor(private readonly capacity: number) {}

  /**
   * Consume one token for the key, if available.
   * @param key - the client identity (typically the remote address).
   * @param now - clock for tests.
   * @returns false when the bucket is exhausted, true otherwise.
   */
  allow(key: string, now: number = Date.now()): boolean {
    if (this.capacity <= 0) return true;
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, last: now };
    const elapsed = Math.max(0, now - bucket.last);
    bucket.tokens = Math.min(this.capacity, bucket.tokens + (elapsed / 60_000) * this.capacity);
    bucket.last = now;
    if (bucket.tokens < 1) {
      this.buckets.set(key, bucket);
      return false;
    }
    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    return true;
  }

  /** Drop every bucket (plugin teardown). */
  dispose(): void {
    this.buckets.clear();
  }
}
