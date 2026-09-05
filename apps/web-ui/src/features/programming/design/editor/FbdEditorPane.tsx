import { useMemo } from 'react'
import { ClipboardCheck, GitCompare, Save } from 'lucide-react'
import { useI18n } from '../../../../shared/i18n'
import { Button } from '../../../../shared/components/Button'
import { StructuredFbdEditor } from '../../fbd/StructuredFbdEditor'
import type { FbdSelection } from '../../fbd/commands'
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
  /** `T59-818` — chuyển tiếp lựa chọn canvas lên Inspector dùng chung. */
  onSelectionChange?: (selection: FbdSelection | null) => void
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
  saving,
  onChange,
  onSave,
  userPouInterfaces,
  projectId,
  onSelectionChange,
  focusSelection,
  onRunCheck,
  onOpenCompare,
  checkDisabledReason,
  compareDisabledReason,
}: FbdEditorPaneProps) {
  const { pick } = useI18n()
  const committedJson = useMemo(() => canonicalFbdJson(parseFbdDocument(program.document, program.name)), [program.document, program.name])
  const local = useMemo(() => parseFbdDocument(source, program.name), [program.name, source])
  const localJson = useMemo(() => canonicalFbdJson(local), [local])
  const dirty = localJson !== committedJson

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--c-text)]">{program.name}</h3>
        {canEdit && (
          <Button
            size="sm"
            icon={<Save className="h-4 w-4" aria-hidden="true" />}
            loading={saving}
            disabled={!dirty}
            onClick={() => void onSave([{ op: 'replaceProgramSource', programId: program.programId, language: 'FBD', source: localJson }])}
          >
            {pick('Lưu', 'Save')}
          </Button>
        )}
        {/* `Kiểm tra`/`So sánh` là hành động cấp GÓI nên chúng có mặt ở cả hai
            ngôn ngữ — bỏ chúng khỏi FBD sẽ làm cùng một việc chỉ làm được khi
            đang mở một POU ST. */}
        <Button
          size="sm"
          variant="secondary"
          icon={<ClipboardCheck className="h-4 w-4" aria-hidden="true" />}
          disabled={!onRunCheck || Boolean(checkDisabledReason)}
          title={checkDisabledReason ?? pick('Kiểm tra gói (mở PGM-05)', 'Check the package (opens PGM-05)')}
          onClick={() => onRunCheck?.()}
        >
          {pick('Kiểm tra', 'Check')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<GitCompare className="h-4 w-4" aria-hidden="true" />}
          disabled={!onOpenCompare || Boolean(compareDisabledReason)}
          title={compareDisabledReason ?? pick('So sánh với bản đang vận hành', 'Compare with the running revision')}
          onClick={() => onOpenCompare?.()}
        >
          {pick('So sánh', 'Compare')}
        </Button>
      </div>
      <StructuredFbdEditor
        document={local}
        canEdit={canEdit}
        userPouInterfaces={userPouInterfaces}
        projectId={projectId}
        onChange={(next) => onChange(canonicalFbdJson(next))}
        onSelectionChange={onSelectionChange}
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
