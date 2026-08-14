import type { IncomingMessage } from 'node:http';
import type { StatusPayload, StatusResponse } from './status.js';

/** One SSE subscriber: an open response stream. */
interface Subscriber {
  res: StatusResponse;
  onClose: () => void;
}

/**
 * Server-Sent Events hub: fan-out of typed events to open browser streams.
 * The host keeps no per-subscriber state; a subscriber receives every event
 * broadcast from the moment it connects. Connections are self-registering and
 * self-cleaning: the response's `close` event removes the subscriber.
 */
export class SseHub {
  private readonly subscribers = new Set<Subscriber>();

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
   */
  attach(req: IncomingMessage, res: StatusResponse, snapshot: StatusPayload, initialAlerts: unknown[]): void {
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

  /** Write one event to a single subscriber, dropping it on write failure. */
  private send(subscriber: Subscriber, event: string, payload: unknown): void {
    this.sendRaw(subscriber, `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  }

  private sendRaw(subscriber: Subscriber, frame: string): void {
    subscriber.res.write(frame, (error?: Error | null) => {
      if (error) subscriber.onClose();
    });
  }
}