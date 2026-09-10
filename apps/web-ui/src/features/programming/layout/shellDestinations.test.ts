import { describe, expect, it } from 'vitest'

import { PROGRAMMING_WORKSPACE_PATHS } from '../ProgrammingRoutes'
import { programmingRailItems } from './ProgrammingFeatureRail'
import { programmingMobileNavItems } from './ProgrammingMobileNav'

/**
 * `PLAN-FE-SHELL-062` WP-01 — CỔNG: mọi đích của shell Programming phải CÓ THẬT.
 *
 * BẤT BIẾN
 * --------
 * Một mục điều hướng chỉ được vô hiệu hoá vì **thiếu điều kiện** (chưa chọn
 * Project). **Không bao giờ** vì trang không tồn tại.
 *
 * VÌ SAO CẦN CỔNG CHỨ KHÔNG CHỈ XOÁ MỘT LẦN
 * -----------------------------------------
 * `Project Settings` không sinh ra từ một lần gõ nhầm. Nó sinh ra từ MỘT DÒNG
 * TÀI LIỆU — `60_..._PGM01_PLAN.md:229`: *"6 đích + Project Settings"* — rồi
 * được cài đặt trung thành theo dòng đó, kèm cả chú thích giải thích vì sao nó
 * phải xám. Xoá UI mà không có cổng thì đợt handoff sau chép lại y nguyên, và
 * lần sau cũng sẽ có một chú thích chu đáo giải thích vì sao nó xám.
 *
 * VÌ SAO ĐỐI CHIẾU ĐƯỢC BẰNG MÁY
 * ------------------------------
 * `PROGRAMMING_WORKSPACE_PATHS` là bảng route canonical, và sáu khoá của nó
 * TRÙNG KHỚP TUYỆT ĐỐI sáu `key` hợp lệ của rail. Cổng đọc thẳng bảng ấy — nếu
 * chép tay một danh sách thứ hai ở đây thì chính cổng lại trở thành thứ có thể
 * trôi khỏi route, đúng loại lỗi nó sinh ra để chặn.
 *
 * Quyết định canonical: `UD-PROG-008` — *"Sáu workspace PGM-01..06"*, CLOSED
 * theo `ADR-050.8`.
 */

const WORKSPACE_KEYS = new Set(Object.keys(PROGRAMMING_WORKSPACE_PATHS))

/* `exit` KHÔNG phải workspace: nó là lối ra khỏi focus mode (`R60-03`), trỏ ra
 * ngoài `/eng/programming`. Miễn trừ nó một cách CÓ TÊN thay vì nới lỏng cả
 * phép kiểm — một miễn trừ đọc được thì lần sau người ta còn chất vấn được. */
const NON_WORKSPACE_KEYS = new Set(['exit', 'execution'])

function railKeys(projectId: string | null): string[] {
  return programmingRailItems(projectId).map((item) => item.key)
}

function mobileKeys(projectId: string | null): string[] {
  const items = programmingMobileNavItems(projectId)
  return [...items.primary, ...items.more].map((item) => item.key)
}

describe('PLAN-FE-SHELL-062 — đích của shell Programming phải có thật', () => {
  it('G1: mọi mục của rail là một workspace đã khai route', () => {
    const unknown = railKeys('project-1').filter(
      (key) => !WORKSPACE_KEYS.has(key) && !NON_WORKSPACE_KEYS.has(key)
    )

    expect(unknown, `rail có đích không khai trong PROGRAMMING_WORKSPACE_PATHS: ${unknown.join(', ')}`)
      .toEqual([])
  })

  it('G2: mọi mục của bottom nav là một workspace đã khai route', () => {
    const unknown = mobileKeys('project-1').filter(
      (key) => !WORKSPACE_KEYS.has(key) && !NON_WORKSPACE_KEYS.has(key)
    )

    expect(unknown, `bottom nav có đích không khai trong PROGRAMMING_WORKSPACE_PATHS: ${unknown.join(', ')}`)
      .toEqual([])
  })

  /* Phép kiểm sắc nhất trong ba cái. Khi ĐÃ có Project, không còn lý do chính
   * đáng nào để một mục vô hiệu hoá — mọi điều kiện tiên quyết đã thoả. Mục nào
   * vẫn `to === null` thì đích của nó không tồn tại, và đó đúng là hình dạng
   * của lỗi này.
   *
   * G1/G2 bắt được mục mang `key` lạ; G3 bắt được cả mục mượn `key` hợp lệ mà
   * vẫn không có đích. */
  it('G3: khi đã có Project, không mục nào được vô hiệu vì thiếu trang', () => {
    const railDead = programmingRailItems('project-1').filter((item) => item.to === null)
    const mobile = programmingMobileNavItems('project-1')
    const mobileDead = [...mobile.primary, ...mobile.more].filter((item) => item.to === null)

    expect(railDead.map((item) => item.key), 'rail còn mục không có đích dù đã chọn Project').toEqual([])
    expect(mobileDead.map((item) => item.key), 'bottom nav còn mục không có đích dù đã chọn Project').toEqual([])
  })

  /* Giữ nguyên năng lực "vô hiệu vì THIẾU ĐIỀU KIỆN" — cổng trên không được
   * hiểu thành "cấm mọi mục vô hiệu". Chưa có Project thì ba đích soạn thảo vẫn
   * phải xám KÈM LÝ DO, và đó là hành vi đúng của `T59-503`. */
  it('vẫn cho phép vô hiệu khi CHƯA chọn Project, và luôn kèm lý do', () => {
    const disabled = programmingRailItems(null).filter((item) => item.to === null)

    expect(disabled.length).toBeGreaterThan(0)
    for (const item of disabled) {
      expect(item.disabledReason, `mục ${item.key} xám mà không nói lý do`).not.toBeNull()
    }
  })
})
