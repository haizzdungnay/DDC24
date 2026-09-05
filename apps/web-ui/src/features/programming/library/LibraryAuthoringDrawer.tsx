import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '../../../shared/components/Modal'
import { Button } from '../../../shared/components/Button'
import { useI18n } from '../../../shared/i18n'
import { createUuid } from '../../../shared/crypto'
import { PROGRAMMING_LIBRARY_CATEGORY_ORDER } from '../api/generated/library_registry'
import type { LibraryEntryCheckResult, LibraryEntryDraft } from '../api/mutations'
import type { LibraryEntryGroup } from '../model/library'
import type { ProgrammingLibraryEntry } from '../model/types'
import {
  LIBRARY_WIZARD_DATA_TYPES,
  LIBRARY_WIZARD_STEPS,
  emptyLibraryWizardValues,
  libraryWizardCanAdvance,
  libraryWizardChanges,
  libraryWizardDirty,
  libraryWizardDraft,
  libraryWizardIssues,
  libraryWizardStepIndex,
  libraryWizardStepIssues,
  libraryWizardValuesFrom,
  nextLibraryWizardStep,
  previousLibraryWizardStep,
  type LibraryWizardContext,
  type LibraryWizardDataType,
  type LibraryWizardPort,
  type LibraryWizardStep,
  type LibraryWizardValues,
} from './libraryWizard'

const LIBRARY_CATEGORY_MAX_CHARS = 32

export type LibraryEditorMode =
  | { kind: 'create' }
  | { kind: 'edit'; entry: ProgrammingLibraryEntry; savesNewVersion: boolean }

const STEP_TITLES: Record<LibraryWizardStep, string> = {
  metadata: 'Thông tin',
  interface: 'Giao diện',
  implementation: 'Hiện thực',
  check: 'Kiểm tra',
  review: 'Xem lại và lưu',
}

/**
 * `T61-401` / `ISS-PGM04-11` — wizard 5 bước cho Create/Edit khối PROJECT.
 *
 * Bản trước là MỘT form: mọi trường nằm trên cùng một màn, `interface` chỉ được
 * chép lại nguyên si (không sửa được), không có bước kiểm tra nào trước khi ghi,
 * và đóng giữa chừng thì mất trắng những gì đã gõ mà không hỏi lại.
 *
 * Bốn thay đổi thật, không phải đổi tên:
 *
 *  1. Năm bước có trạng thái riêng; Quay lại/Tiếp KHÔNG đụng vào dữ liệu, nên đi
 *     tới đi lui không mất gì (`libraryWizard.ts` giữ luật, tách khỏi React).
 *  2. Bước Giao diện sửa được cổng vào/ra và kiểu trả về, có kiểm kiểu.
 *  3. Bước Kiểm tra gọi ĐƯỜNG KIỂM TRA CỦA MÁY CHỦ
 *     (`POST .../library/entries/check`) — cùng bộ luật mà đường ghi chạy — và
 *     kết quả đó hết hiệu lực ngay khi người dùng sửa tiếp.
 *  4. Bước Xem lại liệt kê từng thay đổi kèm phân loại nội dung/trình bày
 *     (`D61-09`), và nút Lưu chỉ ghi vào Draft — không có Publish rời.
 *
 * Vẫn dùng `Modal` để thừa hưởng bẫy tiêu điểm, `Esc` và trả tiêu điểm về nút đã
 * mở nó — ba thứ mà một `<div>` tự vẽ sẽ phải làm lại và sẽ làm thiếu.
 */
