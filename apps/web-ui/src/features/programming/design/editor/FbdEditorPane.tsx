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
import { emptyFbdDocument } from '../pou/pouTemplates'
import type { UserPouInterface } from '../../fbd/userPou'
import type { ProgrammingDraftOperation, ProgrammingProgram } from '../../model/types'
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
  const committedJson = useMemo(() => canonicalFbdJson(parseFbdDocument(program.document, program.name)), [program.document, program.name])
  const local = useMemo(() => parseFbdDocument(source, program.name), [program.name, source])
  const localJson = useMemo(() => canonicalFbdJson(local), [local])
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

  return (
    <div
      className="min-w-0 space-y-2 overflow-x-hidden rounded-[var(--radius)] bg-[var(--c-bg)] p-1 text-[var(--c-text)]"
      data-testid="fbd-workspace-shell"
      data-fbd-theme={preferences.theme}
      style={themeStyle}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--c-text)]">{program.name}</h3>
        <div className="flex flex-wrap items-end gap-2" role="group" aria-label={pick('Tuỳ chọn hiển thị FBD', 'FBD display preferences')}>
          <label className="flex flex-col gap-1 text-xs">
            {pick('Khung nhìn', 'View')}
            <select
              className="min-h-11 rounded border border-[var(--c-border)] bg-[var(--c-surface)] px-2"
              value={preferences.networkView}
              onChange={(event) => updatePreferences({ networkView: event.target.value as FbdPreferences['networkView'] })}
            >
              <option value="SELECTED">{pick('Network đang chọn', 'Selected network')}</option>
              <option value="ALL">{pick('Tất cả network', 'All networks')}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {pick('Network hoạt động', 'Active network')}
            <select
              className="min-h-11 rounded border border-[var(--c-border)] bg-[var(--c-surface)] px-2"
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
          <label className="flex flex-col gap-1 text-xs">
            {pick('Giao diện FBD', 'FBD theme')}
            <select
              className="min-h-11 rounded border border-[var(--c-border)] bg-[var(--c-surface)] px-2"
              value={preferences.theme}
              onChange={(event) => updatePreferences({ theme: event.target.value as FbdThemePreference })}
            >
              <option value="FOLLOW_WEB">{pick('Theo giao diện web', 'Follow web')}</option>
              <option value="LIGHT">{pick('Sáng', 'Light')}</option>
              <option value="DARK">{pick('Tối', 'Dark')}</option>
            </select>
          </label>
          <label className="inline-flex min-h-11 items-center gap-2 text-xs">
            <input type="checkbox" checked={preferences.gridVisible} onChange={(event) => updatePreferences({ gridVisible: event.target.checked })} />
            {pick('Lưới', 'Grid')}
          </label>
          <label className="inline-flex min-h-11 items-center gap-2 text-xs">
            <input type="checkbox" checked={preferences.snapEnabled} onChange={(event) => updatePreferences({ snapEnabled: event.target.checked })} />
            {pick('Bám lưới', 'Snap')}
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {pick('Kiểu dây', 'Wire style')}
            <select
              className="min-h-11 rounded border border-[var(--c-border)] bg-[var(--c-surface)] px-2"
              value={preferences.wireStyle}
              onChange={(event) => updatePreferences({ wireStyle: event.target.value as FbdPreferences['wireStyle'] })}
            >
              <option value="ORTHOGONAL">{pick('Vuông góc', 'Orthogonal')}</option>
              <option value="BEZIER">Bezier</option>
            </select>
          </label>
          <label className="inline-flex min-h-11 items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={preferences.dock.library}
              onChange={(event) => updatePreferences({ dock: { ...preferences.dock, library: event.target.checked } })}
            />
            {pick('Khay Thư viện', 'Library dock')}
          </label>
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
        fields={fbdStatusFields({
          language: 'FBD',
          dirty,
          /* `zoom` và `connection` để trống: canvas chưa công bố tỉ lệ thu phóng
             ra ngoài, và trạng thái kết nối thiết bị chưa được nối vào tab này.
             Cả hai hiện `—`. Điền `100%` hay `Trực tuyến` sẽ là khẳng định về
             thứ chưa ai đo — và `Mất kết nối` cho một thiết bị đang khoẻ còn tệ
             hơn: nó gọi người trực đêm dậy vì một giá trị FE tự bịa. */
        })}
      />
      {dirty && <p className="text-xs text-[var(--c-warn-fg)]">{pick('Chưa lưu.', 'Not saved.')}</p>}
    </div>
  )
}
