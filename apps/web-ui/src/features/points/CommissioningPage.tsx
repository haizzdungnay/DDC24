import { AlertTriangle, CheckCircle2, Play, RotateCcw, ShieldOff, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../../shared/api/client'
import { useAuth } from '../auth'
import { Button } from '../../shared/components/Button'
import { Modal } from '../../shared/components/Modal'
import { Panel } from '../../shared/components/Panel'
import { PointCard } from '../../shared/components/PointCard'
import { StateBlock } from '../../shared/components/StateBlock'
import { useToast } from '../../shared/components/Toast'
import { useApi } from '../../shared/hooks/useApi'
import { useI18n } from '../../shared/i18n'
import { useOptionalOverview } from '../../shared/overview/OverviewProvider'
import type { CommissioningTestResult, Point } from '../../shared/types'
import { NO_DATA, formatDateTime, pointDisplayTag } from '../../shared/utils'

/**
 * Trang Chạy thử — WEB-UX-004.
 *
 * Bản trước dài đúng 43 dòng và mỗi nút là **một lệnh ghi thẳng ra thiết bị,
 * không xác nhận, không hoàn tác**:
 *
 * - `Test` gọi `test(point, point.kind === 'DO' ? true : 50)`. Một cú click mở
 *   van 50% hoặc đóng contactor. Con số 50 gán cứng, người vận hành không chọn
 *   được, và không có gì hỏi lại trước khi lệnh đi.
 * - `Release` gọi cùng hàm đó với 0/false. Nhãn nói "trả quyền", hành vi thật là
 *   **ghi 0**. Trên van sưởi mùa đông, "trả quyền" đóng van về 0% không giống
 *   chút nào việc trả điều khiển lại cho vòng lặp tự động.
 * - Không có `refreshMs`: sau khi ghi, giá trị hiển thị đứng im tới khi người
 *   dùng tự tải lại trang, nên không quan sát được cơ cấu có phản hồi hay không
 *   — mà quan sát phản hồi chính là toàn bộ lý do tồn tại của trang chạy thử.
 * - Không xử lý `state.error`: API hỏng thì trang hiện danh sách rỗng, trông y
 *   hệt "thiết bị không có output nào".
 *
 * Nguyên tắc §3.1.2 của plan 45: mọi hành động tác động vật lý phải có xác nhận
 * nêu rõ hậu quả VÀ có gate quyền. Gate ở tầng route là WEB-UX-005; ở đây trang
 * tự khoá thêm một lớp theo đúng mẫu `canManageNetwork` của trang Mạng, để một
 * sai sót cấu hình route không tự nó mở đường ghi ra thiết bị.
 */

const REFRESH_MS = 1000

type PendingAction =
  | { kind: 'test'; point: Point; value: number | boolean; ttlS: number }
  | { kind: 'release'; point: Point }
  | { kind: 'release-all'; points: Point[] }

/* ISS-PIO-26 — mỗi lệnh chạy thử mang một thời hạn do Core cưỡng chế.
 *
 * Không có lựa chọn "giữ vô hạn" trong danh sách này, và đó là chủ ý: đường ép
 * tay thường (trang Giám sát) mới là chỗ để giữ một điểm lâu dài, vì ở đó điểm
 * bị ép hiện thường trực kèm nút trả về. Trang này ngược lại — người dùng thử
 * lần lượt 8 output rồi rời đi, nên một lệnh không tự nhả sẽ để lại van mở mà
 * không ai còn nhìn màn hình nữa. Muốn giữ lâu thì dùng đường ép tay, có chủ
 * đích, chứ không phải bằng cách quên. */
const TTL_CHOICES_S = [60, 300, 900, 1800] as const
const DEFAULT_TTL_S = 300

type ParsedDraft = { value: number | boolean; error?: undefined } | { value: null; error: string }

/** Kết quả lần chạy thử gần nhất của một điểm, GIỮ LẠI trên màn hình.
 *
 *  PA3-504 — bản trước chỉ đẩy một toast rồi thôi. Toast biến mất sau vài giây,
 *  nên người làm commissioning phải nhớ trong đầu điểm nào đã thử, thử ra sao,
 *  lúc mấy giờ. Với 8 output và một biên bản nghiệm thu phải ký, đó là chỗ dễ
 *  sai nhất của cả quy trình. */
interface TestOutcome {
  result: CommissioningTestResult['result']
  message: string
  at: string
  requested: string
  scanMs?: number
  /** Thời hạn đã yêu cầu và thời hạn Core báo còn lại — ISS-PIO-26. Biên bản
   *  nghiệm thu cần biết lệnh giữ trong bao lâu, không chỉ "đã ghi". */
  ttlS?: number
  expiresInS?: number
}

/** Một điều kiện tiên quyết. `blocking` = chưa đạt thì KHÔNG cho ghi. */
interface Prerequisite {
  id: string
  label: string
  ok: boolean
  detail: string
  blocking: boolean
}

export function CommissioningPage() {
  const state = useApi(apiClient.getPoints, [], { refreshMs: REFRESH_MS })
  const toast = useToast()
  const { pick } = useI18n()
  const { session } = useAuth()
  const overview = useOptionalOverview()
  const canCommission = session?.role === 'admin' || session?.role === 'operator'

  const outputs = useMemo(() => (state.data ?? []).filter((point) => point.kind === 'AO' || point.kind === 'DO'), [state.data])
  const forced = useMemo(() => outputs.filter((point) => point.forced), [outputs])

  /* PA3-504 — điều kiện tiên quyết.
   *
   * Ghi ra một cơ cấu chấp hành khi authority đang mất liên lạc là thao tác mù:
   * lệnh có thể không tới nơi, và giá trị phản hồi trên màn hình là số cũ. Bản
   * trước không kiểm gì cả — nút Chạy thử luôn bấm được miễn là role đủ. */
  const prerequisites = useMemo<Prerequisite[]>(() => {
    const snapshot = overview?.data ?? null
    return [
      {
        id: 'authority',
        label: pick('Liên lạc với bộ điều khiển', 'Controller communication'),
        ok: snapshot ? snapshot.connected : !state.error,
        detail: snapshot
          ? (snapshot.connected
            ? pick('Core đang trả lời', 'Core is responding')
            : pick('Core không trả lời — lệnh ghi có thể không tới thiết bị', 'Core is not responding — write commands may not reach the device'))
          : pick('Chưa đọc được tổng quan; dựa theo trạng thái đọc điểm', 'Overview not loaded yet; based on point-read status'),
        blocking: true
      },
      {
        id: 'outputs',
        label: pick('Có output để chạy thử', 'Outputs available to test'),
        ok: outputs.length > 0,
        detail: outputs.length > 0
          ? pick(`${outputs.length} điểm AO/DO`, `${outputs.length} AO/DO points`)
          : pick('Authority không trả điểm AO/DO nào', 'Authority returned no AO/DO points'),
        blocking: true
      },
      {
        id: 'role',
        label: pick('Đủ quyền ghi', 'Sufficient write permission'),
        ok: canCommission,
        detail: canCommission
          ? pick(`Vai trò ${session?.role}`, `Role ${session?.role}`)
          : pick('Cần operator hoặc admin', 'Requires operator or admin'),
        blocking: true
      },
      {
        id: 'forced',
        label: pick('Không còn điểm kẹt ép tay từ phiên trước', 'No points still forced from a previous session'),
        ok: forced.length === 0,
        // KHÔNG chặn: đôi khi chính việc đang ép là chủ ý của phiên chạy thử.
        // Nhưng phải nói ra, vì đây là nguyên nhân phổ biến nhất của "thiết bị
        // không chạy theo lịch" sau một buổi commissioning.
        detail: forced.length === 0
          ? pick('Mọi output đang thuộc điều khiển tự động', 'All outputs are under automatic control')
          : pick(`${forced.length} điểm còn bị ép — cân nhắc trả về tự động trước khi bắt đầu`, `${forced.length} point(s) still forced — consider releasing them before starting`),
        blocking: false
      }
    ]
  }, [canCommission, forced.length, outputs.length, overview?.data, pick, session?.role, state.error])

  const blocked = prerequisites.some((item) => item.blocking && !item.ok)

  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [ttlS, setTtlS] = useState<number>(DEFAULT_TTL_S)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [busy, setBusy] = useState(false)
  const [running, setRunning] = useState<string | null>(null)
  const [outcomes, setOutcomes] = useState<Record<string, TestOutcome>>({})

  if (state.loading && !state.data) return <StateBlock state="loading" title={pick('Đang tải output', 'Loading outputs')} />
  /* Một lỗi tải KHÔNG được hiển thị như "không có output". Ở trang này sự nhầm
     lẫn đó dẫn thẳng tới kết luận sai về phần cứng. */
  if (state.error && !state.data) {
    return <StateBlock state="error" title={pick('Không tải được danh sách output', 'Could not load outputs')} detail={state.error.message} onRetry={state.refetch} />
  }

  function draftFor(point: Point): string {
    return drafts[point.id] ?? ''
  }

  function parseDraft(point: Point): ParsedDraft {
    if (point.kind === 'DO') {
      const raw = draftFor(point)
      if (raw !== 'on' && raw !== 'off') return { value: null, error: pick('Chọn ON hoặc OFF', 'Choose ON or OFF') }
      return { value: raw === 'on' }
    }
    const raw = draftFor(point).trim()
    if (raw === '') return { value: null, error: pick('Nhập giá trị cần ghi', 'Enter the value to write') }
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return { value: null, error: pick('Giá trị phải là số', 'Value must be a number') }
    if (parsed < 0 || parsed > 100) return { value: null, error: pick('Giá trị AO nằm trong 0–100%', 'AO value must be within 0–100%') }
    return { value: parsed }
  }

  function requestTest(point: Point) {
    const parsed = parseDraft(point)
    if (parsed.value === null) {
      toast.push('warn', `${pointDisplayTag(point)}: ${parsed.error}`)
      return
    }
    setPending({ kind: 'test', point, value: parsed.value, ttlS })
  }

  async function runPending() {
    if (!pending) return
    setBusy(true)
    try {
      if (pending.kind === 'test') {
        setRunning(pending.point.id)
        const requested = typeof pending.value === 'boolean' ? (pending.value ? 'ON' : 'OFF') : `${pending.value}%`
        try {
          const result = await apiClient.runCommissioningTest(pending.point.id, pending.value, pending.ttlS)
          /* Kết quả GIỮ trên màn hình, không chỉ thoáng qua trong toast: một
             buổi commissioning thử 8 output rồi phải ký biên bản, và toast biến
             mất sau vài giây (PA3-504). */
          setOutcomes((current) => ({
            ...current,
            [pending.point.id]: { result: result.result, message: result.message, at: new Date().toISOString(), requested, scanMs: result.scanMs, ttlS: result.ttlS, expiresInS: result.expiresInS }
          }))
          toast.push(result.result === 'passed' ? 'success' : 'warn', `${result.pointId}: ${result.message}`)
        } catch (err) {
          setOutcomes((current) => ({
            ...current,
            [pending.point.id]: { result: 'failed', message: err instanceof Error ? err.message : 'Lệnh thất bại', at: new Date().toISOString(), requested }
          }))
          throw err
        } finally {
          setRunning(null)
        }
      } else if (pending.kind === 'release') {
        await apiClient.forcePoint(pending.point.id, pending.point.value as number | boolean, true)
        toast.push('success', `${pointDisplayTag(pending.point)}: ${pick('đã trả về điều khiển tự động', 'returned to automatic control')}`)
      } else {
        /* Trả từng điểm một và đếm riêng: nếu một điểm hỏng, các điểm còn lại
           vẫn phải được trả về tự động. Bỏ cuộc giữa chừng sẽ để một phần thiết
           bị kẹt ở giá trị ép — đúng cái trạng thái mà thao tác này sinh ra để
           thoát khỏi. */
        let released = 0
        const failures: string[] = []
        for (const point of pending.points) {
          try {
            await apiClient.forcePoint(point.id, point.value as number | boolean, true)
            released += 1
          } catch (err) {
            failures.push(`${pointDisplayTag(point)} (${err instanceof Error ? err.message : 'error'})`)
          }
        }
        if (failures.length) toast.push('error', pick(`Đã trả ${released} điểm; còn lỗi: ${failures.join(', ')}`, `Released ${released}; still failing: ${failures.join(', ')}`))
        else toast.push('success', pick(`Đã trả ${released} điểm về điều khiển tự động`, `Released ${released} point(s) to automatic control`))
      }
      setPending(null)
      await state.refetch()
    } catch (err) {
      toast.push('error', err instanceof Error ? err.message : pick('Thao tác thất bại', 'Operation failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{pick('Chạy thử', 'Commissioning')}</h1>
          <p className="text-sm text-[var(--c-text-dim)]">{pick('Ghi trực tiếp ra AO/DO qua core — mọi lệnh đều được ghi audit log', 'Writes directly to AO/DO through core — every command is written to the audit log')}</p>
        </div>
        <div className="flex items-end gap-3">
          {/* ISS-PIO-26 — thời hạn nằm NGAY CẠNH nút ghi, không giấu trong một
              trang cài đặt: nó là một phần của lệnh sắp gửi, và người vận hành
              phải thấy được mình đang ép thiết bị trong bao lâu. */}
          <label className="block text-xs text-[var(--c-text-dim)]">
            {pick('Tự nhả sau', 'Auto-release after')}
            <select
              className="mt-1 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
              aria-label={pick('Thời hạn tự nhả cho lệnh chạy thử', 'Auto-release timeout for commissioning commands')}
              value={String(ttlS)}
              disabled={!canCommission}
              onChange={(event) => setTtlS(Number(event.target.value))}
            >
              {TTL_CHOICES_S.map((seconds) => (
                <option key={seconds} value={seconds}>{formatTtl(seconds)}</option>
              ))}
            </select>
          </label>
          <Button
            variant="danger"
            icon={<ShieldOff className="h-4 w-4" />}
            disabled={!canCommission || forced.length === 0}
            onClick={() => setPending({ kind: 'release-all', points: forced })}
          >
            {pick('Trả tất cả về tự động', 'Release all to automatic')} ({forced.length})
          </Button>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-[var(--radius)] border border-[var(--c-fault)] bg-[var(--c-fault-bg)] p-4 text-sm">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--c-fault-fg)]" aria-hidden="true" />
        <p className="text-[var(--c-text)]">
          {pick(
            'Các lệnh trên trang này tác động trực tiếp lên cơ cấu chấp hành đang đấu nối: van, damper, contactor, biến tần. Chỉ dùng khi đã cô lập thiết bị hoặc đã báo cho người vận hành tại chỗ.',
            'Commands on this page act directly on connected actuators: valves, dampers, contactors, drives. Use only after isolating the equipment or notifying on-site operators.'
          )}
        </p>
      </div>

      {!canCommission && (
        <StateBlock
          state="empty"
          title={pick('Không đủ quyền chạy thử', 'Insufficient permission to commission')}
          detail={pick('Cần vai trò operator hoặc admin để ghi ra output. Vai trò hiện tại chỉ được xem.', 'Operator or admin role is required to write outputs. The current role is read-only.')}
        />
      )}

      {/* PA3-504 — điều kiện tiên quyết, kiểm TRƯỚC khi cho ghi.
          Ghi ra cơ cấu chấp hành trong lúc authority mất liên lạc là thao tác
          mù: lệnh có thể không tới nơi và số trên màn hình là giá trị cũ. */}
      <Panel title={pick('Điều kiện tiên quyết', 'Prerequisites')} className="p-3">
        <ul className="space-y-2">
          {prerequisites.map((item) => (
            <li key={item.id} className="flex items-start gap-3 text-sm">
              {item.ok
                ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--c-good-fg)]" aria-hidden="true" />
                : <XCircle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: item.blocking ? 'var(--c-fault-fg)' : 'var(--c-warn-fg)' }} aria-hidden="true" />}
              <div className="min-w-0">
                <div className="font-semibold">
                  {item.label}
                  {!item.ok && !item.blocking && <span className="ml-2 text-xs font-normal text-[var(--c-warn-fg)]">{pick('cảnh báo', 'warning')}</span>}
                  {!item.ok && item.blocking && <span className="ml-2 text-xs font-normal text-[var(--c-fault-fg)]">{pick('chặn', 'blocking')}</span>}
                </div>
                <div className="text-xs text-[var(--c-text-dim)]">{item.detail}</div>
              </div>
            </li>
          ))}
        </ul>
        {blocked && (
          <p role="alert" className="mt-3 rounded-[var(--radius)] border border-[var(--c-fault)] bg-[var(--c-fault-bg)] px-3 py-2 text-xs text-[var(--c-fault-fg)]">
            {pick('Còn điều kiện chặn chưa đạt — các nút ghi bị khoá cho tới khi khắc phục.', 'A blocking prerequisite is unmet — write controls stay locked until it is resolved.')}
          </p>
        )}
        {/* PA3-504: mọi lệnh chạy thử đều để lại vết audit; đường dẫn tới đó
            phải nằm ngay tại chỗ thao tác, không bắt người dùng tự tìm. */}
        <Link to="/activity?action=commissioning_test" className="mt-3 inline-block text-xs font-semibold text-[var(--c-accent)]">
          {pick('Xem vết audit các lần chạy thử', 'View commissioning audit trail')} →
        </Link>
      </Panel>

      <Panel title={pick('Kiểm thử output', 'Output test')}>
        {outputs.length === 0
          ? <StateBlock state="empty" title={pick('Không có điểm AO/DO nào', 'No AO/DO points')} />
          : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              {outputs.map((point) => (
                <div key={point.id} className="space-y-3">
                  <PointCard point={point} />
                  {point.kind === 'DO' ? (
                    <label className="block text-xs text-[var(--c-text-dim)]">
                      {pick('Giá trị ghi', 'Value to write')}
                      <select
                        className="mt-1 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
                        aria-label={pick(`Giá trị ghi cho ${pointDisplayTag(point)}`, `Value to write for ${pointDisplayTag(point)}`)}
                        value={draftFor(point)}
                        disabled={!canCommission}
                        onChange={(event) => setDrafts((current) => ({ ...current, [point.id]: event.target.value }))}
                      >
                        <option value="">{pick('— chọn —', '— select —')}</option>
                        <option value="on">ON</option>
                        <option value="off">OFF</option>
                      </select>
                    </label>
                  ) : (
                    <label className="block text-xs text-[var(--c-text-dim)]">
                      {pick('Giá trị ghi (%)', 'Value to write (%)')}
                      <input
                        className="mt-1 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
                        aria-label={pick(`Giá trị ghi cho ${pointDisplayTag(point)}`, `Value to write for ${pointDisplayTag(point)}`)}
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={100}
                        step={1}
                        value={draftFor(point)}
                        disabled={!canCommission}
                        onChange={(event) => setDrafts((current) => ({ ...current, [point.id]: event.target.value }))}
                      />
                    </label>
                  )}
                  {/* aria-label mang tên điểm: cả lưới có 24 nút cùng nhãn "Chạy
                      thử", nên nếu không gắn tên điểm thì trình đọc màn hình chỉ
                      đọc được "Chạy thử" và người dùng không biết mình sắp ghi ra
                      cơ cấu nào. */}
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="primary"
                      icon={<Play className="h-4 w-4" />}
                      aria-label={pick(`Chạy thử ${pointDisplayTag(point)}`, `Test ${pointDisplayTag(point)}`)}
                      disabled={!canCommission || blocked || running !== null}
                      loading={running === point.id}
                      onClick={() => requestTest(point)}
                    >
                      {pick('Chạy thử', 'Test')}
                    </Button>
                    {/* Nhãn cũ là `Release` nhưng hành vi là ghi 0. Nay đúng
                        nghĩa: gỡ ép và trả điều khiển lại cho vòng lặp tự động
                        (`PUT /points/{id}` với `release: true`). */}
                    <Button variant="secondary" icon={<RotateCcw className="h-4 w-4" />} aria-label={pick(`Trả ${pointDisplayTag(point)} về tự động`, `Return ${pointDisplayTag(point)} to automatic`)} disabled={!canCommission || !point.forced} onClick={() => setPending({ kind: 'release', point })}>
                      {pick('Trả về tự động', 'To automatic')}
                    </Button>
                  </div>
                  <TestOutcomeRow outcome={outcomes[point.id]} running={running === point.id} />
                </div>
              ))}
            </div>
          )}
      </Panel>

      <ConfirmDialog pending={pending} busy={busy} onConfirm={() => { void runPending() }} onClose={() => setPending(null)} />
    </div>
  )
}

