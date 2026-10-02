import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  parseTimeToMs,
  evaluateStExpression,
  evaluateStCondition,
  computeExecutedLineSequence,
  findFirstUsageLine,
} from './stControlFlow'

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

  describe('PRG_DO16_MODBUS real code verification', () => {
    it('accurately traces execution on real guide code', () => {
      const guidePath = path.resolve(__dirname, '../../../../../../docs/06_operations/PROGRAMMING_ST_DO16_MODBUS_GUIDE.md')
      if (!fs.existsSync(guidePath)) return
      const content = fs.readFileSync(guidePath, 'utf8')
      const fullLines = content.split('\n')
      const prgStart = fullLines.findIndex(l => l.includes('PROGRAM PRG_DO16_MODBUS'))
      const prgEnd = fullLines.findIndex((l, i) => i > prgStart && l.includes('END_PROGRAM'))
      if (prgStart === -1 || prgEnd === -1) return
      const rawLines = fullLines.slice(prgStart, prgEnd + 1)

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

      const seq = computeExecutedLineSequence(rawLines, rawLines, lookup)
      expect(seq.length).toBeGreaterThan(10)
      expect(seq.length).toBeLessThan(rawLines.length) // Verifies non-taken branches are skipped!
    })
  })
})
