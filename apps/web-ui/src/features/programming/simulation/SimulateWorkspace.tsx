import { useMemo } from 'react'
import { useI18n } from '../../../shared/i18n'
import { useProgrammingRevision } from '../api/queries'
import { activeProgramSource } from '../overview/activeProgramSet'
import { LiveFbdView } from '../design/LiveFbdView'
import { parseLiveFbd } from '../design/LiveProgramView'
import { SimulationControls } from './SimulationControls'
import { VirtualInputs } from './VirtualInputs'
import { StRuntimeValueOverlay, type StRuntimeOverlayItem, type StRuntimeOverlayState } from '../design/editor/StRuntimeValueOverlay'
import {
  canControlSimulation,
  currentSession,
  isSimulationSupported,
  isTerminalState,
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
  onStopActive,
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
  onStopActive?: () => void
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

  const simulatedFbdDocument = useMemo(
    () => (sealed.source !== null && sealed.language === 'FBD' ? parseLiveFbd(sealed.source) : null),
    [sealed.language, sealed.source],
  )

  const simulationOverlayState: StRuntimeOverlayState = useMemo(() => {
    if (slice.frame === null) {
      return {
        status: 'unavailable',
        reason: pick(
          'Chưa có nhịp nào chạy — nhấn Chạy hoặc Nhịp để bắt đầu.',
          'No tick has run yet — press Run or Step to start.',
        ),
      }
    }
    const hasMatchingProgram = objectId
      ? slice.frame.observations.some((obs) => obs.programId === objectId)
      : false
    const filteredObs = hasMatchingProgram
      ? slice.frame.observations.filter((obs) => obs.programId === objectId)
      : slice.frame.observations
    const items: StRuntimeOverlayItem[] = filteredObs.map((obs) => ({
      variableId: obs.observationId,
      variableName: obs.variable || obs.observationId,
      value: obs.value,
      valid: obs.value !== null && obs.value !== undefined && obs.quality !== 'UNAVAILABLE',
      quality: obs.quality,
      freshness: 'SIMULATION',
    }))
    items.sort((a, b) => a.variableName.localeCompare(b.variableName) || a.variableId.localeCompare(b.variableId))
    return {
      status: 'ready',
      items,
    }
  }, [slice.frame, objectId, pick])

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
        <SimulationControls slice={slice} canControl={canControl} onAction={onAction} onStop={onStop} onStopActive={onStopActive} />
        {draftDirty ? (
          /* Chặn ngay ở client cho người dùng biết sớm; server vẫn kiểm lại và
           * vẫn trả `PRG-SIM-SAVE-REQUIRED` nếu hash không khớp. Điểm quan
           * trọng: KHÔNG có nhánh nào mô phỏng nội dung chưa lưu. */
          <p role="alert" className="rounded-[var(--radius)] border border-[var(--c-warn-fg)] bg-[var(--c-warn-bg)] p-2 text-xs text-[var(--c-warn-fg)]">
            {pick('Bản nháp còn thay đổi chưa lưu. Hãy Lưu (và chạy Kiểm tra) trước khi mô phỏng — mô phỏng luôn chạy trên bản đã lưu.',
                  'The draft has unsaved changes. Save it (and run Check) before simulating — simulation always runs the saved version.')}
          </p>
        ) : (
          <>
            {draftRevisionId === null && (
              <div role="status" className="space-y-1 rounded-[var(--radius)] border border-[var(--c-warn-fg)] bg-[var(--c-warn-bg)] p-2 text-xs text-[var(--c-warn-fg)]">
                <p className="font-semibold">
                  {pick(
                    'Chưa thể mở phiên mô phỏng: Cần có kết quả Kiểm tra (Check) đạt PASSED.',
                    'Cannot start simulation session: A PASSED Check result is required.'
                  )}
                </p>
                <p className="text-[var(--c-text-dim)]">
                  {pick(
                    'Mô phỏng chạy trên artifact biên dịch từ bản Check gần nhất. Hãy sửa các lỗi trong khay Vấn đề và chạy Kiểm tra trong tab Check & Commission.',
                    'Simulation runs on compiled artifacts from the latest Check. Please resolve issues in the Problems tray and run Check in the Check & Commission workspace.'
                  )}
                </p>
              </div>
            )}
            <button
              type="button"
              disabled={!canControl || draftRevisionId === null || slice.pending !== null}
              onClick={onStart}
              className="rounded-[var(--radius)] border border-[var(--c-border)] px-3 py-1 text-xs text-[var(--c-text)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pick('Mở phiên mô phỏng', 'Start simulation session')}
            </button>
          </>
        )}
        {slice.status.kind === 'ERROR' && (
          <div className="space-y-2">
            <p role="alert" className="text-xs text-[var(--c-danger-fg)]">{slice.status.message}</p>
            {slice.status.code === 'PRG-SIM-QUOTA' && onStopActive && (
              <button
                type="button"
                onClick={onStopActive}
                disabled={slice.pending !== null}
                className="rounded-[var(--radius)] border border-[var(--c-danger-fg)] bg-[var(--c-danger-bg)] px-3 py-1 text-xs font-semibold text-[var(--c-danger-fg)] hover:opacity-80"
              >
                {pick('Dừng phiên mô phỏng đang chạy trên thiết bị', 'Stop running session on controller')}
              </button>
            )}
          </div>
        )}
      </section>
    )
  }

  return (
    <section aria-label={pick('Mô phỏng', 'Simulation')} className="flex min-h-0 flex-1 flex-col gap-3">
      <SimulationControls slice={slice} canControl={canControl} onAction={onAction} onStop={onStop} onStopActive={onStopActive} />

      {isTerminalState(session.state) && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-2 text-xs">
          <span>
            {session.state === 'STOPPED'
              ? pick('Phiên mô phỏng đã dừng.', 'Simulation session stopped.')
              : session.state === 'EXPIRED'
                ? pick('Phiên mô phỏng đã hết hạn.', 'Simulation session expired.')
                : pick('Phiên mô phỏng đã kết thúc.', 'Simulation session completed.')}
          </span>
          <button
            type="button"
            onClick={onStop}
            className="rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2.5 py-1 text-xs font-medium text-[var(--c-text)] hover:bg-[var(--c-surface-3)]"
          >
            {pick('Đóng phiên / Chọn chương trình khác', 'Close session / Choose another program')}
          </button>
        </div>
      )}

      {sealed.source === null ? (
        <p role="status" className="rounded-[var(--radius)] border border-[var(--c-warn-fg)] bg-[var(--c-warn-bg)] p-2 text-xs text-[var(--c-warn-fg)]">
          {sealedSourceReason(pick, sealed.reason)}
        </p>
      ) : sealed.language === 'FBD' ? (
        simulatedFbdDocument === null ? (
          <p role="status" className="rounded-[var(--radius)] border border-[var(--c-warn-fg)] bg-[var(--c-warn-bg)] p-2 text-xs text-[var(--c-warn-fg)]">
            {pick('Sơ đồ FBD của gói mô phỏng không đọc được.', 'The simulated package’s FBD diagram cannot be read.')}
          </p>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 lg:flex-row">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <LiveFbdView
                document={simulatedFbdDocument}
                runtime={simulationOverlayState}
              />
            </div>
            <aside className="w-full shrink-0 rounded-[var(--radius)] border border-[var(--c-border)] p-2 lg:w-72 overflow-y-auto">
              <VirtualInputs inputs={inputs} slice={slice} canControl={canControl} onCommit={onSetInput} />
            </aside>
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="space-y-2">
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
          </div>

          <aside className="rounded-[var(--radius)] border border-[var(--c-border)] p-2">
            <VirtualInputs inputs={inputs} slice={slice} canControl={canControl} onCommit={onSetInput} />
          </aside>
        </div>
      )}

      <StRuntimeValueOverlay
        state={simulationOverlayState}
        programId={objectId ?? session?.sourceDraftRevisionId ?? session?.sessionId}
        mode="SIMULATION"
      />
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

