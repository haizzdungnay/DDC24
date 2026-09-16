import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Settings2 } from 'lucide-react'
import { useI18n } from '../../../../shared/i18n'
import { THEMES, TOKEN_NAMES } from '../../../../shared/theme/tokens'
import { StructuredFbdEditor } from '../../fbd/StructuredFbdEditor'
import type { FbdSelection } from '../../fbd/commands'
import type { FbdNodeEditorTarget } from '../../fbd/nodeEditor'
import {
  readFbdPreferences,
  writeFbdPreferences,
  type FbdPreferences,
  type FbdThemePreference,
} from '../../fbd/fbdPreferences'
import { canonicalFbdJson, type FbdDocument } from '../../fbd/model'
import { readFbdDocument } from '../../fbd/readDocument'
import { emptyFbdDocument } from '../pou/pouTemplates'
import { useWorkbenchOwnsMinimap } from '../../layout/useProgrammingViewport'
import type { UserPouInterface } from '../../fbd/userPou'
import type {
  ProgrammingBinding,
  ProgrammingDraftOperation,
  ProgrammingPointCatalogEntry,
  ProgrammingProgram,
  ProgrammingVariable,
} from '../../model/types'
import { PortMappingPicker } from '../../fbd/PortMappingPicker'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function resolvePortVariableInfo(
  mappingRequest: {
    nodeId: string
    portId: string
    portName: string
    nodeName: string
    portDirection: 'INPUT' | 'OUTPUT'
    portDataType: string
  },
  programId: string,
  variables?: readonly ProgrammingVariable[],
  bindings?: readonly ProgrammingBinding[],
) {
  const rawName = `${mappingRequest.nodeName}_${mappingRequest.portName}`.replace(/[^a-zA-Z0-9_]/g, '_')
  const varName = /^[a-zA-Z_]/.test(rawName) ? rawName : `v_${rawName}`

  const existingVar = variables?.find(
    (v) =>
      v.programId === programId &&
      (v.variableId === mappingRequest.portId || v.name === mappingRequest.portName || v.name === varName),
  )

  const targetVariableId =
    existingVar && UUID_REGEX.test(existingVar.variableId)
      ? existingVar.variableId
      : UUID_REGEX.test(mappingRequest.portId)
        ? mappingRequest.portId
        : crypto.randomUUID()

  const variable: ProgrammingVariable = {
    variableId: targetVariableId,
    programId,
    name: existingVar?.name || varName,
    type: mappingRequest.portDataType,
    class: mappingRequest.portDirection === 'INPUT' ? 'INPUT' : 'OUTPUT',
    initialValue: null,
    retain: false,
  }

  const matchingBindings =
    bindings?.filter((b) => {
      if (b.variableId === targetVariableId) return true
      if (b.variableId === mappingRequest.portId) return true
      if (b.variableId === mappingRequest.portName) return true
      const anyB = b as unknown as Record<string, unknown>
      const bVar = typeof anyB.variable === 'string' ? anyB.variable : null
      if (
        bVar &&
        (bVar === mappingRequest.portName ||
          bVar === varName ||
          bVar === `${mappingRequest.nodeName}_${mappingRequest.portName}` ||
          bVar.endsWith(`_${mappingRequest.portName}`))
      ) {
        return true
      }
      if (variables) {
        const v = variables.find((item) => item.variableId === b.variableId)
        if (
          v &&
          (v.name === mappingRequest.portName ||
            v.name === varName ||
            v.name === `${mappingRequest.nodeName}_${mappingRequest.portName}` ||
            v.name.endsWith(`_${mappingRequest.portName}`))
        ) {
          return true
        }
      }
      return false
    }) ?? []

  const oldBindingIds = Array.from(new Set(matchingBindings.map((b) => b.bindingId)))

  return { varName, targetVariableId, variable, matchingBindings, oldBindingIds }
}
import { EditorStatusBar } from './EditorStatusBar'
import { fbdStatusFields } from './editorStatus'

export function parseFbdDocument(raw: unknown, fallbackName: string): FbdDocument {
  if (typeof raw !== 'string') return emptyFbdDocument(fallbackName)
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      return parsed as FbdDocument
    }
  } catch {
    // fallback
  }
  return emptyFbdDocument(fallbackName)
}