export function LibraryAuthoringDrawer({
  mode,
  disabled,
  projectEntries,
  checkPending,
  checkError,
  onCheck,
  onCancel,
  onSubmit,
}: {
  mode: LibraryEditorMode | null
  disabled: boolean
  projectEntries: LibraryEntryGroup[]
  checkPending: boolean
  checkError: string | null
  onCheck: (draft: LibraryEntryDraft) => Promise<LibraryEntryCheckResult | null>
  onCancel: () => void
  onSubmit: (draft: LibraryEntryDraft) => void
}) {
  if (!mode) return null
  /* Hàng rào THẬT cho `AC-PGM04-03`, không chỉ là ẩn nút Sửa ở thẻ SYSTEM: nếu
     một lối vào nào đó quên kiểm, wizard vẫn không mở. Registry SYSTEM là bất
     biến — mở một form ghi trên nó là hứa một thứ máy chủ sẽ từ chối. */
  if (mode.kind === 'edit' && mode.entry.scope === 'SYSTEM') return null
  return (
    <AuthoringWizard
      // `key` ép state dựng lại khi đổi khối đang sửa: giữ state cũ sẽ mang mã
      // nguồn và cổng của khối trước sang khối sau.
      key={mode.kind === 'edit' ? mode.entry.entryId : 'create'}
      mode={mode}
      disabled={disabled}
      projectEntries={projectEntries}
      checkPending={checkPending}
      checkError={checkError}
      onCheck={onCheck}
      onCancel={onCancel}
      onSubmit={onSubmit}
    />
  )
}

