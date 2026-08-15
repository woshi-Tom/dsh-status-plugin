import { describe, expect, it } from 'vitest';
import Schema from '@deepseek-ai/schemastery';
import { RUNTIME_DEFAULTS, RuntimeSettingsSchema, SETTINGS_NAMESPACE } from '../src/settings.js';

describe('RuntimeSettingsSchema', () => {
  it('resolves the full runtime default set for an empty section', () => {
    const [value] = Schema.resolve({}, RuntimeSettingsSchema, {});
    expect(value).toEqual(RUNTIME_DEFAULTS);
  });

  it('accepts partial overrides and keeps every other default', () => {
    const [value] = Schema.resolve({ cpuWarning: 0.6 }, RuntimeSettingsSchema, {});
    expect(value.cpuWarning).toBe(0.6);
    expect(value.memoryWarning).toBe(RUNTIME_DEFAULTS.memoryWarning);
    expect(value.diskWarning).toBe(RUNTIME_DEFAULTS.diskWarning);
    expect(value.exposeLanAddresses).toBe(false);
  });

  it('rejects thresholds outside the 0..1 band', () => {
    expect(() => Schema.resolve({ cpuWarning: 1.5 }, RuntimeSettingsSchema, {})).toThrow();
    expect(() => Schema.resolve({ memoryWarning: -0.1 }, RuntimeSettingsSchema, {})).toThrow();
  });

  it('rejects negative intervals and out-of-band hysteresis', () => {
    expect(() => Schema.resolve({ heartbeatMs: 999 }, RuntimeSettingsSchema, {})).toThrow();
    expect(() => Schema.resolve({ hysteresis: 0.6 }, RuntimeSettingsSchema, {})).toThrow();
  });

  it('owns the dsh-status namespace', () => {
    expect(SETTINGS_NAMESPACE).toBe('dsh-status');
  });
});
