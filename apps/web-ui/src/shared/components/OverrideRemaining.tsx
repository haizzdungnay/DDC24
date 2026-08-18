import { ShieldAlert } from 'lucide-react'
import { useI18n } from '../i18n'
import { isOverrideExpiringSoon } from '../overview/overrides'
import { NO_DATA, cn, formatCountdown } from '../utils'

/**
 * Ô "Còn lại" của một lệnh ép tay — dùng chung Landing (`T57-1.2`) và Monitor
 * (`T57-1.3`).
 *
 * ## Vì sao là component dùng chung chứ không viết ở mỗi trang
 *
 * Ba trạng thái dưới đây phải TRÔNG khác nhau, và đó chính là chỗ dễ trôi nhất
 * nếu mỗi trang tự vẽ: một trang hiện `00:00` cho điểm không có thời hạn còn
 * trang kia hiện `—` thì người trực buộc phải chọn tin trang nào.
 *
 * | `remainingS` | Trình bày | Nghĩa |
 * |---|---|---|
 * | có, còn nhiều | `mm:ss` | lệnh sẽ tự nhả |
 * | có, sắp hết | `mm:ss` + icon + nhãn chữ "SẮP HẾT HẠN" | cần quyết định gia hạn hay để nhả |
 * | `undefined` | `—` + nhãn "KHÔNG CÓ THỜI HẠN" | lệnh **không** tự nhả, phải nhả bằng tay |
 *
 * ## Vì sao dấu hiệu sắp-hết-hạn không được chỉ là màu
 *
 * `UX_REQ_PA3_WEB` §11 và WCAG 2.2 §1.4.1 cấm truyền trạng thái bằng màu đơn
 * thuần. Ô này nằm trên đường ra quyết định "có gia hạn không", và trên một
 * bảng 29 hàng thì màu vàng nhạt giữa các hàng xám là thứ mắt lướt qua đầu tiên.
 */
export function OverrideRemaining({ remainingS, compact = false }: { remainingS?: number; compact?: boolean }) {
  const { pick } = useI18n()
  const expiringSoon = isOverrideExpiringSoon(remainingS)

  if (remainingS === undefined) {
    return (
      <span className="block leading-tight">
        <span className="mono block font-semibold text-[var(--c-text-dim)]">{NO_DATA}</span>
        <span className={cn('block font-semibold uppercase text-[var(--c-text-dim)]', compact ? 'text-[9px]' : 'text-[10px]')}>
          {pick('không có thời hạn', 'no expiry')}
        </span>
      </span>
    )
  }

  return (
    <span className="block leading-tight">
      <span className="flex items-center gap-1">
        {expiringSoon && <ShieldAlert className={cn('shrink-0 text-[var(--c-warn-fg)]', compact ? 'h-3 w-3' : 'h-3.5 w-3.5')} aria-hidden="true" />}
        <span className={cn('mono font-semibold', expiringSoon ? 'text-[var(--c-warn-fg)]' : 'text-[var(--c-text)]')}>
          {formatCountdown(remainingS)}
        </span>
      </span>
      {expiringSoon && (
        <span className={cn('block font-semibold uppercase text-[var(--c-warn-fg)]', compact ? 'text-[9px]' : 'text-[10px]')}>
          {pick('sắp hết hạn', 'expiring soon')}
        </span>
      )}
    </span>
  )
}