function AuthoringWizard({
  mode,
  disabled,
  projectEntries,
  checkPending,
  checkError,
  onCheck,
  onCancel,
  onSubmit,
}: {
  mode: LibraryEditorMode
  disabled: boolean
  projectEntries: LibraryEntryGroup[]
  checkPending: boolean
  checkError: string | null
  onCheck: (draft: LibraryEntryDraft) => Promise<LibraryEntryCheckResult | null>
  onCancel: () => void
  onSubmit: (draft: LibraryEntryDraft) => void
}) {
  const { pick } = useI18n()
  const existing = mode.kind === 'edit' ? mode.entry : null
  const [createdEntryId] = useState(() => createUuid())
  const baseline = useMemo<LibraryWizardValues>(
    () => (existing ? libraryWizardValuesFrom(existing) : emptyLibraryWizardValues()),
    [existing]
  )
  const [values, setValues] = useState<LibraryWizardValues>(baseline)
  const [step, setStep] = useState<LibraryWizardStep>('metadata')
  const [showIssues, setShowIssues] = useState(false)
  const [confirmingClose, setConfirmingClose] = useState(false)
  const [checkResult, setCheckResult] = useState<LibraryEntryCheckResult | null>(null)
  const [checkedSignature, setCheckedSignature] = useState<string | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

  const context = useMemo<LibraryWizardContext>(
    () => ({
      entryId: existing?.entryId ?? createdEntryId,
      mode: existing ? 'edit' : 'create',
      siblings: projectEntries
        .filter((group) => group.entryId !== existing?.entryId)
        .map((group) => ({
          entryId: group.entryId,
          name: group.name,
          dependencies: group.current.dependencies.map((item) => item.entryId),
        })),
      /* Hợp đồng đọc hôm nay KHÔNG mang `source` (`T61-404` chưa landing). Nói
         ra sự thật đó thay vì để ô trống trông như khối không có mã. */
      storedSourceAvailable: false,
    }),
    [createdEntryId, existing, projectEntries]
  )

  const issues = useMemo(() => libraryWizardIssues(values, context), [values, context])
  const draft = useMemo(() => libraryWizardDraft(values, context, projectEntries), [values, context, projectEntries])
  const signature = JSON.stringify(draft)
  /* Kết quả kiểm tra chỉ có giá trị cho ĐÚNG payload đã gửi đi. Sửa một ký tự
     sau khi kiểm xong là một payload khác, và cho Lưu bằng kết quả cũ là đúng
     cái lỗ hổng mà bước Kiểm tra sinh ra để bịt. */
  const checkFresh = checkResult !== null && checkedSignature === signature
  const stepIssues = libraryWizardStepIssues(issues, step)
  const canAdvance = libraryWizardCanAdvance(issues, step)
  const dirty = libraryWizardDirty(values, baseline)
  const changes = libraryWizardChanges(values, baseline)

  useEffect(() => {
    headingRef.current?.focus()
  }, [step])

  function update(patch: Partial<LibraryWizardValues>) {
    setValues((current) => ({ ...current, ...patch }))
    setShowIssues(false)
  }

  async function runCheck() {
    const result = await onCheck(draft)
    if (!result) return
    setCheckResult(result)
    setCheckedSignature(signature)
  }

  function goNext() {
    if (!canAdvance) {
      setShowIssues(true)
      return
    }
    if (step === 'check' && (!checkFresh || checkResult?.blocking)) {
      setShowIssues(true)
      return
    }
    setShowIssues(false)
    setStep(nextLibraryWizardStep(step))
  }

  function save() {
    if (issues.length > 0 || !checkFresh || checkResult?.blocking) {
      setShowIssues(true)
      return
    }
    onSubmit(draft)
  }

  function requestClose() {
    if (dirty && !confirmingClose) {
      setConfirmingClose(true)
      return
    }
    onCancel()
  }

  const primary =
    step === 'review'
      ? { label: pick('Lưu vào bản nháp thư viện', 'Save to library draft'), run: save }
      : { label: pick('Tiếp', 'Next'), run: goNext }

  return (
    <Modal
      open
      size="xl"
      mobileFullscreen
      title={
        existing
          ? pick('Sửa khối PROJECT', 'Edit PROJECT block')
          : pick('Tạo khối PROJECT', 'New PROJECT block')
      }
      confirmLabel={primary.label}
      cancelLabel={pick('Huỷ', 'Cancel')}
      confirmDisabled={disabled || (step === 'review' && (!checkFresh || checkResult?.blocking === true))}
      confirmLoading={disabled}
      onConfirm={primary.run}
      onClose={requestClose}
    >
      <div className="flex flex-col gap-4 text-[var(--c-text)]">
        {confirmingClose && (
          /* Đóng khi đang bẩn phải HỎI, và phải hỏi ngay trong hộp thoại này chứ
             không phải một `window.confirm` — hộp thoại hệ thống nằm ngoài bẫy
             tiêu điểm và không đọc được bằng trình đọc màn hình cùng ngữ cảnh. */
          <div
            role="alertdialog"
            aria-label={pick('Xác nhận đóng', 'Confirm closing')}
            data-testid="library-wizard-discard"
            className="rounded border border-[var(--c-fault-fg)] p-3 text-sm"
          >
            <p>{pick('Đóng bây giờ sẽ mất những gì đã nhập. Đóng chứ?', 'Closing now discards what you entered. Close?')}</p>
            <div className="mt-2 flex gap-2">
              <Button variant="danger" onClick={onCancel}>{pick('Đóng và bỏ thay đổi', 'Close and discard')}</Button>
              <Button variant="secondary" onClick={() => setConfirmingClose(false)}>{pick('Tiếp tục soạn', 'Keep editing')}</Button>
            </div>
          </div>
        )}

        <ol className="flex flex-wrap gap-2 text-xs" data-testid="library-wizard-steps">
          {LIBRARY_WIZARD_STEPS.map((item, index) => (
            <li key={item}>
              <span
                data-testid={`library-wizard-step-${item}`}
                aria-current={item === step ? 'step' : undefined}
                className={
                  item === step
                    ? 'rounded bg-[var(--c-accent-bg)] px-2 py-1 font-semibold'
                    : 'rounded px-2 py-1 text-[var(--c-text-dim)]'
                }
              >
                {index + 1}. {STEP_TITLES[item]}
              </span>
            </li>
          ))}
        </ol>

        <h3 ref={headingRef} tabIndex={-1} className="text-base font-semibold">
          {STEP_TITLES[step]}
        </h3>

        {existing && (
          <p className="text-xs text-[var(--c-text-dim)]">
            {pick('Đang sửa', 'Editing')} <strong>{existing.name}</strong> · {existing.libraryVersion} · {existing.libraryState}
          </p>
        )}

        {showIssues && stepIssues.length > 0 && (
          <ul role="alert" data-testid="library-wizard-issues" className="flex flex-col gap-1 text-xs text-[var(--c-fault-fg)]">
            {stepIssues.map((issue) => (
              <li key={`${issue.field}-${issue.code}-${issue.message}`}>{issue.message}</li>
            ))}
          </ul>
        )}

        {step === 'metadata' && <MetadataStep values={values} update={update} />}
        {step === 'interface' && <InterfaceStep values={values} update={update} />}
        {step === 'implementation' && (
          <ImplementationStep
            values={values}
            update={update}
            context={context}
            projectEntries={projectEntries}
          />
        )}
        {step === 'check' && (
          <CheckStep
            pending={checkPending}
            error={checkError}
            fresh={checkFresh}
            result={checkResult}
            /* Bấm "Tiếp" mà chưa kiểm thì phải NÓI RA. Không có dòng này, nút
               Tiếp im lặng không làm gì và người dùng bấm lại nhiều lần. */
            blocked={showIssues && (!checkFresh || checkResult?.blocking === true)}
            onRun={runCheck}
          />
        )}
        {step === 'review' && (
          <ReviewStep changes={changes} fresh={checkFresh} blocking={checkResult?.blocking === true} />
        )}

        <div className="flex justify-start">
          <Button
            variant="secondary"
            disabled={libraryWizardStepIndex(step) === 0}
            onClick={() => {
              /* Quay lại KHÔNG đụng vào `values`: đây là toàn bộ lý do dữ liệu
                 không mất khi đi tới đi lui. */
              setShowIssues(false)
              setStep(previousLibraryWizardStep(step))
            }}
          >
            {pick('Quay lại', 'Back')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-[var(--c-text-dim)]">{label}</span>
      {children}
    </label>
  )
}

const inputClass = 'rounded border border-[var(--c-border)] bg-transparent px-2 py-1.5'

function MetadataStep({
  values,
  update,
}: {
  values: LibraryWizardValues
  update: (patch: Partial<LibraryWizardValues>) => void
}) {
  const { pick } = useI18n()
  return (
    <div className="flex flex-col gap-3">
      <Field label={pick('Tên khối', 'Block name')}>
        <input value={values.name} onChange={(event) => update({ name: event.target.value })} maxLength={64} className={inputClass} />
      </Field>
      <Field label={pick('Loại', 'Kind')}>
        <select
          value={values.kind}
          onChange={(event) => update({ kind: event.target.value as LibraryWizardValues['kind'] })}
          className={inputClass}
        >
          <option value="FUNCTION">FUNCTION</option>
          <option value="FUNCTION_BLOCK">FUNCTION_BLOCK</option>
        </select>
      </Field>
      <Field label={pick('Ngôn ngữ', 'Language')}>
        <select
          value={values.language}
          onChange={(event) => update({ language: event.target.value as LibraryWizardValues['language'] })}
          className={inputClass}
        >
          <option value="ST">ST</option>
          <option value="FBD">FBD</option>
        </select>
      </Field>
      <Field label={pick('Phân loại', 'Category')}>
        {/* Danh sách nhóm lấy từ registry, không viết tay ở FE: registry là nơi
            `category` được định nghĩa nên nó cũng định nghĩa tập giá trị hợp lệ.
            Một nhóm thêm vào registry mà FE không biết sẽ tạo ra khối không lọc
            được, và người dùng không nhận ra. */}
        <select value={values.category} onChange={(event) => update({ category: event.target.value })} className={inputClass}>
          <option value="">{pick('— chưa phân loại', '— not categorised')}</option>
          {PROGRAMMING_LIBRARY_CATEGORY_ORDER.filter((item) => item.id.length <= LIBRARY_CATEGORY_MAX_CHARS).map((item) => (
            <option key={item.id} value={item.id}>{pick(item.labelVi, item.labelEn)}</option>
          ))}
        </select>
      </Field>
      <Field label={pick('Mô tả ngắn', 'Short description')}>
        <textarea value={values.description} onChange={(event) => update({ description: event.target.value })} rows={2} className={inputClass} />
      </Field>
      <Field label={pick('Thẻ (ngăn bằng dấu phẩy)', 'Tags (comma separated)')}>
        {/* `tags` đã có trong hợp đồng ghi từ `T61-101` nhưng chưa có ô nào để
            nhập: mọi khối PROJECT vì thế không bao giờ có thẻ, và bộ lọc theo
            thẻ không bao giờ khớp một khối do người dùng tạo. */}
        <input
          value={values.tags.join(', ')}
          onChange={(event) =>
            update({ tags: event.target.value.split(',').map((tag) => tag.trim()).filter((tag) => tag !== '') })
          }
          className={inputClass}
        />
      </Field>
    </div>
  )
}

function PortRows({
  legend,
  ports,
  onChange,
}: {
  legend: string
  ports: LibraryWizardPort[]
  onChange: (next: LibraryWizardPort[]) => void
}) {
  const { pick } = useI18n()
  return (
    <fieldset className="flex flex-col gap-2 text-sm">
      <legend className="text-[var(--c-text-dim)]">{legend}</legend>
      {ports.map((port, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2">
          <input
            aria-label={`${legend} ${index + 1} ${pick('tên', 'name')}`}
            value={port.name}
            onChange={(event) =>
              onChange(ports.map((item, position) => (position === index ? { ...item, name: event.target.value } : item)))
            }
            className={`${inputClass} min-w-0 flex-1`}
          />
          <select
            aria-label={`${legend} ${index + 1} ${pick('kiểu', 'type')}`}
            value={port.type}
            onChange={(event) =>
              onChange(
                ports.map((item, position) =>
                  position === index ? { ...item, type: event.target.value as LibraryWizardDataType } : item
                )
              )
            }
            className={inputClass}
          >
            {/* Kiểu hiện có mà registry không biết vẫn được LIỆT KÊ để người dùng
                nhìn thấy nó, thay vì bị select âm thầm đổi sang giá trị đầu tiên
                — đổi im lặng là một lần sửa interface không ai yêu cầu. */}
            {!(LIBRARY_WIZARD_DATA_TYPES as readonly string[]).includes(port.type) && (
              <option value={port.type}>
                {/* `port.type` được KHAI là kiểu hẹp nhưng dữ liệu đã lưu có thể
                    mang một chuỗi ngoài tập đó — đúng trường hợp nhánh này tồn
                    tại để hiện ra. So bằng `String(...)` vì phép so trực tiếp bị
                    TypeScript coi là vô nghĩa trên kiểu hẹp. */}
                {String(port.type) === '' ? pick('— chưa chọn', '— not set') : port.type}
              </option>
            )}
            {LIBRARY_WIZARD_DATA_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          <Button
            variant="secondary"
            onClick={() => onChange(ports.filter((_, position) => position !== index))}
          >
            {pick('Bỏ', 'Remove')}
          </Button>
        </div>
      ))}
      <div>
        <Button variant="secondary" onClick={() => onChange([...ports, { name: '', type: 'REAL' }])}>
          {pick('Thêm cổng', 'Add port')} · {legend}
        </Button>
      </div>
    </fieldset>
  )
}

function InterfaceStep({
  values,
  update,
}: {
  values: LibraryWizardValues
  update: (patch: Partial<LibraryWizardValues>) => void
}) {
  const { pick } = useI18n()
  return (
    <div className="flex flex-col gap-4">
      <PortRows legend={pick('Cổng vào', 'Inputs')} ports={values.inputs} onChange={(inputs) => update({ inputs })} />
      <PortRows legend={pick('Cổng ra', 'Outputs')} ports={values.outputs} onChange={(outputs) => update({ outputs })} />
      {values.kind === 'FUNCTION' && (
        <Field label={pick('Kiểu trả về', 'Return type')}>
          <select
            value={values.returnType}
            onChange={(event) => update({ returnType: event.target.value as LibraryWizardValues['returnType'] })}
            className={inputClass}
          >
            <option value="">{pick('— chưa chọn', '— not set')}</option>
            {LIBRARY_WIZARD_DATA_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </Field>
      )}
      {values.kind === 'FUNCTION_BLOCK' && (
        <p className="text-xs text-[var(--c-text-dim)]">
          {pick(
            'FUNCTION_BLOCK giữ trạng thái giữa các chu kỳ; layout RETAIN do máy chủ tính khi Seal, wizard không khai nó.',
            'A FUNCTION_BLOCK keeps state between cycles; the RETAIN layout is computed by the server at Seal time.'
          )}
        </p>
      )}
    </div>
  )
}

function ImplementationStep({
  values,
  update,
  context,
  projectEntries,
}: {
  values: LibraryWizardValues
  update: (patch: Partial<LibraryWizardValues>) => void
  context: LibraryWizardContext
  projectEntries: LibraryEntryGroup[]
}) {
  const { pick } = useI18n()
  const selectable = projectEntries.filter((group) => group.entryId !== context.entryId)
  return (
    <div className="flex flex-col gap-3">
      <Field
        label={values.language === 'FBD' ? pick('Nội dung FBD (JSON)', 'FBD content (JSON)') : pick('Mã nguồn ST', 'ST source')}
      >
        <textarea
          value={values.source}
          onChange={(event) => update({ source: event.target.value })}
          rows={10}
          className={`${inputClass} font-mono text-xs`}
        />
      </Field>
      {context.mode === 'edit' && !context.storedSourceAvailable && (
        <p data-testid="library-wizard-source-notice" className="text-xs text-[var(--c-text-dim)]">
          {pick(
            'Máy chủ chưa trả lại mã nguồn đã lưu, nên ô này bắt đầu trống. Lưu là ghi đè TOÀN PHẦN, nên hãy dán lại đủ mã của phiên bản mới.',
            'The server does not return the stored source yet, so this field starts empty. Saving overwrites the whole entry, so paste the full source of the new version.'
          )}
        </p>
      )}
      {selectable.length > 0 && (
        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="text-[var(--c-text-dim)]">{pick('Phụ thuộc khối PROJECT', 'PROJECT block dependencies')}</legend>
          {selectable.map((group) => (
            <label key={group.entryId} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={values.dependencies.includes(group.entryId)}
                onChange={(event) =>
                  update({
                    dependencies: event.target.checked
                      ? [...values.dependencies, group.entryId]
                      : values.dependencies.filter((entryId) => entryId !== group.entryId),
                  })
                }
              />
              <span>
                {group.name} · {group.current.libraryVersion}
              </span>
            </label>
          ))}
        </fieldset>
      )}
    </div>
  )
}

function CheckStep({
  pending,
  error,
  fresh,
  result,
  blocked,
  onRun,
}: {
  pending: boolean
  error: string | null
  fresh: boolean
  result: LibraryEntryCheckResult | null
  blocked: boolean
  onRun: () => void
}) {
  const { pick } = useI18n()
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-xs text-[var(--c-text-dim)]">
        {pick(
          'Phép kiểm chạy trên MÁY CHỦ, bằng đúng bộ luật mà lần Lưu sẽ chạy. Nó không ghi gì và không tiêu ETag của bản nháp.',
          'The check runs on the SERVER with the same rules the save path runs. It writes nothing and does not consume the draft ETag.'
        )}
      </p>
      <div>
        <Button loading={pending} disabled={pending} onClick={onRun} data-testid="library-wizard-run-check">
          {pick('Chạy kiểm tra trên máy chủ', 'Run the server check')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-[var(--c-fault-fg)]">{error}</p>
      )}
      {blocked && (
        <p role="alert" data-testid="library-wizard-check-required" className="text-xs text-[var(--c-fault-fg)]">
          {pick(
            'Phải chạy phép kiểm trên máy chủ cho nội dung hiện tại và không còn lỗi chặn thì mới sang được bước cuối.',
            'Run the server check for the current content and clear every blocking problem before the final step.'
          )}
        </p>
      )}
      {!fresh && result !== null && (
        /* Kết quả CŨ không được hiện như kết quả hiện tại: người dùng vừa sửa
           tiếp sau khi kiểm, và một dấu tích xanh của payload trước là lời mời
           bấm Lưu trên một thứ chưa ai kiểm. */
        <p data-testid="library-wizard-check-stale" className="text-xs text-[var(--c-warn-fg)]">
          {pick('Nội dung đã đổi sau lần kiểm gần nhất. Hãy kiểm lại.', 'The content changed after the last check. Run it again.')}
        </p>
      )}
      {fresh && result !== null && (
        <div data-testid="library-wizard-check-result">
          {result.diagnostics.length === 0 ? (
            <p>{pick('Máy chủ không tìm thấy lỗi nào.', 'The server found no problems.')}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {result.diagnostics.map((diagnostic) => (
                <li
                  key={`${diagnostic.field}-${diagnostic.code}`}
                  className={diagnostic.severity === 'BLOCKING' ? 'text-[var(--c-fault-fg)]' : 'text-[var(--c-warn-fg)]'}
                >
                  <strong>{diagnostic.field}</strong> · {diagnostic.code} — {diagnostic.message}
                </li>
              ))}
            </ul>
          )}
          {result.libraryVersion && (
            <p className="mt-2 text-xs text-[var(--c-text-dim)]">
              {pick('Bản nháp thư viện sẽ nhận thay đổi:', 'The library draft that will take the change:')}{' '}
              {result.libraryVersion}
              {result.libraryRevisionId === null &&
                ` · ${pick('sẽ được mở mới khi lưu', 'will be opened on save')}`}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ReviewStep({
  changes,
  fresh,
  blocking,
}: {
  changes: ReturnType<typeof libraryWizardChanges>
  fresh: boolean
  blocking: boolean
}) {
  const { pick } = useI18n()
  return (
    <div className="flex flex-col gap-3 text-sm">
      {changes.length === 0 ? (
        <p>{pick('Không có thay đổi nào so với bản đã lưu.', 'Nothing changed compared with the stored entry.')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs" data-testid="library-wizard-changes">
            <thead className="text-[var(--c-text-dim)]">
              <tr>
                <th className="py-1 pr-3">{pick('Trường', 'Field')}</th>
                <th className="py-1 pr-3">{pick('Trước', 'Before')}</th>
                <th className="py-1 pr-3">{pick('Sau', 'After')}</th>
                <th className="py-1">{pick('Tác động', 'Impact')}</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((change) => (
                <tr key={change.field} data-testid={`library-wizard-change-${change.field}`}>
                  <td className="py-1 pr-3">{change.label}</td>
                  <td className="py-1 pr-3 font-mono">{change.before === '' ? '—' : change.before}</td>
                  <td className="py-1 pr-3 font-mono">{change.after === '' ? '—' : change.after}</td>
                  <td className="py-1">
                    {change.impact === 'content'
                      ? pick('Nội dung (đổi contentSha256)', 'Content (changes contentSha256)')
                      : pick('Trình bày (không đổi contentSha256)', 'Presentation (contentSha256 unchanged)')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-[var(--c-text-dim)]">
        {pick(
          'Lưu chỉ ghi vào BẢN NHÁP thư viện của Project. Không có Publish riêng: một version chỉ được publish trong cùng transaction với Seal Revision.',
          'Saving writes only to the project library DRAFT. There is no separate Publish: a version is published in the same transaction as sealing a revision.'
        )}
      </p>
      {(!fresh || blocking) && (
        <p role="alert" data-testid="library-wizard-review-blocked" className="text-xs text-[var(--c-fault-fg)]">
          {pick(
            'Chưa lưu được: hãy quay lại bước Kiểm tra và chạy lại phép kiểm trên máy chủ cho nội dung hiện tại.',
            'Cannot save yet: go back to the Check step and run the server check for the current content.'
          )}
        </p>
      )}
    </div>
  )
}
