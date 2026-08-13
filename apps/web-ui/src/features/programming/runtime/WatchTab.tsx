import { useI18n } from '../../../shared/i18n'
import { Panel } from '../../../shared/components/Panel'
import { StateBlock } from '../../../shared/components/StateBlock'
import { useProgrammingRuntimeMonitor } from '../api/queries'

/**
 * Tab "Theo dõi" của PGM-04 (`UJ-PROG-07`) — `OnlineWatch` (chỉ đọc) +
 * `TracePanel`. Gọi `GET /runtime/monitor` THẬT (không mock, xem
 * `useProgrammingRuntimeMonitor`) — backend hiện trả `503
 * PRG-ERR-UNAVAILABLE-001` vì hợp đồng UDS chưa có action mang sample runtime
 * theo Point (chỉ có snapshot vòng đời operation ở P3/P4). Đây là trạng thái
 * "chưa sẵn sàng" thật phản ánh đúng backend hiện tại, không phải placeholder.
 * `POST/GET/DELETE /runtime/traces` cùng lý do, chưa nối query riêng vì chưa
 * có gì để hiển thị khác ngoài cùng một lỗi 503.
 */
export function WatchTab() {
  const { pick } = useI18n()
  const monitor = useProgrammingRuntimeMonitor()

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title={pick('Theo dõi trực tuyến', 'Online watch')}>
        {monitor.status === 'loading' ? (
          <StateBlock state="loading" title={pick('Đang tải…', 'Loading…')} />
        ) : (
          <StateBlock
            state="offline"
            title={pick('Chưa sẵn sàng', 'Not available yet')}
            detail={
              monitor.error ??
              pick(
                'GET /runtime/monitor chưa có action UDS mang sample theo Point. Program/actual/owner/priority/TTL sẽ hiện khi Core bổ sung action này.',
                'GET /runtime/monitor has no UDS action carrying per-point samples yet. Program/actual/owner/priority/TTL will appear once Core adds it.'
              )
            }
            onRetry={monitor.refresh}
          />
        )}
      </Panel>
      <Panel title={pick('Bản ghi (Trace)', 'Trace')}>
        <StateBlock
          state="offline"
          title={pick('Chưa sẵn sàng', 'Not available yet')}
          detail={pick(
            'POST /runtime/traces chưa có action UDS tương ứng ở Core. Xem CHANGELOG mục TASK-PROG-505 để biết khoảng hở.',
            'POST /runtime/traces has no corresponding UDS action in Core yet. See the TASK-PROG-505 CHANGELOG entry for the gap.'
          )}
        />
      </Panel>
    </div>
  )
}
