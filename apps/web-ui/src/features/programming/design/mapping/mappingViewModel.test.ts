import { describe, expect, it } from 'vitest'
import type {
  ProgrammingDraftDocument,
  ProgrammingPointCatalogEntry,
  ProgrammingVariable,
} from '../../model/types'
import {
  buildMappingVariableRows,
  buildPointRows,
  formatMappingValue,
  rankPointRows,
} from './mappingViewModel'

function baseDocument(): ProgrammingDraftDocument {
  return {
    schemaVersion: 1,
    project: { projectId: 'project-1', name: 'AHU-01', functionalTags: [] },
    programs: [{
      programId: 'program-1',
      name: 'AHU_Main',
      kind: 'PROGRAM',
      language: 'ST',
      document: [
        'PROGRAM AHU_Main',
        'VAR_INPUT',
        '  SupplyTemp : REAL;',
        'END_VAR',
        'VAR_OUTPUT',
        '  FanCmd : BOOL;',
        'END_VAR',
        'END_PROGRAM',
      ].join('\n'),
    }],
    variables: [],
    bindings: [],
    task: { taskId: 'task-1', periodMs: 1000, programOrder: ['program-1'] },
    library: { profile: 'CORE_REVA', version: '1' },
  }
}

function point(overrides: Partial<ProgrammingPointCatalogEntry> = {}): ProgrammingPointCatalogEntry {
  return {
    category: 'LOCAL',
    pointId: 'UI-01',
    name: 'Supply air temperature',
    dataType: 'REAL',
    unit: 'degC',
    direction: 'READ',
    writable: false,
    quality: 'GOOD',
    value: 21.4,
    observedAt: '2026-08-24T09:00:00Z',
    ...overrides,
  }
}

