import { useRef, useState } from 'react'
import { AlertTriangle, Download, RotateCcw, Upload } from 'lucide-react'
import { useI18n } from '../../../shared/i18n'
import { bytesToBase64, createUuid, sha256Hex } from '../../../shared/crypto'
import { Panel } from '../../../shared/components/Panel'
import { Button } from '../../../shared/components/Button'
import { Modal } from '../../../shared/components/Modal'
import { useProgrammingApiClient } from '../api/authClient'
import { ProgrammingApiError } from '../api/generated/client'
import { programmingErrorCopy } from '../api/errorCopy'
import { useProgrammingRevisionChanges } from '../api/queries'
import { useRestoreWorkflow } from './useRestoreWorkflow'
import { useRetainResetWorkflow } from './useRetainResetWorkflow'
import type { ProgrammingRuntime } from '../model/types'
import { useProgrammingActionAllowed } from '../api/authorization'

/**
 * Vùng thao tác nguy hiểm của PGM-06 (`UJ-PROG-08`) — tách khỏi vùng chỉ đọc,
 * viền cảnh báo; capability tương ứng mới làm hiện nút thật, vai chỉ đọc thấy lý
 * do, KHÔNG thấy một dãy nút bị vô hiệu hóa (UX §16.4).
 */
export function DangerZone({ runtime, runtimeStatus }: { runtime: ProgrammingRuntime | null; runtimeStatus: 'loading' | 'ready' | 'error' }) {
  const { pick } = useI18n()
  const canActivate = useProgrammingActionAllowed('restore')
  const canExport = useProgrammingActionAllowed('bundleExport')
  const coreMutationReady = runtimeStatus === 'ready' && runtime?.producerState === 'READY' && runtime.safeState === false

  if (!canActivate && !canExport) {
    return (
      <Panel title={pick('Vùng thao tác nguy hiểm', 'Danger zone')} className="border-[var(--c-warn)]">
        <p className="text-sm text-[var(--c-text-dim)]">
          {pick('Cần capability Programming phù hợp để khôi phục, xuất/nhập gói hoặc đặt lại trạng thái lưu.', 'The matching Programming capability is required to restore, export/import a bundle, or reset RETAIN state.')}
        </p>
      </Panel>
    )
  }

  return (
    <Panel title={pick('Vùng thao tác nguy hiểm', 'Danger zone')} className="border-[var(--c-warn)]">
      <div className="space-y-4">
        {canActivate && <RestoreSection runtime={runtime} coreMutationReady={coreMutationReady} />}
        {canActivate && canExport && <div className="h-px bg-[var(--c-border)]" />}
        {canExport && <BundleExportSection revisionId={runtime?.activeRevisionId ?? null} />}
        {canActivate && canExport && <div className="h-px bg-[var(--c-border)]" />}
        {canActivate && <BundleImportSection />}
        {canActivate && <div className="h-px bg-[var(--c-border)]" />}
        {canActivate && <RetainResetSection runtime={runtime} coreMutationReady={coreMutationReady} />}
      </div>
    </Panel>
  )
}

