import { ClipboardCheck, RefreshCw, Save } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useI18n } from '../../../shared/i18n'
import { Button } from '../../../shared/components/Button'
import type { ProgrammingEditingContext } from './ProgrammingLayout'

/**
 * `ProgrammingHeader` — UX §16.1.4/§22/§23.
 *
 * `DEV-PROG-009` đưa `Lưu` và `Kiểm tra` lên đây. Chúng KHÔNG rời khỏi thanh
 * công cụ của trình soạn thảo: người đang gõ cần nút ngay cạnh chỗ gõ, còn
 * người vừa quay lại trang cần một chỗ cố định luôn nhìn thấy. Hai chỗ bấm cho
 * MỘT hành động là đúng ý đồ — điều bị cấm là hai chỗ dựng ra hai lệnh khác
 * nhau, nên header chỉ gọi lại đúng hành động mà workspace đã đăng ký
 * (`ProgrammingEditingContext.actions`), không tự dựng batch operation.
 *
 * Không có workspace nào đăng ký hành động (Tổng quan, Runtime…) ⇒ hai nút
 * KHÔNG hiện. Một nút chết luôn nằm đó dạy người dùng rằng nó không dùng được,
 * và họ sẽ thôi nhìn nó cả lúc nó sống.
 *
 * TIÊU ĐỀ ROUTE — `<h1>` ẨN NHÌN, KHÔNG ẨN VỚI TRÌNH ĐỌC MÀN HÌNH
 * -------------------------------------------------------------
 * `TASK-FBD-05-6` bỏ khối tiêu đề nhìn thấy được ở đây, và bỏ đúng: dải ngữ
 * cảnh ngay phía trên đã nói người dùng đang ở đâu, còn ~40 px chiều cao mà
 * khối đó chiếm là chiều cao cắt thẳng vào vùng vẽ FBD.
 *
 * Nhưng "không cần nhìn thấy" khác "không cần tồn tại". Gỡ luôn thẻ `<h1>` thì
 * cả sáu workspace của route Programming mất mốc gốc của cây heading: người
 * dùng trình đọc màn hình nhảy theo phím tắt heading sẽ rơi thẳng vào `<h2>`
 * của trang con mà không biết mình đang ở nhánh nào, và hợp đồng `F-UX-15`
 * (`route-menu-contract.test.ts`, N-08 — mỗi route đúng MỘT `<h1>`, do layout
 * sở hữu) đứt. Chú thích trong cả bốn trang con vẫn trỏ về đây làm nơi giữ
 * `<h1>`, nên đây là chỗ duy nhất trả lại được nó.
 *
 * Vì vậy `<h1>` ở lại dưới dạng `sr-only`: chiếm 0 px bố cục — giữ nguyên ý đồ
 * dọn chiều cao của `TASK-FBD-05-6` — nhưng vẫn nằm trong cây trợ năng.
 */
export function ProgrammingHeader({
  onRefresh,
  refreshing,
  actions
}: {
  onRefresh: () => void
  refreshing: boolean
  actions?: ProgrammingEditingContext['actions']
}) {
  const { pick } = useI18n()
  const location = useLocation()
  const mapping = location.pathname.includes('/mapping')
  return (
    <header className="flex w-full flex-col items-stretch gap-2">
      <h1 className="sr-only">{pick('Lập trình điều khiển', 'Control programming')}</h1>
      <div className={`flex w-full flex-wrap items-center justify-end gap-2 ${mapping ? 'border-b border-[var(--c-border)] pb-2' : ''}`}>
        {actions && (
          <>
            {/* Tên truy cập khác nút `Lưu` của thanh công cụ trình soạn thảo,
                dù nhãn nhìn thấy giống nhau. Hai nút cùng tên trên một màn hình
                buộc người dùng trình đọc màn hình phải đoán cái nào là cái nào —
                và nó cũng làm mọi phép chọn theo vai trò trong test thành mơ hồ.
                Tên đầy đủ CHỨA nhãn nhìn thấy, đúng WCAG 2.5.3. */}
            <Button
              size="sm"
              aria-label={pick('Lưu bản nháp', 'Save the draft')}
              icon={<Save className="h-4 w-4" aria-hidden="true" />}
              loading={actions.saving}
              disabled={actions.saveDisabledReason !== null}
              /* Nút bị khoá phải NÓI vì sao. Một nút xám im lặng buộc người dùng
                 đoán, và họ thường đoán là "hỏng". */
              title={actions.saveDisabledReason ?? pick('Lưu bản nháp', 'Save the draft')}
              onClick={actions.onSave}
            >
              {pick('Lưu', 'Save')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              aria-label={pick('Kiểm tra gói', 'Check the package')}
              icon={<ClipboardCheck className="h-4 w-4" aria-hidden="true" />}
              disabled={actions.checkDisabledReason !== null}
              title={actions.checkDisabledReason ?? pick('Kiểm tra gói (mở PGM-03)', 'Check the package (opens PGM-03)')}
              onClick={actions.onCheck}
            >
              {pick('Kiểm tra', 'Check')}
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="disabled:opacity-100"
          icon={<RefreshCw className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden="true" />}
          onClick={onRefresh}
          disabled={refreshing}
          aria-busy={refreshing}
        >
          {pick('Làm mới', 'Refresh')}
        </Button>
      </div>
    </header>
  )
}
