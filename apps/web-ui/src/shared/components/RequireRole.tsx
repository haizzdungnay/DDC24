import { ShieldAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../features/auth'
import { roleAtLeast } from '../../features/auth'
import { useI18n } from '../i18n'
import type { UserRole } from '../types'

/**
 * Gate quyền ở tầng route — WEB-UX-005.
 *
 * Trước đây `RequireAdmin` tồn tại trong `App.tsx` nhưng **không bọc route nào**,
 * nên mọi trang kỹ thuật — chạy thử, ép output, cấu hình alarm, lịch vận hành,
 * quản lý người dùng — đều mở cho mọi phiên hợp lệ, kể cả `viewer`. Backend vẫn
 * trả 403 nên không leo thang quyền thật, nhưng người dùng chỉ-đọc đi vào một
 * trang đầy nút bấm rồi mỗi nút ném một lỗi khó hiểu.
 *
 * Hai khác biệt có chủ đích so với `RequireAdmin` cũ:
 *
 * 1. **Theo thang quyền, không so bằng.** `role === 'admin'` loại luôn cả những
 *    trang mà `operator` được phép vào. Nay dùng `roleAtLeast` khớp `roleRank`
 *    của backend.
 * 2. **Không đá về `/` trong im lặng.** `<Navigate to="/" replace />` đúng là
 *    lỗi B5a mà WEB-UX-007 phải sửa ở trang Lập trình: người dùng bấm vào menu,
 *    màn hình nhảy về Dashboard, không một lời giải thích, và họ sẽ bấm lại vì
 *    tưởng mình lỡ tay. Ở đây hiện hẳn một trang nói rõ cần quyền gì.
 */
export function RequireRole({ role, children }: { role: UserRole; children: ReactNode }) {
  const { session } = useAuth()
  const { pick } = useI18n()

  if (roleAtLeast(session?.role, role)) return <>{children}</>

  return (
    <div className="grid min-h-[320px] place-items-center">
      <div className="max-w-md rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-6 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-[var(--c-warn-fg)]" aria-hidden="true" />
        <h1 className="mt-4 text-lg font-semibold">{pick('Không đủ quyền truy cập', 'Insufficient permission')}</h1>
        <p className="mt-2 text-sm text-[var(--c-text-dim)]">
          {pick(
            `Trang này yêu cầu vai trò ${role.toUpperCase()} trở lên. Vai trò hiện tại: ${(session?.role ?? 'không xác định').toUpperCase()}.`,
            `This page requires role ${role.toUpperCase()} or higher. Current role: ${(session?.role ?? 'unknown').toUpperCase()}.`
          )}
        </p>
        <p className="mt-2 text-sm text-[var(--c-text-dim)]">
          {pick('Liên hệ quản trị viên nếu cần quyền này.', 'Contact an administrator if you need this access.')}
        </p>
        <Link className="mt-5 inline-block text-sm font-semibold text-[var(--c-accent)]" to="/">
          {pick('Về Bảng điều khiển', 'Back to Dashboard')}
        </Link>
      </div>
    </div>
  )
}
