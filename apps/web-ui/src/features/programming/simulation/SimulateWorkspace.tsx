import { useEffect, useMemo } from 'react'
import { useI18n } from '../../../shared/i18n'
import { useLazyProgrammingPointCatalog, useProgrammingRevision } from '../api/queries'
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
import type { ProgrammingBinding, ProgrammingPointCatalogEntry, ProgrammingProgram, ProgrammingSimulationCapability } from '../model/types'
import type { FbdDocument } from '../fbd/model'

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
  bindings,
  pointCatalogItems: pointCatalogItemsProp,
  objectId,
  draftDirty,
  draftRevisionId,
  allowMutation = true,
  program,
  onRequestCheck,
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
  bindings?: readonly ProgrammingBinding[]
  pointCatalogItems?: readonly ProgrammingPointCatalogEntry[]
  objectId: string | undefined
  draftDirty: boolean
  /** Revision đã lưu gần nhất — nguồn hợp lệ DUY NHẤT để mở phiên. */
  draftRevisionId: string | null
  /** Phán quyết capability của phiên, đã gồm thu hồi HTTP 403. */
  allowMutation?: boolean
  program?: ProgrammingProgram
  /** Mở PGM-05 và tự chạy Check (chủ sở hữu 2026-09-27: Kiểm tra xong là sang
   * Mô phỏng được). Vắng mặt khi không có quyền Check hoặc Draft chưa lưu. */
  onRequestCheck?: () => void
  onStart: () => void
  onAction: (action: SimulationAction, speed?: number, baseTickMs?: number) => void
  onSetInput: (descriptor: SimulationInputDescriptor, raw: string) => void
  onStop: () => void
  onStopActive?: () => void
}) {
  const { pick } = useI18n()
  const session = currentSession(slice)
  const supported = isSimulationSupported(capability)
  const lazyCatalog = useLazyProgrammingPointCatalog()
  const { ensureLoaded } = lazyCatalog

  useEffect(() => {
    if (!pointCatalogItemsProp) {
      ensureLoaded()
    }
  }, [pointCatalogItemsProp, ensureLoaded])

  const pointCatalogItems = pointCatalogItemsProp ?? lazyCatalog.data?.items
  const canControl = allowMutation && canControlSimulation(capability, role)

  const isStaleSession = Boolean(
    session && draftRevisionId && session.sourceDraftRevisionId !== draftRevisionId,
  )

  const activeSimRevisionId = session?.sourceDraftRevisionId ?? draftRevisionId ?? null
  const revision = useProgrammingRevision(activeSimRevisionId)
  const sealed = activeProgramSource({
    activeRevisionId: activeSimRevisionId,
    status: revision.status,
    revision: revision.data,
    objectId: objectId ?? null,
  })

  const draftFbdDocument = useMemo(() => {
    if (!program) return null
    if (program.language === 'FBD') {
      if (typeof program.document === 'object' && program.document !== null) {
        return program.document as FbdDocument
      }
      if (typeof program.document === 'string') {
        return parseLiveFbd(program.document)
      }
    }
    return null
  }, [program])

  const simulatedFbdDocument = useMemo(
    () => (sealed.source !== null && sealed.language === 'FBD' ? parseLiveFbd(sealed.source) : null),
    [sealed.language, sealed.source],
  )

  const activeFbdDocument = useMemo(() => {
    if (isStaleSession && draftFbdDocument) return draftFbdDocument
    if (simulatedFbdDocument) return simulatedFbdDocument
    return draftFbdDocument
  }, [isStaleSession, draftFbdDocument, simulatedFbdDocument])

  const simulationOverlayState: StRuntimeOverlayState = useMemo(() => {
    if (session === null) {
      return {
        status: 'unavailable',
        reason: pick(
          'Chưa mở phiên mô phỏng — nhấn [Mở phiên mô phỏng] để bắt đầu.',
          'No simulation session open — click [Start simulation session] to begin.',
        ),
      }
    }
    if (slice.frame === null) {
      return {
        status: 'unavailable',
        reason: pick(
          'Chưa có nhịp nào chạy — nhấn Chạy hoặc Nhịp để bắt đầu.',
          'No tick has run yet — press Run or Step to start.',
        ),
      }
    }
    if (!objectId) {
      return { status: 'ready', items: [] }
    }
    const hasMatching = slice.frame.observations.some((obs) => obs.programId === objectId)
    const filteredObs = hasMatching
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
  }, [session, slice.frame, objectId, pick])

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
        <SimulationControls
        slice={slice}
        canControl={canControl}
        onAction={onAction}
        onStop={onStop}
        onStopActive={onStopActive}
        onStart={onStart}
        canStart={draftRevisionId !== null && !draftDirty}
        isStaleSession={isStaleSession}
      />
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
                {onRequestCheck && (
                  <button
                    type="button"
                    onClick={onRequestCheck}
                    className="rounded-[var(--radius)] border border-[var(--c-warn-fg)] px-3 py-1 text-xs font-medium text-[var(--c-warn-fg)]"
                  >
                    {pick('Kiểm tra ngay', 'Run Check now')}
                  </button>
                )}
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

        {objectId && activeFbdDocument !== null && (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <LiveFbdView
              document={activeFbdDocument}
              runtime={simulationOverlayState}
            />
          </div>
        )}
      </section>
    )
  }

  return (
    <section aria-label={pick('Mô phỏng', 'Simulation')} className="flex min-h-0 flex-1 flex-col gap-3">
      <SimulationControls
        slice={slice}
        canControl={canControl}
        onAction={onAction}
        onStop={onStop}
        onStopActive={onStopActive}
        onStart={onStart}
        canStart={draftRevisionId !== null && !draftDirty}
        isStaleSession={isStaleSession}
      />

      {/* `isStaleSession` đã hàm ý `draftRevisionId !== null`, nhưng TypeScript
        * không thu hẹp kiểu qua `Boolean(...)`; nói lại điều kiện ở đây thay vì
        * ép `!` để một lần sửa `isStaleSession` sau này không thành lỗi runtime. */}
      {isStaleSession && draftRevisionId !== null && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-[var(--c-warn-fg)] bg-[var(--c-warn-bg)] p-2 text-xs text-[var(--c-warn-fg)]">
          <div>
            <span className="font-semibold">{pick('Đang chạy phiên mô phỏng của bản cũ:', 'Running simulation of previous revision:')}</span>{' '}
            <span className="font-mono">{session.sourceDraftRevisionId.slice(0, 8)}…</span>.{' '}
            <span>{pick('Bản nháp mới nhất đã sẵn sàng:', 'Latest draft revision is ready:')}</span>{' '}
            <span className="font-mono">{draftRevisionId.slice(0, 8)}…</span>.
          </div>
          <button
            type="button"
            onClick={onStart}
            disabled={!canControl || slice.pending !== null}
            className="rounded border border-[var(--c-warn-fg)] bg-[var(--c-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--c-warn-fg)] hover:opacity-80"
          >
            {pick('Mô phỏng bản nháp mới', 'Simulate latest draft')}
          </button>
        </div>
      )}

      {draftDirty && (
        <p role="alert" className="rounded-[var(--radius)] border border-[var(--c-warn-fg)] bg-[var(--c-warn-bg)] p-2 text-xs text-[var(--c-warn-fg)]">
          {pick('Bản nháp còn thay đổi chưa lưu. Hãy Lưu (và chạy Kiểm tra) trước khi mô phỏng — mô phỏng luôn chạy trên bản đã lưu.',
                'The draft has unsaved changes. Save it (and run Check) before simulating — simulation always runs the saved version.')}
        </p>
      )}

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

      {!objectId ? (
        <div
          role="status"
          className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-6 text-center text-xs text-[var(--c-text-dim)]"
        >
          <p className="font-semibold text-[var(--c-text)]">
            {pick('Chưa chọn chương trình mô phỏng', 'No program selected for simulation')}
          </p>
          <p className="mt-1">
            {pick(
              'Vui lòng chọn một chương trình (POU) trong danh sách bên trái để xem sơ đồ và mô phỏng.',
              'Please select a program (POU) from the left sidebar to view its diagram and simulation values.'
            )}
          </p>
        </div>
      ) : activeFbdDocument !== null ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 lg:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <LiveFbdView
              document={activeFbdDocument}
              runtime={simulationOverlayState}
            />
          </div>
          <aside className="w-full shrink-0 rounded-[var(--radius)] border border-[var(--c-border)] p-2 lg:w-72 overflow-y-auto min-h-0 max-h-[380px] lg:max-h-[460px] [scrollbar-gutter:stable]">
            <VirtualInputs
              inputs={inputs}
              slice={slice}
              canControl={canControl}
              onCommit={onSetInput}
              bindings={bindings}
              pointCatalogItems={pointCatalogItems}
            />
          </aside>
        </div>
      ) : sealed.source !== null && sealed.language !== 'FBD' ? (
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

          <aside className="rounded-[var(--radius)] border border-[var(--c-border)] p-2 min-h-0 max-h-[380px] lg:max-h-[460px] overflow-y-auto [scrollbar-gutter:stable]">
            <VirtualInputs
              inputs={inputs}
              slice={slice}
              canControl={canControl}
              onCommit={onSetInput}
              bindings={bindings}
              pointCatalogItems={pointCatalogItems}
            />
          </aside>
        </div>
      ) : (
        <p role="status" className="rounded-[var(--radius)] border border-[var(--c-warn-fg)] bg-[var(--c-warn-bg)] p-2 text-xs text-[var(--c-warn-fg)]">
          {sealedSourceReason(pick, sealed.reason)}
        </p>
      )}

      {objectId && (
        <StRuntimeValueOverlay
          state={simulationOverlayState}
          programId={objectId}
          mode="SIMULATION"
        />
      )}
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

