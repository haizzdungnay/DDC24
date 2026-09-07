import { describe, expect, it } from 'vitest'
import {
  FBD_LABEL_MAX_CHARS,
  formatNodeParameterSummary,
  formatPortLabel,
  truncateText,
} from './nodeLabel'

describe('nodeLabel pure helper', () => {
  describe('truncateText', () => {
    it('giữ nguyên chuỗi ngắn hơn hoặc bằng ngưỡng', () => {
      expect(truncateText('SHORT', 10)).toBe('SHORT')
      expect(truncateText('1234567890', 10)).toBe('1234567890')
    })

    it('cắt ngắn kèm dấu ellipsis khi chuỗi vượt ngưỡng', () => {
      expect(truncateText('12345678901', 10)).toBe('123456789…')
    })
  })

  describe('formatPortLabel (C1, CB-5)', () => {
    it('trả về nguyên name nếu không có dataType', () => {
      expect(formatPortLabel('IN1', null, null)).toBe('IN1')
      expect(formatPortLabel('IN1', undefined, undefined)).toBe('IN1')
    })

    it('trả về dạng name : TYPE khi không có unit', () => {
      expect(formatPortLabel('IN', 'BOOL', null)).toBe('IN : BOOL')
    })

    it('trả về dạng name : TYPE (unit) khi có unit và không vượt ngưỡng', () => {
      expect(formatPortLabel('T', 'REAL', 'degC')).toBe('T : REAL (degC)')
    })

    it('cắt ngắn khi chuỗi dài vượt ngưỡng an toàn FBD_LABEL_MAX_CHARS', () => {
      // Chuỗi "ROOM_TEMP_SENSOR : REAL (degC)" dài 30 ký tự > FBD_LABEL_MAX_CHARS (22)
      const label = formatPortLabel('ROOM_TEMP_SENSOR', 'REAL', 'degC')
      expect(label).toBe('ROOM_TEMP_SENSOR…')
    })
  })

  describe('formatNodeParameterSummary (C2, CB-5)', () => {
    it('trả về variable cho INPUT và OUTPUT', () => {
      expect(formatNodeParameterSummary('INPUT', { variable: 'OCCUPIED' })).toBe('OCCUPIED')
      expect(formatNodeParameterSummary('OUTPUT', { variable: 'FAN_CMD' })).toBe('FAN_CMD')
    })

    it('trả về value cho CONSTANT', () => {
      expect(formatNodeParameterSummary('CONSTANT', { value: 42 })).toBe('42')
      expect(formatNodeParameterSummary('CONSTANT', { value: true })).toBe('true')
      expect(formatNodeParameterSummary('CONSTANT', { value: 'T#5s' })).toBe('T#5s')
    })

    it('trả về instance cho FUNCTION_BLOCK', () => {
      expect(formatNodeParameterSummary('FUNCTION_BLOCK', { instance: 'TON_1' })).toBe('TON_1')
    })

    it('trả về null khi thiếu parameter hoặc kind khác (để trống, không render chuỗi mẫu)', () => {
      expect(formatNodeParameterSummary('INPUT', {})).toBeNull()
      expect(formatNodeParameterSummary('INPUT', { variable: '' })).toBeNull()
      expect(formatNodeParameterSummary('CONSTANT', {})).toBeNull()
      expect(formatNodeParameterSummary('FUNCTION_BLOCK', {})).toBeNull()
      expect(formatNodeParameterSummary('FUNCTION', { variable: 'IGNORED' })).toBeNull()
    })

    it('cắt ngắn tham số nếu vượt quá ngưỡng ký tự', () => {
      const longVar = 'VERY_LONG_VARIABLE_NAME_EXCEEDING_LIMIT'
      const summary = formatNodeParameterSummary('INPUT', { variable: longVar })
      expect(summary).toBe(`${longVar.slice(0, FBD_LABEL_MAX_CHARS - 1)}…`)
    })
  })
})
