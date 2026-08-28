import { describe, expect, it } from 'vitest'
import type { ProgrammingRuntime, RemoteState } from '../model/types'
import { programmingCoreTruth } from './runtimeTruth'

const runtime: ProgrammingRuntime = {
  schemaVersion: '1.0',
  controllerId: 'controller-local',
  producerState: 'READY',
  activeRevisionId: null,
  lkgRevisionId: null,
  taskState: 'STOPPED',
  safeState: false,
  safeStateNoControllerOnly: false,
  observedAt: '2026-08-19T00:00:00Z'
}

function state(status: RemoteState<ProgrammingRuntime>['status'], data: ProgrammingRuntime | null) {
  return { status, data }
}

describe('programmingCoreTruth', () => {
  it('chỉ READY từ query ready mới là Core ready', () => {
    expect(programmingCoreTruth(state('ready', runtime))).toBe('ready')
    expect(programmingCoreTruth(state('error', runtime))).toBe('stale')
  })

  it('giữ DEGRADED và UNAVAILABLE độc lập', () => {
    expect(programmingCoreTruth(state('ready', { ...runtime, producerState: 'DEGRADED' }))).toBe('degraded')
    expect(programmingCoreTruth(state('ready', { ...runtime, producerState: 'UNAVAILABLE' }))).toBe('unavailable')
  })

  it('enum thiếu hoặc lạ fail-closed thành unknown', () => {
    expect(programmingCoreTruth(state('ready', { ...runtime, producerState: undefined } as unknown as ProgrammingRuntime))).toBe('unknown')
    expect(programmingCoreTruth(state('ready', { ...runtime, producerState: 'FUTURE_STATE' } as unknown as ProgrammingRuntime))).toBe('unknown')
  })
})

