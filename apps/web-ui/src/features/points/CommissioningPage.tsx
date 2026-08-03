import { AlertTriangle, Play, RotateCcw, ShieldOff } from 'lucide-react'
import { useMemo, useState } from 'react'
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
import type { Point } from '../../shared/types'
import { pointDisplayTag } from '../../shared/utils'

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
  | { kind: 'test'; point: Point; value: number | boolean }
  | { kind: 'release'; point: Point }
  | { kind: 'release-all'; points: Point[] }

type ParsedDraft = { value: number | boolean; error?: undefined } | { value: null; error: string }

export function CommissioningPage() {
  const state = useApi(apiClient.getPoints, [], { refreshMs: REFRESH_MS })
  const toast = useToast()
  const { pick } = useI18n()
  const { session } = useAuth()
  const canCommission = session?.role === 'admin' || session?.role === 'operator'

  const outputs = useMemo(() => (state.data ?? []).filter((point) => point.kind === 'AO' || point.kind === 'DO'), [state.data])
  const forced = useMemo(() => outputs.filter((point) => point.forced), [outputs])

  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [busy, setBusy] = useState(false)

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
    setPending({ kind: 'test', point, value: parsed.value })
  }

  async function runPending() {
    if (!pending) return
    setBusy(true)
    try {
      if (pending.kind === 'test') {
        const result = await apiClient.runCommissioningTest(pending.point.id, pending.value)
        toast.push(result.result === 'passed' ? 'success' : 'warn', `${result.pointId}: ${result.message}`)
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
        <Button
          variant="danger"
          icon={<ShieldOff className="h-4 w-4" />}
          disabled={!canCommission || forced.length === 0}
          onClick={() => setPending({ kind: 'release-all', points: forced })}
        >
          {pick('Trả tất cả về tự động', 'Release all to automatic')} ({forced.length})
        </Button>
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
                    <Button variant="primary" icon={<Play className="h-4 w-4" />} aria-label={pick(`Chạy thử ${pointDisplayTag(point)}`, `Test ${pointDisplayTag(point)}`)} disabled={!canCommission} onClick={() => requestTest(point)}>
                      {pick('Chạy thử', 'Test')}
                    </Button>
                    {/* Nhãn cũ là `Release` nhưng hành vi là ghi 0. Nay đúng
                        nghĩa: gỡ ép và trả điều khiển lại cho vòng lặp tự động
                        (`PUT /points/{id}` với `release: true`). */}
                    <Button variant="secondary" icon={<RotateCcw className="h-4 w-4" />} aria-label={pick(`Trả ${pointDisplayTag(point)} về tự động`, `Return ${pointDisplayTag(point)} to automatic`)} disabled={!canCommission || !point.forced} onClick={() => setPending({ kind: 'release', point })}>
                      {pick('Trả về tự động', 'To automatic')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
      </Panel>

      <ConfirmDialog pending={pending} busy={busy} onConfirm={() => { void runPending() }} onClose={() => setPending(null)} />
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
      </dl>
      <p className="mt-3 font-semibold text-[var(--c-fault-fg)]">{consequence}</p>
    </Modal>
  )
}
