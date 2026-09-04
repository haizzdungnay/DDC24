import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ISS-PIO-25 — cổng canh: `AoConfig`/`DoConfig` chỉ được khai trường CÓ NGƯỜI ĐỌC.
 *
 * TRIỆU CHỨNG: hai interface từng khai 26 trường phụ (`minHeatOutput`,
 * `piSeqLowerFan1`, `switchOnDelay`, `pwmCycleTime`, `runtimeAlarmHours`, …) mà
 * `grep` chỉ ra đúng dòng khai báo. Không form nào ghi, không backend nào đọc,
 * `renderOutputField` trả `null` cho tất cả — nhưng chúng là trường BẮT BUỘC nên
 * mọi literal AO trong repo phải điền số cho chúng. Bề mặt hợp đồng hứa một tính
 * năng không tồn tại.
 *
 * NGUỒN CHUẨN: `apps/web-api/internal/configschema/schema.go` liệt kê đúng các
 * khoá `io_config.conf`/`safe_state.conf` mà firmware và web-api đọc. Cổng này
 * đọc CHÍNH tệp đó chứ không chép lại danh sách — một bản sao sẽ lệch âm thầm,
 * đúng cách 26 trường kia sống sót nhiều năm.
 */

const here = dirname(fileURLToPath(import.meta.url))
const typesPath = resolve(here, '../types.ts')
const schemaPath = resolve(here, '../../../../web-api/internal/configschema/schema.go')

/** Trường FE không có khoá cấu hình, kèm LÝ DO. Danh sách này là chỗ duy nhất
 *  được phép miễn trừ, và mỗi mục phải nói được vì sao. */
const feOnlyFields: Record<string, string> = {
  kind: 'định danh nhánh của union AoConfig | DoConfig, không phải dữ liệu cấu hình',
  safeValue: 'nằm ở safe_state.conf (khoá `safe`), không phải io_config.conf',
  safeState: 'nằm ở safe_state.conf (khoá `safe`), không phải io_config.conf',
  manualValue: 'giá trị soạn cho nút ép tay, đi PUT /points/{id}, không lưu cấu hình',
  demoNote: 'nhãn đánh dấu dữ liệu demo, không bao giờ rời khỏi frontend'
}

/** camelCase phía FE ↔ snake_case phía cấu hình. */
const configKeyFor: Record<string, string> = {
  channel: 'ch',
  label: 'name',
  minPv: 'min_pv',
  maxPv: 'max_pv'
}

function declaredFields(interfaceName: string): string[] {
  const source = readFileSync(typesPath, 'utf8')
  const start = source.indexOf(`export interface ${interfaceName} {`)
  expect(start, `không tìm thấy interface ${interfaceName} trong types.ts`).toBeGreaterThan(-1)
  const end = source.indexOf('\n}', start)
  expect(end, `không tìm thấy chỗ đóng của ${interfaceName}`).toBeGreaterThan(start)
  const body = source.slice(start, end)
  const fields: string[] = []
  for (const line of body.split('\n').slice(1)) {
    const match = /^\s{2}([a-zA-Z][a-zA-Z0-9]*)\??:/.exec(line)
    if (match) fields.push(match[1])
  }
  return fields
}

/** Các tên Field khai trong schema.go — đọc thẳng tệp Go, không chép tay. */
function schemaFieldNames(): Set<string> {
  const source = readFileSync(schemaPath, 'utf8')
  const names = new Set<string>()
  for (const match of source.matchAll(/\{?Name:\s*"([a-z_0-9]+)"/g)) names.add(match[1])
  return names
}

describe('ISS-PIO-25 — AoConfig/DoConfig không chở trường chết', () => {
  const schemaNames = schemaFieldNames()

  it('đọc được schema Go làm nguồn chuẩn', () => {
    // Nếu đường dẫn hỏng thì `schemaNames` rỗng và mọi phép kiểm dưới đây xanh
    // giả. Canh chính cơ chế đọc trước.
    expect(schemaNames.has('min_pv')).toBe(true)
    expect(schemaNames.has('mode')).toBe(true)
    expect(schemaNames.size).toBeGreaterThan(15)
  })

  for (const name of ['AoConfig', 'DoConfig']) {
    it(`${name}: mọi trường đều có khoá cấu hình hoặc lý do miễn trừ`, () => {
      const fields = declaredFields(name)
      expect(fields.length).toBeGreaterThan(5)
      const orphans = fields.filter((field) => {
        if (field in feOnlyFields) return false
        const key = configKeyFor[field] ?? field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
        return !schemaNames.has(key)
      })
      expect(orphans, `${name} khai trường không ai đọc: ${orphans.join(', ')} — thêm khoá vào firmware + configschema TRƯỚC, hoặc xoá trường`).toEqual([])
    })
  }

  it('12 trường mà REV-PIO-3SRC-001 nêu đích danh đã biến mất khỏi cả repo frontend', () => {
    const named = [
      'minHeatOutput', 'maxHeatOutput', 'minCoolOutput', 'maxCoolOutput',
      'piSeqLowerFan1', 'fanSpeed2', 'piSeqUpperFan3', 'setbackAlarm',
      'switchOnDelay', 'switchOffDelay', 'pwmCycleTime', 'runtimeAlarmHours'
    ]
    const declared = new Set([...declaredFields('AoConfig'), ...declaredFields('DoConfig')])
    for (const field of named) {
      expect(declared.has(field), `${field} quay lại AoConfig/DoConfig`).toBe(false)
    }
  })
})
