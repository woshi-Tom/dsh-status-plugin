import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.js'

describe('locales', () => {
  it('keep English and Chinese key sets in parity', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})