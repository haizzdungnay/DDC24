import { ChevronDown } from 'lucide-react'
import { useI18n } from '../i18n'
import { cn } from '../utils'

/**
 * Nút đổi ngôn ngữ, DÙNG CHUNG cho mọi vỏ trang.
 *
 * Trước đây nút này chỉ tồn tại bên trong `TopBar`. `AppShell` ẩn `TopBar` ở
 * `lg` trên các route Programming (`G-01`: Programming đã có Feature Rail và
 * Global Context Bar riêng), mà không component nào tiếp quản — nên trên desktop,
 * trong toàn bộ Programming, người dùng KHÔNG có cách đổi ngôn ngữ. Một điều
 * khiển toàn cục biến mất theo route là lỗi, không phải lựa chọn bố cục.
 *
 * Tách ra đây để mỗi vỏ đặt nó vào đúng chỗ của mình mà không ai chép lại logic
 * `setLang`. Ràng buộc bất biến: **mỗi kích thước màn hình chỉ được thấy đúng
 * MỘT nút này** — hai nút cùng tên truy cập trên một màn hình buộc người dùng
 * trình đọc màn hình phải đoán, và làm mọi phép chọn theo vai trò trong test
 * thành mơ hồ. Bên gọi chịu trách nhiệm cho phần responsive đó qua `className`.
 */
export function LanguageToggle({
  compact = false,
  className,
}: {
  /**
   * Bản gọn cho hàng Global Context Bar cao 38 px (`overflow-hidden`): bỏ mũi
   * nhọn và hạ chiều cao. Không phải chỉ đổi cỡ chữ — một nút cao 40 px trong
   * hàng 38 px sẽ bị cắt mất một phần, và vùng bị cắt vẫn nhận được chuột.
   */
  compact?: boolean
  className?: string
}) {
  const { lang, setLang, pick } = useI18n()
  const next = lang === 'vi' ? 'en' : 'vi'
  return (
    <button
      type="button"
      data-testid="language-toggle"
      onClick={() => setLang(next)}
      /* Tên truy cập là HÀNH ĐỘNG (`Đổi ngôn ngữ`), không phải trạng thái
         (`VI`): người dùng trình đọc màn hình cần biết bấm vào thì gì xảy ra.
         Nhãn nhìn thấy vẫn là mã ngôn ngữ hiện tại, nên `title` nói rõ đích. */
      aria-label={pick('Đổi ngôn ngữ', 'Toggle language')}
      title={pick(`Đổi ngôn ngữ sang ${next.toUpperCase()}`, `Switch language to ${next.toUpperCase()}`)}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] font-semibold text-[var(--c-text)] transition hover:border-[var(--c-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]',
        compact ? 'h-6 px-1.5 text-[11px]' : 'h-10 gap-2 px-2 text-xs sm:px-3',
        className,
      )}
    >
      {lang.toUpperCase()}
      {!compact && <ChevronDown className="h-4 w-4" aria-hidden="true" />}
    </button>
  )
}
