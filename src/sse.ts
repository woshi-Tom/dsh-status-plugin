import type { IncomingMessage } from 'node:http';
import type { StatusPayload, StatusResponse } from './status.js';

/** One SSE subscriber: an open response stream. */
interface Subscriber {
  res: StatusResponse;
  onClose: () => void;
}

/** Default maximum concurrent SSE streams (configurable by the caller). */
export const DEFAULT_MAX_SUBSCRIBERS = 32;
/**
 * Write-buffer high-water mark (bytes). When a stream's buffered-but-unsent
 * bytes exceed this, the subscriber is dropped: an SSE consumer that cannot
 * keep up must not pin the host's memory forever.
 */
export const DEFAULT_MAX_BUFFERED_BYTES = 64 * 1024;

/**
 * Server-Sent Events hub: fan-out of typed events to open browser streams.
 * The host keeps no per-subscriber state; a subscriber receives every event
 * broadcast from the moment it connects. Connections are self-registering and
 * self-cleaning: the response's `close` event removes the subscriber.
 *
 * Hardening:
 * - a configurable subscriber cap: the hub answers `attach()` with an error
 *   once the cap is reached, so one runaway client cannot fan out forever;
 * - a configurable write-buffer high-water mark: a subscriber whose kernel
 *   buffer cannot drain (backpressure) is dropped instead of accumulating an
 *   unbounded in-memory queue;
 * - `dispose()` closes every open stream, so plugin teardown never leaks
 *   lingering sockets.
 */
export class SseHub {
  private readonly subscribers = new Set<Subscriber>();

  /**
   * Create the hub.
   * @param maxSubscribers - greatest number of concurrent streams accepted.
   * @param maxBufferedBytes - per-stream write-buffer cap before dropping.
   */
  constructor(
    private readonly maxSubscribers: number = DEFAULT_MAX_SUBSCRIBERS,
    private readonly maxBufferedBytes: number = DEFAULT_MAX_BUFFERED_BYTES,
  ) {}

  /** Total open subscriber streams. */
  get size(): number {
    return this.subscribers.size;
  }

  /**
   * Accept one incoming SSE request: write the stream headers, emit the
   * initial frames (snapshot plus any active alert transitions), and hold
   * the response until the client disconnects.
   * @param req - the incoming GET request (used for its close event).
   * @param res - the response that becomes the event stream.
   * @param snapshot - the status snapshot to emit immediately.
   * @param initialAlerts - active threshold-breach events to synchronize.
   * @throws Error when the subscriber cap is already reached.
   */
  attach(req: IncomingMessage, res: StatusResponse, snapshot: StatusPayload, initialAlerts: unknown[]): void {
    if (this.subscribers.size >= this.maxSubscribers) {
      throw new Error(`max SSE subscribers reached (${this.maxSubscribers})`);
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const subscriber: Subscriber = {
      res,
      onClose: () => { this.subscribers.delete(subscriber); },
    };
    this.subscribers.add(subscriber);
    req.on('close', subscriber.onClose);
    this.send(subscriber, 'snapshot', snapshot);
    for (const alert of initialAlerts) this.send(subscriber, 'alert', alert);
  }

  /**
   * Broadcast an event to every open subscriber. Write failures remove the
   * subscriber; the response close handler cleans up the rest.
   * @param event - the SSE event name.
   * @param payload - the JSON payload carried by the event.
   */
  broadcast(event: string, payload: unknown): void {
    const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const subscriber of this.subscribers) {
      this.sendRaw(subscriber, frame);
    }
  }

  /**
   * Close every open subscriber stream. Called on plugin teardown so no
   * socket outlives the plugin that owns it.
   */
  dispose(): void {
    for (const subscriber of this.subscribers) {
      subscriber.res.end('');
      subscriber.onClose();
    }
  }

  /** Write one event to a single subscriber, dropping it on write failure. */
  private send(subscriber: Subscriber, event: string, payload: unknown): void {
    this.sendRaw(subscriber, `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  }

  /** Write a frame, dropping the subscriber when the socket cannot take it. */
  private sendRaw(subscriber: Subscriber, frame: string): void {
    let writeOk = false;
    try {
      writeOk = subscriber.res.write(frame, (error?: Error | null) => {
        if (error) subscriber.onClose();
      });
    } catch {
      subscriber.onClose();
      return;
    }
    if (!writeOk && subscriber.res.writableLength > this.maxBufferedBytes) {
      subscriber.onClose();
    }
  }
}