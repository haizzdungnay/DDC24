import { useI18n } from '../../../shared/i18n'
import { Panel } from '../../../shared/components/Panel'
import { StateBlock } from '../../../shared/components/StateBlock'
import { StatusBadge } from '../../../shared/components/StatusBadge'
import { useProgrammingAudit, useProgrammingOperations } from '../api/queries'
import type { ProgrammingRuntime } from '../model/types'

/**
 * Tab "Phiên bản & Bảo trì" của PGM-04 (`UJ-PROG-08`) — `PreviousVersionsDrawer`
 * + `AuditTimeline`. Rev A không có route "liệt kê mọi Revision của Project"
 * trong hợp đồng hiện hành (chỉ `GET /revisions/{id}` đơn lẻ) nên danh sách
 * "bản trước" ở đây giới hạn đúng những gì có AUTHORITY thật: Active + LKG từ
 * `GET /runtime`, và lịch sử thao tác từ `GET /operations`. Chọn Revision bất
 * kỳ để khôi phục (ngoài LKG) là khoảng hở BE cần route mới, ghi ở CHANGELOG.
 */
export function VersionsTab({ runtime }: { runtime: ProgrammingRuntime | null }) {
  const { pick } = useI18n()
  const operations = useProgrammingOperations(20)
  const audit = useProgrammingAudit(50)

  return (
    <div className="space-y-4">
      {/* F-UX-15: tab con phải có mốc tiêu đề riêng trong cây heading. `<h1>`
          thuộc layout của feature, `<h2>` thuộc màn hình cha, nên tab là
          `<h3>`. Ẩn thị giác vì thanh tab đã hiện tên. */}
      <h3 className="sr-only">{pick('Phiên bản & Bảo trì', 'Versions & Service')}</h3>
      <Panel title={pick('Bản đang vận hành và LKG', 'Active and last-known-good')}>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase text-[var(--c-text-dim)]">{pick('Đang vận hành', 'Active')}</dt>
            <dd className="font-mono text-[var(--c-text)]">{runtime?.activeRevisionId ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-[var(--c-text-dim)]">LKG</dt>
            <dd className="font-mono text-[var(--c-text)]">{runtime?.lkgRevisionId ?? '—'}</dd>
          </div>
        </dl>
      </Panel>

      <Panel title={pick('Lịch sử thao tác', 'Operation history')}>
        {operations.status === 'loading' ? (
          <StateBlock state="loading" title={pick('Đang tải…', 'Loading…')} />
        ) : operations.status === 'error' || !operations.data ? (
          <StateBlock state="error" title={pick('Không tải được lịch sử.', 'Could not load history.')} onRetry={operations.refresh} />
        ) : operations.data.items.length === 0 ? (
          <p className="text-sm text-[var(--c-text-dim)]">{pick('Chưa có thao tác nào.', 'No operations yet.')}</p>
        ) : (
          <>
          <ul className="space-y-2 md:hidden">
            {operations.data.items.map((operation) => (
              <li key={operation.operationId} className="rounded-[var(--radius)] border border-[var(--c-border)] p-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-[var(--c-text)]">{operation.kind ?? '—'}</span>
                  <StatusBadge state={operation.state === 'SUCCEEDED' ? 'online' : operation.state === 'FAILED' || operation.state === 'REJECTED' ? 'fault' : 'unknown'} label={operation.state} />
                </div>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
                  <dt className="text-[var(--c-text-dim)]">{pick('Bản đích', 'Target')}</dt><dd className="font-mono">{(operation.requestedRevisionId ?? '—').slice(0, 8)}</dd>
                  <dt className="text-[var(--c-text-dim)]">{pick('Cập nhật', 'Updated')}</dt><dd>{new Date(operation.updatedAt).toLocaleString()}</dd>
                </dl>
              </li>
            ))}
          </ul>
          <table className="hidden w-full text-left text-sm md:table">
            <thead>
              <tr className="text-xs uppercase text-[var(--c-text-dim)]">
                <th className="py-1 pr-3">{pick('Loại', 'Kind')}</th>
                <th className="py-1 pr-3">{pick('Trạng thái', 'State')}</th>
                <th className="py-1 pr-3">{pick('Bản đích', 'Target')}</th>
                <th className="py-1">{pick('Cập nhật', 'Updated')}</th>
              </tr>
            </thead>
            <tbody>
              {operations.data.items.map((operation) => (
                <tr key={operation.operationId} className="border-t border-[var(--c-border)]">
                  <td className="py-1 pr-3">{operation.kind ?? '—'}</td>
                  <td className="py-1 pr-3">
                    <StatusBadge state={operation.state === 'SUCCEEDED' ? 'online' : operation.state === 'FAILED' || operation.state === 'REJECTED' ? 'fault' : 'unknown'} label={operation.state} />
                  </td>
                  <td className="py-1 pr-3 font-mono text-xs">{(operation.requestedRevisionId ?? '—').slice(0, 8)}</td>
                  <td className="py-1 text-[var(--c-text-dim)]">{new Date(operation.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </>
        )}
      </Panel>

      <Panel title={pick('Nhật ký hoạt động', 'Audit timeline')}>
        {audit.status === 'loading' ? (
          <StateBlock state="loading" title={pick('Đang tải…', 'Loading…')} />
        ) : audit.status === 'error' || !audit.data ? (
          <StateBlock state="error" title={pick('Không tải được nhật ký.', 'Could not load the audit log.')} onRetry={audit.refresh} />
        ) : audit.data.items.length === 0 ? (
          <p className="text-sm text-[var(--c-text-dim)]">{pick('Chưa có hoạt động nào.', 'No activity yet.')}</p>
        ) : (
          <ul tabIndex={0} aria-label={pick('Danh sách nhật ký hoạt động có thể cuộn', 'Scrollable activity log')} className="max-h-64 space-y-1 overflow-y-auto text-sm focus:outline focus:outline-2 focus:outline-[var(--c-accent)]">
            {audit.data.items.map((entry) => (
              <li key={entry.auditId} className="flex items-center justify-between gap-2">
                <span className="text-[var(--c-text)]">{entry.action}</span>
                <span className="text-[var(--c-text-dim)]">
                  {entry.actorId} · {new Date(entry.occurredAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
