import { useEffect, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { StatusLocaleKey } from './locales.ts'
import type { RuntimeSettings } from './settings.ts'
import css from './status.css'

/** Registration-side face: the bound settings scope for the `dsh-status` namespace. */
export interface StatusSettingsInjected {
  /** Durable settings scope whose writes the host applies live. */
  settingsScope: SettingsScope<RuntimeSettings>
}

/** Full component props assembled by the settings-section slot renderer. */
export type StatusSettingsProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'dsh-status'>
  & InjectFace<StatusSettingsInjected>

/** One editable field: metadata mirrors the host schema's field. */
interface FieldMeta {
  key: keyof RuntimeSettings
  label: StatusLocaleKey
  kind: 'number' | 'boolean'
  /** Inclusive lower bound; the host schema rejects below it. */
  min?: number
  /** Inclusive upper bound; the host schema rejects above it. */
  max?: number
  /** Input step (and the value the UI nudges by). */
  step?: number
  /** Suffix rendered next to the input (e.g. 'ms'); not localized (universal). */
  unit?: string
}

/** Editable fields, in display order. */
const FIELDS: FieldMeta[] = [
  { key: 'cpuWarning', label: 'settingCpuWarning', kind: 'number', min: 0, max: 1, step: 0.05 },
  { key: 'memoryWarning', label: 'settingMemoryWarning', kind: 'number', min: 0, max: 1, step: 0.05 },
  { key: 'diskWarning', label: 'settingDiskWarning', kind: 'number', min: 0, max: 1, step: 0.05 },
  { key: 'eventLoopWarning', label: 'settingEventLoopWarning', kind: 'number', min: 0, step: 5, unit: 'ms' },
  { key: 'hysteresis', label: 'settingHysteresis', kind: 'number', min: 0, max: 0.5, step: 0.05 },
  { key: 'heartbeatMs', label: 'settingHeartbeatMs', kind: 'number', min: 1000, step: 1000, unit: 'ms' },
  { key: 'checkIntervalMs', label: 'settingCheckIntervalMs', kind: 'number', min: 1000, step: 1000, unit: 'ms' },
  { key: 'rateLimitPerMinute', label: 'settingRateLimitPerMinute', kind: 'number', min: 0, step: 50 },
  { key: 'exposeLanAddresses', label: 'settingExposeLanAddresses', kind: 'boolean' },
]

/** Clamp a raw number into the field's schema bounds. */
function clamp(field: FieldMeta, value: number): number {
  const min = field.min ?? Number.NEGATIVE_INFINITY
  const max = field.max ?? Number.POSITIVE_INFINITY
  return Math.min(max, Math.max(min, value))
}

/** The current value of one field, or undefined before the first snapshot. */
function fieldValue(snapshot: SettingsScopeSnapshot<RuntimeSettings>, field: FieldMeta): unknown {
  return snapshot.value?.[field.key]
}

/** Whether the field is user-overridden (present in the raw user layer). */
function isOverridden(snapshot: SettingsScopeSnapshot<RuntimeSettings>, key: string): boolean {
  return typeof snapshot.user === 'object' && snapshot.user !== null && key in snapshot.user
}

/**
 * Status settings page contributed to the settings shell. A schema-driven
 * form: every field is declared once in {@link FIELDS} (mirroring the host
 * schema) and rendered generically, with edits committed through the settings
 * scope — the host applies threshold/interval changes live, no restart.
 */
export function StatusSettings({ settingsScope, t }: StatusSettingsProps): ReactNode {
  const [snapshot, setSnapshot] = useState<SettingsScopeSnapshot<RuntimeSettings>>(() => settingsScope.getSnapshot())
  const [saving, setSaving] = useState(false)
  // Number inputs edit a local draft so typing never fights the committed
  // value; the draft commits on blur / Enter.
  const [drafts, setDrafts] = useState<Partial<Record<keyof RuntimeSettings, string>>>({})

  useEffect(() => settingsScope.subscribe(() => setSnapshot(settingsScope.getSnapshot())), [settingsScope])

  const write = (key: keyof RuntimeSettings, value: unknown): void => {
    setSaving(true)
    void settingsScope.set(key, value).finally(() => setSaving(false))
  }

  const commitNumber = (field: FieldMeta, raw: string): void => {
    setDrafts(prev => {
      const next = { ...prev }
      delete next[field.key]
      return next
    })
    const value = Number(raw)
    if (raw === '' || !Number.isFinite(value)) return
    write(field.key, clamp(field, value))
  }

  const resetField = (field: FieldMeta): void => {
    setDrafts(prev => {
      const next = { ...prev }
      delete next[field.key]
      return next
    })
    setSaving(true)
    void settingsScope.unset(field.key).finally(() => setSaving(false))
  }

  if (snapshot.status === 'unavailable') {
    return <p className={css.settingsStatus}>{t('settingsUnavailable')}</p>
  }
  if (snapshot.value === undefined) {
    return <p className={css.settingsStatus}>{t('settingsLoading')}</p>
  }

  return (
    <div className={css.settingsPage}>
      {!snapshot.writable ? <p className={css.settingsStatus}>{t('settingsNotWritable')}</p> : null}
      <dl className={css.settingsList}>
        {FIELDS.map(field => {
          const value = fieldValue(snapshot, field)
          const draft = drafts[field.key]
          const overridden = isOverridden(snapshot, field.key)
          const disabled = !snapshot.writable
          if (field.kind === 'boolean') {
            return (
              <div className={css.settingsRow} key={field.key}>
                <dt className={css.settingsLabel}>{t(field.label)}</dt>
                <dd className={css.settingsControl}>
                  <input
                    type="checkbox"
                    checked={Boolean(value)}
                    disabled={disabled}
                    onChange={event => write(field.key, event.target.checked)}
                  />
                  {overridden ? (
                    <button type="button" className={css.settingsReset} disabled={disabled} onClick={() => resetField(field)}>
                      {t('settingsReset')}
                    </button>
                  ) : null}
                </dd>
              </div>
            )
          }
          return (
            <div className={css.settingsRow} key={field.key}>
              <dt className={css.settingsLabel}>{t(field.label)}</dt>
              <dd className={css.settingsControl}>
                <input
                  type="number"
                  className={css.settingsInput}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={draft ?? String(value ?? '')}
                  disabled={disabled}
                  onChange={event => setDrafts(prev => ({ ...prev, [field.key]: event.target.value }))}
                  onBlur={event => commitNumber(field, event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') commitNumber(field, (event.target as HTMLInputElement).value)
                  }}
                />
                {field.unit !== undefined ? <span className={css.settingsUnit}>{field.unit}</span> : null}
                {overridden ? (
                  <button type="button" className={css.settingsReset} disabled={disabled} onClick={() => resetField(field)}>
                    {t('settingsReset')}
                  </button>
                ) : null}
              </dd>
            </div>
          )
        })}
      </dl>
      {saving ? <p className={css.settingsStatus}>{t('settingsSaving')}</p> : null}
    </div>
  )
}
