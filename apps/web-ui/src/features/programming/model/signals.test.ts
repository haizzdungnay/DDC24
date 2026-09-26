import { describe, expect, it } from 'vitest'
import {
  SIGNAL_FRESHNESS_DEFAULT_MS,
  SIGNAL_FRESHNESS_MAX_MS,
  SIGNAL_FRESHNESS_MIN_MS,
  emptySignalForm,
  validateSignalForm,
  type SignalFormValue
} from './signals'

const PUBLISHER = '11111111-1111-4111-8111-111111111111'

function form(freshnessMs: string): SignalFormValue {
  return { ...emptySignalForm('22222222-2222-4222-8222-222222222222', PUBLISHER), name: 'SupplyTemp', freshnessMs }
}

describe('signals — dải freshness ADR-061 mục 4.5', () => {
  it('dải mới 10..150000 ms khớp CHECK của migration 0016', () => {
    expect([SIGNAL_FRESHNESS_MIN_MS, SIGNAL_FRESHNESS_MAX_MS]).toEqual([10, 150_000])
    const context = { signals: [], producerProgramIds: [PUBLISHER] }
    expect(validateSignalForm(form('10'), context).freshness).toBeUndefined()
    expect(validateSignalForm(form('150000'), context).freshness).toBeUndefined()
    expect(validateSignalForm(form('9'), context).freshness).toBe('FRESHNESS_RANGE')
    expect(validateSignalForm(form('150001'), context).freshness).toBe('FRESHNESS_RANGE')
  })

  it('freshness nhỏ hơn chu kỳ publisher bị chặn tại chỗ (cùng luật Check ST-SIG-003)', () => {
    const context = { signals: [], producerProgramIds: [PUBLISHER], producerPeriodsMs: { [PUBLISHER]: 50_000 } }
    expect(validateSignalForm(form('10000'), context).freshness).toBe('FRESHNESS_BELOW_PUBLISHER_PERIOD')
    expect(validateSignalForm(form('50000'), context).freshness).toBeUndefined()
    // Không biết chu kỳ publisher thì không đoán.
    expect(validateSignalForm(form('10000'), { signals: [], producerProgramIds: [PUBLISHER] }).freshness).toBeUndefined()
  })

  it('signal mới gợi ý 1 s, không phải cận dưới 10 ms', () => {
    expect(SIGNAL_FRESHNESS_DEFAULT_MS).toBe(1000)
    expect(emptySignalForm('x', PUBLISHER).freshnessMs).toBe('1000')
  })
})
