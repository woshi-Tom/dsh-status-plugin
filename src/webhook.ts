/**
 * Fire-and-forget webhook delivery for alert transitions.
 *
 * The host must keep monitoring even when the notification channel is down,
 * so failures are swallowed and reported through the logger instead of being
 * thrown into the alert pipeline.
 */

/** Shape pushed to a configured webhook on every alert transition. */
export interface WebhookPayload {
  event: 'alert';
  active: boolean;
  reason: string;
  value: number;
  threshold: number;
  timestamp: string;
  hostname: string;
  pid: number;
}

/**
 * POST a JSON payload to the webhook URL.
 * @param url - destination; a non-http(s) value is rejected by fetch.
 * @param payload - the JSON body.
 * @param timeoutMs - abort the request after this long (default 5 s).
 * @returns true when the endpoint answered 2xx, false otherwise.
 */
export async function postWebhook(url: string, payload: WebhookPayload, timeoutMs = 5_000): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}
