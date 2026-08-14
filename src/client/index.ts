import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { StatusBadge, type StatusBadgeInjected } from './StatusBadge.tsx'
import type { StatusEvent, StatusPayload } from './status.ts'
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

/** Contribute the status badge to the session header utilities seat. */
export function apply(ctx: ClientContext): void {
  const style = document.createElement('style')
  style.dataset.owner = 'dsh-status'
  style.textContent = cssText
  document.head.appendChild(style)
  ctx.effect(() => () => style.remove(), 'dsh-status: stylesheet')

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-status: dictionaries')

  const t = ctx.locale.bind(NS)
  const statusUrl = '/api/status'
  const eventsUrl = '/api/status/events'

  const fetchStatus = async (): Promise<StatusPayload> => {
    const response = await fetch(statusUrl, { cache: 'no-store' })
    if (!response.ok) throw new Error(`status fetch failed: ${response.status}`)
    return await response.json() as StatusPayload
  }

  const subscribe = (onEvent: (event: StatusEvent) => void): (() => void) => {
    const source = new EventSource(eventsUrl)
    source.addEventListener('snapshot', (event) => {
      onEvent({ type: 'snapshot', payload: JSON.parse((event as MessageEvent).data) })
    })
    source.addEventListener('alert', (event) => {
      onEvent({ type: 'alert', payload: JSON.parse((event as MessageEvent).data) })
    })
    return () => source.close()
  }

  const injected = (): StatusBadgeInjected => ({ fetchStatus, subscribe })

  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'dsh-status',
    order: 100,
    locale: NS,
    inject: injected,
  }, StatusBadge))
}