import { describe, expect, it } from 'vitest'
/* Đọc nguồn bằng builtin của Node (test chạy trong Node), KHÔNG dùng `?raw`
   của Vite: `apps/hmi` nằm NGOÀI root của Vite nên bị `Denied ID`, và nới
   `server.fs.allow` chỉ để phục vụ một test là đánh đổi sai. Kiểu của ba
   builtin được khai tối thiểu tại `src/node-builtins.d.ts` — dự án cố ý không
   cài `@types/node` (lý do ở đầu `theme/tokens.ts`). */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import type { PointQuality } from './types'

/**
 * Kiểm chéo từ vựng trạng thái giữa **HMI local (C++/LVGL)** và **Web (TS)**.
 * `T57-0.10` của Plan 57, đóng đề xuất §6.19-P1 của
 * `REV-FE-UIUX-UC-2026-08-18`.
 *
 * VÌ SAO CẦN
 *
 * `KX-DDC24-UX-SYSTEM-001` §1.5 đặt ra một luật rõ ràng: "cùng một ý nghĩa →
 * cùng chữ/icon/hình; Web và HMI local dùng chung semantic state dù layout
 * khác nhau." Nhưng hai bề mặt nằm ở hai ngôn ngữ, hai codebase, hai quy trình
 * build — và **không có gì khoá luật đó**. Sửa nhãn ở một bên là chuyện của
 * một dòng; phát hiện ra bên kia đã lệch là chuyện của một chuyến đi hiện
 * trường, khi kỹ thuật viên đọc "STALE" trên màn hình tủ và "Dữ liệu cũ" trên
 * điện thoại rồi không chắc có phải cùng một tình trạng không.
 *
 * PHẠM VI
 *
 * Chỉ kiểm **từ vựng chất lượng điểm** — tập giá trị mà cả hai bề mặt đều phải
 * trình bày và là tập đã được `UX_REQ_PA3_WEB` §1.1 chốt nghĩa. Không kiểm
 * nhãn điều hướng hay nhãn màn hình: HMI cố ý có IA riêng (5 surface, theo
 * ADR-016), nên đòi trùng ở đó là đòi sai.
 *
 * Test đọc thẳng bảng chuỗi C++ thay vì phải dựng code-gen dùng chung. Thô,
 * nhưng bắt đúng lớp lỗi cần bắt và không thêm bước build nào cho firmware.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../../..')

function readSource(relativePath: string): string {
  return readFileSync(resolve(REPO, relativePath), 'utf8')
}

/** Đọc khối `/* Quality *\/` trong bảng chuỗi tiếng Anh của HMI. */
function readHmiQualityVocabulary(): string[] {
  const source = readSource('apps/hmi/i18n/locale.cpp')
  const englishTable = source.slice(source.indexOf('STR_EN['), source.indexOf('STR_VI['))
  const marker = englishTable.indexOf('/* Quality */')
  expect(marker, 'không tìm thấy khối /* Quality */ trong bảng tiếng Anh của HMI').toBeGreaterThan(-1)
  const line = englishTable.slice(marker).split('\n')[1] ?? ''
  return [...line.matchAll(/"([^"]+)"/g)].map((match) => match[1])
}

/** Từ vựng chất lượng của Web — nguồn là `StateAtoms.qualityVisuals`. */
const WEB_QUALITY: Record<PointQuality, string> = {
  good: 'GOOD',
  uncertain: 'UNCERTAIN',
  bad: 'BAD',
  stale: 'STALE',
  offline: 'OFFLINE'
}

describe('Từ vựng trạng thái HMI ↔ Web (UX-SYSTEM-001 §1.5)', () => {
  it('bảng đối chiếu của test khớp đúng qualityVisuals thật của Web', () => {
    /* Nếu ai đó đổi nhãn trong `StateAtoms` mà quên file này, test phải đỏ ở
       đây trước — nếu không, phần đối chiếu bên dưới sẽ so với một bản chép
       tay đã lỗi thời và im lặng cho qua. */
    const stateAtomsSource = readSource('apps/web-ui/src/shared/components/pa3/StateAtoms.tsx')
    const block = stateAtomsSource.slice(stateAtomsSource.indexOf('const qualityVisuals'), stateAtomsSource.indexOf('const chipClass'))
    for (const [quality, label] of Object.entries(WEB_QUALITY)) {
      const row = new RegExp(`${quality}:\\s*\\{[^}]*label:\\s*'${label}'`)
      expect(row.test(block), `StateAtoms.qualityVisuals.${quality} không còn nhãn '${label}'`).toBe(true)
    }
  })

  it('mọi nhãn chất lượng HMI đều tồn tại trong từ vựng Web', () => {
    const hmi = readHmiQualityVocabulary()
    expect(hmi.length, 'khối Quality của HMI rỗng — có thể bảng chuỗi đã đổi cấu trúc').toBeGreaterThan(0)
    const web = new Set(Object.values(WEB_QUALITY))
    for (const label of hmi) {
      expect(
        web.has(label),
        `HMI hiển thị chất lượng '${label}' nhưng Web không có nhãn này. `
        + 'UX-SYSTEM-001 §1.5: cùng một ý nghĩa phải dùng cùng một chữ trên cả hai bề mặt.'
      ).toBe(true)
    }
  })

  it('ghi nhận rõ trạng thái Web có mà HMI chưa có, thay vì để lệch âm thầm', () => {
    const hmi = new Set(readHmiQualityVocabulary())
    const missingOnHmi = Object.values(WEB_QUALITY).filter((label) => !hmi.has(label))

    /* KHOẢNG HỞ ĐÃ BIẾT VÀ ĐƯỢC CHẤP NHẬN CÓ Ý THỨC.
     *
     * HMI hiện không có `OFFLINE`. Đây không phải lỗi chính tả mà là khác biệt
     * mô hình: `screen_io.cpp` suy chất lượng từ `KX_Q_*` của SHM cộng cờ
     * `stale`, và mất liên lạc với MCU được thể hiện bằng dải "I/O FAULT —
     * Check MCU connection" ở mức toàn màn hình, không phải bằng một nhãn trên
     * từng điểm.
     *
     * Test khoá danh sách này lại để nó không âm thầm DÀI THÊM. Muốn thêm một
     * trạng thái mới vào Web thì phải quyết định HMI làm gì với nó, ngay tại
     * lúc thêm — chứ không phải phát hiện ra sau vài tháng ở hiện trường. */
    expect(missingOnHmi).toEqual(['OFFLINE'])
  })
})
