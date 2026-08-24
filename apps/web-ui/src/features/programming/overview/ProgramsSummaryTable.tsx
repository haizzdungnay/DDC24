import { useNavigate } from 'react-router-dom'
import { useI18n } from '../../../shared/i18n'
import { Panel } from '../../../shared/components/Panel'
import { StateBlock } from '../../../shared/components/StateBlock'
import { StatusBadge } from '../../../shared/components/StatusBadge'
import { semanticBadgeProps, semanticStateDescriptor } from '../shared/semanticState'
import { activeProgramSetReasonLabel } from './activeProgramSet'
import {
  programHealthSemanticState,
  programRuntimeSemanticState,
  type OverviewProgramRow,
  type ProgramHealthMissingReason,
  type ProgramsSummaryModel
} from './overviewViewModel'
import type { ProgrammingProgramHealth, ProgrammingProgramRuntimeState } from '../model/types'

/**
 * `T60-205` — bảng Programs của PGM-01.
 *
 * SÁU CỘT THEO D-02 — VÀ VÌ SAO KHÔNG CÓ CỘT `Task`
 * -------------------------------------------------
 * `Program | Language | Cycle | State | Last Exec | Health`. Ảnh mockup có thêm
 * cột `Task`; D-02 đã loại nó. Lý do không phải thẩm mỹ: từ `T59-402` **mỗi
 * Program tự release theo chu kỳ riêng**, nên Task không còn là đơn vị chạy.
 * Giữ cột đó lại là dạy người vận hành một mô hình đã lỗi thời — sai nguy hiểm
 * hơn thiếu một cột. Cũng không có CPU/core: handoff §2 cấm đưa chúng vào
 * Overview.
 *
 * BA LUẬT KHÔNG ĐƯỢC PHÁ
 * ----------------------
 * 1. **Thiếu số liệu ⇒ `—` KÈM LÝ DO, không bao giờ `0`** (`AC-PGM01-04`).
 *    `0 ms` ở cột `Cycle` hay `0` ở `Last Exec` là số bịa, và nó bịa đúng chỗ
 *    người vận hành tin nhất.
 * 2. **`runtimeStateSource = LAST_KNOWN` phải mang nhãn "giá trị cũ" nhìn thấy
 *    được.** Một trạng thái đọc từ lần trước trông y hệt một trạng thái sống
 *    nếu không ai nói ra.
 * 3. **Không UUID ở mặt trước** (`AC-PGM01-01`). Tên Program lấy từ gói đang
 *    vận hành; không có tên thì hiện `—` kèm lý do, KHÔNG in `programId` thay
 *    thế — kể cả dạng rút gọn (phương án D-05 đã loại). `programId`/`objectId`
 *    chỉ sống trong khoá React và trong query của deep-link.
 *
 * MÀU KHÔNG BAO GIỜ LÀ TÍN HIỆU DUY NHẤT: mọi ô trạng thái đi qua
 * `semanticState.ts` (`T60-104`), vốn bắt buộc mỗi trạng thái có icon + chữ.
 */
