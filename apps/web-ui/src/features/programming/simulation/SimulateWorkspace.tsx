import { useI18n } from '../../../shared/i18n'
import { useProgrammingRevision } from '../api/queries'
import { activeProgramSource } from '../overview/activeProgramSet'
import { SimulationControls } from './SimulationControls'
import { VirtualInputs } from './VirtualInputs'
import {
  canControlSimulation,
  currentSession,
  isSimulationSupported,
  simulationValuesByObservation,
  type SimulationAction,
  type SimulationInputDescriptor,
  type SimulationSlice,
} from './simulationSession'
import type { ProgrammingSimulationCapability } from '../model/types'

/**
 * `T59-815` / `PGM02-V22-WP-08` — bề mặt SIMULATE.
 *
 * Giống LIVE ở một điểm cốt lõi: đây **không** phải editor với nút Lưu bị khoá.
 * Nó là một tài liệu khác — nguồn của bản đã lưu và đã Check mà phiên đang
 * chạy, không phải Draft đang gõ. Hai thứ ấy trông giống hệt nhau trên màn
 * hình, nên dùng lại component editor rồi tắt sửa là cách chắc chắn nhất để một
 * hôm nào đó người dùng tin rằng mình đang thử thứ mình vừa sửa.
 *
 * Khác LIVE ở chỗ nguồn được PIN theo `sourceDraftRevisionId` của phiên, không
 * theo Active của thiết bị: phiên mô phỏng có thể chạy một Revision không hề
 * đang điều khiển tủ.
 */
