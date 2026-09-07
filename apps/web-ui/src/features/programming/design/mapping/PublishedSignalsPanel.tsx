import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Plus, Radio, Save, Trash2 } from 'lucide-react'
import { useI18n } from '../../../../shared/i18n'
import { Button } from '../../../../shared/components/Button'
import { Modal } from '../../../../shared/components/Modal'
import { useProgrammingActionAllowed } from '../../api/authorization'
import { StateBlock } from '../../../../shared/components/StateBlock'
import { createUuid } from '../../../../shared/crypto'
import { programsWorkspacePath } from '../../shared/programsRoute'
import {
  SIGNAL_FRESHNESS_MAX_MS,
  SIGNAL_FRESHNESS_MIN_MS,
  SIGNAL_STALE_POLICIES,
  SIGNAL_TYPES,
  SIGNAL_UNIT_MAX_LENGTH,
  draftProducerOptions,
  draftSignals,
  emptySignalForm,
  isDraftV2,
  signalFormFrom,
  stalePolicyFromWire,
  toSignalDraftInput,
  validateSignalForm,
  type DraftProducerOption,
  type SignalErrorCode,
  type SignalFieldName,
  type SignalFormValue
} from '../../model/signals'
import type {
  ProgrammingDraftDocument,
  ProgrammingDraftOperation,
  ProgrammingPublishedSignal,
  ProgrammingSignalStalePolicy,
  ProgrammingSignalType,
  ProgrammingSignalDependencies,
  ProgrammingSignalDependency,
  ProgrammingSignalDependencyReference,
  RemoteState
} from '../../model/types'

/**
 * PGM-02 / tab Mapping — soạn thảo Published Signal
 * (`UC-PROG-08`, `UX-REQ-007`, DDD §4.5/§7.3).
 *
 * Panel này đọc/ghi TRỰC TIẾP tài liệu Draft v2, không đi qua
 * `toWorkspaceDocument`: adapter đó chiếu v2 về view model v1 và bỏ hẳn mảng
 * `signals`, nên mọi thứ đi qua nó sẽ không thấy signal nào tồn tại.
 *
 * Đường ghi là hai op có thật của backend — `upsertSignal` và `removeSignal`
 * (`application/draft_v2.go`). Không có endpoint riêng cho Signal, và trang này
 * không được bịa ra một cái.
 */
