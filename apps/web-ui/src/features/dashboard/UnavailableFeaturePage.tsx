import { Construction } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useI18n } from '../../shared/i18n'

/**
 * Trang giải thích cho tính năng chưa khả dụng — WEB-UX-007.
 *
 * Trước đây route `/eng/programming` là
 * `LEGACY_GRAPH_DEMO_ENABLED ? <ProgrammingPage/> : <Navigate to="/" replace />`.
 * Mục "Lập trình" vẫn nằm trong menu ở bản demo, nên người dùng bấm vào rồi bị
 * đá về Dashboard mà không một lời giải thích. Phản ứng tự nhiên là bấm lại lần
 * nữa, rồi kết luận sản phẩm hỏng.
 *
 * Ở bản live mục menu đã bị lọc đi (xem `NavRail`), nên trang này chỉ gặp khi
 * người dùng gõ thẳng URL hoặc mở một deep link cũ — vẫn cần một câu trả lời tử
 * tế thay vì im lặng chuyển hướng.
 */
export function UnavailableFeaturePage({ title, reason }: { title: string; reason: string }) {
  const { pick } = useI18n()
  return (
    <div className="grid min-h-[320px] place-items-center">
      <div className="max-w-md rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-6 text-center">
        <Construction className="mx-auto h-10 w-10 text-[var(--c-warn-fg)]" aria-hidden="true" />
        <h1 className="mt-4 text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-[var(--c-text-dim)]">{reason}</p>
        <Link className="mt-5 inline-block text-sm font-semibold text-[var(--c-accent)]" to="/">
          {pick('Về Bảng điều khiển', 'Back to Dashboard')}
        </Link>
      </div>
    </div>
  )
}
