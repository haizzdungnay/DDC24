import { describe, expect, it } from 'vitest'
import { canonicalOutputPointId } from '../utils'
import { normalizePoint } from './pointNormalizer'

describe('point normalizer output namespace', () => {
  it('maps global AO channel 19 to canonical AO-03', () => {
    expect(normalizePoint({ id: 'AO-03', kind: 'AO', channel: 19, value: 0 }).id).toBe('AO-03')
  })

  it('maps global DO channel 21 to canonical DO-01', () => {
    expect(normalizePoint({ id: 'DO-01', kind: 'DO', channel: 21, value: false }).id).toBe('DO-01')
  })

  it('preserves already-local output channels', () => {
    expect(normalizePoint({ id: 'AO-03', kind: 'AO', channel: 3, value: 0 }).id).toBe('AO-03')
    expect(normalizePoint({ id: 'DO-01', kind: 'DO', channel: 1, value: false }).id).toBe('DO-01')
  })

  it('migrates stale global output IDs stored by the previous frontend', () => {
    expect(canonicalOutputPointId('AO-19')).toBe('AO-03')
    expect(canonicalOutputPointId('DO-21')).toBe('DO-01')
  })
})
