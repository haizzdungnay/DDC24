import { describe, expect, it } from 'vitest'
import { checkPouAndDependencies, findPouDependencies, generateRandomValue, extractStVariables } from './pouCheck'
import type { ProgrammingDraftDocument } from '../../model/types'
import { emptyFbdDocument } from '../pou/pouTemplates'
import { canonicalFbdJson } from '../../fbd/model'

describe('pouCheck', () => {
  const dummyDoc: ProgrammingDraftDocument = {
    schemaVersion: 1,
    project: { projectId: 'p-1', name: 'Test' },
    programs: [
      {
        programId: 'prog-main',
        name: 'Main',
        kind: 'PROGRAM',
        language: 'ST',
        document: `PROGRAM Main
VAR_INPUT
  speed1 : REAL;
  speed2 : REAL;
  active : BOOL;
END_VAR
VAR
  fb1 : FB_Sub;
END_VAR
fb1();
END_PROGRAM`,
      },
      {
        programId: 'prog-sub',
        name: 'FB_Sub',
        kind: 'FUNCTION_BLOCK',
        language: 'ST',
        document: `FUNCTION_BLOCK FB_Sub
VAR_INPUT
  in1 : BOOL;
END_VAR
VAR_OUTPUT
  out1 : BOOL;
END_VAR
END_FUNCTION_BLOCK`,
      },
      {
        programId: 'prog-unrelated',
        name: 'Unrelated',
        kind: 'PROGRAM',
        language: 'ST',
        document: `PROGRAM Unrelated
VAR
  x : BOOL;
END_VAR
END_PROGRAM`,
      },
    ],
    variables: [],
    bindings: [],
  }

  it('tìm đúng dependency chuyển tiếp (transitive)', () => {
    const deps = findPouDependencies('prog-main', dummyDoc)
    expect(deps.map((d) => d.name)).toEqual(['Main', 'FB_Sub'])
  })

  it('kiểm tra POU hợp lệ trả về 0 diagnostic, có test vectors và logs', () => {
    const res = checkPouAndDependencies('prog-main', dummyDoc)
    expect(res.diagnostics).toHaveLength(0)
    expect(res.checkedProgramNames).toEqual(['Main', 'FB_Sub'])
    expect(res.testVectors.length).toBeGreaterThan(0)
    expect(res.logs.length).toBeGreaterThan(0)
  })

  it('sinh giá trị ngẫu nhiên độc lập cho từng biến', () => {
    const real1 = generateRandomValue('REAL')
    const real2 = generateRandomValue('REAL')
    const boolVal = generateRandomValue('BOOL')

    expect(Number(real1.raw)).toBeGreaterThanOrEqual(1.0)
    expect(Number(real1.raw)).toBeLessThanOrEqual(5.0)
    expect(typeof boolVal.raw).toBe('boolean')
  })

  it('trích xuất đúng danh sách biến ST', () => {
    const vars = extractStVariables(dummyDoc.programs[0].document as string)
    expect(vars.map((v) => v.name)).toEqual(['speed1', 'speed2', 'active', 'fb1'])
    expect(vars.find((v) => v.name === 'speed1')?.direction).toBe('INPUT')
    expect(vars.find((v) => v.name === 'fb1')?.direction).toBe('LOCAL')
  })

  it('đánh giá biểu thức quan hệ ST với véc-tơ thử nghiệm và ghi log', () => {
    const docWithLogic: ProgrammingDraftDocument = {
      ...dummyDoc,
      programs: [
        {
          programId: 'prog-logic',
          name: 'LogicTest',
          kind: 'PROGRAM',
          language: 'ST',
          document: `PROGRAM LogicTest
VAR_INPUT
  TEMP : REAL;
END_VAR
VAR
  ALARM : BOOL;
END_VAR
ALARM := TEMP > 3.0;
END_PROGRAM`,
        },
      ],
    }

    const res = checkPouAndDependencies('prog-logic', docWithLogic)
    expect(res.logs.some((l) => l.message.includes('[Logic] ALARM := TEMP'))).toBe(true)
  })

  it('bắt lỗi cú pháp trong POU phụ thuộc', () => {
    const docWithBrokenSub: ProgrammingDraftDocument = {
      ...dummyDoc,
      programs: [
        dummyDoc.programs[0],
        {
          ...dummyDoc.programs[1],
          document: `FUNCTION_BLOCK FB_Sub
VAR_INPUT
  in1 : BOOL
END_VAR
END_FUNCTION_BLOCK`,
        },
      ],
    }

    const res = checkPouAndDependencies('prog-main', docWithBrokenSub)
    expect(res.diagnostics.length).toBeGreaterThan(0)
    expect(res.diagnostics.some((d) => d.code === 'ST-SYNTAX-ERROR')).toBe(true)
  })

  it('bắt lỗi kiểu dữ liệu không tồn tại', () => {
    const docWithBadType: ProgrammingDraftDocument = {
      ...dummyDoc,
      programs: [
        {
          ...dummyDoc.programs[0],
          document: `PROGRAM Main
VAR
  val : NonExistentType;
END_VAR
END_PROGRAM`,
        },
      ],
    }

    const res = checkPouAndDependencies('prog-main', docWithBadType)
    expect(res.diagnostics.some((d) => d.code === 'ST-UNKNOWN-TYPE')).toBe(true)
  })

  it('kiểm tra FBD gọi ST block phụ thuộc', () => {
    const fbdProgramDoc = emptyFbdDocument('AHU_FBD')
    fbdProgramDoc.networks[0].nodes.push({
      id: '10000000-0000-4000-8000-000000000001',
      kind: 'FUNCTION_BLOCK',
      typeRef: 'FB_Sub',
      executionOrder: 1,
      parameters: {},
      ports: [
        {
          id: '20000000-0000-4000-8000-000000000001',
          name: 'in1',
          direction: 'INPUT',
          dataType: 'BOOL',
          order: 0,
          unit: null,
        },
        {
          id: '20000000-0000-4000-8000-000000000002',
          name: 'out1',
          direction: 'OUTPUT',
          dataType: 'BOOL',
          order: 1,
          unit: null,
        },
      ],
    })

    const docWithFbd: ProgrammingDraftDocument = {
      ...dummyDoc,
      programs: [
        {
          programId: 'fbd-main',
          name: 'AHU_FBD',
          kind: 'PROGRAM',
          language: 'FBD',
          document: canonicalFbdJson(fbdProgramDoc),
        },
        dummyDoc.programs[1],
      ],
    }

    const res = checkPouAndDependencies('fbd-main', docWithFbd)
    expect(res.checkedProgramNames).toEqual(['AHU_FBD', 'FB_Sub'])
    expect(res.diagnostics).toHaveLength(0)
  })

  it('bắt lỗi khối không xác định trong FBD', () => {
    const fbdProgramDoc = emptyFbdDocument('AHU_FBD')
    fbdProgramDoc.networks[0].nodes.push({
      id: '10000000-0000-4000-8000-000000000001',
      kind: 'FUNCTION_BLOCK',
      typeRef: 'FB_UNKNOWN_NEVER_EXIST',
      executionOrder: 1,
      parameters: {},
      ports: [],
    })

    const docWithBadFbd: ProgrammingDraftDocument = {
      ...dummyDoc,
      programs: [
        {
          programId: 'fbd-bad',
          name: 'AHU_FBD',
          kind: 'PROGRAM',
          language: 'FBD',
          document: canonicalFbdJson(fbdProgramDoc),
        },
      ],
    }

    const res = checkPouAndDependencies('fbd-bad', docWithBadFbd)
    expect(res.diagnostics.some((d) => d.code === 'FBD-UNKNOWN-BLOCK')).toBe(true)
  })
})
