import { ClipboardCheck, RefreshCw, Save } from 'lucide-react'
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
 * `DEV-PROG-013/014` rút gọn phần chữ: tiêu đề còn một dòng, phụ đề dài đã bỏ —
 * nó lặp lại đúng thứ dải ngữ cảnh ngay phía trên đã nói, mà chiếm ~40 px chiều
 * cao của chính vùng soạn thảo.
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
  return (
    <header className="flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-xl font-bold text-[var(--c-text)]">{pick('Lập trình điều khiển', 'Control programming')}</h1>
      <div className="flex flex-wrap items-center gap-2">
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
