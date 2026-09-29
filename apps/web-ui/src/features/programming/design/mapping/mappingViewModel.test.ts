import { emptyFbdDocument } from '../pou/pouTemplates'
import { describe, expect, it } from 'vitest'
import type {
  ProgrammingDraftDocument,
  ProgrammingPointCatalogEntry,
  ProgrammingPointMapEligibility,
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

/* ISS-PIO-32 — `mapping` là QUYẾT ĐỊNH của server. Fixture ở đây cố tình khai
 * nó tường minh: bài test của FE là "hiển thị đúng thứ server nói", nên nếu
 * fixture tự suy ra quyết định thì test lại đang kiểm một bản luật thứ hai —
 * đúng thứ vừa bị gỡ khỏi mã sản phẩm. */
function decision(status: ProgrammingPointMapEligibility['status'], reason?: string): ProgrammingPointMapEligibility {
  return { status, reasons: status === 'SUPPORTED' ? [] : [reason ?? 'lý do do server cấp'] }
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
    mapping: { input: decision('SUPPORTED'), output: decision('SUPPORTED') },
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
      point({
        pointId: 'UI-01', dataType: 'REAL', direction: 'READ', writable: false,
        mapping: { input: decision('SUPPORTED'), output: decision('INCOMPATIBLE', 'UI là ngõ vào vật lý; chỉ AO/DO nhận được VAR_OUTPUT') },
      }),
      /* VP do CHƯƠNG TRÌNH sở hữu: server trả READ_WRITE và eligibility mở.
       * Bản FE cũ chặn cứng "VP hiện chỉ hỗ trợ VAR_INPUT" — một câu đã sai từ
       * khi `F-PROG-ASBUILT-016` gỡ chặn chiều ghi. */
      point({ category: 'VP', pointId: 'BV-01', name: 'Virtual binary', dataType: 'BOOL', unit: undefined, direction: 'READ_WRITE', writable: true, value: true }),
      point({
        category: 'MB_RTU', deviceId: 'bus-1-slave-2', pointId: 'coil-1', name: 'VFD enable',
        dataType: 'BOOL', unit: undefined, direction: 'READ_WRITE', writable: true, value: true,
        mapping: {
          input: decision('UNSUPPORTED_BY_CORE', 'Catalog chưa phát extIndex cho điểm Modbus nên chưa dựng được binding (ISS-PIO-31); Core đã resolve MB_RTU'),
          output: decision('UNSUPPORTED_BY_CORE', 'Catalog chưa phát extIndex cho điểm Modbus nên chưa dựng được binding (ISS-PIO-31); Core đã resolve MB_RTU'),
        },
      }),
      point({ pointId: 'DO-02', name: 'Bad output', dataType: 'BOOL', unit: undefined, direction: 'WRITE', writable: true, quality: 'BAD', value: null }),
      point({ pointId: 'DO-03', name: 'Unknown output', dataType: 'BOOL', unit: undefined, direction: 'WRITE', writable: true, quality: 'UNKNOWN', value: null }),
    ]

    const rows = buildPointRows(entries, { ...output, direction: 'OUTPUT' }, { status: 'ready', lastSuccessAt: 100 })

    expect(rows.find((row) => row.pointId === 'DO-01')?.eligibility).toBe('SUPPORTED')
    expect(rows.find((row) => row.pointId === 'UI-01')?.eligibility).toBe('INCOMPATIBLE')
    // Năng lực đã mở ở Core và ở server ⇒ FE phải theo, không được tự chặn.
    expect(rows.find((row) => row.category === 'VP')?.eligibility).toBe('SUPPORTED')
    expect(rows.find((row) => row.category === 'MB_RTU')?.eligibility).toBe('UNSUPPORTED_BY_CORE')
    // Lý do hiển thị phải là NGUYÊN VĂN của server, không phải câu FE tự đặt.
    /* `ISS-PGUI-02` — câu của SERVER đi qua nhánh `server` và giữ NGUYÊN VĂN.
       FE không mã hoá lại một câu nó không kiểm soát (`ISS-PIO-32`). */
    expect(rows.find((row) => row.category === 'MB_RTU')?.compatibilityReasons).toEqual([
      { kind: 'server', text: 'Catalog chưa phát extIndex cho điểm Modbus nên chưa dựng được binding (ISS-PIO-31); Core đã resolve MB_RTU' },
    ])
    /* Issue #840 — đích GHI không bị chặn theo chất lượng live
       (`DDD-CTRL-PROG-001` §5 chỉ áp quality policy cho đầu vào). Một DO/VP về
       BAD khi Program ghi nó không chạy; chặn ở đây là chặn đúng việc sửa
       Program đó. */
    expect(rows.find((row) => row.pointId === 'DO-02')?.eligibility).toBe('SUPPORTED')
    expect(rows.find((row) => row.pointId === 'DO-03')?.eligibility).toBe('SUPPORTED')
    expect(rows.find((row) => row.pointId === 'DO-02')?.compatibilityReasons).toEqual([])

    /* Chiều ĐỌC vẫn chịu quality policy như cũ. */
    const input: ProgrammingVariable = {
      variableId: 'var-input', programId: 'program-1', name: 'FanFb', type: 'BOOL', class: 'INPUT', initialValue: null, retain: false,
    }
    const inputRows = buildPointRows([
      point({ pointId: 'DI-02', name: 'Bad input', dataType: 'BOOL', unit: undefined, direction: 'READ', writable: false, quality: 'BAD', value: null }),
      point({ pointId: 'DI-03', name: 'Good input', dataType: 'BOOL', unit: undefined, direction: 'READ', writable: false, value: true }),
    ], { ...input, direction: 'INPUT' }, { status: 'ready', lastSuccessAt: 100 })
    expect(inputRows.find((row) => row.pointId === 'DI-02')?.eligibility).toBe('QUALITY_BLOCKED')
    expect(inputRows.find((row) => row.pointId === 'DI-03')?.eligibility).toBe('SUPPORTED')
  })

  /* Điều kiện đóng thứ ba của ISS-PIO-32: Core mở một năng lực mới ⇒ FE tự
   * nhận, KHÔNG cần sửa FE. Bài test này chạy trên đúng mã sản phẩm hiện tại,
   * chỉ đổi thứ server trả về. */
  it('nhận năng lực mới do server mở mà không cần sửa dòng FE nào', () => {
    const output: ProgrammingVariable = {
      variableId: 'var-output', programId: 'program-1', name: 'FanCmd', type: 'BOOL', class: 'OUTPUT', initialValue: null, retain: false,
    }
    const opened = point({
      category: 'MB_RTU', deviceId: 'bus-1-slave-2', pointId: 'coil-1', name: 'VFD enable',
      dataType: 'BOOL', unit: undefined, direction: 'READ_WRITE', writable: true, value: true,
      extIndex: 7,
      mapping: { input: decision('SUPPORTED'), output: decision('SUPPORTED') },
    })

    const rows = buildPointRows([opened], { ...output, direction: 'OUTPUT' }, { status: 'ready', lastSuccessAt: 100 })

    expect(rows[0].eligibility).toBe('SUPPORTED')
    expect(rows[0].compatible).toBe(true)
    expect(rows[0].compatibilityReasons).toEqual([])
  })

  /* Server đời cũ không trả `mapping`. FE KHÔNG được suy lại — suy lại là dựng
   * lại đúng bản luật thứ hai vừa gỡ — nên nó fail-closed và nói rõ vì sao. */
  it('fail-closed khi server không trả quyết định eligibility', () => {
    const input: ProgrammingVariable = {
      variableId: 'var-input', programId: 'program-1', name: 'SupplyTemp', type: 'REAL', class: 'INPUT', initialValue: null, retain: false,
    }
    const legacy = point()
    delete legacy.mapping

    const rows = buildPointRows([legacy], { ...input, direction: 'INPUT' }, { status: 'ready', lastSuccessAt: 100 })

    expect(rows[0].eligibility).toBe('SERVER_DECISION_MISSING')
    expect(rows[0].compatible).toBe(false)
    /* `ISS-PGUI-02` — lý do do CHÍNH FE kết luận là một MÃ, không phải câu
       tiếng Việt: câu ấy sẽ hiện ra giữa giao diện English. */
    expect(rows[0].compatibilityReasons).toEqual([{ kind: 'code', code: 'SERVER_DECISION_MISSING' }])
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

  /* `ISS-PGUI-02` — lý do FE tự kết luận phải là MÃ. Một chuỗi cứng lọt vào
     đây (kể cả núp dưới nhánh `server`) sẽ mãi mãi là tiếng Việt trên mọi bề
     mặt, vì tầng này không có `pick`. */
  it('lý do do FE kết luận đi qua bảng mã, không phải câu chữ', () => {
    const variable: ProgrammingVariable = {
      variableId: 'var-input', programId: 'program-1', name: 'SupplyTemp', type: 'REAL', class: 'INPUT', initialValue: null, retain: false,
    }
    const boolPoint = point({
      pointId: 'DO-01', name: 'Supply fan', dataType: 'BOOL', unit: undefined,
      direction: 'WRITE', writable: true, value: true,
      mapping: { input: decision('SUPPORTED'), output: decision('SUPPORTED') },
    })

    const rows = buildPointRows([boolPoint], { ...variable, direction: 'INPUT' }, { status: 'ready', lastSuccessAt: 100 })

    expect(rows[0].compatibilityReasons).toContainEqual({ kind: 'code', code: 'TYPE_MISMATCH' })
    expect(rows[0].compatibilityReasons.every((reason) => reason.kind === 'code')).toBe(true)
  })

  /* Mốc đọc của điểm đang gắn phải đi vào hàng biến. Thiếu nó, cột "Cập nhật"
     và ô "Observed" vẽ `—` VĨNH VIỄN — một ô chết trông y hệt "máy chủ không
     đọc được mốc thời gian". */
  it('hàng biến mang mốc đọc của chính Point đang gắn', () => {
    const document = baseDocument()
    document.variables.push({ variableId: 'var-supply', programId: 'program-1', name: 'SupplyTemp', type: 'REAL', class: 'INPUT', initialValue: null, retain: false })
    document.bindings.push({ bindingId: 'binding-supply', variableId: 'var-supply', point: { category: 'LOCAL', pointId: 'UI-01' }, direction: 'READ', dataType: 'REAL', unit: 'degC', writable: false, qualityPolicy: 'REQUIRE_GOOD' })

    const rows = buildMappingVariableRows(document, [point()], { status: 'ready', lastSuccessAt: 100 })
    expect(rows.find((row) => row.bindingId === 'binding-supply')?.observedAt).toBe('2026-08-24T09:00:00Z')
  })

  it('loại trừ biến từ FUNCTION_BLOCK và FUNCTION, và loại trừ biến ma của FBD không có trên sơ đồ', () => {
    const document = baseDocument()
    // Thêm 1 Function Block ST có VAR_INPUT pv, VAR_OUTPUT q
    document.programs.push({
      programId: 'fb-1',
      name: 'NewFunctionBlock_2',
      kind: 'FUNCTION_BLOCK',
      language: 'ST',
      document: [
        'FUNCTION_BLOCK NewFunctionBlock_2',
        'VAR_INPUT pv : REAL; END_VAR',
        'VAR_OUTPUT q : BOOL; END_VAR',
        'END_FUNCTION_BLOCK',
      ].join('\n'),
    })

    // Thêm 1 Program FBD có node INPUT DEMO_1
    const fbdDoc = emptyFbdDocument('FbdProg')
    fbdDoc.networks = [
      {
        id: 'net-1',
        name: 'Network 1',
        order: 0,
        nodes: [
          {
            id: 'node-demo-1',
            kind: 'INPUT',
            typeRef: 'BOOL',
            executionOrder: 0,
            parameters: { variable: 'DEMO_1' },
            ports: [{ id: 'p-1', name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL', unit: null, order: 0 }],
          },
        ],
        wires: [],
      },
    ]

    document.programs.push({
      programId: 'fbd-prog-1',
      name: 'NewFbdProgram',
      kind: 'PROGRAM',
      language: 'FBD',
      document: JSON.stringify(fbdDoc),
    })

    // Variables trong document có chứa:
    // 1. Biến hợp lệ của FBD: DEMO_1
    // 2. Biến ma của FBD không có trên sơ đồ: NewFunctionBlock_pv
    // 3. Biến của Function Block: pv
    document.variables.push(
      { variableId: 'v-demo1', programId: 'fbd-prog-1', name: 'DEMO_1', type: 'BOOL', class: 'INPUT', initialValue: null, retain: false },
      { variableId: 'v-ghost', programId: 'fbd-prog-1', name: 'NewFunctionBlock_pv', type: 'REAL', class: 'INPUT', initialValue: null, retain: false },
      { variableId: 'v-fb-pv', programId: 'fb-1', name: 'pv', type: 'REAL', class: 'INPUT', initialValue: null, retain: false },
    )

    const rows = buildMappingVariableRows(document, [point()], { status: 'ready', lastSuccessAt: 100 })
    const names = rows.map((r) => r.name)

    // Biến của program ST (AHU_Main) và FBD (NewFbdProgram) được hiện
    expect(names).toContain('SupplyTemp')
    expect(names).toContain('FanCmd')
    expect(names).toContain('DEMO_1')

    // Biến của Function Block hoàn toàn KHÔNG xuất hiện
    expect(names).not.toContain('pv')
    expect(names).not.toContain('q')

    // Biến ma FBD không tồn tại trên sơ đồ hoàn toàn KHÔNG xuất hiện
    expect(names).not.toContain('NewFunctionBlock_pv')
  })

  it('không biến null thành zero nhưng giữ zero/false thật', () => {
    const vi = (v: string, _e: string) => v
    expect(formatMappingValue(null, vi)).toBe('—')
    expect(formatMappingValue(undefined, vi)).toBe('—')
    expect(formatMappingValue(0, vi)).toBe('0')
    expect(formatMappingValue(false, vi)).toBe('Tắt')
  })

  /* `ISS-PGUI-02` — BOOL từng in "Tắt"/"Bật" ở cả bốn bề mặt Mapping, kể cả
     khi giao diện đang là English (`PM-006`). Số và chuỗi thì không dịch:
     chúng là giá trị đo được. */
  it('BOOL theo ngôn ngữ đang chọn; số và chuỗi giữ nguyên', () => {
    const en = (_v: string, e: string) => e
    expect(formatMappingValue(false, en)).toBe('Off')
    expect(formatMappingValue(true, en)).toBe('On')
    expect(formatMappingValue(21.5, en)).toBe('21.5')
    expect(formatMappingValue('AUTO', en)).toBe('AUTO')
    expect(formatMappingValue(Number.NaN, en)).toBe('—')
  })
})
