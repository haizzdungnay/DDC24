import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { resolveDrilldown } from './drilldown'
import type { AttentionTargetType } from '../types'

/**
 * Hợp đồng deep link — HAI CHIỀU. `T57-0.8` của Plan 57, gate chặn tái diễn
 * `F-UX-02/03/04` (`REV-FE-UIUX-UC-2026-08-18` §7.3 cơ chế 1).
 *
 * VÌ SAO CẦN TEST NÀY
 *
 * `drilldown.ts` đã có test cho chiều SINH URL (`drilldown.test.ts`): cho một
 * `(targetType, targetId)` thì ra đúng đường dẫn nào. Không có gì kiểm chiều
 * còn lại — trang đích có THỰC SỰ ĐỌC tham số đó không.
 *
 * Hậu quả đã xảy ra thật, ba lần cùng lúc: `/alarms?alarm=`, `/monitor?group=`
 * và `/trends?points=` đều được phát ra từ Landing/Monitor, cả ba trang đích
 * đều bỏ qua tham số. Liên kết mở đúng trang nhưng không lọc gì — người trực
 * bấm "Xem chi tiết" một cảnh báo Critical và rơi vào danh sách đầy đủ, giữa
 * lúc đang có sự cố. Trớ trêu là chính chú thích trong `drilldown.ts` đã cảnh
 * báo đúng kiểu lỗi này cho một tham số khác.
 *
 * CÁCH TEST NÀY CHẶN
 *
 * Nó đọc **mã nguồn** của từng trang đích và đòi hỏi trang đó có nhắc tới tên
 * tham số mà resolver phát ra. Đây là một phép kiểm thô — nó không chứng minh
 * trang lọc ĐÚNG (việc đó thuộc test hành vi của từng trang) — nhưng nó bắt
 * được đúng lớp lỗi "quên nối hoàn toàn", vốn là lớp đã thoát khỏi mọi test
 * hiện có suốt nhiều tháng.
 *
 * Thêm một `targetType` mới mà quên nối trang đích ⇒ test này ĐỎ.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, '../..')

function readSource(relativePath: string): string {
  return readFileSync(resolve(SRC, relativePath), 'utf8')
}

/**
 * Bảng đăng ký: mỗi `targetType` mà resolver biết → trang đích và tham số nó
 * phải đọc. `paramsRead` rỗng nghĩa là đường dẫn không mang query nào.
 *
 * ĐÂY LÀ NƠI PHẢI SỬA khi thêm loại drill-down mới. Cố ý bắt người thêm phải
 * khai ở đây, thay vì để test tự suy — tự suy thì thêm loại mới sẽ âm thầm
 * lọt qua.
 */
const CONTRACT: Array<{
  targetType: AttentionTargetType | string
  sampleId: string
  consumerFile: string
  paramsRead: string[]
}> = [
  { targetType: 'point', sampleId: 'UI-01', consumerFile: 'features/points/MonitorPage.tsx', paramsRead: ['point'] },
  { targetType: 'alarm', sampleId: 'ALM-001', consumerFile: 'features/operations/AlarmsPage.tsx', paramsRead: ['alarm'] },
  { targetType: 'modbus_device', sampleId: 'dev-1', consumerFile: 'features/modbus-rtu/pages/DevicesPage.tsx', paramsRead: ['q'] },
  { targetType: 'bus', sampleId: 'bus-1', consumerFile: 'features/modbus-rtu/pages/PortsPage.tsx', paramsRead: [] },
  { targetType: 'subsystem', sampleId: 'local_io', consumerFile: 'features/points/MonitorPage.tsx', paramsRead: ['group'] },
  { targetType: 'subsystem', sampleId: 'controller', consumerFile: 'features/dashboard/DiagnosticsPage.tsx', paramsRead: [] },
  { targetType: 'subsystem', sampleId: 'modbus', consumerFile: 'features/modbus-rtu/pages/OverviewPage.tsx', paramsRead: [] },
  { targetType: 'subsystem', sampleId: 'network', consumerFile: 'features/network/NetworkPage.tsx', paramsRead: [] },
  { targetType: 'subsystem', sampleId: 'historian', consumerFile: 'features/operations/TrendsPage.tsx', paramsRead: [] }
]

/** Liên kết deep link viết TRỰC TIẾP trong trang, không đi qua resolver. */
const DIRECT_LINKS: Array<{ from: string; param: string; consumerFile: string; note: string }> = [
  { from: 'features/points/MonitorPage.tsx', param: 'points', consumerFile: 'features/operations/TrendsPage.tsx', note: '"Mở trong Trends" ở khung lịch sử điểm' },
  { from: 'features/points/MonitorPage.tsx', param: 'objectId', consumerFile: 'features/dashboard/ActivityPage.tsx', note: '"Xem vết audit của điểm này"' }
]

