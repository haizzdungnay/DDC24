import { describe, expect, it } from 'vitest'
import { PROGRAMMING_ALLOWED_PERIOD_MS } from '../api/generated/profile'
import {
  DEFAULT_PROGRAMMING_PERIOD_MS,
  formatProgrammingPeriod,
  nearestProgrammingPeriods,
  programmingPeriodChoices,
  programmingPeriodValidity
} from './cyclePeriods'

describe('cyclePeriods — ADR-061 C1/4.13/4.14', () => {
  it('tập mặc định là hằng SINH từ product profile, không chép tay', () => {
    expect(programmingPeriodChoices()).toBe(PROGRAMMING_ALLOWED_PERIOD_MS)
    expect([...programmingPeriodChoices()]).toEqual([10, 50, 100, 500, 1000, 5000, 10000, 50000])
    expect(DEFAULT_PROGRAMMING_PERIOD_MS).toBe(1000)
  })

  it('ưu tiên capabilities, bỏ phần tử hỏng, rơi về profile khi rỗng', () => {
    expect(programmingPeriodChoices([5000, 10, 10, 100])).toEqual([10, 100, 5000])
    expect(programmingPeriodChoices([0, -5, 1.5, Number.NaN])).toBe(PROGRAMMING_ALLOWED_PERIOD_MS)
    expect(programmingPeriodChoices(null)).toBe(PROGRAMMING_ALLOWED_PERIOD_MS)
  })

  it('phân loại hợp lệ / legacy 30 s / lạ', () => {
    expect(programmingPeriodValidity(10)).toBe('VALID')
    expect(programmingPeriodValidity(50000)).toBe('VALID')
    expect(programmingPeriodValidity(30000)).toBe('LEGACY')
    expect(programmingPeriodValidity(5)).toBe('INVALID')
    expect(programmingPeriodValidity(777)).toBe('INVALID')
  })

  it('hiển thị ms dưới 1 s và giây từ 1 s; giá trị hỏng là —', () => {
    expect(formatProgrammingPeriod(10)).toBe('10 ms')
    expect(formatProgrammingPeriod(500)).toBe('500 ms')
    expect(formatProgrammingPeriod(1000)).toBe('1 s')
    expect(formatProgrammingPeriod(1500)).toBe('1.5 s')
    expect(formatProgrammingPeriod(50000)).toBe('50 s')
    expect(formatProgrammingPeriod(30000)).toBe('30 s')
    expect(formatProgrammingPeriod(0)).toBe('—')
    expect(formatProgrammingPeriod(null)).toBe('—')
    expect(formatProgrammingPeriod(Number.NaN)).toBe('—')
  })

  it('gợi ý hai chu kỳ hợp lệ kề bên: 30 s → 10 s và 50 s', () => {
    expect(nearestProgrammingPeriods(30000)).toEqual([10000, 50000])
    expect(nearestProgrammingPeriods(5)).toEqual([10])
    expect(nearestProgrammingPeriods(60000)).toEqual([50000])
  })
})
