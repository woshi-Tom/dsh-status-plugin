import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/** Header name carrying the bearer token on JSON requests. */
export const AUTH_HEADER = 'authorization';
/** Prefix of the Authorization header value (case-insensitive per RFC 7235). */
export const BEARER_PREFIX = 'Bearer ';

/**
 * Constant-time token comparison. Length is not a secret, so the differing
 * lengths are padded to the longer operand before `timingSafeEqual`.
 */
function safeEqual(a: string, b: string): boolean {
  const max = Math.max(a.length, b.length);
  const pa = Buffer.alloc(max);
  const pb = Buffer.alloc(max);
  pa.write(a);
  pb.write(b);
  return timingSafeEqual(pa, pb);
}

/**
 * True when the request carries the expected token, either as an
 * `Authorization: Bearer <token>` header (JSON endpoints) or as a `?token=`
 * query parameter (SSE, where EventSource cannot set request headers).
 * An empty configured token disables authentication entirely.
 * @param req - the incoming request to inspect.
 * @param expected - the configured token; empty means "no authentication".
 */
export function isAuthorized(req: IncomingMessage, expected: string): boolean {
  if (expected === '') return true;
  const header = req.headers[AUTH_HEADER];
  if (typeof header === 'string') {
    if (header.toLowerCase().startsWith(BEARER_PREFIX.toLowerCase())
      && safeEqual(header.slice(BEARER_PREFIX.length), expected)) {
      return true;
    }
  }
  const query = new URL(req.url ?? '/', 'http://x').searchParams;
  const token = query.get('token');
  return token !== null && safeEqual(token, expected);
}