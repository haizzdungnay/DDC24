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
const TOOLBAR_SELECT_CLASS = 'min-h-11 rounded border border-[var(--c-border)] bg-[var(--c-surface)] px-2 min-[1440px]:h-7 min-[1440px]:min-h-0 min-[1440px]:py-0'

/** Kẻ dọc phân tách cụm điều khiển, chỉ hiện ở khổ ≥1440px vì dưới đó thanh
 *  công cụ xuống dòng và một vạch dọc giữa hai hàng đọc thành rác. */
function ToolbarDivider() {
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
  const [wideDesktop, setWideDesktop] = useState(() => window.innerWidth >= 1440)

  useEffect(() => {
    setPreferences(readFbdPreferences(userScope, projectId))
  }, [projectId, userScope])

  useEffect(() => {
    const update = () => setWideDesktop(window.innerWidth >= 1440)
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

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
      className="min-w-0 space-y-2 overflow-x-hidden rounded-[var(--radius)] bg-[var(--c-bg)] p-1 text-[var(--c-text)]"
      data-testid="fbd-workspace-shell"
      data-fbd-theme={preferences.theme}
      style={themeStyle}
    >
      {/* Thanh công cụ phụ, ~46px theo ảnh chuẩn PGM-02B (vùng y≈104..150).
       *
       * Vùng chạm 44px (`min-h-11`) giữ nguyên ở khổ dưới 1440px và chỉ rút
       * xuống ở khổ ≥1440px. Đó là khổ ảnh chuẩn mô tả, và cũng là khổ dùng
       * chuột; hạ vùng chạm toàn cục sẽ lấy mất 44px trên đúng những tủ có màn
       * cảm ứng — nơi ngón tay là thiết bị trỏ duy nhất. */}
      <div
        className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--c-border)] px-1 py-1.5 min-[1440px]:h-[46px] min-[1440px]:flex-nowrap min-[1440px]:py-0"
        data-testid="fbd-secondary-toolbar"
      >
        <h3 className="shrink-0 text-sm font-semibold text-[var(--c-text)]">{program.name}</h3>
        <div className="flex flex-wrap items-end gap-2 min-[1440px]:flex-nowrap min-[1440px]:items-center min-[1440px]:gap-3" role="group" aria-label={pick('Tuỳ chọn hiển thị FBD', 'FBD display preferences')}>
          {/* Cụm 1 — chọn phạm vi đang xem. */}
          <div className="flex flex-wrap items-end gap-2 min-[1440px]:flex-nowrap min-[1440px]:items-center">
            <label className="flex flex-col gap-1 text-xs min-[1440px]:flex-row min-[1440px]:items-center min-[1440px]:gap-1.5">
              {pick('Khung nhìn', 'View')}
              <select
                className={TOOLBAR_SELECT_CLASS}
                value={preferences.networkView}
                onChange={(event) => updatePreferences({ networkView: event.target.value as FbdPreferences['networkView'] })}
              >
                <option value="SELECTED">{pick('Network đang chọn', 'Selected network')}</option>
                <option value="ALL">{pick('Tất cả network', 'All networks')}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs min-[1440px]:flex-row min-[1440px]:items-center min-[1440px]:gap-1.5">
              {pick('Network hoạt động', 'Active network')}
              <select
                className={TOOLBAR_SELECT_CLASS}
                value={activeNetworkId ?? ''}
                onChange={(event) => {
                  const next = event.target.value
                  setActiveNetworkId(next)
                  onSelectionChange?.({ kind: 'network', networkId: next })
                }}
              >
                {local.networks.map((network) => <option key={network.id} value={network.id}>{network.order + 1}. {network.name}</option>)}
              </select>
            </label>
          </div>

          <ToolbarDivider />

          {/* Cụm 2 — cách canvas vẽ. */}
          <div className="flex flex-wrap items-end gap-2 min-[1440px]:flex-nowrap min-[1440px]:items-center">
            <label className="inline-flex min-h-11 items-center gap-2 text-xs min-[1440px]:min-h-0">
              <input type="checkbox" checked={preferences.gridVisible} onChange={(event) => updatePreferences({ gridVisible: event.target.checked })} />
              {pick('Lưới', 'Grid')}
            </label>
            <label className="inline-flex min-h-11 items-center gap-2 text-xs min-[1440px]:min-h-0">
              <input type="checkbox" checked={preferences.snapEnabled} onChange={(event) => updatePreferences({ snapEnabled: event.target.checked })} />
              {pick('Bám lưới', 'Snap')}
            </label>
            <label className="flex flex-col gap-1 text-xs min-[1440px]:flex-row min-[1440px]:items-center min-[1440px]:gap-1.5">
              {pick('Kiểu dây', 'Wire style')}
              <select
                className={TOOLBAR_SELECT_CLASS}
                value={preferences.wireStyle}
                onChange={(event) => updatePreferences({ wireStyle: event.target.value as FbdPreferences['wireStyle'] })}
              >
                <option value="ORTHOGONAL">{pick('Vuông góc', 'Orthogonal')}</option>
                <option value="BEZIER">Bezier</option>
              </select>
            </label>
          </div>

          <ToolbarDivider />

          {/* Cụm 3 — vỏ giao diện quanh canvas. */}
          <div className="flex flex-wrap items-end gap-2 min-[1440px]:flex-nowrap min-[1440px]:items-center">
            <label className="flex flex-col gap-1 text-xs min-[1440px]:flex-row min-[1440px]:items-center min-[1440px]:gap-1.5">
              {pick('Giao diện FBD', 'FBD theme')}
              <select
                className={TOOLBAR_SELECT_CLASS}
                value={preferences.theme}
                onChange={(event) => updatePreferences({ theme: event.target.value as FbdThemePreference })}
              >
                <option value="FOLLOW_WEB">{pick('Theo giao diện web', 'Follow web')}</option>
                <option value="LIGHT">{pick('Sáng', 'Light')}</option>
                <option value="DARK">{pick('Tối', 'Dark')}</option>
              </select>
            </label>
            <label className="inline-flex min-h-11 items-center gap-2 text-xs min-[1440px]:min-h-0">
              <input
                type="checkbox"
                checked={preferences.dock.library}
                onChange={(event) => updatePreferences({ dock: { ...preferences.dock, library: event.target.checked } })}
              />
              {pick('Khay Thư viện', 'Library dock')}
            </label>
          </div>
        </div>
      </div>
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
        libraryDefaultOpen={preferences.dock.library && wideDesktop}
        onLibraryOpenChange={(open) => updatePreferences({ dock: { ...preferences.dock, library: open } })}
        onChange={(next) => onChange(canonicalFbdJson(next))}
        onSelectionChange={(selection) => {
          if (selection?.networkId) setActiveNetworkId(selection.networkId)
          onSelectionChange?.(selection)
        }}
        onNodeEditorTargetChange={onNodeEditorTargetChange}
        focusSelection={focusSelection}
      />
      <EditorStatusBar
        leading={<span>{pick('Sẵn sàng', 'Ready')}</span>}
        fields={fbdStatusFields({
          language: 'FBD',
          dirty,
          /* `zoom` và `connection` để trống: canvas chưa công bố tỉ lệ thu phóng
             ra ngoài, và trạng thái kết nối thiết bị chưa được nối vào tab này.
             Cả hai hiện `—`. Điền `100%` hay `Trực tuyến` sẽ là khẳng định về
             thứ chưa ai đo — và `Mất kết nối` cho một thiết bị đang khoẻ còn tệ
             hơn: nó gọi người trực đêm dậy vì một giá trị FE tự bịa.

             `PGM-02B` vẽ dải này với `(100%)` và `● Online`. Bố cục lấy theo ảnh
             (cao 37px, `Sẵn sàng` bên trái, các ô dồn phải), nhưng GIÁ TRỊ thì
             không: một bản vẽ thiết kế không phải phép đo. Khi `StructuredFbdEditor`
             công bố được tỉ lệ thu phóng thật thì truyền vào `zoom` ở đây. */
        })}
      />
      {dirty && <p className="text-xs text-[var(--c-warn-fg)]">{pick('Chưa lưu.', 'Not saved.')}</p>}
    </div>
  )
}
