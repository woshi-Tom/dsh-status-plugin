import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { isAuthorized, isOriginAllowed } from '../src/auth.js';

/** Build a request with a URL and optional headers. */
function req(url: string, headers: Record<string, string | undefined> = {}): IncomingMessage {
  return { url, headers } as IncomingMessage;
}

describe('isAuthorized', () => {
  it('accepts any request when no token is configured', () => {
    expect(isAuthorized(req('/api/status'), '')).toBe(true);
    expect(isAuthorized(req('/api/status', { authorization: 'nope' }), '')).toBe(true);
  });

  it('accepts a matching Authorization bearer header', () => {
    expect(isAuthorized(req('/api/status', { authorization: 'Bearer secret-token' }), 'secret-token')).toBe(true);
  });

  it('accepts a case-insensitive bearer scheme', () => {
    expect(isAuthorized(req('/api/status', { authorization: 'bearer secret-token' }), 'secret-token')).toBe(true);
  });

  it('accepts a matching token query parameter for SSE', () => {
    expect(isAuthorized(req('/api/status/events?token=secret-token'), 'secret-token')).toBe(true);
  });

  it('rejects a missing token', () => {
    expect(isAuthorized(req('/api/status'), 'secret-token')).toBe(false);
    expect(isAuthorized(req('/api/status/events'), 'secret-token')).toBe(false);
  });

  it('rejects a wrong header token', () => {
    expect(isAuthorized(req('/api/status', { authorization: 'Bearer wrong' }), 'secret-token')).toBe(false);
  });

  it('rejects a wrong query token', () => {
    expect(isAuthorized(req('/api/status/events?token=wrong'), 'secret-token')).toBe(false);
  });

  it('rejects a malformed authorization header without the bearer scheme', () => {
    expect(isAuthorized(req('/api/status', { authorization: 'Basic dXNlcjpwYXNz' }), 'secret-token')).toBe(false);
  });

  it('does not confuse a query token with a header token', () => {
    expect(isAuthorized(req('/api/status?token=secret-token'), 'secret-token')).toBe(true);
    expect(isAuthorized(req('/api/status?token=wrong', { authorization: 'Bearer secret-token' }), 'secret-token')).toBe(true);
  });
});

describe('isOriginAllowed', () => {
  it('accepts everything with an empty allowlist', () => {
    expect(isOriginAllowed(req('/api/status', { origin: 'https://evil.example' }), [])).toBe(true);
    expect(isOriginAllowed(req('/api/status'), [])).toBe(true);
  });

  it('rejects a disallowed origin', () => {
    const allowlist = ['https://dsh.example'];
    expect(isOriginAllowed(req('/api/status', { origin: 'https://evil.example' }), allowlist)).toBe(false);
  });

  it('accepts an allowed origin', () => {
    const allowlist = ['https://dsh.example'];
    expect(isOriginAllowed(req('/api/status', { origin: 'https://dsh.example' }), allowlist)).toBe(true);
  });

  it('accepts header-less clients such as curl even with an allowlist', () => {
    expect(isOriginAllowed(req('/api/status'), ['https://dsh.example'])).toBe(true);
  });

  it('matches origins exactly, not by prefix', () => {
    const allowlist = ['https://dsh.example'];
    expect(isOriginAllowed(req('/api/status', { origin: 'https://dsh.example.evil' }), allowlist)).toBe(false);
  });
});