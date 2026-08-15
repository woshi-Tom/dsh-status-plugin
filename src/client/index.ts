import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { StatusBadge, type StatusBadgeInjected } from './StatusBadge.tsx'
import type { AlertEvent, StatusEvent, StatusPayload } from './status.ts'
import { en, zh, type StatusLocaleKey } from './locales.ts'
import cssText from './status.css?raw'

export type { StatusBadgeInjected, StatusBadgeProps } from './StatusBadge.tsx'
export type { StatusLocaleKey } from './locales.ts'
export type { StatusPayload, StatusEvent } from './status.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-status badge and panel copy. */
    'dsh-status': StatusLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'dsh-status'

/** Services required by the header registration. */
export const inject = ['slots', 'locale']

/** Reconnect delay bounds for the SSE client (exponential backoff). */
const MIN_RETRY_MS = 1_000
const MAX_RETRY_MS = 30_000

/** Build a minimal SSE client over fetch + ReadableStream. */
export function createSseClient(
  url: string,
  headers: Record<string, string>,
  onEvent: (event: StatusEvent) => void,
  onConnectionChange: (connected: boolean) => void,
): () => void {
  let closed = false
  let retryMs = MIN_RETRY_MS
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let controller: AbortController | null = null

  const parseEvent = (raw: string): unknown => {
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }

  const handleFrame = (frame: string): void => {
    let eventName = 'message'
    const dataLines: string[] = []
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
      else if (line.startsWith('retry:')) {
        const ms = Number(line.slice(6).trim())
        if (Number.isFinite(ms) && ms > 0) retryMs = ms
      }
    }
    if (dataLines.length === 0) return
    const payload = parseEvent(dataLines.join('\n'))
    if (payload === null) return
    if (eventName === 'snapshot') onEvent({ type: 'snapshot', payload: payload as StatusPayload })
    else if (eventName === 'alert') onEvent({ type: 'alert', payload: payload as AlertEvent })
  }

  const scheduleReconnect = (): void => {
    onConnectionChange(false)
    if (closed) return
    retryTimer = setTimeout(() => { void connect() }, retryMs)
    retryMs = Math.min(retryMs * 2, MAX_RETRY_MS)
  }

  const connect = async (): Promise<void> => {
    if (closed) return
    controller = new AbortController()
    let response: Response
    try {
      response = await fetch(url, { headers, cache: 'no-store', signal: controller.signal })
      if (!response.ok) throw new Error(`SSE connect failed: ${response.status}`)
      if (response.body === null) throw new Error('SSE response has no body')
    } catch {
      scheduleReconnect()
      return
    }
    onConnectionChange(true)
    retryMs = MIN_RETRY_MS
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (!closed) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let boundary = buffer.indexOf('\n\n')
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          handleFrame(frame)
          boundary = buffer.indexOf('\n\n')
        }
      }
    } catch {
      // stream error: fall through to reconnect
    }
    if (!closed) scheduleReconnect()
  }

  void connect()
  return () => {
    closed = true
    controller?.abort()
    if (retryTimer !== null) clearTimeout(retryTimer)
  }
}

/** Contribute the status badge to the session header utilities seat. */
export function apply(ctx: ClientContext): void {
  const style = document.createElement('style')
  style.dataset.owner = 'dsh-status'
  style.textContent = cssText
  document.head.appendChild(style)
  ctx.effect(() => () => style.remove(), 'dsh-status: stylesheet')

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-status: dictionaries')

  const statusUrl = '/api/status'
  const eventsUrl = '/api/status/events'

  const fetchStatus = async (): Promise<StatusPayload> => {
    const response = await fetch(statusUrl, { cache: 'no-store' })
    if (!response.ok) throw new Error(`status fetch failed: ${response.status}`)
    return await response.json() as StatusPayload
  }

  const subscribe = (
    onEvent: (event: StatusEvent) => void,
    onConnectionChange: (connected: boolean) => void,
    headers: Record<string, string> = {},
  ): (() => void) => createSseClient(eventsUrl, headers, onEvent, onConnectionChange)

  const injected = (): StatusBadgeInjected => ({ fetchStatus, subscribe })

  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'dsh-status',
    order: 100,
    locale: NS,
    inject: injected,
  }, StatusBadge))
}