function RestoreSection({ runtime, coreMutationReady }: { runtime: ProgrammingRuntime | null; coreMutationReady: boolean }) {
  const { pick } = useI18n()
  const restore = useRestoreWorkflow()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [password, setPassword] = useState('')
  const submitting = restore.state.phase === 'submitting' || restore.state.phase === 'polling'
  const canRestore = coreMutationReady && !!runtime?.lkgRevisionId

  return (
    <div>
      <h3 className="text-sm font-semibold text-[var(--c-text)]">{pick('Khôi phục bản trước', 'Restore previous version')}</h3>
      <p className="mt-1 text-sm text-[var(--c-text-dim)]">
        {canRestore
          ? pick(`Khôi phục về LKG (${runtime!.lkgRevisionId!.slice(0, 8)}) — bản tốt gần nhất đã biết.`, `Restore to LKG (${runtime!.lkgRevisionId!.slice(0, 8)}) — the last known-good revision.`)
          : pick('Chỉ cho phép khi có LKG, Core ở READY và safe-state không tác động.', 'Allowed only when an LKG exists, Core is READY, and safe-state is inactive.')}
      </p>
      <Button size="sm" variant="danger" className="mt-2" icon={<RotateCcw className="h-4 w-4" aria-hidden="true" />} disabled={!canRestore} onClick={() => setOpen(true)}>
        {pick('Khôi phục bản trước…', 'Restore previous…')}
      </Button>

      {restore.state.phase === 'unknown' && (
        <div role="alert" className="mt-2 rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-2 text-sm">
          <p className="text-[var(--c-warn-fg)]">{pick('Chưa xác định kết quả Khôi phục. Đang chờ đọc ngược…', 'Restore result unknown. Waiting for read-back…')}</p>
          <Button size="sm" className="mt-1" onClick={() => restore.recheckStatus(restore.state.phase === 'unknown' ? restore.state.operationId : '')}>
            {pick('Kiểm tra lại trạng thái', 'Re-check status')}
          </Button>
        </div>
      )}
      {restore.state.phase === 'terminal' && (
        <p className={`mt-2 text-sm ${restore.state.operation.state === 'SUCCEEDED' ? 'text-[var(--c-good-fg)]' : 'text-[var(--c-fault-fg)]'}`}>
          {restore.state.operation.state === 'SUCCEEDED'
            ? pick(`Khôi phục thành công. Bản đang chạy: ${restore.state.operation.actualActiveRevisionId ?? '—'}.`, `Restore succeeded. Running version: ${restore.state.operation.actualActiveRevisionId ?? '—'}.`)
            : pick('Khôi phục thất bại.', 'Restore failed.')}
        </p>
      )}
      {restore.state.phase === 'error' && <p className="mt-2 text-sm text-[var(--c-fault-fg)]">{restore.state.message}</p>}

      <Modal
        open={open}
        title={pick('Xác nhận Khôi phục', 'Confirm restore')}
        confirmLabel={pick('Khôi phục', 'Restore')}
        danger
        confirmLoading={submitting}
        confirmDisabled={submitting || reason.trim().length === 0 || password.length === 0}
        onConfirm={() => {
          if (!runtime?.lkgRevisionId) return
          void restore.submit(runtime.lkgRevisionId, runtime.activeRevisionId, reason, password)
        }}
        onClose={() => {
          if (submitting) return
          setOpen(false)
        }}
      >
        <div className="space-y-3">
          <p>{pick('Hành động này thay đổi ngay hệ thống đang chạy và không thể hoàn tác bằng nút Hủy.', 'This action immediately changes the running system and cannot be undone with Cancel.')}</p>
          <label className="block text-xs font-medium text-[var(--c-text-dim)]" htmlFor="programming-restore-reason">
            {pick('Lý do khôi phục', 'Restore reason')}
          </label>
          <input
            id="programming-restore-reason"
            className="w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 py-2 text-sm text-[var(--c-text)]"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <label className="block text-xs font-medium text-[var(--c-text-dim)]" htmlFor="programming-restore-reauth">
            {pick('Xác thực lại — nhập mật khẩu', 'Re-authenticate — enter password')}
          </label>
          <input
            id="programming-restore-reauth"
            type="password"
            autoComplete="current-password"
            className="w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 py-2 text-sm text-[var(--c-text)]"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
      </Modal>
    </div>
  )
}

interface BundleExportResponse {
  schemaVersion: string
  bundleSha256: string
  byteSize: number
  selectedRevisionId: string
  bundleBase64: string
}

