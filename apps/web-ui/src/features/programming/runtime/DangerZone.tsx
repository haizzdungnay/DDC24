import { useRef, useState } from 'react'
import { AlertTriangle, Download, RotateCcw, Upload } from 'lucide-react'
import { useI18n } from '../../../shared/i18n'
import { bytesToBase64, createUuid, sha256Hex } from '../../../shared/crypto'
import { useAuth, roleAtLeast } from '../../auth'
import { Panel } from '../../../shared/components/Panel'
import { Button } from '../../../shared/components/Button'
import { Modal } from '../../../shared/components/Modal'
import { useProgrammingApiClient } from '../api/authClient'
import { ProgrammingApiError } from '../api/generated/client'
import { programmingErrorCopy } from '../api/errorCopy'
import { useRestoreWorkflow } from './useRestoreWorkflow'
import type { ProgrammingRuntime } from '../model/types'

/**
 * Vùng thao tác nguy hiểm của PGM-04 (`UJ-PROG-08`) — tách khỏi vùng chỉ đọc,
 * viền cảnh báo, chỉ `admin` thấy nút thật; viewer thấy ở chế độ đọc kèm lý
 * do, KHÔNG thấy một dãy nút bị vô hiệu hóa (UX §16.4).
 */
export function DangerZone({ runtime, runtimeStatus }: { runtime: ProgrammingRuntime | null; runtimeStatus: 'loading' | 'ready' | 'error' }) {
  const { pick } = useI18n()
  const { session } = useAuth()
  const canEdit = roleAtLeast(session?.role, 'admin')
  const coreMutationReady = runtimeStatus === 'ready' && runtime?.producerState === 'READY' && runtime.safeState === false

  if (!canEdit) {
    return (
      <Panel title={pick('Vùng thao tác nguy hiểm', 'Danger zone')} className="border-[var(--c-warn)]">
        <p className="text-sm text-[var(--c-text-dim)]">
          {pick('Cần quyền Quản trị viên để khôi phục, nhập gói hoặc đặt lại trạng thái lưu.', 'Admin permission is required to restore, import a bundle, or reset RETAIN state.')}
        </p>
      </Panel>
    )
  }

  return (
    <Panel title={pick('Vùng thao tác nguy hiểm', 'Danger zone')} className="border-[var(--c-warn)]">
      <div className="space-y-4">
        <RestoreSection runtime={runtime} coreMutationReady={coreMutationReady} />
        <div className="h-px bg-[var(--c-border)]" />
        <BundleExportSection revisionId={runtime?.activeRevisionId ?? null} />
        <div className="h-px bg-[var(--c-border)]" />
        <BundleImportSection />
        <div className="h-px bg-[var(--c-border)]" />
        <RetainResetSection />
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

function RetainResetSection() {
  const { pick } = useI18n()

  return (
    <div>
      <h3 className="text-sm font-semibold text-[var(--c-text)]">{pick('Đặt lại trạng thái lưu (RETAIN)', 'Reset RETAIN state')}</h3>
      <p id="programming-retain-locked-reason" role="status" className="mt-1 text-sm text-[var(--c-warn-fg)]">
        {pick(
          'Bị khóa an toàn: backend chưa cung cấp danh sách biến RETAIN bị ảnh hưởng và route hiện mới ở mức contract-only. Không gửi lệnh với Active Revision giả.',
          'Safety locked: the backend does not provide the affected RETAIN variable list and the route is contract-only. No command is sent with a fabricated Active Revision.'
        )}
      </p>
      <Button size="sm" variant="danger" className="mt-2" icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />} disabled aria-describedby="programming-retain-locked-reason">
        {pick('Đặt lại RETAIN…', 'Reset RETAIN…')}
      </Button>
    </div>
  )
}