export function ProgramsSummaryTable({ model, projectId }: { model: ProgramsSummaryModel; projectId: string | null }) {
  const { pick } = useI18n()
  const navigate = useNavigate()

  const title = pick('Chương trình đang vận hành', 'Programs in operation')

  if (model.rows.length === 0) {
    return (
      <Panel title={title}>
        <EmptyPrograms model={model} />
      </Panel>
    )
  }

  const openProgram = (row: OverviewProgramRow) => {
    // Không có `objectId` thì không có POU nào để chọn ở PGM-02 — điều hướng
    // "chung chung" sẽ mở một cây rồi bỏ người dùng ở đó tự tìm.
    if (!projectId || !row.objectId) return
    navigate(`/eng/programming/projects/${projectId}/programs?program=${encodeURIComponent(row.objectId)}`)
  }

  return (
    <Panel title={title}>
      <ProgramsSourceNote model={model} />
      {/* `overflow-x-auto`: bảng sáu cột phải tự cuộn TRONG ô của nó, không
          được đẩy cả trang tràn ngang ở 390 px (handoff §7). */}
      <div className="mt-2 overflow-x-auto rounded-[var(--radius)] border border-[var(--c-border)]">
        <table className="w-full border-collapse text-left text-xs">
          <caption className="sr-only">
            {pick('Chương trình của gói đang vận hành: ngôn ngữ, chu kỳ, trạng thái, lần chạy gần nhất và sức khoẻ.',
              'Programs of the running package: language, cycle, state, last run and health.')}
          </caption>
          <thead className="bg-[var(--c-surface-2)] text-[10px] uppercase text-[var(--c-text-dim)]">
            <tr>
              <th scope="col" className="border-b border-[var(--c-border)] px-3 py-2 font-semibold">{pick('Chương trình', 'Program')}</th>
              <th scope="col" className="border-b border-[var(--c-border)] px-3 py-2 font-semibold">{pick('Ngôn ngữ', 'Language')}</th>
              <th scope="col" className="border-b border-[var(--c-border)] px-3 py-2 font-semibold">{pick('Chu kỳ', 'Cycle')}</th>
              <th scope="col" className="border-b border-[var(--c-border)] px-3 py-2 font-semibold">{pick('Trạng thái', 'State')}</th>
              <th scope="col" className="border-b border-[var(--c-border)] px-3 py-2 font-semibold">{pick('Chạy gần nhất', 'Last Exec')}</th>
              <th scope="col" className="border-b border-[var(--c-border)] px-3 py-2 font-semibold">{pick('Sức khoẻ', 'Health')}</th>
            </tr>
          </thead>
          <tbody>
            {model.rows.map((row) => (
              <tr
                key={row.key}
                data-program-row={row.origin}
                onClick={() => openProgram(row)}
                className={projectId && row.objectId
                  ? 'cursor-pointer border-b border-[var(--c-border)] transition last:border-0 hover:bg-[var(--c-accent-bg)]'
                  : 'border-b border-[var(--c-border)] last:border-0'}
              >
                <td className="px-3 py-2 align-top"><ProgramNameCell row={row} projectId={projectId} onOpen={openProgram} /></td>
                <td className="px-3 py-2 align-top"><LanguageCell row={row} /></td>
                <td className="px-3 py-2 align-top"><CycleCell row={row} /></td>
                <td className="px-3 py-2 align-top"><StateCell row={row} /></td>
                <td className="px-3 py-2 align-top"><LastRunCell row={row} /></td>
                <td className="px-3 py-2 align-top"><HealthCell row={row} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

/* ------------------------------------------------------------------ *
 * Ô thiếu dữ liệu — `—` KÈM LÝ DO, không bao giờ `0`                  *
 * ------------------------------------------------------------------ */

function MissingCell({ reason }: { reason: string }) {
  return (
    <span className="flex flex-col gap-0.5">
      {/* `aria-hidden` cho dấu gạch: trình đọc màn hình đọc "em dash" thì vô
          nghĩa; câu lý do bên dưới mới là nội dung. */}
      <span aria-hidden="true" className="text-[var(--c-text-dim)]">—</span>
      <span className="text-[10px] leading-tight text-[var(--c-text-dim)]">{reason}</span>
    </span>
  )
}

type Pick = (vi: string, en: string) => string

function notReadFromCore(pick: Pick): string {
  return pick('Chưa đọc được từ Core', 'Not read from Core')
}

function healthMissingReasonLabel(pick: Pick, reason: ProgramHealthMissingReason | null): string {
  switch (reason) {
    case 'NOT_READ_FROM_CORE':
      return notReadFromCore(pick)
    case 'NOT_REPORTED_BY_CORE':
      return pick('Core không kể tên chương trình này', 'Core does not report this program')
    case 'NOT_LABELLED':
      return pick('Máy chủ không gán nhãn cho trạng thái này', 'The server assigns no label for this state')
    default:
      return notReadFromCore(pick)
  }
}

/* ------------------------------------------------------------------ *
 * Sáu ô                                                               *
 * ------------------------------------------------------------------ */

function ProgramNameCell({ row, projectId, onOpen }: {
  row: OverviewProgramRow
  projectId: string | null
  onOpen: (row: OverviewProgramRow) => void
}) {
  const { pick } = useI18n()
  if (row.name === null) {
    return (
      <MissingCell reason={row.origin === 'LIVE_ONLY'
        ? pick('Không có trong gói đang vận hành', 'Not part of the running package')
        : pick('Gói đang vận hành không khai tên', 'The running package declares no name')} />
    )
  }
  if (!projectId || !row.objectId) {
    return <span className="font-medium text-[var(--c-text)]">{row.name}</span>
  }
  return (
    <button
      type="button"
      // `stopPropagation`: hàng cũng bấm được (tiện chuột). Không chặn thì một
      // cú bấm sẽ điều hướng hai lần qua cùng một đích.
      onClick={(event) => { event.stopPropagation(); onOpen(row) }}
      className="rounded-[var(--radius)] text-left font-medium text-[var(--c-accent)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--c-accent)]"
    >
      {row.name}
    </button>
  )
}

function LanguageCell({ row }: { row: OverviewProgramRow }) {
  const { pick } = useI18n()
  if (row.language === null) {
    return <MissingCell reason={pick('Không có trong gói đang vận hành', 'Not part of the running package')} />
  }
  return <span className="text-[var(--c-text)]">{row.language}</span>
}

function CycleCell({ row }: { row: OverviewProgramRow }) {
  const { pick } = useI18n()
  if (row.cycle === null) return <MissingCell reason={notReadFromCore(pick)} />
  // D-03: con số ở đây LUÔN đến từ dữ liệu thật. Không có hằng số `10 ms`/
  // `100 ms` nào của ảnh mockup trong mã — profile Rev A chỉ cho
  // `[1000, 5000, 30000]`.
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-[var(--c-text)]">{`${row.cycle.periodMs} ms`}</span>
      <span className="text-[10px] leading-tight text-[var(--c-text-dim)]">
        {row.cycle.source === 'CORE_LIVE'
          ? pick('Core đang chạy', 'Live from Core')
          : pick('Khai báo trong gói', 'Declared in the package')}
      </span>
    </span>
  )
}

function runtimeStateLabel(pick: Pick, state: ProgrammingProgramRuntimeState): string {
  switch (state) {
    case 'RUNNING':
      return pick('Đang chạy', 'Running')
    case 'WAITING':
      return pick('Chờ chạy', 'Waiting')
    case 'DISABLED':
      return pick('Đã tắt', 'Disabled')
    case 'FAULTED':
      return pick('Lỗi', 'Faulted')
    case 'UNKNOWN':
      return pick('Chưa rõ', 'Unknown')
  }
}

function StateCell({ row }: { row: OverviewProgramRow }) {
  const { pick } = useI18n()
  const stale = semanticStateDescriptor('stale')
  const StaleIcon = stale.icon
  return (
    <span className="flex flex-col items-start gap-1">
      <StatusBadge {...semanticBadgeProps(pick, programRuntimeSemanticState(row.runtimeState), runtimeStateLabel(pick, row.runtimeState))} />
      {/* Nhãn "giá trị cũ" là bắt buộc khi read-back rơi về bảng ý định bền
          vững: nếu không, một trạng thái đọc từ lần Enable/Disable gần nhất
          trông y hệt trạng thái sống. */}
      {row.runtimeStateSource === 'LAST_KNOWN' && (
        <span className="flex items-center gap-1 text-[10px] leading-tight text-[var(--c-warn-fg)]">
          <StaleIcon className="h-3 w-3" aria-hidden="true" />
          {pick('giá trị cũ', 'stale value')}
        </span>
      )}
      {row.runtimeStateSource === 'UNAVAILABLE' && (
        <span className="text-[10px] leading-tight text-[var(--c-text-dim)]">{notReadFromCore(pick)}</span>
      )}
    </span>
  )
}

/** Mốc lần chạy gần nhất theo giờ máy người dùng; chuỗi không phân giải được thì giữ nguyên chứ không bịa. */
function formatLastRunAt(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleTimeString()
}

function formatAge(pick: Pick, ageMs: number): string {
  if (ageMs < 1000) return pick(`${ageMs} ms trước`, `${ageMs} ms ago`)
  const seconds = Math.floor(ageMs / 1000)
  if (seconds < 60) return pick(`${seconds} giây trước`, `${seconds} s ago`)
  const minutes = Math.floor(seconds / 60)
  return pick(`${minutes} phút trước`, `${minutes} min ago`)
}

function LastRunCell({ row }: { row: OverviewProgramRow }) {
  const { pick } = useI18n()
  // CỘT NÀY LÀ MỐC THỜI GIAN. `lastExecNs` của Core là THỜI LƯỢNG một lần chạy
  // và không bao giờ được rò vào đây — view model đã chặn ở tầng dữ liệu, phần
  // hiển thị không có đường nào chạm tới nó.
  if (row.lastRun === null) return <MissingCell reason={notReadFromCore(pick)} />
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-[var(--c-text)]">
        {row.lastRun.atUtc !== null ? formatLastRunAt(row.lastRun.atUtc) : pick('Chưa rõ mốc', 'Timestamp unknown')}
      </span>
      {row.lastRun.ageMs !== null && (
        <span className="text-[10px] leading-tight text-[var(--c-text-dim)]">{formatAge(pick, row.lastRun.ageMs)}</span>
      )}
    </span>
  )
}

function healthLabel(pick: Pick, health: ProgrammingProgramHealth): string {
  switch (health) {
    case 'HEALTHY':
      return pick('Bình thường', 'Healthy')
    case 'DEGRADED':
      return pick('Suy giảm', 'Degraded')
    case 'FAULT':
      return pick('Lỗi', 'Fault')
    case 'UNKNOWN':
      return pick('Chưa rõ', 'Unknown')
  }
}

function HealthCell({ row }: { row: OverviewProgramRow }) {
  const { pick } = useI18n()
  // FE KHÔNG tự tính `health` (D-04): server là authority. Ở đây chỉ có việc
  // hiển thị nhãn server cấp, hoặc nói vì sao không có nhãn nào.
  if (row.health === null) return <MissingCell reason={healthMissingReasonLabel(pick, row.healthMissingReason)} />
  return <StatusBadge {...semanticBadgeProps(pick, programHealthSemanticState(row.health), healthLabel(pick, row.health))} />
}

/* ------------------------------------------------------------------ *
 * Nguồn danh sách + trạng thái rỗng                                   *
 * ------------------------------------------------------------------ */

function ProgramsSourceNote({ model }: { model: ProgramsSummaryModel }) {
  const { pick } = useI18n()
  return (
    <p className="text-xs text-[var(--c-text-dim)]">
      {model.activeLabel
        ? pick(`Nguồn: gói đang vận hành ${model.activeLabel}.`, `Source: running package ${model.activeLabel}.`)
        : pick('Nguồn: gói đang vận hành (chưa phân giải được số hiệu).', 'Source: the running package (its number is unresolved).')}
      {model.source !== 'CORE_LIVE' && ` ${pick('Trạng thái theo từng chương trình chưa đọc được từ Core.', 'Per-program state could not be read from Core.')}`}
      {model.truncated && ` ${pick('Core đã cắt danh sách ở trần 32 chương trình — bảng này chưa đầy đủ.', 'Core truncated the list at the 32-program limit — this table is incomplete.')}`}
    </p>
  )
}

function EmptyPrograms({ model }: { model: ProgramsSummaryModel }) {
  const { pick } = useI18n()
  if (model.emptyReason === 'LOADING') {
    return <StateBlock state="loading" title={pick('Đang đọc danh sách chương trình…', 'Reading the program list…')} />
  }
  const detail = activeProgramSetReasonLabel(pick, model.activeSetReason) ?? undefined
  if (model.emptyReason === 'UNAVAILABLE') {
    return (
      <StateBlock
        state="offline"
        title={pick('Chưa đọc được danh sách chương trình.', 'The program list could not be read.')}
        detail={detail}
      />
    )
  }
  return (
    <StateBlock
      state="empty"
      title={pick('Chưa có chương trình nào đang vận hành.', 'No program is in operation yet.')}
      detail={detail}
    />
  )
}