function BundleExportSection({ revisionId }: { revisionId: string | null }) {
  const { pick } = useI18n()
  const client = useProgrammingApiClient()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  async function exportBundle() {
    if (!revisionId) return
    setBusy(true)
    setResult(null)
    try {
      const response = await client.request<BundleExportResponse>('exportProgrammingBundle', {
        body: { schemaVersion: '1.0', revisionIds: [revisionId] },
        idempotencyKey: createUuid(),
        correlationId: createUuid()
      })
      const binary = atob(response.bundleBase64)
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `mkddc-programming-${response.selectedRevisionId.slice(0, 8)}.zip`
      anchor.click()
      URL.revokeObjectURL(url)
      setResult(pick(`Đã xuất ${response.byteSize} byte · SHA-256 ${response.bundleSha256.slice(0, 12)}…`, `Exported ${response.byteSize} bytes · SHA-256 ${response.bundleSha256.slice(0, 12)}…`))
    } catch (reason) {
      setResult(reason instanceof ProgrammingApiError ? programmingErrorCopy(pick, reason.envelope.error.code) : pick('Không xuất được gói.', 'Could not export the bundle.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-[var(--c-text)]">{pick('Xuất gói source-only', 'Export source-only bundle')}</h3>
      <p className="mt-1 text-sm text-[var(--c-text-dim)]">{pick('Xuất Revision đang vận hành cùng manifest và SHA-256; không chứa artifact native.', 'Export the active revision with its manifest and SHA-256; native artifacts are excluded.')}</p>
      <Button size="sm" variant="secondary" className="mt-2" icon={<Download className="h-4 w-4" aria-hidden="true" />} loading={busy} disabled={!revisionId} onClick={() => void exportBundle()}>
        {pick('Xuất gói .zip', 'Export .zip bundle')}
      </Button>
      {result && <p className="mt-2 text-sm text-[var(--c-text)]">{result}</p>}
    </div>
  )
}

function BundleImportSection() {
  const { pick } = useI18n()
  const client = useProgrammingApiClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  async function handleFile(file: File) {
    setBusy(true)
    setResult(null)
    try {
      const raw = new Uint8Array(await file.arrayBuffer())
      const expectedSha256 = sha256Hex(raw)
      const bundleBase64 = bytesToBase64(raw)
      await client.request('importProgrammingBundle', {
        body: { schemaVersion: '1.0', name: file.name.replace(/\.zip$/i, ''), bundleBase64, expectedSha256 },
        idempotencyKey: createUuid(),
        correlationId: createUuid()
      })
      setResult(pick('Nhập gói thành công — đã tạo Project/Draft mới, chưa Active.', 'Bundle imported — a new Project/Draft was created, not yet active.'))
    } catch (reason) {
      setResult(reason instanceof ProgrammingApiError ? programmingErrorCopy(pick, reason.envelope.error.code) : pick('Không nhập được gói.', 'Could not import the bundle.'))
    } finally {
      setBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-[var(--c-text)]">{pick('Nhập gói thay thiết bị', 'Import replacement bundle')}</h3>
      <p className="mt-1 text-sm text-[var(--c-text-dim)]">
        {pick('Chỉ chấp nhận gói source-only (.zip) đã xuất từ controller khác. Nhập KHÔNG tự Active.', 'Only source-only bundles (.zip) exported from another controller are accepted. Import never auto-activates.')}
      </p>
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip"
        className="sr-only"
        id="programming-bundle-import-input"
        aria-label={pick('Tệp bundle Programming để nhập', 'Programming bundle file to import')}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void handleFile(file)
        }}
      />
      <Button size="sm" variant="secondary" className="mt-2" icon={<Upload className="h-4 w-4" aria-hidden="true" />} loading={busy} onClick={() => fileInputRef.current?.click()}>
        {pick('Chọn gói .zip…', 'Choose .zip bundle…')}
      </Button>
      {result && <p className="mt-2 text-sm text-[var(--c-text)]">{result}</p>}
    </div>
  )
}

/**
 * WP-12 (RETAIN Reset, DDD-RETAIN-RESET-PROG-001). Trước đây là stub khoá
 * cứng vì backend chỉ ở mức contract-only (503) và chưa có danh sách biến
 * RETAIN bị ảnh hưởng — cả hai điều kiện đó nay đã có: `POST /retain/reset`
 * đã nối Core thật, và danh sách biến dùng lại đúng
 * `GET /revisions/none/changes/{activeRevisionId}` (impact nhóm `retain`)
 * — cùng cơ chế Commission đã dùng, không phải một nguồn dữ liệu mới.
 */
function RetainResetSection({ runtime, coreMutationReady }: { runtime: ProgrammingRuntime | null; coreMutationReady: boolean }) {
  const { pick } = useI18n()
  const activeRevisionId = runtime?.activeRevisionId ?? null
  const changes = useProgrammingRevisionChanges('none', activeRevisionId ?? undefined)
  const retainReset = useRetainResetWorkflow()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [password, setPassword] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const submitting = retainReset.state.phase === 'submitting' || retainReset.state.phase === 'polling'
  const canReset = coreMutationReady && !!activeRevisionId

  const impact = changes.data?.impact.retain ?? null
  // UNAVAILABLE (hoặc lỗi đọc) fail-closed — không cho xác nhận khi không
  // biết chắc phạm vi ảnh hưởng (đúng nguyên tắc Commission dùng cho `hasUnavailable`).
  const impactUnavailable = changes.status === 'error' || impact?.status === 'UNAVAILABLE'
  const impactPresent = impact?.status === 'PRESENT'
  const confirmDisabled =
    submitting ||
    changes.status === 'loading' ||
    reason.trim().length === 0 ||
    password.length === 0 ||
    impactUnavailable ||
    (impactPresent && !acknowledged)

  function openDialog() {
    setReason('')
    setPassword('')
    setAcknowledged(false)
    changes.refresh()
    setOpen(true)
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-[var(--c-text)]">{pick('Đặt lại trạng thái lưu (RETAIN)', 'Reset RETAIN state')}</h3>
      <p className="mt-1 text-sm text-[var(--c-text-dim)]">
        {canReset
          ? pick(
              `Đặt lại toàn bộ biến RETAIN của bản đang chạy (${activeRevisionId!.slice(0, 8)}) về giá trị khởi tạo.`,
              `Reset all RETAIN variables of the running version (${activeRevisionId!.slice(0, 8)}) to their initial value.`
            )
          : pick('Chỉ cho phép khi có Active Revision, Core ở READY và safe-state không tác động.', 'Allowed only when an Active Revision exists, Core is READY, and safe-state is inactive.')}
      </p>
      <Button size="sm" variant="danger" className="mt-2" icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />} disabled={!canReset} onClick={openDialog}>
        {pick('Đặt lại RETAIN…', 'Reset RETAIN…')}
      </Button>

      {retainReset.state.phase === 'unknown' && (
        <div role="alert" className="mt-2 rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-2 text-sm">
          <p className="text-[var(--c-warn-fg)]">{pick('Chưa xác định kết quả Đặt lại RETAIN. Đang chờ đọc ngược…', 'RETAIN reset result unknown. Waiting for read-back…')}</p>
          <Button size="sm" className="mt-1" onClick={() => retainReset.recheckStatus(retainReset.state.phase === 'unknown' ? retainReset.state.operationId : '')}>
            {pick('Kiểm tra lại trạng thái', 'Re-check status')}
          </Button>
        </div>
      )}
      {retainReset.state.phase === 'terminal' && (
        <p className={`mt-2 text-sm ${retainReset.state.operation.state === 'SUCCEEDED' ? 'text-[var(--c-good-fg)]' : 'text-[var(--c-fault-fg)]'}`}>
          {retainReset.state.operation.state === 'SUCCEEDED'
            ? pick('Đặt lại RETAIN thành công.', 'RETAIN reset succeeded.')
            : pick('Đặt lại RETAIN thất bại.', 'RETAIN reset failed.')}
        </p>
      )}
      {retainReset.state.phase === 'error' && <p className="mt-2 text-sm text-[var(--c-fault-fg)]">{retainReset.state.message}</p>}

      <Modal
        open={open}
        title={pick('Xác nhận Đặt lại RETAIN', 'Confirm RETAIN reset')}
        confirmLabel={pick('Đặt lại RETAIN', 'Reset RETAIN')}
        danger
        confirmLoading={submitting}
        confirmDisabled={confirmDisabled}
        onConfirm={() => {
          if (!activeRevisionId) return
          void retainReset.submit(activeRevisionId, reason, password)
        }}
        onClose={() => {
          if (submitting) return
          setOpen(false)
        }}
      >
        <div className="space-y-3">
          <p>{pick('Hành động này xoá ngay giá trị RETAIN đang lưu của bản đang chạy và không thể hoàn tác bằng nút Hủy.', 'This action immediately clears the RETAIN values of the running version and cannot be undone with Cancel.')}</p>
          <p className="text-xs text-[var(--c-text-dim)]">
            {pick(`Áp dụng cho Active Revision: ${activeRevisionId?.slice(0, 8) ?? '—'}`, `Applies to Active Revision: ${activeRevisionId?.slice(0, 8) ?? '—'}`)}
          </p>

          {changes.status === 'loading' && (
            <p className="text-sm text-[var(--c-text-dim)]">{pick('Đang tải danh sách biến RETAIN…', 'Loading the RETAIN variable list…')}</p>
          )}
          {impactUnavailable && (
            <p role="alert" className="text-sm text-[var(--c-fault-fg)]">
              {pick('Không đọc được danh sách biến RETAIN bị ảnh hưởng — không thể xác nhận an toàn.', 'Could not read the affected RETAIN variable list — cannot confirm safely.')}
            </p>
          )}
          {impactPresent && impact && (
            <fieldset className="rounded-[var(--radius)] border border-[var(--c-border)] p-2">
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
                <span>
                  {pick(
                    `Tôi xác nhận đã xem ${impact.items.length} biến RETAIN sẽ bị đặt về giá trị khởi tạo.`,
                    `I confirm I have reviewed the ${impact.items.length} RETAIN variables that will be reset to their initial value.`
                  )}
                </span>
              </label>
              <ul className="mt-2 max-h-32 list-disc space-y-0.5 overflow-y-auto pl-6 text-xs text-[var(--c-text-dim)]">
                {impact.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </fieldset>
          )}
          {impact?.status === 'NONE' && <p className="text-sm text-[var(--c-text-dim)]">{pick('Bản đang chạy không có biến RETAIN nào.', 'The running version has no RETAIN variables.')}</p>}

          <label className="block text-xs font-medium text-[var(--c-text-dim)]" htmlFor="programming-retain-reset-reason">
            {pick('Lý do đặt lại RETAIN', 'RETAIN reset reason')}
          </label>
          <input
            id="programming-retain-reset-reason"
            className="w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 py-2 text-sm text-[var(--c-text)]"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <label className="block text-xs font-medium text-[var(--c-text-dim)]" htmlFor="programming-retain-reset-reauth">
            {pick('Xác thực lại — nhập mật khẩu', 'Re-authenticate — enter password')}
          </label>
          <input
            id="programming-retain-reset-reauth"
            type="password"
            autoComplete="current-password"
            className="w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 py-2 text-sm text-[var(--c-text)]"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
      </Modal>
    </div>
  )
}
