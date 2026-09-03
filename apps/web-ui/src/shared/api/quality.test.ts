import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  normalizePointQuality,
  POINT_QUALITY_CONTRACT_VERSION,
  POINT_QUALITY_FALLBACK,
  POINT_QUALITY_VALUES
} from './quality'

interface QualityContract {
  version: number
  values: Array<{ id: string; wire: string }>
  unrecognizedFallback: string
  forbiddenFallback: string
}

/* `import.meta.url` chứ không phải `__dirname`: bộ typecheck của `npm run build`
 * chạy ở chế độ ESM và không có `__dirname` — cùng cách mà
 * `i18n.hmiVocabulary.test.ts` định vị gốc repo. */
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../../../..')

function contract(): QualityContract {
  return JSON.parse(readFileSync(resolve(REPO, 'contracts/quality/point_quality_v1.json'), 'utf8')) as QualityContract
}

describe('hợp đồng quality (ISS-PIO-35)', () => {
  // Cổng chống trôi: danh sách trong TS là GƯƠNG của tệp hợp đồng, và một cái
  // gương không tự biết mình lệch.
  it('danh sách và version khớp contracts/quality/point_quality_v1.json', () => {
    const doc = contract()
    expect(POINT_QUALITY_CONTRACT_VERSION).toBe(doc.version)
    expect([...POINT_QUALITY_VALUES]).toEqual(doc.values.map((value) => value.id))
    expect(POINT_QUALITY_FALLBACK).toBe(doc.unrecognizedFallback)
    expect(POINT_QUALITY_FALLBACK).not.toBe(doc.forbiddenFallback)
  })

  // Đây là con bug: `unknown`, `config_error` và khoá VẮNG MẶT đều từng ra
  // `good`, nên trang Giám sát vẽ huy hiệu GOOD cho một điểm không ai đọc được.
  it('mọi giá trị lạ hoặc thiếu ra unknown, TUYỆT ĐỐI không ra good', () => {
    const strangers: unknown[] = [undefined, null, '', '   ', 'GOOD_ENOUGH', 'q7', 42, {}, [], true, 'excellent']
    for (const value of strangers) {
      expect(normalizePointQuality(value), `giá trị ${JSON.stringify(value)}`).toBe('unknown')
    }
  })

  it('nhận cả dạng dây hoa lẫn dạng thường, và các biến thể dấu nối', () => {
    expect(normalizePointQuality('GOOD')).toBe('good')
    expect(normalizePointQuality('CONFIG_ERROR')).toBe('config_error')
    expect(normalizePointQuality('config-error')).toBe('config_error')
    expect(normalizePointQuality(' Config Error ')).toBe('config_error')
    expect(normalizePointQuality('UNKNOWN')).toBe('unknown')
  })

  it('mọi giá trị trong hợp đồng đều tự chuẩn hoá về chính nó', () => {
    for (const value of POINT_QUALITY_VALUES) {
      expect(normalizePointQuality(value)).toBe(value)
      expect(normalizePointQuality(value.toUpperCase())).toBe(value)
    }
  })
})
