import { useEffect, useMemo, useState, type CSSProperties } from 'react'
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
import type { UserPouInterface } from '../../fbd/userPou'
import type { ProgrammingDraftOperation, ProgrammingProgram } from '../../model/types'
import { EditorStatusBar } from './EditorStatusBar'
import { fbdStatusFields } from './editorStatus'

/* Vùng chạm 44px (`min-h-11`) là bắt buộc ở khổ cảm ứng và chỉ rút xuống ở khổ
   ≥1440px — khổ mà ảnh chuẩn PGM-02B mô tả, và cũng là khổ dùng chuột. */
const _TOOLBAR_SELECT_CLASS = 'min-h-11 rounded border border-[var(--c-border)] bg-[var(--c-surface)] px-2 min-[1440px]:h-7 min-[1440px]:min-h-0 min-[1440px]:py-0'

/** Kẻ dọc phân tách cụm điều khiển, chỉ hiện ở khổ ≥1440px vì dưới đó thanh
 *  công cụ xuống dòng và một vạch dọc giữa hai hàng đọc thành rác. */
function _ToolbarDivider() {
  return <span aria-hidden="true" className="hidden h-5 w-px shrink-0 bg-[var(--c-border)] min-[1440px]:block" />
}

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
}: FbdEditorPaneProps) {
  const { pick } = useI18n()
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

  return (
    <div
      className="flex min-w-0 flex-1 flex-col gap-2 overflow-x-hidden rounded-[var(--radius)] bg-[var(--c-bg)] p-1 text-[var(--c-text)]"
      data-testid="fbd-workspace-shell"
      data-fbd-theme={preferences.theme}
      style={themeStyle}
    >
      {/* Mốc tiêu đề cho trợ năng — ẩn thị giác vì tên POU đã có trên tab bar */}
      <h3 className="sr-only">{program.name}</h3>
      {/* ponytail: ẩn thanh công cụ phụ phía trên — program.name đã có trên tab bar và dải trạng thái FBD; các tuỳ chọn hiển thị đã chuyển xuống dải dưới. */}
      {/*
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--c-border)] p-1 min-[1440px]:h-[46px] min-[1440px]:flex-nowrap min-[1440px]:py-0">
          ...
        </div>
      */}
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
        showInlineMinimap={false}
        onChange={(next) => onChange(canonicalFbdJson(next))}
        onSelectionChange={(selection) => {
          if (selection?.networkId) setActiveNetworkId(selection.networkId)
          onSelectionChange?.(selection)
        }}
        onNodeEditorTargetChange={onNodeEditorTargetChange}
        focusSelection={focusSelection}
      />
      {/* Dải trạng thái + tuỳ chọn hiển thị — nằm cùng hàng, cùng kích thước
       * text-[11px]. Preferences dồn trái, status fields dồn phải. */}
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--c-border)] px-2 py-1 text-[11px] text-[var(--c-text-dim)] min-[1440px]:h-[37px] min-[1440px]:flex-nowrap min-[1440px]:py-0"
        role="group"
        aria-label={pick('Tuỳ chọn hiển thị FBD', 'FBD display preferences')}
        data-testid="fbd-secondary-toolbar"
      >
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
      <EditorStatusBar
        leading={<span>{pick('Sẵn sàng', 'Ready')}</span>}
        fields={fbdStatusFields({
          language: 'FBD',
          dirty,
        })}
      />
      {dirty && <p className="text-xs text-[var(--c-warn-fg)]">{pick('Chưa lưu.', 'Not saved.')}</p>}
    </div>
  )
}