export function PublishedSignalsPanel({
  draft,
  saving,
  onSave,
  forceReadOnly = false,
  dependencies,
  projectId
}: {
  draft: ProgrammingDraftDocument
  saving: boolean
  onSave: (operations: ProgrammingDraftOperation[]) => Promise<boolean>
  forceReadOnly?: boolean
  dependencies?: RemoteState<ProgrammingSignalDependencies>
  projectId?: string
}) {
  const { pick } = useI18n()
  const canEdit = useProgrammingActionAllowed('publishedSignal') && !forceReadOnly
  const dependencyState: RemoteState<ProgrammingSignalDependencies> = dependencies ?? {
    status: 'loading', data: null, error: null, refresh: () => {},
  }

  const supported = isDraftV2(draft)
  const signals = useMemo(() => (supported ? draftSignals(draft) : []), [draft, supported])
  const producers = useMemo(() => (supported ? draftProducerOptions(draft) : []), [draft, supported])
  const producerById = useMemo(() => new Map(producers.map((item) => [item.programId, item])), [producers])

  const [form, setForm] = useState<SignalFormValue | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [readBack, setReadBack] = useState<{ signalId: string; action: 'save' | 'delete'; state: 'reading' | 'done' } | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ProgrammingPublishedSignal | null>(null)
  const readBackRef = useRef(readBack)
  readBackRef.current = readBack

  /* Read-back thật: `useDraftWorkspace.save()` thay `project.draft` bằng CHÍNH
   * tài liệu server trả trong response PATCH. Panel chỉ tuyên bố "đã lưu" sau
   * khi prop `draft` đổi identity — tức sau khi đọc được giá trị của server. */
  useEffect(() => {
    const current = readBackRef.current
    if (!current || current.state !== 'reading') return
    setReadBack({ ...current, state: 'done' })
  }, [draft])

  if (!supported) {
    return (
      <StateBlock
        state="empty"
        title={pick('Bản nháp chưa ở schema v2 nên chưa có Published Signal.', 'The draft is not on schema v2 yet, so it has no published signals.')}
        detail={pick(
          'Published Signal là công dân hạng nhất của tài liệu v2. Lưu bất kỳ thay đổi nào ở tab Chương trình sẽ nâng bản nháp lên v2.',
          'Published signals are first-class only in the v2 document. Saving any change on the Programs tab upgrades the draft to v2.'
        )}
      />
    )
  }

  const context = { signals, producerProgramIds: producers.map((item) => item.programId) }
  const errors = form ? validateSignalForm(form, context) : {}

  async function submit(value: SignalFormValue) {
    setSubmitted(true)
    const input = toSignalDraftInput(value, context)
    if (!input) return
    setFailure(null)
    setReadBack({ signalId: value.signalId, action: 'save', state: 'reading' })
    const saved = await onSave([{ op: 'upsertSignal', signal: input }])
    if (!saved) {
      setReadBack(null)
      setFailure(pick('Máy chủ không nhận thay đổi Published Signal.', 'The server did not accept the published signal change.'))
      return
    }
    setForm(null)
    setSubmitted(false)
  }

  async function remove(signal: ProgrammingPublishedSignal) {
    setFailure(null)
    setReadBack({ signalId: signal.signalId, action: 'delete', state: 'reading' })
    const saved = await onSave([{ op: 'removeSignal', signalId: signal.signalId }])
    if (!saved) {
      setReadBack(null)
      setFailure(pick('Máy chủ không nhận yêu cầu xoá Published Signal.', 'The server did not accept the published signal removal.'))
      return
    }
    if (form?.signalId === signal.signalId) setForm(null)
  }

  return (
    <section className="space-y-3" aria-labelledby="published-signals-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="published-signals-heading" className="flex items-center gap-1.5 text-sm font-semibold">
          <Radio className="h-4 w-4" aria-hidden="true" />
          {pick('Published Signal', 'Published signals')}
        </h3>
        {canEdit && (
          <Button
            size="sm"
            icon={<Plus className="h-4 w-4" aria-hidden="true" />}
            disabled={producers.length === 0}
            onClick={() => {
              setSubmitted(false)
              setFailure(null)
              setForm(emptySignalForm(createUuid(), producers[0]?.programId ?? ''))
            }}
          >
            {pick('Khai Published Signal', 'Declare a published signal')}
          </Button>
        )}
      </div>

      <p className="text-xs text-[var(--c-text-dim)]">
        {pick(
          'Mỗi signal có ĐÚNG MỘT Program publish. Consumer đọc ảnh chụp đã chốt ở đầu chu kỳ, nên trong một chu kỳ mọi consumer thấy cùng một giá trị.',
          'Each signal has exactly one publishing program. Consumers read the committed snapshot taken at the start of the cycle, so within one cycle every consumer sees the same value.'
        )}
      </p>

      {producers.length === 0 && (
        <p role="status" className="text-sm text-[var(--c-warn-fg)]">
          {pick(
            'Chưa có Program nào được cấu hình chạy nên chưa có nơi publish signal.',
            'No program has a run configuration yet, so there is nowhere to publish a signal from.'
          )}
        </p>
      )}

      {failure && (
        <p role="alert" className="text-sm text-[var(--c-fault-fg)]">
          {failure}
        </p>
      )}
      {readBack && <SignalReadBackNotice readBack={readBack} signals={signals} />}

      <DependencyStatus state={dependencyState} />

      <SignalTable
        signals={signals}
        producerById={producerById}
        canEdit={canEdit}
        saving={saving}
        onEdit={(signal) => {
          setSubmitted(false)
          setFailure(null)
          setForm(signalFormFrom(signal))
        }}
        dependencies={dependencyState.data}
        projectId={projectId}
        onDelete={setPendingDelete}
      />

      <DeleteSignalModal
        signal={pendingDelete}
        dependency={dependencyState.data?.dependencies?.find((item) => item.signalId === pendingDelete?.signalId)}
        dependencyStatus={dependencyState.data?.status ?? (dependencyState.status === 'error' ? 'UNAVAILABLE' : 'PENDING_CHECK')}
        saving={saving}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return
          const signal = pendingDelete
          setPendingDelete(null)
          void remove(signal)
        }}
      />

      {canEdit && form && (
        <SignalForm
          value={form}
          errors={submitted ? errors : {}}
          producers={producers}
          saving={saving}
          onChange={setForm}
          onCancel={() => {
            setForm(null)
            setSubmitted(false)
          }}
          onSubmit={submit}
        />
      )}
    </section>
  )
}

