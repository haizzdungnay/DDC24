import { useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { useI18n } from '../../../shared/i18n'
import { useAuth, roleAtLeast } from '../../auth'
import { Panel } from '../../../shared/components/Panel'
import { Button } from '../../../shared/components/Button'
import { Modal } from '../../../shared/components/Modal'
import { StateBlock } from '../../../shared/components/StateBlock'
import { StatusBadge } from '../../../shared/components/StatusBadge'
import { useProgrammingRuntimeContext } from '../layout/ProgrammingLayout'
import { useProgrammingCheck, useProgrammingOverrides, useProgrammingRevisionChanges } from '../api/queries'
import { useCommissionWorkflow } from './useCommissionWorkflow'
import type { ProgrammingImpactKey } from '../api/generated/client'
import { ProblemsDrawer } from '../shared/ProblemsDrawer'

const IMPACT_GROUP_ORDER: ProgrammingImpactKey[] = ['retain', 'activeOverrides', 'cutover', 'outputMappingChanges']
const IMPACT_GROUP_LABEL: Record<ProgrammingImpactKey, [string, string]> = {
  retain: ['Trạng thái lưu (RETAIN) sẽ khởi tạo lại', 'RETAIN state will be re-initialised'],
  activeOverrides: ['Override thủ công đang giữ đầu ra', 'Manual overrides currently holding outputs'],
  cutover: ['Chuyển quyền điều khiển graph → program', 'Cutover from graph to program control'],
  outputMappingChanges: ['Thay đổi ánh xạ Điểm ảnh hưởng đầu ra vật lý', 'Point mapping changes affecting physical outputs']
}

interface NavState {
  revisionId?: string
  checkId?: string
}

/**
 * PGM-03 Kiểm tra & Đưa vào vận hành — `UJ-PROG-05/06` (TASK-PROG-504). Trang
 * chỉ nhận `revisionId/checkId` qua `navigate(..., {state})` từ nút "Mở Kiểm
 * tra & Đưa vào vận hành" của PGM-02 (S5-B) — vào thẳng bằng URL/reload không
 * có ngữ cảnh Check nào để tin, nên phải quay lại Thiết kế chạy Kiểm tra lại.
 * Đây là lựa chọn AN TOÀN có chủ đích, không phải thiếu sót: không có route
 * nào trả "Check mới nhất của Project" để suy đoán thay.
 */
export function CheckCommissionPage() {
  const { pick } = useI18n()
  const { session } = useAuth()
  const canEdit = roleAtLeast(session?.role, 'admin')
  const { projectId } = useParams<{ projectId: string }>()
  const location = useLocation()
  const navState = (location.state as NavState | null) ?? null
  const { runtime } = useProgrammingRuntimeContext()

  const check = useProgrammingCheck(navState?.checkId)
  const changes = useProgrammingRevisionChanges(runtime.data?.activeRevisionId ?? 'none', navState?.revisionId)
  const overrides = useProgrammingOverrides()
  const commission = useCommissionWorkflow()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [acknowledged, setAcknowledged] = useState<Set<ProgrammingImpactKey>>(new Set())
  const [password, setPassword] = useState('')

  const impact = changes.data?.impact
  const presentKeys = useMemo(() => IMPACT_GROUP_ORDER.filter((key) => impact?.[key].status === 'PRESENT'), [impact])
  const hasUnavailable = useMemo(() => IMPACT_GROUP_ORDER.some((key) => !impact || impact[key].status !== 'NONE' && impact[key].status !== 'PRESENT'), [impact])
  const checkPassed = check.data?.state === 'PASSED'
  const readyToCommission = checkPassed && changes.status === 'ready' && !hasUnavailable && !!projectId

  if (!navState?.revisionId || !navState?.checkId) {
    return (
      <div className="space-y-3">
        <StateBlock
          state="empty"
          title={pick('Chưa có Revision để kiểm tra.', 'No revision to check yet.')}
          detail={pick(
            'Mở trang này từ nút "Mở Kiểm tra & Đưa vào vận hành" ở workspace Thiết kế sau khi Kiểm tra đạt.',
            'Open this page from the "Open Check & Commission" button in the Design workspace after a check passes.'
          )}
        />
        {projectId && (
          <Link className="text-sm font-medium text-[var(--c-accent)] underline" to={`/eng/programming/projects/${projectId}/design`}>
            {pick('Về workspace Thiết kế', 'Back to the Design workspace')}
          </Link>
        )}
      </div>
    )
  }

  function openConfirmDialog() {
    check.refresh()
    changes.refresh()
    overrides.refresh()
    setAcknowledged(new Set())
    setPassword('')
    setDialogOpen(true)
  }

  function submitCommission() {
    if (!impact || !navState?.revisionId || !navState?.checkId) return
    void commission.submit(
      {
        revisionId: navState.revisionId,
        expectedActiveRevisionId: runtime.data?.activeRevisionId ?? null,
        checkId: navState.checkId,
        impactRef: impact.impactRef,
        acknowledgements: presentKeys
      },
      password
    )
  }

  const submitting = commission.state.phase === 'submitting' || commission.state.phase === 'polling'

  return (
    <div className="space-y-4">
      <Panel title={pick('Kết quả Kiểm tra', 'Check result')}>
        {check.status === 'loading' ? (
          <StateBlock state="loading" title={pick('Đang tải…', 'Loading…')} />
        ) : check.status === 'error' || !check.data ? (
          <StateBlock state="error" title={pick('Không tải được Kiểm tra.', 'Could not load the check.')} onRetry={check.refresh} />
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <StatusBadge state={check.data.state === 'PASSED' ? 'online' : 'fault'} label={check.data.state} />
              <span className="text-sm text-[var(--c-text-dim)]">Revision {navState.revisionId.slice(0, 8)}</span>
            </div>
            {check.data.diagnostics.length > 0 && <ProblemsDrawer diagnostics={check.data.diagnostics} />}
            {!checkPassed && <p className="text-sm text-[var(--c-warn-fg)]">{pick('Chỉ Kiểm tra PASSED mới mở được Đưa vào vận hành.', 'Only a PASSED check unlocks Commission.')}</p>}
          </div>
        )}
      </Panel>

      <Panel title={pick('Thay đổi so với bản đang chạy', 'Changes vs. the running version')}>
        {changes.status === 'loading' ? (
          <StateBlock state="loading" title={pick('Đang tải…', 'Loading…')} />
        ) : changes.status === 'error' || !changes.data ? (
          <StateBlock state="error" title={pick('Không tải được thay đổi.', 'Could not load changes.')} onRetry={changes.refresh} />
        ) : changes.data.changes.length === 0 ? (
          <p className="text-sm text-[var(--c-text-dim)]">{pick('Không có thay đổi so với bản đang chạy.', 'No changes vs. the running version.')}</p>
        ) : (
          <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
            {changes.data.changes.map((change) => (
              <li key={`${change.kind}-${change.objectId}`} className="flex items-center justify-between">
                <span className="font-mono text-xs text-[var(--c-text)]">
                  {change.kind}:{change.objectId.slice(0, 8)}
                </span>
                <span className="text-[var(--c-text-dim)]">{change.changeType}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={pick('Ảnh hưởng khi áp dụng', 'Impact when applied')}>
        {changes.status !== 'ready' || !impact ? (
          <StateBlock state={changes.status === 'error' ? 'error' : 'loading'} title={pick('Đang tính ảnh hưởng…', 'Computing impact…')} />
        ) : (
          <ul className="space-y-2 text-sm">
            {IMPACT_GROUP_ORDER.map((key) => {
              const group = impact[key]
              return (
                <li key={key} className="flex items-start justify-between gap-3">
                  <span className="text-[var(--c-text)]">{pick(...IMPACT_GROUP_LABEL[key])}</span>
                  <StatusBadge
                    state={group.status === 'PRESENT' ? 'warning' : group.status === 'UNAVAILABLE' ? 'fault' : 'online'}
                    label={group.status === 'NONE' ? pick('Không có', 'None') : group.status === 'PRESENT' ? pick(`${group.items.length} mục`, `${group.items.length} item(s)`) : pick('Chưa tính được', 'Unavailable')}
                  />
                </li>
              )
            })}
          </ul>
        )}
        {hasUnavailable && (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-[var(--c-fault-fg)]">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" /> {pick('Chưa tính được đủ ảnh hưởng — Đưa vào vận hành bị chặn.', 'Impact could not be fully computed — Commission is blocked.')}
          </p>
        )}
      </Panel>

      <Panel title={pick('Override thủ công còn hiệu lực', 'Active manual overrides')}>
        {overrides.status === 'loading' ? (
          <StateBlock state="loading" title={pick('Đang tải…', 'Loading…')} />
        ) : overrides.status === 'error' || !overrides.data ? (
          <StateBlock state="error" title={pick('Không tải được override.', 'Could not load overrides.')} onRetry={overrides.refresh} />
        ) : overrides.data.items.length === 0 ? (
          <p className="text-sm text-[var(--c-text-dim)]">{pick('Không có override nào đang giữ đầu ra.', 'No override is currently holding an output.')}</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase text-[var(--c-text-dim)]">
                <th className="py-1 pr-3">Point</th>
                <th className="py-1 pr-3">{pick('Giá trị', 'Value')}</th>
                <th className="py-1 pr-3">{pick('Người thực hiện', 'Actor')}</th>
                <th className="py-1">{pick('Còn lại', 'Remaining')}</th>
              </tr>
            </thead>
            <tbody>
              {overrides.data.items.map((entry) => (
                <tr key={`${entry.category}-${entry.pointId}`}>
                  <td className="py-1 pr-3 font-mono text-xs">{entry.pointId}</td>
                  <td className="py-1 pr-3">{String(entry.value)}</td>
                  <td className="py-1 pr-3">{entry.actorId || '—'}</td>
                  <td className="py-1">{entry.remainingS !== null ? `${entry.remainingS}s` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {canEdit && (
        <div className="flex justify-end">
          <Button icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />} disabled={!readyToCommission} onClick={openConfirmDialog}>
            {pick('Đưa vào vận hành…', 'Commission…')}
          </Button>
        </div>
      )}

      {commission.state.phase === 'unknown' && (
        <div role="alert" className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-3 text-sm">
          <p className="font-semibold text-[var(--c-warn-fg)]">{pick('Chưa xác định kết quả. Đang chờ đọc ngược từ Core…', 'Result unknown. Waiting for Core read-back…')}</p>
          <Button size="sm" className="mt-2" onClick={() => commission.recheckStatus(commission.state.phase === 'unknown' ? commission.state.operationId : '')}>
            {pick('Kiểm tra lại trạng thái', 'Re-check status')}
          </Button>
        </div>
      )}
      {commission.state.phase === 'terminal' && (
        <div
          role="status"
          className={`rounded-[var(--radius)] border p-3 text-sm ${
            commission.state.operation.state === 'SUCCEEDED' ? 'border-[var(--c-good)] bg-[var(--c-good-bg)] text-[var(--c-good-fg)]' : 'border-[var(--c-fault)] bg-[var(--c-fault-bg)] text-[var(--c-fault-fg)]'
          }`}
        >
          {commission.state.operation.state === 'SUCCEEDED' ? (
            <p>{pick(`Đưa vào vận hành thành công. Bản đang chạy: ${commission.state.operation.actualActiveRevisionId ?? '—'}.`, `Commission succeeded. Running version: ${commission.state.operation.actualActiveRevisionId ?? '—'}.`)}</p>
          ) : (
            <p>
              {pick('Đưa vào vận hành thất bại.', 'Commission failed.')}{' '}
              {commission.state.operation.keepsRunningRevision ? pick('Phiên bản đang chạy không đổi.', 'The running version is unchanged.') : ''}
            </p>
          )}
        </div>
      )}
      {commission.state.phase === 'error' && (
        <div role="alert" className="rounded-[var(--radius)] border border-[var(--c-fault)] bg-[var(--c-fault-bg)] p-3 text-sm text-[var(--c-fault-fg)]">
          {commission.state.message}
        </div>
      )}

      <Modal
        open={dialogOpen}
        title={pick('Xác nhận Đưa vào vận hành', 'Confirm Commission')}
        confirmLabel={pick('Gửi lệnh', 'Submit')}
        confirmLoading={submitting}
        confirmDisabled={submitting || presentKeys.some((key) => !acknowledged.has(key)) || password.length === 0 || changes.status !== 'ready'}
        onConfirm={submitCommission}
        onClose={() => {
          if (submitting) return
          setDialogOpen(false)
        }}
      >
        <div className="space-y-3">
          {changes.status === 'loading' && <p>{pick('Đang tải lại ảnh hưởng mới nhất…', 'Reloading the latest impact…')}</p>}
          {presentKeys.length === 0 ? (
            <p>{pick('Không có ảnh hưởng nào cần xác nhận. Vẫn cần xác thực lại.', 'No impact needs acknowledgement. Re-authentication is still required.')}</p>
          ) : (
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Xác nhận ảnh hưởng', 'Acknowledge impact')}</legend>
              {presentKeys.map((key) => (
                <div key={key}>
                  <label className="flex items-start gap-2 text-sm text-[var(--c-text)]">
                    <input
                      type="checkbox"
                      checked={acknowledged.has(key)}
                      onChange={(event) => {
                        setAcknowledged((current) => {
                          const next = new Set(current)
                          if (event.target.checked) next.add(key)
                          else next.delete(key)
                          return next
                        })
                      }}
                    />
                    {/* SC-RETAIN-RESET (UC-PROG-13): dùng đúng ngôn ngữ điều khiển,
                        không phải thuật ngữ schema. */}
                    {key === 'retain'
                      ? pick(
                          'Trạng thái điều khiển đã lưu không còn tương thích. Các giá trị RETAIN bị ảnh hưởng sẽ được khởi tạo lại.',
                          'Stored control state is no longer compatible. Affected RETAIN values will be re-initialised.'
                        )
                      : pick(...IMPACT_GROUP_LABEL[key])}
                  </label>
                  {impact![key].items.length > 0 && (
                    <ul className="ml-6 mt-1 max-h-24 list-disc space-y-0.5 overflow-y-auto text-xs text-[var(--c-text-dim)]">
                      {impact![key].items.map((item) => (
                        <li key={item} className="font-mono">
                          {item}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </fieldset>
          )}
          <label className="block text-xs font-medium text-[var(--c-text-dim)]" htmlFor="programming-commission-reauth-password">
            {pick('Xác thực lại — nhập mật khẩu', 'Re-authenticate — enter password')}
          </label>
          <input
            id="programming-commission-reauth-password"
            type="password"
            className="w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 py-2 text-sm text-[var(--c-text)]"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </div>
      </Modal>
    </div>
  )
}