/** Thời hạn dạng đọc được. Giây và phút chứ không phải "300" trần trụi: đơn vị
 *  là thứ đầu tiên bị đọc nhầm khi thao tác vội.
 *
 *  Dùng ký hiệu `s`/`min` chứ không phải chữ "phút"/"minutes": hàm này chạy
 *  ngoài `pick` (nó không phải component nên không gọi được hook i18n), nên một
 *  chuỗi có chữ sẽ kẹt cứng một ngôn ngữ giữa giao diện song ngữ. */
function formatTtl(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest}s`
}

/** Kết quả lần chạy thử gần nhất của một điểm — PA3-504.
 *
 *  Chưa thử thì nói "chưa chạy thử", KHÔNG để trống: một ô trống trong lưới 8
 *  output trông giống hệt một ô đã thử và đạt. */
function TestOutcomeRow({ outcome, running }: { outcome?: TestOutcome; running: boolean }) {
  const { pick } = useI18n()
  if (running) {
    return (
      <p role="status" className="rounded-[var(--radius)] border border-[var(--c-accent)] bg-[var(--c-accent-bg)] px-2 py-1.5 text-xs text-[var(--c-accent)]">
        {pick('Đang ghi và chờ phản hồi…', 'Writing and waiting for feedback…')}
      </p>
    )
  }
  if (!outcome) {
    return <p className="px-2 py-1.5 text-xs text-[var(--c-text-dim)]">{pick('Chưa chạy thử', 'Not tested yet')}</p>
  }
  const passed = outcome.result === 'passed'
  return (
    <div
      className="rounded-[var(--radius)] border px-2 py-1.5 text-xs"
      style={{
        borderColor: passed ? 'var(--c-good)' : 'var(--c-fault)',
        backgroundColor: passed ? 'var(--c-good-bg)' : 'var(--c-fault-bg)',
        color: passed ? 'var(--c-good-fg)' : 'var(--c-fault-fg)'
      }}
    >
      <div className="font-semibold">
        {passed ? pick('ĐẠT', 'PASSED') : pick('KHÔNG ĐẠT', 'FAILED')} · {outcome.requested}
        {typeof outcome.scanMs === 'number' && <span className="ml-1 font-normal">({outcome.scanMs} ms)</span>}
      </div>
      <div className="mt-0.5 text-[var(--c-text)]">{outcome.message || NO_DATA}</div>
      {/* `expiresInS` vắng nghĩa là Core KHÔNG báo thời hạn còn lại. Nói thẳng
          ra thay vì hiện "còn 0 giây" hay im lặng: người vận hành cần biết lệnh
          này có được ai cưỡng chế nhả hay không (ISS-PIO-26). */}
      {typeof outcome.ttlS === 'number' && (
        <div className="mt-0.5 text-[var(--c-text)]">
          {typeof outcome.expiresInS === 'number'
            ? pick(`Tự nhả sau ${formatTtl(outcome.ttlS)} — bộ điều khiển báo còn ${formatTtl(outcome.expiresInS)}`, `Auto-release after ${formatTtl(outcome.ttlS)} — controller reports ${formatTtl(outcome.expiresInS)} left`)
            : pick(`Đã xin thời hạn ${formatTtl(outcome.ttlS)} — bộ điều khiển KHÔNG báo thời hạn còn lại`, `Requested ${formatTtl(outcome.ttlS)} — the controller did NOT report a remaining time`)}
        </div>
      )}
      <div className="mono mt-0.5 text-[var(--c-text-dim)]">{formatDateTime(outcome.at)}</div>
    </div>
  )
}

/**
 * Hộp thoại phải nêu ĐÍCH DANH điểm, giá trị và hậu quả vật lý — không phải một
 * câu "Bạn có chắc không?" chung chung mà ai cũng bấm Đồng ý theo phản xạ.
 */
function ConfirmDialog({ pending, busy, onConfirm, onClose }: { pending: PendingAction | null; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  const { pick } = useI18n()
  if (!pending) return null

  if (pending.kind === 'release-all') {
    return (
      <Modal
        open
        danger
        title={pick('Trả tất cả output về điều khiển tự động?', 'Release all outputs to automatic control?')}
        confirmLabel={pick('Trả tất cả', 'Release all')}
        confirmLoading={busy}
        onConfirm={onConfirm}
        onClose={onClose}
      >
        <p>{pick(`${pending.points.length} điểm đang bị ép giá trị sẽ được trả lại cho vòng lặp điều khiển. Vị trí thực tế của cơ cấu chấp hành sẽ thay đổi ngay theo logic tự động.`, `${pending.points.length} forced point(s) will be handed back to the control loop. Actuator positions will change immediately to follow automatic logic.`)}</p>
        <ul className="mono mt-3 list-disc pl-5">
          {pending.points.map((point) => <li key={point.id}>{pointDisplayTag(point)} — {point.name}</li>)}
        </ul>
      </Modal>
    )
  }

  if (pending.kind === 'release') {
    return (
      <Modal
        open
        title={pick('Trả về điều khiển tự động?', 'Return to automatic control?')}
        confirmLabel={pick('Trả về tự động', 'To automatic')}
        confirmLoading={busy}
        onConfirm={onConfirm}
        onClose={onClose}
      >
        <p className="mono text-[var(--c-text)]">{pointDisplayTag(pending.point)} — {pending.point.name}</p>
        <p className="mt-3">{pick('Điểm này sẽ thôi giữ giá trị ép và nhận lại lệnh từ vòng lặp điều khiển. Đây KHÔNG phải ghi giá trị 0: cơ cấu chấp hành sẽ chạy theo logic tự động, có thể tăng hoặc giảm so với hiện tại.', 'This point stops holding its forced value and takes commands from the control loop again. This is NOT writing zero: the actuator follows automatic logic and may move up or down from its current position.')}</p>
      </Modal>
    )
  }

  const valueText = typeof pending.value === 'boolean' ? (pending.value ? 'ON' : 'OFF') : `${pending.value}%`
  const consequence = pending.point.kind === 'DO'
    ? pick(
        pending.value === true
          ? 'Contactor/relay của điểm này sẽ ĐÓNG. Thiết bị đấu sau nó (bơm, quạt, van on/off) chạy ngay lập tức.'
          : 'Contactor/relay của điểm này sẽ MỞ. Thiết bị đấu sau nó dừng ngay lập tức.',
        pending.value === true
          ? 'The contactor/relay will CLOSE. Downstream equipment (pump, fan, on/off valve) starts immediately.'
          : 'The contactor/relay will OPEN. Downstream equipment stops immediately.'
      )
    : pick(
        `Tín hiệu analog của điểm này sẽ được ghi thành ${valueText}. Van/damper/biến tần đấu sau nó chạy tới vị trí tương ứng.`,
        `The analog signal will be written to ${valueText}. The connected valve/damper/drive moves to the matching position.`
      )

  return (
    <Modal
      open
      danger
      title={pick('Xác nhận ghi ra thiết bị', 'Confirm write to device')}
      confirmLabel={pick('Ghi giá trị', 'Write value')}
      confirmLoading={busy}
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <dl className="grid grid-cols-[110px_1fr] gap-y-2">
        <dt>{pick('Điểm', 'Point')}</dt><dd className="mono font-semibold text-[var(--c-text)]">{pointDisplayTag(pending.point)} — {pending.point.name}</dd>
        <dt>{pick('Giá trị', 'Value')}</dt><dd className="mono font-semibold text-[var(--c-text)]">{valueText}</dd>
        <dt>{pick('Hiện tại', 'Current')}</dt><dd className="mono">{String(pending.point.value)}{pending.point.unit ? ` ${pending.point.unit}` : ''}</dd>
        {/* Thời hạn phải nằm trong chính hộp xác nhận: nó là một nửa hậu quả của
            lệnh sắp gửi. Một hộp chỉ nói "sẽ ghi 60%" mà không nói "và giữ 5
            phút" mô tả thiếu đúng phần người vận hành cần biết để rời khỏi bàn. */}
        <dt>{pick('Tự nhả sau', 'Auto-release')}</dt><dd className="mono font-semibold text-[var(--c-text)]">{formatTtl(pending.ttlS)}</dd>
      </dl>
      <p className="mt-3 font-semibold text-[var(--c-fault-fg)]">{consequence}</p>
      <p className="mt-2 text-xs text-[var(--c-text-dim)]">
        {pick(
          `Bộ điều khiển tự trả điểm về điều khiển tự động sau ${formatTtl(pending.ttlS)}, kể cả khi trình duyệt đóng hoặc mất mạng. Muốn trả sớm hơn thì bấm "Trả về tự động".`,
          `The controller returns the point to automatic control after ${formatTtl(pending.ttlS)}, even if this browser closes or the network drops. Use "To automatic" to release sooner.`
        )}
      </p>
    </Modal>
  )
}