function SignalReadBackNotice({
  readBack,
  signals
}: {
  readBack: { signalId: string; action: 'save' | 'delete'; state: 'reading' | 'done' }
  signals: ProgrammingPublishedSignal[]
}) {
  const { pick } = useI18n()
  if (readBack.state === 'reading') {
    return (
      <p role="status" className="text-sm text-[var(--c-text-dim)]">
        {pick('Đang đọc lại bản nháp từ máy chủ…', 'Reading the draft back from the server…')}
      </p>
    )
  }
  const stored = signals.find((signal) => signal.signalId === readBack.signalId)
  if (readBack.action === 'delete') {
    return (
      <p role="status" className="text-sm">
        {stored
          ? pick('Máy chủ vẫn còn signal này — hãy tải lại và kiểm tra.', 'The server still lists this signal — reload and check.')
          : pick('Máy chủ xác nhận đã xoá signal khỏi bản nháp.', 'The server confirms the signal was removed from the draft.')}
      </p>
    )
  }
  if (!stored) {
    return (
      <p role="alert" className="text-sm text-[var(--c-warn-fg)]">
        {pick(
          'Đã gửi nhưng bản nháp máy chủ trả về không có signal vừa ghi — không hiển thị giá trị lạc quan.',
          'Sent, but the draft returned by the server does not contain the signal — no optimistic value is shown.'
        )}
      </p>
    )
  }
  return (
    <p role="status" className="text-sm">
      {pick('Máy chủ đã trả lại signal', 'The server returned the signal')} <strong>{stored.name}</strong> · {stored.type} ·{' '}
      {stored.freshnessMs} ms · {stored.stalePolicy}
    </p>
  )
}

