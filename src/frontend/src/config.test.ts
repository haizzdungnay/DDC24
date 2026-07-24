import { describe, expect, it } from 'vitest'
import { isLegacyGraphDemoEnabled } from './config'

describe('legacy graph demo gate', () => {
  it('requires both demo mode and an explicit opt-in flag', () => {
    expect(isLegacyGraphDemoEnabled('demo', '1')).toBe(true)
    expect(isLegacyGraphDemoEnabled('demo', undefined)).toBe(false)
    expect(isLegacyGraphDemoEnabled('live', '1')).toBe(false)
  })
})