export interface FbdEditorPaneProps {
  program: ProgrammingProgram
  source: string
  canEdit: boolean
  saving: boolean
  onChange: (source: string) => void
  onSave: (operations: ProgrammingDraftOperation[]) => Promise<boolean>
  userPouInterfaces: readonly UserPouInterface[]
  projectId?: string
  userScope?: string
  /** `T59-818` — chuyển tiếp lựa chọn canvas lên Inspector dùng chung. */
  onSelectionChange?: (selection: FbdSelection | null) => void
  onNodeEditorTargetChange?: (target: FbdNodeEditorTarget | null) => void
  focusSelection?: FbdSelection | null
  onRunCheck?: () => void
  onOpenCompare?: () => void
  checkDisabledReason?: string | null
  compareDisabledReason?: string | null
  /** Point catalog items for inline port mapping. */
  pointCatalogItems?: readonly ProgrammingPointCatalogEntry[]
  pointCatalogLoading?: boolean
  onEnsurePointCatalogLoaded?: () => void
  bindings?: readonly ProgrammingBinding[]
  variables?: readonly ProgrammingVariable[]
  programs?: readonly ProgrammingProgram[]
}

export function FbdEditorPane({
  program,
  source,
  canEdit,
  onChange,
  userPouInterfaces,
  projectId,
  userScope,
  onSelectionChange,
  onNodeEditorTargetChange,
  focusSelection,
  pointCatalogItems,
  pointCatalogLoading,
  onEnsurePointCatalogLoaded,
  onSave,
  bindings,
  variables,
  programs,
}: FbdEditorPaneProps) {
  const { pick } = useI18n()
  const [mappingRequest, setMappingRequest] = useState<{
    nodeId: string; portId: string; portName: string; nodeName: string
    portDirection: 'INPUT' | 'OUTPUT'; portDataType: string
  } | null>(null)

  useEffect(() => {
    onEnsurePointCatalogLoaded?.()
  }, [onEnsurePointCatalogLoaded])
  /* `T9-02` dời Mini Map sang cột 3 của khay đáy, mà cột đó chỉ tồn tại từ
     `1440px`. Tắt bản nội tuyến vô điều kiện sẽ làm `1280px` không còn Mini
     Map ở bất kỳ đâu. Hỏi đúng một nguồn: khay giữ từ `1440px`, canvas giữ ở
     dưới ngưỡng — đúng MỘT bản tại mọi khổ. */
  const workbenchOwnsMinimap = useWorkbenchOwnsMinimap()
  const committedResult = useMemo(() => readFbdDocument(program.document), [program.document])
  const localResult = useMemo(() => readFbdDocument(source), [source])
  const committedJson = committedResult.ok ? committedResult.canonical : String(program.document ?? '')
  /* Buffer hỏng vẫn phải có fallback ổn định để các hook phía dưới giữ đúng
   * thứ tự. Tạo `emptyFbdDocument` ở mỗi render sinh UUID mới, khiến effect
   * active-network tự cập nhật vô hạn ngay cả khi nhánh fail-closed đã khóa UI. */
  const local = useMemo(
    () => localResult.ok ? localResult.document : emptyFbdDocument(program.name),
    [localResult, program.name],
  )
  const localJson = localResult.ok ? localResult.canonical : source
  const dirty = localJson !== committedJson
  const [preferences, setPreferences] = useState(() => readFbdPreferences(userScope, projectId))
  const [activeNetworkId, setActiveNetworkId] = useState(() => local.networks[0]?.id)
  const settingsRef = useRef<HTMLDetailsElement | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    setPreferences(readFbdPreferences(userScope, projectId))
  }, [projectId, userScope])

  useEffect(() => {
    if (local.networks.some((network) => network.id === activeNetworkId)) return
    setActiveNetworkId(local.networks[0]?.id)
  }, [activeNetworkId, local.networks])

  useEffect(() => {
    if (localResult.ok) return
    /* Editor invalid không được để Inspector giữ selection/mutation callback
     * của graph hợp lệ trước đó. Buffer vẫn nguyên byte nhưng mọi target sửa
     * phải bị thu hồi ngay. */
    onSelectionChange?.(null)
    onNodeEditorTargetChange?.(null)
  }, [localResult.ok, onNodeEditorTargetChange, onSelectionChange])

  /* Bấm ra ngoài thì đóng popover. `<details>` native KHÔNG tự đóng, nên nếu
     thiếu hiệu ứng này thì khay tuỳ chọn nằm đè lên canvas cho tới khi người
     dùng bấm lại đúng nút bánh răng — đúng kiểu "panel chồng nhau" mà lát này
     dọn đi. */
  useEffect(() => {
    if (!settingsOpen) return undefined
    const closeOnOutside = (event: MouseEvent) => {
      const element = settingsRef.current
      if (!element || event.target instanceof Node && element.contains(event.target)) return
      element.open = false
      setSettingsOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const element = settingsRef.current
      if (!element) return
      element.open = false
      setSettingsOpen(false)
    }
    window.addEventListener('pointerdown', closeOnOutside)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOnOutside)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [settingsOpen])

  function updatePreferences(patch: Partial<FbdPreferences>) {
    setPreferences(writeFbdPreferences(patch, userScope, projectId))
  }

  const explicitTheme = preferences.theme === 'FOLLOW_WEB'
    ? null
    : preferences.theme.toLowerCase() as 'light' | 'dark'
  const themeStyle = explicitTheme
    ? {
        ...Object.fromEntries(TOKEN_NAMES.map((token) => [token, THEMES[explicitTheme][token]])),
        colorScheme: explicitTheme,
      } as CSSProperties
    : undefined

  if (!localResult.ok) {
    return (
      <div
        className="min-w-0 space-y-3 overflow-x-hidden rounded-[var(--radius)] bg-[var(--c-bg)] p-3 text-[var(--c-text)]"
        data-testid="fbd-workspace-shell"
        data-fbd-theme={preferences.theme}
        style={themeStyle}
      >
        <div role="alert" data-testid="fbd-invalid-source" className="rounded-[var(--radius)] border border-[var(--c-fault-fg)] bg-[var(--c-fault-bg)] p-3">
          <p className="font-mono text-xs font-semibold text-[var(--c-fault-fg)]">{localResult.code}</p>
          <p className="mt-1 text-sm text-[var(--c-text)]">
            {pick('Tài liệu FBD bị hỏng nên trình soạn thảo đã khóa thay đổi. Buffer gốc được giữ nguyên; dùng Làm mới để đọc lại nguồn canonical.', 'The FBD document is damaged, so editing is locked. The original buffer is preserved; use Refresh to read the canonical source again.')}
          </p>
          <p className="mt-1 font-mono text-xs text-[var(--c-text-dim)]">{localResult.detail}</p>
        </div>
        <EditorStatusBar fields={fbdStatusFields({ language: 'FBD', dirty })} />
      </div>
    )
  }

  /* Tuỳ chọn hiển thị — popover, KHÔNG phải một dải thường trực.
   *
   * Năm điều khiển này (khung nhìn, lưới, bám lưới, kiểu dây, giao diện FBD)
   * được đặt một lần rồi hầu như không đụng lại, nhưng dải chứa chúng chiếm
   * 37 px chiều cao ở MỌI thời điểm — lấy đúng từ chỗ vẽ, vốn là thứ khan
   * hiếm nhất của trang này. Ảnh chuẩn `PGM-02B` đặt chúng sau một nút bánh
   * răng trên thanh công cụ; đây là bản dựng đúng như vậy.
       *
   * `<details>` chứ không phải state React: nó cho hành vi đóng/mở, phím
   * Enter/Space và ngữ nghĩa `aria-expanded` sẵn có của trình duyệt, nên
   * không có bản dựng tay nào để lệch. Quyền sở hữu state của preferences
   * không đổi — vẫn ở component này. */
  const displaySettings = (
      <details
        ref={settingsRef}
        className="relative"
        onToggle={(event) => setSettingsOpen(event.currentTarget.open)}
      >
        <summary
          data-testid="fbd-display-settings-toggle"
          className="inline-flex h-8 cursor-pointer list-none items-center gap-1 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-2 text-xs text-[var(--c-text)] marker:content-none hover:border-[var(--c-accent)]"
          title={pick('Tuỳ chọn hiển thị FBD', 'FBD display preferences')}
        >
          <Settings2 className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">{pick('Tuỳ chọn hiển thị FBD', 'FBD display preferences')}</span>
        </summary>
        <div
          className="absolute right-0 z-30 mt-1 flex w-64 flex-col gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-2 text-[11px] text-[var(--c-text-dim)] shadow-lg"
          role="group"
          aria-label={pick('Tuỳ chọn hiển thị FBD', 'FBD display preferences')}
          data-testid="fbd-secondary-toolbar"
        >
        {/* `Khung nhìn` — chọn xem MỘT network hay TẤT CẢ.
          *
          * Điều khiển này biến mất cùng thanh công cụ phụ cũ, nhưng nó không
          * nằm trong số "các tuỳ chọn hiển thị đã chuyển xuống dải dưới" —
          * nó không được chuyển đi đâu cả. Với một chương trình nhiều network,
          * mất nó nghĩa là không còn cách nào xem hết các network cùng lúc, và
          * `TC-FBD-RESP-001` khoá đúng hành vi đó (`SELECTED` → 1 article,
          * `ALL` → 2). Trả nó về đúng dải mà các tuỳ chọn hiển thị khác đang ở,
          * theo cùng kiểu compact, thay vì dựng lại thanh công cụ đã gỡ. */}
        <label className="inline-flex items-center gap-1">
          {pick('Khung nhìn', 'View')}
          <select
            className="rounded border border-[var(--c-border)] bg-[var(--c-surface)] px-1 py-0.5 text-[11px]"
            value={preferences.networkView}
            onChange={(event) => updatePreferences({ networkView: event.target.value as FbdPreferences['networkView'] })}
          >
            <option value="SELECTED">{pick('Network đang chọn', 'Selected network')}</option>
            <option value="ALL">{pick('Tất cả network', 'All networks')}</option>
          </select>
        </label>
        <label className="inline-flex items-center gap-1">
          <input type="checkbox" checked={preferences.gridVisible} onChange={(event) => updatePreferences({ gridVisible: event.target.checked })} />
          {pick('Lưới', 'Grid')}
        </label>
        <label className="inline-flex items-center gap-1">
          <input type="checkbox" checked={preferences.snapEnabled} onChange={(event) => updatePreferences({ snapEnabled: event.target.checked })} />
          {pick('Bám lưới', 'Snap')}
        </label>
        <label className="inline-flex items-center gap-1">
          {pick('Kiểu dây', 'Wire style')}
          <select
            className="rounded border border-[var(--c-border)] bg-[var(--c-surface)] px-1 py-0.5 text-[11px]"
            value={preferences.wireStyle}
            onChange={(event) => updatePreferences({ wireStyle: event.target.value as FbdPreferences['wireStyle'] })}
          >
            <option value="ORTHOGONAL">{pick('Vuông góc', 'Orthogonal')}</option>
            <option value="BEZIER">Bezier</option>
          </select>
        </label>
        <label className="inline-flex items-center gap-1">
          {pick('Giao diện FBD', 'FBD theme')}
          <select
            className="rounded border border-[var(--c-border)] bg-[var(--c-surface)] px-1 py-0.5 text-[11px]"
            value={preferences.theme}
            onChange={(event) => updatePreferences({ theme: event.target.value as FbdThemePreference })}
          >
            <option value="FOLLOW_WEB">{pick('Theo giao diện web', 'Follow web')}</option>
            <option value="LIGHT">{pick('Sáng', 'Light')}</option>
            <option value="DARK">{pick('Tối', 'Dark')}</option>
          </select>
        </label>
        </div>
      </details>
  )

  return (
    <div
      /* `min-h-0` ngang hàng quan trọng với `min-w-0`: thiếu nó, vỏ này là một
         flex item với `min-height:auto`, nên nó cao bằng cảnh canvas (tối thiểu
         1600 px theo công thức pan của `FbdCanvas`) thay vì nhận đúng phần chiều
         cao còn lại và để canvas tự cuộn bên trong. */
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden text-[var(--c-text)]"
      data-testid="fbd-workspace-shell"
      data-fbd-theme={preferences.theme}
      style={themeStyle}
    >
      {/* Mốc tiêu đề cho trợ năng — ẩn thị giác vì tên POU đã có trên tab bar */}
      <h3 className="sr-only">{program.name}</h3>
      <StructuredFbdEditor
        document={local}
        canEdit={canEdit}
        userPouInterfaces={userPouInterfaces}
        projectId={projectId}
        networkView={preferences.networkView}
        activeNetworkId={activeNetworkId}
        wireStyle={preferences.wireStyle}
        gridVisible={preferences.gridVisible}
        snapEnabled={preferences.snapEnabled}
        snapSize={preferences.snapSize}
        showInlineMinimap={!workbenchOwnsMinimap}
        toolbarExtras={displaySettings}
        onChange={(next) => onChange(canonicalFbdJson(next))}
        onSelectionChange={(selection) => {
          if (selection?.networkId) setActiveNetworkId(selection.networkId)
          onSelectionChange?.(selection)
        }}
        onNodeEditorTargetChange={onNodeEditorTargetChange}
        focusSelection={focusSelection}
        onRequestPortMapping={(info) => {
          onEnsurePointCatalogLoaded?.()
          setMappingRequest(info)
        }}
        bindings={bindings}
        variables={variables}
        pointCatalogItems={pointCatalogItems}
        programs={programs}
      />
      {dirty && <p className="text-xs text-[var(--c-warn-fg)]">{pick('Chưa lưu.', 'Not saved.')}</p>}
      {mappingRequest && (
        <PortMappingPicker
          portId={mappingRequest.portId}
          portDirection={mappingRequest.portDirection}
          portDataType={mappingRequest.portDataType}
          portName={mappingRequest.portName}
          nodeName={mappingRequest.nodeName}
          points={pointCatalogItems ?? []}
          loading={pointCatalogLoading}
          bindings={bindings}
          variables={variables}
          onClose={() => setMappingRequest(null)}
          onSelect={async (point) => {
            try {
              const { variable, targetVariableId, oldBindingIds } = resolvePortVariableInfo(
                mappingRequest,
                program.programId,
                variables,
                bindings,
              )

              const binding = {
                bindingId: oldBindingIds[0] ?? crypto.randomUUID(),
                variableId: targetVariableId,
                point: {
                  category: point.category,
                  pointId: point.pointId,
                  ...(point.deviceId ? { deviceId: point.deviceId } : {}),
                },
                direction: mappingRequest.portDirection === 'INPUT' ? ('READ' as const) : ('WRITE' as const),
                dataType: mappingRequest.portDataType,
                ...(point.unit ? { unit: point.unit } : {}),
                writable: point.writable,
                qualityPolicy: 'REQUIRE_GOOD' as const,
              }

              // Gỡ bỏ các binding cũ thừa nếu từng map nhiều lần
              const removeOps = oldBindingIds.slice(1).map((bindingId) => ({
                op: 'removeBinding' as const,
                bindingId,
              }))

              const ok = await onSave([
                { op: 'upsertVariable', variable },
                ...removeOps,
                { op: 'upsertBinding', binding },
              ])
              if (!ok) {
                return {
                  ok: false,
                  error: pick('Máy chủ từ chối lưu thay đổi Draft.', 'Server rejected saving the draft change.'),
                }
              }
              return { ok: true }
            } catch (err) {
              return {
                ok: false,
                error: pick('Đã xảy ra lỗi khi lưu ánh xạ điểm.', 'An error occurred while saving point mapping.'),
                detail: err instanceof Error ? err.message : String(err),
              }
            }
          }}
          onUnmap={async () => {
            try {
              const { oldBindingIds } = resolvePortVariableInfo(
                mappingRequest,
                program.programId,
                variables,
                bindings,
              )
              if (oldBindingIds.length === 0) return { ok: true }

              const ops = oldBindingIds.map((bindingId) => ({
                op: 'removeBinding' as const,
                bindingId,
              }))
              const ok = await onSave(ops)
              if (!ok) {
                return {
                  ok: false,
                  error: pick('Máy chủ từ chối hủy ánh xạ Draft.', 'Server rejected unmapping draft.'),
                }
              }
              return { ok: true }
            } catch (err) {
              return {
                ok: false,
                error: pick('Đã xảy ra lỗi khi hủy ánh xạ điểm.', 'An error occurred while unmapping point.'),
                detail: err instanceof Error ? err.message : String(err),
              }
            }
          }}
        />
      )}
    </div>
  )
}