describe('Hợp đồng deep link — chiều tiêu thụ', () => {
  it('mọi targetType resolver biết đều cho ra một đường dẫn nội bộ', () => {
    for (const row of CONTRACT) {
      const link = resolveDrilldown(row.targetType, row.sampleId)
      expect(link, `${row.targetType}/${row.sampleId} phải resolve được`).toBeTruthy()
      expect(link!.startsWith('/'), `${row.targetType} phải là đường dẫn nội bộ`).toBe(true)
    }
  })

  it.each(CONTRACT)(
    'trang đích của $targetType ($sampleId) thực sự đọc tham số resolver phát ra',
    (row) => {
      const link = resolveDrilldown(row.targetType, row.sampleId)!
      const query = new URLSearchParams(link.split('?')[1] ?? '')
      const emitted = [...query.keys()]

      // Bảng đăng ký phải khớp đúng những gì resolver phát ra.
      expect(emitted.sort(), `tham số phát ra cho ${row.targetType}/${row.sampleId} khác bảng đăng ký`).toEqual([...row.paramsRead].sort())

      const source = readSource(row.consumerFile)
      for (const param of emitted) {
        /* SIẾT SAU KIỂM TRA ĐỘC LẬP (B-01, 2026-08-18).
         *
         * Bản đầu chỉ hỏi `source.includes("'group'")` — tức "tên tham số có
         * xuất hiện đâu đó trong tệp không". Kiểm tra viên chứng minh nó VÔ
         * DỤNG với đúng chế độ hỏng cần chặn: xoá `searchParams.get('group')`
         * mà vẫn giữ `'group'` trong union type là gate xanh, trang thì hết
         * lọc. Một thành viên union hay một `value=` tình cờ đủ giữ nó xanh.
         *
         * Nay đòi đúng biểu thức ĐỌC tham số. Vẫn là phép kiểm tĩnh, nên nó
         * KHÔNG thay thế test hành vi — `MonitorPage.regressionLocks` và
         * `AlarmsPage.deepLink` mới là thứ chứng minh trang lọc đúng. Vai trò
         * của gate này là bắt lớp "quên nối hoàn toàn" trên MỌI trang đích
         * cùng lúc, kể cả trang chưa có test riêng. */
        const readsParam = new RegExp(`searchParams\\.get\\(\\s*['"\`]${param}['"\`]`).test(source)
        expect(
          readsParam,
          `${row.consumerFile} KHÔNG có biểu thức searchParams.get('${param}') mà drilldown.ts phát ra cho ${row.targetType}. `
          + 'Liên kết sẽ mở đúng trang nhưng không lọc gì — đúng lỗi F-UX-02/03/04.'
        ).toBe(true)
      }
    }
  )

  it.each(DIRECT_LINKS)(
    'liên kết trực tiếp ?$param từ $from được trang đích đọc',
    (row) => {
      const emitter = readSource(row.from)
      expect(emitter.includes(`?${row.param}=`), `${row.from} không còn phát ra ?${row.param}= (${row.note})`).toBe(true)
      const consumer = readSource(row.consumerFile)
      const readsParam = new RegExp(`searchParams\\.get\\(\\s*['"\`]${row.param}['"\`]`).test(consumer)
      expect(
        readsParam,
        `${row.consumerFile} KHÔNG có biểu thức searchParams.get('${row.param}') mà ${row.from} phát ra`
      ).toBe(true)
    }
  )

  it('bảng đăng ký phủ hết mọi nhánh case của resolver', () => {
    /* Đọc thẳng source của resolver để đếm số `case` — thêm một `case` mới mà
       quên khai vào CONTRACT thì test này đỏ, đúng mục đích của gate. */
    const source = readSource('shared/overview/drilldown.ts')
    const caseLabels = [...source.matchAll(/case '([a-z_]+)':/g)].map((match) => match[1])
    const registered = new Set(CONTRACT.map((row) => String(row.targetType)))
    for (const label of caseLabels) {
      expect(registered.has(label), `drilldown.ts có case '${label}' nhưng CONTRACT chưa khai trang đích`).toBe(true)
    }
  })

  it('mọi domain trong subsystemRoutes đều có trang đích đã khai', () => {
    const source = readSource('shared/overview/drilldown.ts')
    const block = source.slice(source.indexOf('subsystemRoutes'), source.indexOf('function resolveSubsystem'))
    const domains = [...block.matchAll(/^\s{2}([a-z_]+):/gm)].map((match) => match[1])
    expect(domains.length, 'không đọc được subsystemRoutes').toBeGreaterThan(0)
    const registered = new Set(CONTRACT.filter((row) => row.targetType === 'subsystem').map((row) => row.sampleId))
    for (const domain of domains) {
      expect(registered.has(domain), `subsystemRoutes có '${domain}' nhưng CONTRACT chưa khai trang đích`).toBe(true)
    }
  })
})