describe('mappingViewModel — Phase 1A truth model', () => {
  it('hợp nhất biến khai báo, binding hiện hữu, INOUT cũ và Point đã mất mà không che identity', () => {
    const document = baseDocument()
    document.variables.push(
      { variableId: 'var-supply', programId: 'program-1', name: 'SupplyTemp', type: 'REAL', class: 'INPUT', initialValue: null, retain: false },
      { variableId: 'var-orphan', programId: 'program-1', name: 'OrphanInput', type: 'REAL', class: 'INPUT', initialValue: null, retain: false },
      { variableId: 'var-inout', programId: 'program-1', name: 'LegacyInOut', type: 'REAL', class: 'INOUT', initialValue: null, retain: false },
    )
    document.bindings.push(
      { bindingId: 'binding-supply', variableId: 'var-supply', point: { category: 'LOCAL', pointId: 'UI-01' }, direction: 'READ', dataType: 'REAL', unit: 'degC', writable: false, qualityPolicy: 'REQUIRE_GOOD' },
      { bindingId: 'binding-orphan', variableId: 'var-orphan', point: { category: 'VP', pointId: 'AV-09' }, direction: 'READ', dataType: 'REAL', writable: false, qualityPolicy: 'REQUIRE_GOOD' },
    )

    const rows = buildMappingVariableRows(document, [point()], { status: 'ready', lastSuccessAt: 100 })

    expect(rows.map((row) => row.name)).toEqual(['SupplyTemp', 'FanCmd', 'OrphanInput', 'LegacyInOut'])
    expect(rows.find((row) => row.name === 'SupplyTemp')).toMatchObject({ bindingStatus: 'MAPPED', liveQuality: 'GOOD', liveValue: 21.4 })
    expect(rows.find((row) => row.name === 'FanCmd')).toMatchObject({ bindingStatus: 'UNMAPPED', liveValue: null })
    expect(rows.find((row) => row.name === 'OrphanInput')).toMatchObject({
      bindingStatus: 'POINT_UNAVAILABLE',
      point: { category: 'VP', pointId: 'AV-09' },
      liveValue: null,
      liveQuality: 'UNKNOWN',
    })
    expect(rows.find((row) => row.name === 'LegacyInOut')).toMatchObject({ eligibility: 'UNSUPPORTED_DIRECTION', direction: 'INOUT' })
  })

  it('áp capability Core, direction/type/writable và đủ quality theo REQUIRE_GOOD', () => {
    const output: ProgrammingVariable = {
      variableId: 'var-output', programId: 'program-1', name: 'FanCmd', type: 'BOOL', class: 'OUTPUT', initialValue: null, retain: false,
    }
    const entries = [
      point({ pointId: 'DO-01', name: 'Supply fan', dataType: 'BOOL', unit: undefined, direction: 'WRITE', writable: true, value: true }),
      point({ pointId: 'UI-01', dataType: 'REAL', direction: 'READ', writable: false }),
      point({ category: 'VP', pointId: 'BV-01', name: 'Virtual binary', dataType: 'BOOL', unit: undefined, direction: 'READ_WRITE', writable: true, value: true }),
      point({ category: 'MB_RTU', deviceId: 'vfd-1', pointId: 'coil-1', name: 'VFD enable', dataType: 'BOOL', unit: undefined, direction: 'READ_WRITE', writable: true, value: true }),
      point({ pointId: 'DO-02', name: 'Bad output', dataType: 'BOOL', unit: undefined, direction: 'WRITE', writable: true, quality: 'BAD', value: null }),
      point({ pointId: 'DO-03', name: 'Unknown output', dataType: 'BOOL', unit: undefined, direction: 'WRITE', writable: true, quality: 'UNKNOWN', value: null }),
    ]

    const rows = buildPointRows(entries, { ...output, direction: 'OUTPUT' }, { status: 'ready', lastSuccessAt: 100 })

    expect(rows.find((row) => row.pointId === 'DO-01')?.eligibility).toBe('SUPPORTED')
    expect(rows.find((row) => row.pointId === 'UI-01')?.eligibility).toBe('INCOMPATIBLE')
    expect(rows.find((row) => row.category === 'VP')?.eligibility).toBe('UNSUPPORTED_BY_CORE')
    expect(rows.find((row) => row.category === 'MB_RTU')?.eligibility).toBe('UNSUPPORTED_BY_CORE')
    expect(rows.find((row) => row.pointId === 'DO-02')?.eligibility).toBe('QUALITY_BLOCKED')
    expect(rows.find((row) => row.pointId === 'DO-03')?.eligibility).toBe('QUALITY_BLOCKED')
  })

  it('giữ snapshot chỉ để inspect khi poll lỗi và xếp suggestion deterministic', () => {
    const input: ProgrammingVariable = {
      variableId: 'var-input', programId: 'program-1', name: 'SupplyTemp', type: 'REAL', class: 'INPUT', initialValue: null, retain: false,
    }
    const entries = [
      point({ pointId: 'UI-02', name: 'Return Temp' }),
      point({ pointId: 'UI-01', name: 'Supply Temp' }),
    ]

    const staleRows = buildPointRows(entries, { ...input, direction: 'INPUT' }, { status: 'error', lastSuccessAt: 123 })
    expect(staleRows.every((row) => row.eligibility === 'CATALOG_STALE')).toBe(true)

    const readyRows = buildPointRows(entries, { ...input, direction: 'INPUT' }, { status: 'ready', lastSuccessAt: 123 })
    expect(rankPointRows(readyRows, { name: input.name, type: input.type, direction: 'INPUT' }).map((row) => row.pointId)).toEqual(['UI-01', 'UI-02'])
  })

  it('không biến null thành zero nhưng giữ zero/false thật', () => {
    expect(formatMappingValue(null)).toBe('—')
    expect(formatMappingValue(undefined)).toBe('—')
    expect(formatMappingValue(0)).toBe('0')
    expect(formatMappingValue(false)).toBe('Tắt')
  })
})
