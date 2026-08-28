import { describe, expect, it } from 'vitest'
import { isLegacyGraphDemoEnabled, isProgramsWorkspaceV2Enabled } from './config'

describe('legacy graph demo gate', () => {
  it('requires both demo mode and an explicit opt-in flag', () => {
    expect(isLegacyGraphDemoEnabled('demo', '1')).toBe(true)
    expect(isLegacyGraphDemoEnabled('demo', undefined)).toBe(false)
    expect(isLegacyGraphDemoEnabled('live', '1')).toBe(false)
  })
})

describe('PGM-02 workspace v2 rollback gate', () => {
  it('mặc định tắt và chỉ bật bằng giá trị chính xác 1', () => {
    expect(isProgramsWorkspaceV2Enabled(undefined)).toBe(false)
    expect(isProgramsWorkspaceV2Enabled('0')).toBe(false)
    expect(isProgramsWorkspaceV2Enabled('true')).toBe(false)
    expect(isProgramsWorkspaceV2Enabled('1')).toBe(true)
  })
})
