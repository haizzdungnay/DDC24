import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  parseTimeToMs,
  evaluateStExpression,
  evaluateStCondition,
  computeExecutedLineSequence,
  findFirstUsageLine,
  extractLineCalls,
  extractLineAssignments,
  extractLineExpressions,
  getStatementAtLine,
  parseStProgram,
} from './stControlFlow'
import { PRG_DO16_MODBUS_SOURCE } from './prgDo16Modbus.fixture'

describe('stControlFlow', () => {
  describe('parseTimeToMs', () => {
    it('parses various IEC time literals', () => {
      expect(parseTimeToMs('T#10s')).toBe(10000)
      expect(parseTimeToMs('T#500ms')).toBe(500)
      expect(parseTimeToMs('T#22s')).toBe(22000)
      expect(parseTimeToMs('T#0s')).toBe(0)
      expect(parseTimeToMs('T#1m30s')).toBe(90000)
      expect(parseTimeToMs('T#1d2h')).toBe((86400 + 7200) * 1000)
    })
  })

  describe('evaluateStExpression & evaluateStCondition', () => {
    const vars: Record<string, unknown> = {
      mode: 10,
      autoon: true,
      inpermit: true,
      autonext: false,
      autoidx: 1,
      settled: true,
      cmdreverse: false,
      step: 1,
      'permitlost.q': false,
      'autotmr.et': 5000,
      tripcount: 0,
      mask: 6,
    }
    const lookup = (name: string) => vars[name.toLowerCase()]

    it('evaluates comparisons and boolean logic', () => {
      expect(evaluateStCondition('Mode > 7', lookup)).toBe(true)
      expect(evaluateStCondition('Mode = 10', lookup)).toBe(true)
      expect(evaluateStCondition('NOT AutoOn OR NOT InPermit', lookup)).toBe(false)
      expect(evaluateStCondition('AutoOn AND InPermit', lookup)).toBe(true)
      expect(evaluateStCondition('AutoNext', lookup)).toBe(false)
      expect(evaluateStCondition('PermitLost.Q AND (TripCount < 2147483647)', lookup)).toBe(false)
      expect(evaluateStCondition('AutoTmr.ET < T#20s', lookup)).toBe(true)
    })

    it('evaluates SEL and LIMIT', () => {
      expect(evaluateStExpression('SEL(CmdReverse, 1, 16)', lookup)).toBe(1)
      expect(evaluateStExpression('LIMIT(0, Mode, 5)', lookup)).toBe(5)
    })

    it('evaluates nested SEL without regex breakage', () => {
      // Khi Mode = 2, không phải Mode = 5 (G = FALSE): trả về IN0 là 0.0
      const expr = 'SEL(Mode = 5, 0.0, SEL(AutoTmr.ET < T#20s, 20.0, 55.0))'
      expect(evaluateStExpression(expr, (n) => (n.toLowerCase() === 'mode' ? 2 : lookup(n)))).toBe(0.0)

      // Khi Mode = 5 (G = TRUE) và AutoTmr.ET (5000) < T#20s (20000) là TRUE: trả về IN1 là 55.0
      expect(evaluateStExpression(expr, (n) => (n.toLowerCase() === 'mode' ? 5 : lookup(n)))).toBe(55.0)

      // Khi Mode = 5 và AutoTmr.ET >= 20s (G trong là FALSE): trả về IN0 là 20.0
      expect(
        evaluateStExpression(expr, (n) => {
          if (n.toLowerCase() === 'mode') return 5
          if (n.toLowerCase() === 'autotmr.et') return 25000
          return lookup(n)
        }),
      ).toBe(20.0)
    })

    it('handles bitwise NOT, AND, OR, XOR vs Boolean operations', () => {
      // 16-bit UINT bitwise NOT: MASK_ODD = 21845 (0x5555) -> 43690 (0xAAAA = MASK_EVEN)
      expect(evaluateStExpression('NOT MASK_ODD', lookup)).toBe(43690)
      // MASK_LOW_NIBBLES = 3855 (0x0F0F) -> 61680 (0xF0F0 = MASK_HIGH_NIBBLES)
      expect(evaluateStExpression('NOT MASK_LOW_NIBBLES', lookup)).toBe(61680)

      // Bitwise AND mask checks: (Mask AND 2) <> 0
      // Mask = 6 (0b0110): bit 1 is set (6 & 2 = 2) -> true
      expect(evaluateStCondition('(Mask AND 2) <> 0', lookup)).toBe(true)
      // Mask = 4 (0b0100): bit 1 is NOT set (4 & 2 = 0) -> false
      expect(evaluateStCondition('(Mask AND 2) <> 0', (n) => (n.toLowerCase() === 'mask' ? 4 : lookup(n)))).toBe(false)

      // Bitwise OR & XOR
      expect(evaluateStExpression('2 OR 8', lookup)).toBe(10)
      expect(evaluateStExpression('2 XOR 3', lookup)).toBe(1)
    })

    it('evaluates IEC and custom helper functions', () => {
      expect(evaluateStExpression('FN_FIRST_N(0)', lookup)).toBe(0)
      expect(evaluateStExpression('FN_FIRST_N(1)', lookup)).toBe(1)
      expect(evaluateStExpression('FN_FIRST_N(4)', lookup)).toBe(15) // 0x0F
      expect(evaluateStExpression('FN_FIRST_N(16)', lookup)).toBe(65535)

      expect(evaluateStExpression('FN_ONE_HOT(1)', lookup)).toBe(1)
      expect(evaluateStExpression('FN_ONE_HOT(4)', lookup)).toBe(8)
      expect(evaluateStExpression('FN_ONE_HOT(16)', lookup)).toBe(32768)

      expect(evaluateStExpression('FN_NEXT_STEP(3, 16, FALSE)', lookup)).toBe(4)
      expect(evaluateStExpression('FN_NEXT_STEP(16, 16, FALSE)', lookup)).toBe(1)
      expect(evaluateStExpression('FN_NEXT_STEP(1, 16, TRUE)', lookup)).toBe(16)
      expect(evaluateStExpression('FN_NEXT_STEP(5, 16, TRUE)', lookup)).toBe(4)

      expect(evaluateStExpression('FN_MASK_FROM_REAL(65535.8)', lookup)).toBe(65535)
      expect(evaluateStExpression('FN_SEC_TO_TIME(2.5, 0.5, 60.0)', lookup)).toBe(2500)
      expect(evaluateStExpression('DEADBAND(10.5, 2.0, 10.0)', lookup)).toBe(10.0) // inside deadband
      expect(evaluateStExpression('DEADBAND(13.0, 2.0, 10.0)', lookup)).toBe(13.0) // exceeds deadband
    })
  })

  describe('computeExecutedLineSequence', () => {
    it('executes only the true IF branch and skips ELSIF and ELSE', () => {
      const src = [
        'PROGRAM TestPrg',
        'VAR_INPUT',
        '  x : INT;',
        'END_VAR',
        'IF x = 1 THEN',
        '  y := 10;',
        'ELSIF x = 2 THEN',
        '  y := 20;',
        'ELSE',
        '  y := 30;',
        'END_IF;',
        'END_PROGRAM',
      ]

      // Case x = 1
      const seq1 = computeExecutedLineSequence(src, src, (name) => (name.toLowerCase() === 'x' ? 1 : null))
      expect(seq1).toContain(4)
      expect(seq1).toContain(5)
      expect(seq1).not.toContain(6)
      expect(seq1).not.toContain(7)
      expect(seq1).not.toContain(8)
      expect(seq1).not.toContain(9)

      // Case x = 2
      const seq2 = computeExecutedLineSequence(src, src, (name) => (name.toLowerCase() === 'x' ? 2 : null))
      expect(seq2).toContain(4)
      expect(seq2).not.toContain(5)
      expect(seq2).toContain(6)
      expect(seq2).toContain(7)
      expect(seq2).not.toContain(8)
      expect(seq2).not.toContain(9)

      // Case x = 99 (goes to ELSE)
      const seq3 = computeExecutedLineSequence(src, src, (name) => (name.toLowerCase() === 'x' ? 99 : null))
      expect(seq3).toContain(4)
      expect(seq3).not.toContain(5)
      expect(seq3).not.toContain(7)
      expect(seq3).toContain(8)
      expect(seq3).toContain(9)
    })

    it('executes only the matching CASE branch', () => {
      const src = [
        'CASE Mode OF',
        '  1: A := 1;',
        '  2: B := 2;',
        '  3: C := 3;',
        'ELSE',
        '  D := 4;',
        'END_CASE;',
      ]

      // Case Mode = 2
      const seq = computeExecutedLineSequence(src, src, (name) => (name.toLowerCase() === 'mode' ? 2 : null))
      expect(seq).toContain(0)
      expect(seq).not.toContain(1)
      expect(seq).toContain(2)
      expect(seq).not.toContain(3)
      expect(seq).not.toContain(4)
      expect(seq).not.toContain(5)

      // Case Mode = 0 (goes to ELSE)
      const seqElse = computeExecutedLineSequence(src, src, (name) => (name.toLowerCase() === 'mode' ? 0 : null))
      expect(seqElse).toContain(0)
      expect(seqElse).not.toContain(1)
      expect(seqElse).not.toContain(2)
      expect(seqElse).not.toContain(3)
      expect(seqElse).toContain(4)
      expect(seqElse).toContain(5)
    })

    it('handles single-line IF without swallowing subsequent lines', () => {
      const src = [
        'PROGRAM TestSingle',
        'VAR DO01: BOOL; DO02: BOOL; DO03: BOOL; OnCount: INT; END_VAR',
        'IF DO01 THEN OnCount := OnCount + 1; END_IF;',
        'IF DO02 THEN OnCount := OnCount + 1; END_IF;',
        'IF DO03 THEN OnCount := OnCount + 1; END_IF;',
        'END_PROGRAM',
      ]

      // DO01 = false, DO02 = true, DO03 = false
      const vars: Record<string, boolean> = { do01: false, do02: true, do03: false }
      const seq = computeExecutedLineSequence(src, src, (n) => vars[n.toLowerCase()] ?? false)

      // Dòng 2 (DO01), Dòng 3 (DO02), Dòng 4 (DO03) đều phải được duyệt qua
      // Đặc biệt dòng 3 không bị nuốt bởi dòng 2!
      expect(seq).toContain(2)
      expect(seq).toContain(3)
      expect(seq).toContain(4)
    })
  })

  describe('findFirstUsageLine', () => {
    const src = [
      'PROGRAM POU1',
      'VAR_INPUT',
      '  CmdMode : UINT;',
      '  InPermit : BOOL;',
      'END_VAR',
      'VAR',
      '  Mode : UINT;',
      'END_VAR',
      'Mode := CmdMode;',
      'IF InPermit THEN',
      '  Mode := 1;',
      'END_IF;',
    ]

    it('finds variable in the executable body first', () => {
      expect(findFirstUsageLine(src, src, 'CmdMode')).toBe(8)
      expect(findFirstUsageLine(src, src, 'InPermit')).toBe(9)
    })

    it('falls back to declaration if not in body', () => {
      const src2 = [
        'VAR_INPUT',
        '  UnusedInput : BOOL;',
        'END_VAR',
        'Mode := 1;',
      ]
      expect(findFirstUsageLine(src2, src2, 'UnusedInput')).toBe(1)
    })
  })

  describe('Function & Expression Extraction', () => {
    it('extracts line assignments with multiple assignments on one line', () => {
      const line = '1: SegMode := 2; AutoDur := T#22s;'
      const assigns = extractLineAssignments(line, 114)
      expect(assigns).toHaveLength(2)
      expect(assigns[0]).toEqual({
        target: 'SegMode',
        value: '2',
        line: 114,
        endLine: 114,
      })
      expect(assigns[1]).toEqual({
        target: 'AutoDur',
        value: 'T#22s',
        line: 114,
        endLine: 114,
      })
    })

    it('extracts FB calls with named parameters and function calls with return target', () => {
      const fbLine = 'StepClk(Run := Settled AND (Mode = 2), StepTime := StepTime);'
      const fbCalls = extractLineCalls(fbLine, 157)
      expect(fbCalls).toHaveLength(1)
      expect(fbCalls[0].name).toBe('StepClk')
      expect(fbCalls[0].isFb).toBe(true)
      expect(fbCalls[0].args).toHaveLength(2)
      expect(fbCalls[0].args[0].name).toBe('Run')

      const fnLine = 'Mask := SEL(AutoTmr.ET < T#4s, MASK_HIGH_NIBBLES, MASK_LOW_NIBBLES);'
      const fnCalls = extractLineCalls(fnLine, 175)
      expect(fnCalls).toHaveLength(1)
      expect(fnCalls[0].name).toBe('SEL')
      expect(fnCalls[0].targetVar).toBe('Mask')
      expect(fnCalls[0].isFb).toBe(false)
    })

    it('extracts member accesses and identifiers on a line', () => {
      const line = 'IF PermitLost.Q AND (TripCount < 2147483647) THEN'
      const exprs = extractLineExpressions(line, 143)
      expect(exprs.memberAccesses).toEqual([
        {
          object: 'PermitLost',
          member: 'Q',
          full: 'PermitLost.Q',
          line: 143,
        },
      ])
      expect(exprs.identifiers).toContain('PermitLost')
      expect(exprs.identifiers).toContain('TripCount')
    })
  })

  describe('PRG_DO16_MODBUS real code verification', () => {
    const rawLines = PRG_DO16_MODBUS_SOURCE.split('\n')

    it('has standard 293 lines in PRG_DO16_MODBUS_SOURCE fixture', () => {
      expect(rawLines.length).toBe(293)
      expect(rawLines[0].trim()).toBe('PROGRAM PRG_DO16_MODBUS')
      expect(rawLines[292].trim()).toBe('END_PROGRAM')
    })

    it('traces Mode = 1 (Auto Mode) and executes 1: IF AutoOn THEN branch correctly', () => {
      const vars: Record<string, unknown> = {
        cmdmode: 1,
        mode: 1,
        autoon: true,
        settled: true,
        'autotmr.et': 1000,
        cmdmanualmask: 255,
      }
      const seq = computeExecutedLineSequence(rawLines, rawLines, (n) => vars[n.toLowerCase()])

      // Dòng 173 (CASE Mode OF) được thăm
      expect(seq).toContain(173)
      // Dòng 174 (1: IF AutoOn THEN) được thăm
      expect(seq).toContain(174)
      // Vì AutoOn = true, dòng 175 (Mask := SEL(...)) được chạy
      expect(seq).toContain(175)
      // Dòng 177 (ELSE: Mask := FN_MASK_FROM_REAL) bị bỏ qua
      expect(seq).not.toContain(177)
      // Các nhánh Mode khác (Mode 2..7) hoàn toàn bị bỏ qua
      expect(seq).not.toContain(179) // 2: LoadMode := TRUE
      expect(seq).not.toContain(186) // 3: IF Step = 0
      expect(seq).not.toContain(198) // 6: IF TestTrig.Q
    })

    it('traces Mode = 3 (Step Mode) and executes 3: IF Step = 0 THEN branch correctly', () => {
      const vars: Record<string, unknown> = {
        cmdmode: 3,
        mode: 3,
        settled: true,
        step: 0,
        cmdreverse: false,
      }
      const seq = computeExecutedLineSequence(rawLines, rawLines, (n) => vars[n.toLowerCase()])

      expect(seq).toContain(173) // CASE Mode OF
      expect(seq).toContain(186) // 3: IF Step = 0 THEN
      expect(seq).toContain(187) // Step := SEL(CmdReverse, 1, 16);
      expect(seq).toContain(194) // Mask := FN_ONE_HOT(Step);

      // Bỏ qua Mode 1, Mode 2, Mode 6
      expect(seq).not.toContain(174)
      expect(seq).not.toContain(179)
      expect(seq).not.toContain(198)
    })

    it('traces Mode = 6 (Test Mode) and executes 6: branch correctly', () => {
      const vars: Record<string, unknown> = {
        cmdmode: 6,
        mode: 6,
        settled: true,
        'testtrig.q': true,
        'teststep.q': false,
        testrunning: false,
      }
      const seq = computeExecutedLineSequence(rawLines, rawLines, (n) => vars[n.toLowerCase()])

      expect(seq).toContain(173) // CASE Mode OF
      expect(seq).toContain(198) // 6: IF TestTrig.Q AND Settled THEN
      expect(seq).toContain(199) // TestRunning := TRUE;

      // Bỏ qua Mode 1, 2, 3
      expect(seq).not.toContain(174)
      expect(seq).not.toContain(179)
      expect(seq).not.toContain(186)
    })

    it('traces CASE AutoIdx OF and jumps to same-line label statement', () => {
      // AutoIdx = 1: nhảy tới dòng 114 (1: SegMode := 2; AutoDur := T#22s;)
      const vars1: Record<string, unknown> = { autoidx: 1 }
      const seq1 = computeExecutedLineSequence(rawLines, rawLines, (n) => vars1[n.toLowerCase()])
      expect(seq1).toContain(113) // CASE AutoIdx OF
      expect(seq1).toContain(114) // 1: SegMode := 2; AutoDur := T#22s;
      expect(seq1).not.toContain(115) // 2: SegMode := 3; AutoDur := T#12s;

      // AutoIdx = 2: nhảy tới dòng 115
      const vars2: Record<string, unknown> = { autoidx: 2 }
      const seq2 = computeExecutedLineSequence(rawLines, rawLines, (n) => vars2[n.toLowerCase()])
      expect(seq2).toContain(113)
      expect(seq2).not.toContain(114)
      expect(seq2).toContain(115)
    })

    it('executes multi-line statements and FB calls covering their full line range', () => {
      const vars: Record<string, unknown> = { mode: 2, settled: true }
      const seq = computeExecutedLineSequence(rawLines, rawLines, (n) => vars[n.toLowerCase()])

      // FB Call StepClk trải qua 2 dòng (157..158)
      expect(seq).toContain(157)
      expect(seq).toContain(158)

      // Lệnh gán AnyWaiting trải qua 4 dòng (260..263)
      expect(seq).toContain(260)
      expect(seq).toContain(261)
      expect(seq).toContain(262)
      expect(seq).toContain(263)
    })

    it('handles 16 consecutive single-line IF statements without swallowing lines', () => {
      // Bật một số kênh DO ngẫu nhiên: DO01=false, DO02=true, DO03=false, DO04=true
      const vars: Record<string, boolean> = {
        do01: false,
        do02: true,
        do03: false,
        do04: true,
      }
      const seq = computeExecutedLineSequence(rawLines, rawLines, (n) => vars[n.toLowerCase()] ?? false)

      // Cả 16 dòng single-line IF (267..282) đều phải được duyệt qua đầy đủ
      for (let l = 267; l <= 282; l++) {
        expect(seq).toContain(l)
      }
    })

    it('accurately traces execution on real guide code from documentation', () => {
      const guidePath = path.resolve(__dirname, '../../../../../../docs/06_operations/PROGRAMMING_ST_DO16_MODBUS_GUIDE.md')
      if (!fs.existsSync(guidePath)) return
      const content = fs.readFileSync(guidePath, 'utf8')
      const fullLines = content.split('\n')
      const prgStart = fullLines.findIndex(l => l.includes('PROGRAM PRG_DO16_MODBUS'))
      const prgEnd = fullLines.findIndex((l, i) => i > prgStart && l.includes('END_PROGRAM'))
      if (prgStart === -1 || prgEnd === -1) return
      const guideLines = fullLines.slice(prgStart, prgEnd + 1)

      const vars: Record<string, unknown> = {
        cmdmode: 10,
        autoon: true,
        inpermit: true,
        autonext: false,
        autoidx: 1,
        mode: 2,
        settled: true,
        'permitlost.q': false,
        'pulseall.q': false,
      }
      const lookup = (name: string) => vars[name.toLowerCase()]

      const seq = computeExecutedLineSequence(guideLines, guideLines, lookup)
      expect(seq.length).toBeGreaterThan(10)
      expect(seq.length).toBeLessThan(guideLines.length)
    })
  })
})
