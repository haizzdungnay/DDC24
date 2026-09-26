import { useI18n } from '../../../shared/i18n'
import {
  allowedActions,
  currentSession,
  isTerminalState,
  SIMULATION_SPEEDS,
  type SimulationAction,
  type SimulationSlice,
} from './simulationSession'

/**
 * `T59-815` / `PGM02-V22-WP-08` — thanh điều khiển phiên mô phỏng.
 *
 * Hai điều component này cố ý KHÔNG làm:
 *
 * - **Không đoán trạng thái.** Nhãn trạng thái và tập nút hoạt động đều đọc từ
 *   `session.state` do server trả về. Bấm Chạy chỉ khoá nút trong lúc chờ; chữ
 *   "Đang chạy" chỉ xuất hiện sau read-back.
 * - **Không ẩn nút vì thiếu quyền.** Vai không điều khiển được vẫn thấy đủ
 *   thanh này ở dạng chỉ đọc, kèm câu nói rõ vì sao. Ẩn đi làm người trực ca
 *   tưởng thiết bị không có khả năng đó.
 */
export function SimulationControls({
  slice,
  canControl,
  onAction,
  onStop,
  onStopActive,
  onFocusWatch,
}: {
  slice: SimulationSlice
  canControl: boolean
  onAction: (action: SimulationAction, speed?: number) => void
  onStop: () => void
  onStopActive?: () => void
  /** Đưa tiêu điểm xuống bảng giá trị đã hiển thị sẵn, không dựng bảng thứ hai. */
  onFocusWatch?: () => void
}) {
  const { pick } = useI18n()
  const session = currentSession(slice)
  const allowed = allowedActions(session)
  const busy = slice.pending !== null

  function enabled(action: SimulationAction): boolean {
    return canControl && !busy && allowed.includes(action)
  }

  return (
    <section
      className="space-y-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-2"
      aria-label={pick('Điều khiển mô phỏng', 'Simulation controls')}
    >
      {/* Băng rôn này là bất biến an toàn của cả màn hình, không phải trang trí:
          mọi giá trị dưới đây là ảnh ảo trong sandbox, không có đường nào ra
          thiết bị. Nó hiện ở MỌI trạng thái, kể cả khi phiên đã dừng. */}
      <p
        role="note"
        className="rounded-[var(--radius)] border border-[var(--c-warn-fg)] bg-[var(--c-warn-bg)] px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--c-warn-fg)]"
      >
        {pick('KHÔNG CÓ NGÕ RA THẬT — mọi giá trị chỉ tồn tại trong phiên mô phỏng',
              'NO REAL OUTPUT — every value exists only inside the simulation session')}
      </p>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold uppercase text-[var(--c-text)]">
          {pick('Mô phỏng', 'Simulation')}
        </span>
        <span
          className="rounded-full border border-[var(--c-border)] px-2 py-0.5 text-[11px] text-[var(--c-text-dim)]"
          data-testid="simulation-state"
        >
          {sessionStateLabel(pick, slice)}
        </span>
        {session && (
          <>
            <span className="text-[var(--c-text-dim)]">
              {pick('Thời gian ảo', 'Virtual time')}{' '}
              <span className="font-mono">{formatVirtualTime(session.virtualTimeMs)}</span>
            </span>
            <span className="text-[var(--c-text-dim)]">
              {pick('Nhịp cơ sở', 'Base tick')}{' '}
              <span className="font-mono">{session.baseTickMs === null ? '—' : `${session.baseTickMs} ms`}</span>
            </span>
            <span className="text-[var(--c-text-dim)]">
              {pick('Tốc độ', 'Speed')} <span className="font-mono">{session.speed}×</span>
            </span>
          </>
        )}
      </div>

      {session && (
        /* Danh tính đầy đủ của thứ đang chạy. Không có nó, người dùng không có
           cách nào biết mình đang mô phỏng bản lưu nào. */
        <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-[11px] text-[var(--c-text-dim)] sm:grid-cols-2">
          <div className="flex gap-1">
            <dt>{pick('Phiên', 'Session')}</dt>
            <dd className="font-mono">{session.sessionId}</dd>
          </div>
          <div className="flex gap-1">
            <dt>{pick('Revision nguồn', 'Source revision')}</dt>
            <dd className="font-mono">{session.sourceDraftRevisionId}</dd>
          </div>
          <div className="flex gap-1">
            <dt>{pick('Hash nội dung', 'Content hash')}</dt>
            <dd className="font-mono">{session.sourceContentSha256.slice(0, 12)}…</dd>
          </div>
          <div className="flex gap-1">
            <dt>{pick('Hết hạn', 'Expires')}</dt>
            <dd className="font-mono">{session.idleExpiresAt}</dd>
          </div>
        </dl>
      )}

      {!canControl && (
        <p role="status" className="text-[11px] text-[var(--c-text-dim)]">
          {pick('Vai của bạn xem được phiên mô phỏng nhưng không điều khiển được.',
                'Your role can view the simulation session but cannot control it.')}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1">
        <ControlButton label={pick('Chạy', 'Run')} enabled={enabled('RUN')} onClick={() => onAction('RUN')} />
        <ControlButton label={pick('Tạm dừng', 'Pause')} enabled={enabled('PAUSE')} onClick={() => onAction('PAUSE')} />
        <ControlButton label={pick('Một nhịp', 'Step')} enabled={enabled('STEP_CYCLE')} onClick={() => onAction('STEP_CYCLE')} />
        <ControlButton label={pick('Đặt lại', 'Reset')} enabled={enabled('RESET')} onClick={() => onAction('RESET')} />
        <span className="ml-1 text-[11px] text-[var(--c-text-dim)]">{pick('Tốc độ', 'Speed')}</span>
        {SIMULATION_SPEEDS.map((speed) => (
          <ControlButton
            key={speed}
            label={`${speed}×`}
            enabled={enabled('SET_SPEED') && session?.speed !== speed}
            onClick={() => onAction('SET_SPEED', speed)}
          />
        ))}
        <ControlButton
          label={pick('Dừng phiên', 'Stop session')}
          enabled={canControl && !busy && session !== null && !isTerminalState(session.state)}
          onClick={onStop}
        />
        <ControlButton
          label={pick('Ngắt phiên', 'Abort session')}
          enabled={canControl && !busy && (session !== null || typeof onStopActive === 'function')}
          onClick={() => {
            if (session) {
              onStop()
            } else if (onStopActive) {
              onStopActive()
            }
          }}
          disabledReason={pick('Chưa có phiên mô phỏng nào để ngắt.', 'No simulation session to abort.')}
        />
        {/* `T59-821` / `PGM-02A §3` — thanh SIMULATE có `Watch` và `Trace`.
          *
          * `Watch` là bảng giá trị theo biến, và nó ĐANG hiển thị sẵn ngay dưới
          * thanh này trong `SimulateWorkspace`; nút chỉ đưa tiêu điểm xuống đó
          * thay vì dựng một bảng thứ hai cho cùng dữ liệu.
          *
          * `Trace` thì CHƯA có bề mặt: API `listProgrammingSimulationTrace` tồn
          * tại nhưng chưa FE nào đọc nó. Nút vẫn hiện và vẫn khoá, kèm lý do
          * đọc được — ẩn nó đi sẽ làm người dùng tưởng tính năng không tồn tại
          * thay vì biết nó chưa được nối. */}
        <ControlButton
          label={pick('Theo dõi', 'Watch')}
          enabled={session !== null}
          disabledReason={session === null
            ? pick('Chưa mở phiên mô phỏng nên chưa có giá trị nào để theo dõi.',
                   'No simulation session is open, so there are no values to watch.')
            : undefined}
          onClick={() => onFocusWatch?.()}
        />
        <ControlButton
          label={pick('Vết', 'Trace')}
          enabled={false}
          disabledReason={pick(
            'Bề mặt Vết chưa được nối vào giao diện. Dịch vụ đã có, phần hiển thị thì chưa.',
            'The trace surface is not wired into the UI yet. The service exists; the view does not.',
          )}
          onClick={() => undefined}
        />
      </div>

      {slice.lastDenial && (
        /* Một lệnh bị từ chối KHÔNG đổi trạng thái phiên. Nói ra lý do và giữ
           nguyên thứ server xác nhận lần cuối. */
        <p role="alert" className="text-[11px] text-[var(--c-danger-fg)]">
          {slice.lastDenial.message}
        </p>
      )}
    </section>
  )
}

function ControlButton({
  label, enabled, onClick, disabledReason,
}: { label: string; enabled: boolean; onClick: () => void; disabledReason?: string }) {
  return (
    <button
      type="button"
      disabled={!enabled}
      onClick={onClick}
      /* Nút khoá phải NÊU LÝ DO. Một nút xám không giải thích buộc người dùng
         thử đi thử lại rồi tự dựng một lời giải thích sai. */
      title={!enabled ? disabledReason : undefined}
      className="rounded-[var(--radius)] border border-[var(--c-border)] px-2 py-1 text-[11px] text-[var(--c-text)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {label}
    </button>
  )
}

function sessionStateLabel(pick: (vi: string, en: string) => string, slice: SimulationSlice): string {
  switch (slice.status.kind) {
    case 'IDLE': return pick('Chưa mở phiên', 'No session')
    case 'STARTING': return pick('Đang mở phiên…', 'Starting…')
    case 'UNSUPPORTED': return pick('Không khả dụng', 'Unavailable')
    case 'RECONCILING': return pick('Đang đối chiếu…', 'Reconciling…')
    case 'ERROR': return pick('Lỗi', 'Error')
    case 'ACTIVE': return stateLabel(pick, slice.status.session.state)
  }
}

function stateLabel(pick: (vi: string, en: string) => string, state: string): string {
  switch (state) {
    case 'PREPARING': return pick('Đang chuẩn bị', 'Preparing')
    case 'PAUSED': return pick('Tạm dừng', 'Paused')
    case 'RUNNING': return pick('Đang chạy', 'Running')
    case 'COMPLETED': return pick('Đã kết thúc', 'Completed')
    case 'FAILED': return pick('Hỏng', 'Failed')
    case 'EXPIRED': return pick('Hết hạn', 'Expired')
    case 'STOPPED': return pick('Đã dừng', 'Stopped')
    default: return state
  }
}

/** `virtualTimeMs` là uint64 dạng chuỗi — không đổi sang Number để định dạng. */
function formatVirtualTime(value: string): string {
  const digits = value.replace(/^0+(?=\d)/, '')
  if (digits.length <= 3) return `0,${digits.padStart(3, '0')} s`
  const seconds = digits.slice(0, digits.length - 3)
  const milliseconds = digits.slice(digits.length - 3)
  return `${seconds},${milliseconds} s`
}