export function SimulateWorkspace({
  capability,
  role,
  slice,
  inputs,
  objectId,
  draftDirty,
  draftRevisionId,
  allowMutation = true,
  onStart,
  onAction,
  onSetInput,
  onStop,
}: {
  capability: ProgrammingSimulationCapability | undefined | null
  role: string | undefined
  slice: SimulationSlice
  inputs: readonly SimulationInputDescriptor[]
  objectId: string | undefined
  draftDirty: boolean
  /** Revision đã lưu gần nhất — nguồn hợp lệ DUY NHẤT để mở phiên. */
  draftRevisionId: string | null
  /** Phán quyết capability của phiên, đã gồm thu hồi HTTP 403. */
  allowMutation?: boolean
  onStart: () => void
  onAction: (action: SimulationAction, speed?: number) => void
  onSetInput: (descriptor: SimulationInputDescriptor, raw: string) => void
  onStop: () => void
}) {
  const { pick } = useI18n()
  const session = currentSession(slice)
  const supported = isSimulationSupported(capability)
  const canControl = allowMutation && canControlSimulation(capability, role)

  const revision = useProgrammingRevision(session?.sourceDraftRevisionId ?? null)
  const sealed = activeProgramSource({
    activeRevisionId: session?.sourceDraftRevisionId ?? null,
    status: revision.status,
    revision: revision.data,
    objectId: objectId ?? null,
  })
  const values = simulationValuesByObservation(slice.frame)

  if (!supported) {
    /* Thiết bị không công bố khả năng mô phỏng. Nói ra và DỪNG — không dựng
     * simulator trong trình duyệt, không hiện một giá trị mẫu nào. */
    return (
      <section aria-label={pick('Mô phỏng', 'Simulation')} className="space-y-2">
        <p role="status" className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 text-xs text-[var(--c-text-dim)]">
          {pick('Thiết bị này chưa công bố khả năng Mô phỏng, nên không có phiên nào mở được ở đây.',
                'This controller does not advertise the Simulation capability, so no session can be started here.')}
          {' '}
          {pick('Không có dữ liệu thay thế và không có mô phỏng chạy trong trình duyệt.',
                'There is no substitute data and no in-browser simulation.')}
        </p>
      </section>
    )
  }

  if (session === null) {
    return (
      <section aria-label={pick('Mô phỏng', 'Simulation')} className="space-y-2">
        <SimulationControls slice={slice} canControl={canControl} onAction={onAction} onStop={onStop} />
        {draftDirty ? (
          /* Chặn ngay ở client cho người dùng biết sớm; server vẫn kiểm lại và
           * vẫn trả `PRG-SIM-SAVE-REQUIRED` nếu hash không khớp. Điểm quan
           * trọng: KHÔNG có nhánh nào mô phỏng nội dung chưa lưu. */
          <p role="alert" className="rounded-[var(--radius)] border border-[var(--c-warn-fg)] bg-[var(--c-warn-bg)] p-2 text-xs text-[var(--c-warn-fg)]">
            {pick('Bản nháp còn thay đổi chưa lưu. Hãy Lưu (và chạy Kiểm tra) trước khi mô phỏng — mô phỏng luôn chạy trên bản đã lưu.',
                  'The draft has unsaved changes. Save it (and run Check) before simulating — simulation always runs the saved version.')}
          </p>
        ) : (
          <button
            type="button"
            disabled={!canControl || draftRevisionId === null || slice.pending !== null}
            onClick={onStart}
            className="rounded-[var(--radius)] border border-[var(--c-border)] px-3 py-1 text-xs text-[var(--c-text)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pick('Mở phiên mô phỏng', 'Start simulation session')}
          </button>
        )}
        {slice.status.kind === 'ERROR' && (
          <p role="alert" className="text-xs text-[var(--c-danger-fg)]">{slice.status.message}</p>
        )}
      </section>
    )
  }

  return (
    <section aria-label={pick('Mô phỏng', 'Simulation')} className="space-y-3">
      <SimulationControls slice={slice} canControl={canControl} onAction={onAction} onStop={onStop} />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-2">
          {sealed.source === null ? (
            <p role="status" className="rounded-[var(--radius)] border border-[var(--c-warn-fg)] bg-[var(--c-warn-bg)] p-2 text-xs text-[var(--c-warn-fg)]">
              {sealedSourceReason(pick, sealed.reason)}
            </p>
          ) : (
            <label className="block space-y-1">
              <span className="text-[11px] uppercase text-[var(--c-text-dim)]">
                {pick('Mã nguồn đang mô phỏng', 'Simulated source')}
              </span>
              <textarea
                readOnly
                aria-label={pick('Mã nguồn đang mô phỏng', 'Simulated source')}
                value={sealed.source}
                rows={16}
                className="w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-2 font-mono text-xs"
              />
            </label>
          )}

          <section aria-label={pick('Lớp giá trị mô phỏng', 'Simulation value layer')} className="space-y-1">
            <h3 className="text-xs font-semibold uppercase text-[var(--c-text)]">
              {pick('Giá trị quan sát', 'Observations')}
            </h3>
            {slice.frame === null ? (
              <p className="text-[11px] text-[var(--c-text-dim)]">
                {pick('Chưa có nhịp nào chạy, nên chưa có giá trị nào để hiện.',
                      'No tick has run yet, so there is nothing to show.')}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {Object.values(values).map((value) => (
                  <li key={value.observationId} className="flex flex-wrap items-baseline gap-2 text-[11px]">
                    <span className="font-mono text-[var(--c-text)]">{value.observationId}</span>
                    <span className="font-mono">
                      {value.value === null || value.value === undefined
                        ? '—'
                        : typeof value.value === 'boolean' ? (value.value ? 'TRUE' : 'FALSE') : String(value.value)}
                    </span>
                    <span className="text-[var(--c-text-dim)]">{value.quality}</span>
                    {/* Nguồn hiện tường minh trên MỖI dòng: giá trị mô phỏng và
                        giá trị của gói đang chạy trông giống hệt nhau. */}
                    <span className="rounded-full border border-[var(--c-border)] px-1 text-[10px] text-[var(--c-text-dim)]">
                      {pick('MÔ PHỎNG', 'SIMULATION')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="rounded-[var(--radius)] border border-[var(--c-border)] p-2">
          <VirtualInputs inputs={inputs} slice={slice} canControl={canControl} onCommit={onSetInput} />
        </aside>
      </div>
    </section>
  )
}

function sealedSourceReason(pick: (vi: string, en: string) => string, reason: string | null): string {
  switch (reason) {
    case 'POU_NOT_IN_REVISION':
      return pick('POU đang chọn không có trong bản đã seal của phiên này.',
                  'The selected POU is not in the revision this session sealed.')
    case 'SOURCE_UNREADABLE':
      return pick('Thân POU trong bản đã seal không đọc được — đây KHÁC với một chương trình rỗng.',
                  'The POU body in the sealed revision is unreadable — that is not the same as an empty program.')
    case 'REVISION_MISMATCH':
      return pick('Bản đã seal không khớp phiên đang mở; không hiện nguồn nào để tránh đọc nhầm.',
                  'The sealed revision does not match this session; no source is shown to avoid a misread.')
    default:
      return pick('Chưa đọc được nguồn của bản đã seal.', 'The sealed source is not available yet.')
  }
}