function SignalTable({
  signals,
  producerById,
  canEdit,
  saving,
  dependencies,
  projectId,
  onEdit,
  onDelete
}: {
  signals: ProgrammingPublishedSignal[]
  producerById: Map<string, DraftProducerOption>
  canEdit: boolean
  saving: boolean
  dependencies: ProgrammingSignalDependencies | null
  projectId?: string
  onEdit: (signal: ProgrammingPublishedSignal) => void
  onDelete: (signal: ProgrammingPublishedSignal) => void
}) {
  const { pick } = useI18n()
  if (signals.length === 0) {
    return <p className="text-sm text-[var(--c-text-dim)]">{pick('Chưa khai Published Signal nào.', 'No published signal declared yet.')}</p>
  }
  return (
    /* Vùng cuộn ngang phải TỰ nhận tiêu điểm: người dùng bàn phím không có
       cách nào khác để cuộn nó, và axe `scrollable-region-focusable` báo đúng
       chỗ này ở lane real-backend — nơi Point Catalog có dữ liệu thật nên bảng
       mới thực sự tràn. Lane mock xanh vì bảng rỗng, không vì bảng đúng. */
    <div
      className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--c-accent)]"
      tabIndex={0}
      role="group"
      aria-label={pick('Bảng Published Signal của bản nháp', 'Published signals in the draft')}
    >
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{pick('Bảng Published Signal của bản nháp', 'Published signals in the draft')}</caption>
        <thead>
          <tr className="border-b border-[var(--c-border)] text-xs uppercase text-[var(--c-text-dim)]">
            <th scope="col" className="py-1.5 pr-3">{pick('Tên', 'Name')}</th>
            <th scope="col" className="py-1.5 pr-3">{pick('Kiểu', 'Type')}</th>
            <th scope="col" className="py-1.5 pr-3">{pick('Đơn vị', 'Unit')}</th>
            <th scope="col" className="py-1.5 pr-3">{pick('Program publish', 'Publisher')}</th>
            <th scope="col" className="py-1.5 pr-3">{pick('Hạn tươi', 'Freshness')}</th>
            <th scope="col" className="py-1.5 pr-3">{pick('Khi quá hạn', 'When stale')}</th>
            <th scope="col" className="py-1.5 pr-3">{pick('Giá trị dự phòng', 'Fallback')}</th>
            <th scope="col" className="py-1.5 pr-3">{pick('Consumer đã kiểm', 'Verified consumers')}</th>
            {canEdit && <th scope="col" className="py-1.5">{pick('Thao tác', 'Actions')}</th>}
          </tr>
        </thead>
        <tbody>
          {signals.map((signal) => {
            const producer = producerById.get(signal.publisherProgramId)
            const dependency = dependencies?.dependencies?.find((item) => item.signalId === signal.signalId)
            const publisherName = dependencies?.status === 'AUTHORITATIVE' && dependency
              ? dependency.publisher.name
              : producer?.name
            const policy = stalePolicyFromWire(signal.stalePolicy)
            return (
              <tr key={signal.signalId} className="border-b border-[var(--c-border)]">
                <th scope="row" className="py-1.5 pr-3 text-left font-medium">{signal.name}</th>
                <td className="py-1.5 pr-3">{signal.type}</td>
                <td className="py-1.5 pr-3">{signal.unit ?? '—'}</td>
                <td className="py-1.5 pr-3">
                  {publisherName
                    ? publisherName
                    : pick('Không xác định — Program đã bị gỡ', 'Unresolved — the program was removed')}
                </td>
                <td className="py-1.5 pr-3">{signal.freshnessMs} ms</td>
                <td className="py-1.5 pr-3">
                  {policy ? stalePolicyLabel(pick, policy) : `${signal.stalePolicy} — ${pick('ngoài DDD §7.3', 'outside DDD §7.3')}`}
                </td>
                <td className="py-1.5 pr-3">
                  {signal.stalePolicy === 'USE_FALLBACK'
                    ? formatFallbackForDisplay(signal.type, signal.fallbackValue)
                    : pick('Không áp dụng', 'Not applicable')}
                </td>
                <td className="py-1.5 pr-3">
                  <SignalConsumers dependency={dependency} status={dependencies?.status} projectId={projectId} />
                </td>
                {canEdit && (
                  <td className="py-1.5">
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="ghost" disabled={saving} onClick={() => onEdit(signal)}>
                        {pick('Sửa', 'Edit')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={saving}
                        icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                        onClick={() => onDelete(signal)}
                      >
                        {pick('Xoá', 'Remove')}
                      </Button>
                    </div>
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-1 text-xs text-[var(--c-text-dim)]">
        {pick(
          'Publisher và consumer lấy từ compiler trong Check. Trạng thái phía trên cho biết dữ liệu có còn khớp bản nháp hiện tại hay không.',
          'Publishers and consumers come from the compiler Check. The status above states whether they still match the current draft.'
        )}
      </p>
    </div>
  )
}

function DependencyStatus({ state }: { state: RemoteState<ProgrammingSignalDependencies> }) {
  const { pick } = useI18n()
  if (state.status === 'loading') return <p role="status" className="text-xs text-[var(--c-text-dim)]">{pick('Đang đọc dependency từ Check…', 'Loading dependencies from Check…')}</p>
  if (state.status === 'error' || !state.data) return <p role="alert" className="text-xs text-[var(--c-fault-fg)]">{pick('Không đọc được dependency authoritative.', 'Authoritative dependencies are unavailable.')}</p>
  const labels = {
    AUTHORITATIVE: pick('Đã kiểm chứng — khớp bản nháp hiện tại', 'Verified — matches the current draft'),
    STALE: pick('Đã cũ — bản nháp đã đổi sau Check', 'Stale — the draft changed after Check'),
    PENDING_CHECK: pick('Chưa kiểm chứng — cần chạy Check', 'Unverified — run Check'),
    UNAVAILABLE: pick('Không khả dụng — Check lỗi hoặc contract cũ', 'Unavailable — Check failed or uses an older contract'),
  }
  const tone = state.data.status === 'AUTHORITATIVE' ? 'text-[var(--c-ok-fg)]' : 'text-[var(--c-warn-fg)]'
  return <p role="status" className={`text-xs font-medium ${tone}`}>{labels[state.data.status]} · {state.data.reasonCode}</p>
}

function SignalConsumers({ dependency, status, projectId }: {
  dependency?: ProgrammingSignalDependency
  status?: ProgrammingSignalDependencies['status']
  projectId?: string
}) {
  const { pick } = useI18n()
  if (!dependency || status !== 'AUTHORITATIVE') {
    return <span className="text-[var(--c-warn-fg)]">{status === 'STALE' ? pick('Đã cũ', 'Stale') : pick('Chưa kiểm chứng', 'Unverified')}</span>
  }
  if (dependency.consumers.length === 0) return <span>{pick('Đã kiểm: không có', 'Verified: none')}</span>
  return <span className="flex flex-wrap gap-1">{dependency.consumers.map((consumer) => (
    <button key={consumer.objectId} type="button" className="underline decoration-dotted underline-offset-2"
      onClick={() => openSignalSource(projectId, consumer)}>{consumer.name}</button>
  ))}</span>
}

function openSignalSource(projectId: string | undefined, reference: ProgrammingSignalDependencyReference) {
  if (!projectId) return
  const query = new URLSearchParams({ program: reference.objectId })
  if (reference.location) {
    query.set('line', String(reference.location.line))
    query.set('column', String(reference.location.column))
    query.set('length', String(reference.location.length))
  }
  globalThis.history.pushState({}, '', programsWorkspacePath(projectId, {
    pou: reference.objectId,
    mode: 'EDIT',
    search: query,
  }))
  globalThis.dispatchEvent(new PopStateEvent('popstate'))
}

function DeleteSignalModal({ signal, dependency, dependencyStatus, saving, onClose, onConfirm }: {
  signal: ProgrammingPublishedSignal | null
  dependency?: ProgrammingSignalDependency
  dependencyStatus: ProgrammingSignalDependencies['status']
  saving: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const { pick } = useI18n()
  const count = dependency?.consumers.length ?? null
  return <Modal open={signal !== null} title={pick('Xác nhận xoá Published Signal', 'Confirm published signal removal')}
    confirmLabel={pick('Xoá khỏi Draft', 'Remove from Draft')} cancelLabel={pick('Giữ signal', 'Keep signal')}
    danger confirmLoading={saving} onClose={onClose} onConfirm={onConfirm}>
    <div className="space-y-2 text-sm">
      <p>{pick(`Signal ${signal?.name ?? ''} sẽ bị xoá khỏi Draft. Thao tác không Commission và chỉ hoàn tất sau read-back từ máy chủ.`,
        `Signal ${signal?.name ?? ''} will be removed from the Draft. This does not Commission and completes only after server read-back.`)}</p>
      {dependencyStatus === 'AUTHORITATIVE' && count !== null
        ? <p className={count > 0 ? 'text-[var(--c-fault-fg)]' : ''}>{pick(`Check xác nhận ${count} consumer bị ảnh hưởng.`, `Check confirms ${count} affected consumers.`)}</p>
        : <p className="text-[var(--c-warn-fg)]">{pick('Impact chưa được kiểm chứng cho bản nháp hiện tại.', 'Impact is unverified for the current draft.')}</p>}
      {dependency?.consumers.map((consumer) => <p key={consumer.objectId} className="font-mono text-xs">{consumer.name} · {consumer.language}{consumer.location ? `:${consumer.location.line}:${consumer.location.column}` : ''}</p>)}
    </div>
  </Modal>
}

function stalePolicyLabel(pick: (vi: string, en: string) => string, policy: ProgrammingSignalStalePolicy): string {
  switch (policy) {
    case 'USE_FALLBACK':
      return pick('USE_FALLBACK — dùng giá trị dự phòng', 'USE_FALLBACK — use the fallback value')
    case 'HOLD_PRIVATE':
      return pick('HOLD_PRIVATE — giữ riêng giá trị cũ', 'HOLD_PRIVATE — hold the previous value privately')
    case 'BLOCK_PROGRAM':
      return pick('BLOCK_PROGRAM — chặn cả Program', 'BLOCK_PROGRAM — block the whole program')
  }
}

function formatFallbackForDisplay(type: ProgrammingSignalType, value: number | undefined): string {
  if (value === undefined) return '—'
  if (type === 'BOOL') return value === 0 ? 'FALSE' : 'TRUE'
  if (type === 'TIME') return `${value} ms`
  return String(value)
}

function errorText(pick: (vi: string, en: string) => string, code: SignalErrorCode): string {
  switch (code) {
    case 'NAME_REQUIRED':
      return pick('Tên signal là bắt buộc.', 'The signal name is required.')
    case 'NAME_INVALID':
      return pick(
        'Tên phải bắt đầu bằng chữ cái và chỉ gồm chữ, số hoặc gạch dưới, tối đa 64 ký tự.',
        'The name must start with a letter and contain only letters, digits or underscores, up to 64 characters.'
      )
    case 'NAME_RESERVED':
      return pick('Tên này là từ khoá của ngôn ngữ, không dùng được.', 'This name is a language keyword and cannot be used.')
    case 'NAME_DUPLICATE':
      return pick(
        'Đã có signal khác trùng tên (không phân biệt hoa thường).',
        'Another signal already uses this name (case-insensitive).'
      )
    case 'TYPE_INVALID':
      return pick('Kiểu dữ liệu ngoài phạm vi profile.', 'The data type is outside the profile scope.')
    case 'UNIT_TOO_LONG':
      return pick('Đơn vị tối đa 32 ký tự.', 'The unit is limited to 32 characters.')
    case 'PUBLISHER_REQUIRED':
      return pick('Phải chọn đúng một Program publish.', 'Exactly one publishing program must be chosen.')
    case 'PUBLISHER_UNKNOWN':
      return pick('Program publish không còn tồn tại trong bản nháp.', 'The publishing program no longer exists in the draft.')
    case 'FRESHNESS_RANGE':
      return pick(
        'Hạn tươi phải là số nguyên trong khoảng 1000..90000 ms.',
        'Freshness must be a whole number between 1000 and 90000 ms.'
      )
    case 'POLICY_INVALID':
      return pick('Chính sách quá hạn không hợp lệ.', 'The stale policy is invalid.')
    case 'FALLBACK_REQUIRED':
      return pick('USE_FALLBACK bắt buộc có giá trị dự phòng.', 'USE_FALLBACK requires a fallback value.')
    case 'FALLBACK_INVALID':
      return pick('Giá trị dự phòng không đúng kiểu đã chọn.', 'The fallback value does not match the selected type.')
    case 'FALLBACK_RANGE':
      return pick('Giá trị dự phòng nằm ngoài dải cho phép của kiểu.', 'The fallback value is outside the range allowed by the type.')
  }
}

function SignalForm({
  value,
  errors,
  producers,
  saving,
  onChange,
  onCancel,
  onSubmit
}: {
  value: SignalFormValue
  errors: Partial<Record<SignalFieldName, SignalErrorCode>>
  producers: DraftProducerOption[]
  saving: boolean
  onChange: (value: SignalFormValue) => void
  onCancel: () => void
  onSubmit: (value: SignalFormValue) => void
}) {
  const { pick } = useI18n()
  const id = useId()
  const field = (name: SignalFieldName) => `${id}-${name}`
  const errorId = (name: SignalFieldName) => `${id}-${name}-error`

  return (
    <form
      className="flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--c-border)] p-3"
      aria-label={pick('Biểu mẫu Published Signal', 'Published signal form')}
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(value)
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor={field('name')} className="text-[var(--c-text-dim)]">
            {pick('Tên signal', 'Signal name')}
          </label>
          <input
            id={field('name')}
            value={value.name}
            maxLength={64}
            onChange={(event) => onChange({ ...value, name: event.target.value })}
            aria-invalid={errors.name ? 'true' : undefined}
            aria-describedby={errors.name ? errorId('name') : undefined}
            className="rounded border border-[var(--c-border)] bg-transparent px-2 py-1.5"
          />
          {errors.name && (
            <span id={errorId('name')} role="alert" className="text-xs text-[var(--c-fault-fg)]">
              {errorText(pick, errors.name)}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor={field('type')} className="text-[var(--c-text-dim)]">
            {pick('Kiểu dữ liệu', 'Data type')}
          </label>
          <select
            id={field('type')}
            value={value.type}
            onChange={(event) => onChange({ ...value, type: event.target.value as ProgrammingSignalType })}
            className="rounded border border-[var(--c-border)] bg-transparent px-2 py-1.5"
          >
            {SIGNAL_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor={field('unit')} className="text-[var(--c-text-dim)]">
            {pick('Đơn vị', 'Unit')}
          </label>
          <input
            id={field('unit')}
            value={value.unit}
            maxLength={SIGNAL_UNIT_MAX_LENGTH}
            onChange={(event) => onChange({ ...value, unit: event.target.value })}
            aria-invalid={errors.unit ? 'true' : undefined}
            aria-describedby={errors.unit ? errorId('unit') : undefined}
            className="rounded border border-[var(--c-border)] bg-transparent px-2 py-1.5"
          />
          {errors.unit && (
            <span id={errorId('unit')} role="alert" className="text-xs text-[var(--c-fault-fg)]">
              {errorText(pick, errors.unit)}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor={field('publisher')} className="text-[var(--c-text-dim)]">
            {pick('Program publish (duy nhất)', 'Publishing program (exactly one)')}
          </label>
          <select
            id={field('publisher')}
            value={value.publisherProgramId}
            onChange={(event) => onChange({ ...value, publisherProgramId: event.target.value })}
            aria-invalid={errors.publisher ? 'true' : undefined}
            aria-describedby={errors.publisher ? errorId('publisher') : undefined}
            className="rounded border border-[var(--c-border)] bg-transparent px-2 py-1.5"
          >
            <option value="">{pick('— Chọn Program —', '— Select a program —')}</option>
            {producers.map((producer) => (
              <option key={producer.programId} value={producer.programId}>
                {producer.name} · {producer.periodMs} ms
              </option>
            ))}
          </select>
          {errors.publisher && (
            <span id={errorId('publisher')} role="alert" className="text-xs text-[var(--c-fault-fg)]">
              {errorText(pick, errors.publisher)}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor={field('freshness')} className="text-[var(--c-text-dim)]">
            {pick('Hạn tươi (ms)', 'Freshness (ms)')}
          </label>
          <input
            id={field('freshness')}
            type="number"
            inputMode="numeric"
            min={SIGNAL_FRESHNESS_MIN_MS}
            max={SIGNAL_FRESHNESS_MAX_MS}
            step={1}
            value={value.freshnessMs}
            onChange={(event) => onChange({ ...value, freshnessMs: event.target.value })}
            aria-invalid={errors.freshness ? 'true' : undefined}
            aria-describedby={errors.freshness ? errorId('freshness') : undefined}
            className="rounded border border-[var(--c-border)] bg-transparent px-2 py-1.5"
          />
          {errors.freshness && (
            <span id={errorId('freshness')} role="alert" className="text-xs text-[var(--c-fault-fg)]">
              {errorText(pick, errors.freshness)}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor={field('policy')} className="text-[var(--c-text-dim)]">
            {pick('Chính sách khi quá hạn', 'Policy when stale')}
          </label>
          <select
            id={field('policy')}
            value={value.stalePolicy}
            onChange={(event) => onChange({ ...value, stalePolicy: event.target.value as SignalFormValue['stalePolicy'] })}
            aria-invalid={errors.policy ? 'true' : undefined}
            aria-describedby={
              errors.policy
                ? errorId('policy')
                : value.unsupportedStalePolicy && value.stalePolicy === ''
                  ? `${field('policy')}-legacy`
                  : undefined
            }
            className="rounded border border-[var(--c-border)] bg-transparent px-2 py-1.5"
          >
            {value.unsupportedStalePolicy && (
              <option value="" disabled>
                {value.unsupportedStalePolicy} — {pick('chọn chính sách thay thế', 'choose a replacement policy')}
              </option>
            )}
            {SIGNAL_STALE_POLICIES.map((policy) => (
              <option key={policy} value={policy}>
                {stalePolicyLabel(pick, policy)}
              </option>
            ))}
          </select>
          {value.unsupportedStalePolicy && value.stalePolicy === '' && (
            <span id={`${field('policy')}-legacy`} role="status" className="text-xs text-[var(--c-warn-fg)]">
              {pick(
                `Giá trị hiện có ${value.unsupportedStalePolicy} nằm ngoài DDD §7.3. Hãy chọn chính sách thay thế trước khi lưu; giao diện sẽ không đổi ngầm.`,
                `The current value ${value.unsupportedStalePolicy} is outside DDD §7.3. Choose a replacement before saving; the UI will not change it silently.`
              )}
            </span>
          )}
          {errors.policy && (
            <span id={errorId('policy')} role="alert" className="text-xs text-[var(--c-fault-fg)]">
              {errorText(pick, errors.policy)}
            </span>
          )}
        </div>

        {/* Ô giá trị dự phòng CHỈ hiện với `USE_FALLBACK`: ba chính sách còn lại
            không được mang giá trị, và một ô bị xám vẫn nói rằng khái niệm đó
            tồn tại ở đây. */}
        {value.stalePolicy === 'USE_FALLBACK' && (
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor={field('fallback')} className="text-[var(--c-text-dim)]">
              {value.type === 'BOOL'
                ? pick('Giá trị dự phòng (TRUE/FALSE)', 'Fallback value (TRUE/FALSE)')
                : value.type === 'TIME'
                  ? pick('Giá trị dự phòng (ms)', 'Fallback value (ms)')
                  : pick('Giá trị dự phòng', 'Fallback value')}
            </label>
            <input
              id={field('fallback')}
              value={value.fallbackValue}
              onChange={(event) => onChange({ ...value, fallbackValue: event.target.value })}
              aria-invalid={errors.fallback ? 'true' : undefined}
              aria-describedby={errors.fallback ? errorId('fallback') : undefined}
              className="rounded border border-[var(--c-border)] bg-transparent px-2 py-1.5"
            />
            {errors.fallback && (
              <span id={errorId('fallback')} role="alert" className="text-xs text-[var(--c-fault-fg)]">
                {errorText(pick, errors.fallback)}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" variant="primary" loading={saving} icon={<Save className="h-4 w-4" aria-hidden="true" />}>
          {pick('Lưu Published Signal', 'Save published signal')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {pick('Huỷ', 'Cancel')}
        </Button>
      </div>
    </form>
  )
}
