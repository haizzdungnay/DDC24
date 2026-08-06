import { useAuth, roleAtLeast } from '../../auth'
import { useModbusConfig } from '../useModbusConfig'

const NO_DATA = '—'

/**
 * MBR-B302/B303 — băng trạng thái cấu hình.
 *
 * Bản trước hiển thị chuỗi viết cứng "Trạng thái cấu hình iobus: Đồng bộ thành
 * công" và `Active rev {revision ?? 1}`. Cả hai đều sai theo cùng một kiểu: câu
 * đầu đúng kể cả khi iobus đang chạy cấu hình của tuần trước, câu sau bịa ra
 * revision 1 cho một hệ thống chưa apply lần nào. Người vận hành sắp phát lệnh
 * xuống thiết bị hiện trường không có cách nào phân biệt "đã đồng bộ" thật với
 * dòng chữ trang trí.
 *
 * Nay mỗi phần đến từ một nguồn có thẩm quyền, và thiếu nguồn thì hiện "—".
 */
export function ConfigStateBanner() {
  const { state, lifecycle, save, apply, discard, status, locked } = useModbusConfig()
  const { session } = useAuth()
  const canEdit = roleAtLeast(session?.role, 'admin')

  const running = state?.running_on_iobus
  const dirty = lifecycle === 'DIRTY' || lifecycle === 'FAILED'
  /* `diff` PHẢI được chắn riêng, không dựa vào `state?.` — optional chaining
   * chỉ chắn `state`, còn `state.diff` vẫn có thể là `null`. Backend Go tuần tự
   * hoá nil slice thành `null`, nên `state?.diff.length` nổ TypeError ngay
   * trong lúc render; và vì banner nằm ở layout, React unmount CẢ cây và mọi
   * tab Modbus RTU thành trang trắng (sự cố board 2026-08-06). */
  const diff = state?.diff ?? []
  const changeCount = diff.length

  const tone =
    lifecycle === 'FAILED' ? 'border-red-500/50 bg-red-500/5'
      : lifecycle === 'APPLYING' ? 'border-blue-500/50 bg-blue-500/5'
        : dirty ? 'border-amber-500/50 bg-amber-500/5'
          : 'border-[var(--c-border)] bg-[var(--c-surface-2)]'

  return (
    <div className={`rounded-[var(--radius)] border p-3 text-xs ${tone}`} data-testid="modbus-config-banner">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono">
          <span data-testid="config-lifecycle" className="font-semibold">
            {lifecycle === 'CLEAN' && 'Không có thay đổi chờ áp dụng'}
            {lifecycle === 'DIRTY' && `Có ${changeCount} thay đổi chưa áp dụng`}
            {lifecycle === 'APPLYING' && 'Đang áp dụng…'}
            {lifecycle === 'FAILED' && 'Lần áp dụng gần nhất THẤT BẠI'}
          </span>
          <span>
            Revision đã lưu:{' '}
            <span data-testid="active-revision">
              {state ? state.active_revision : NO_DATA}
            </span>
          </span>
          <span data-testid="iobus-sync">
            {/* Không liên lạc được iobus là KHÔNG BIẾT, không phải "đã đồng bộ". */}
            {!running || !running.reachable
              ? `iobus đang chạy: ${NO_DATA} (không liên lạc được)`
              : running.in_sync
                ? `iobus đang chạy revision ${running.config_revision} · khớp`
                : `iobus đang chạy revision ${running.config_revision} · LỆCH với bản đã lưu`}
          </span>
          {state?.active_checksum && (
            <span className="opacity-70">checksum {state.active_checksum.slice(0, 12)}…</span>
          )}
        </div>

        {canEdit && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="h-8 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] px-3 font-semibold disabled:opacity-50"
              disabled={locked || !dirty}
              onClick={() => void discard()}
            >
              Bỏ thay đổi
            </button>
            <button
              type="button"
              className="h-8 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] px-3 font-semibold disabled:opacity-50"
              disabled={locked}
              onClick={() => void save()}
            >
              Lưu nháp
            </button>
            <button
              type="button"
              data-testid="apply-config"
              className="h-8 rounded-[var(--radius)] border border-[var(--c-primary,#2563eb)] bg-[var(--c-primary,#2563eb)]/10 px-3 font-semibold text-[var(--c-primary,#2563eb)] disabled:opacity-50"
              disabled={locked || !dirty}
              onClick={() => void apply()}
            >
              {locked ? 'Đang áp dụng…' : 'Áp dụng xuống thiết bị'}
            </button>
          </div>
        )}
      </div>

      {state?.last_error && lifecycle === 'FAILED' && (
        <p className="mt-2 text-[var(--c-danger,#c00)]" role="alert">
          {state.last_error}
        </p>
      )}
      {status && (
        <p className="mt-2 text-[var(--c-text-dim)]" role="status">{status}</p>
      )}
      {dirty && changeCount > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[var(--c-text-dim)]">
            Xem {changeCount} thay đổi sẽ được phát xuống thiết bị
          </summary>
          <ul className="mt-2 space-y-1 font-mono text-[11px]">
            {diff.map((entry, index) => (
              <li key={`${entry.kind}-${entry.id}-${entry.field ?? index}`}>
                [{entry.kind}] {entry.id}
                {entry.action === 'modified' && entry.field
                  ? `: ${entry.field} ${entry.before || NO_DATA} → ${entry.after || NO_DATA}`
                  : ` — ${entry.action === 'added' ? 'thêm mới' : 'xoá'}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
