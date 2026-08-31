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
 * TIÊU ĐỀ THEO TRANG (hợp nhất `DEV-PROG-013/014` với `PR #311`)
 * -------------------------------------------------------------
 * Hai lát đụng nhau ở đúng chỗ này và cả hai đều có lý:
 *
 * - `DEV-PROG-013/014` bỏ phụ đề dài vì nó lặp lại thứ dải ngữ cảnh ngay trên
 *   đã nói, mà chiếm ~40 px chiều cao của chính vùng soạn thảo.
 * - `PR #311` muốn Tổng quan có tiêu đề lớn kèm phụ đề, vì đó là trang đích đầu
 *   tiên và người dùng cần biết mình vừa mở cái gì.
 *
 * Điều kiện hoà giải là ROUTE: chỉ **Tổng quan** mới có ngân sách chiều cao để
 * mang phụ đề — nó không có trình soạn thảo tranh chỗ. Năm workspace còn lại
 * giữ tiêu đề một dòng. Đây không phải thoả hiệp nửa vời mà là điều kiện đúng:
 * ràng buộc chiều cao chỉ tồn tại ở nơi có editor.
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
  const overview = location.pathname === '/eng/programming' || location.pathname === '/eng/programming/'
  const mapping = location.pathname.includes('/mapping')
  return (
    <header className={`flex flex-wrap justify-between gap-2 ${mapping ? 'flex-col items-stretch' : overview ? 'items-start' : 'items-center'}`}>
      <div className={`min-w-0 ${mapping ? 'sr-only' : ''}`}>
        {overview && !mapping && (
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--c-accent)]">
            Programming workstation
          </p>
        )}
        <h1 className={`${overview ? 'text-2xl' : 'text-xl'} font-bold text-[var(--c-text)]`}>
          {pick('Lập trình điều khiển', 'Control programming')}
        </h1>
        {overview && !mapping && (
          <p className="mt-1 text-sm text-[var(--c-text-dim)]">
            {pick(
              'Theo dõi ứng dụng đang chạy, tiếp tục bản nháp và xử lý các vấn đề cần chú ý.',
              'Monitor the running application, continue draft work, and resolve items requiring attention.'
            )}
          </p>
        )}
      </div>
      <div className={`flex flex-wrap items-center gap-2 ${mapping ? 'justify-end border-b border-[var(--c-border)] pb-2' : ''}`}>
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
