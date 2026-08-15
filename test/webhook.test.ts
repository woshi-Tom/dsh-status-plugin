import { afterEach, describe, expect, it, vi } from 'vitest';
import { postWebhook, type WebhookPayload } from '../src/webhook.js';

const payload: WebhookPayload = {
  event: 'alert',
  active: true,
  reason: 'cpu',
  value: 0.9,
  threshold: 0.8,
  timestamp: '2026-08-14T00:00:00.000Z',
  hostname: 'host',
  pid: 1,
};

describe('postWebhook', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts JSON and reports success on 2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    await expect(postWebhook('https://example.com/hook', payload)).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.com/hook');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(JSON.parse(String(init.body))).toMatchObject({ active: true, reason: 'cpu' });
  });

  it('reports failure on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(postWebhook('https://example.com/hook', payload)).resolves.toBe(false);
  });

  it('reports failure when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(postWebhook('https://example.com/hook', payload)).resolves.toBe(false);
  });

  it('reports failure when the request times out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError')));
    await expect(postWebhook('https://example.com/hook', payload, 10)).resolves.toBe(false);
  });
});
