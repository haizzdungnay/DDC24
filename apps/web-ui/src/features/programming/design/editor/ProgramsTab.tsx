import { useEffect, useMemo, useState } from 'react'
import { FilePlus, Save } from 'lucide-react'
import { useI18n } from '../../../../shared/i18n'
import { useAuth, roleAtLeast } from '../../../auth'
import { Button } from '../../../../shared/components/Button'
import { StructuredFbdEditor } from '../../fbd/StructuredFbdEditor'
import { canonicalFbdJson, FBD_PROFILE_ID, FBD_SCHEMA_VERSION, type FbdDocument } from '../../fbd/model'
import type { ProgrammingDraftDocument, ProgrammingDraftOperation, ProgrammingProgram } from '../../model/types'

function emptyFbdDocument(name: string): FbdDocument {
  return {
    $schema: '../../fbd_v1.schema.json',
    schemaVersion: FBD_SCHEMA_VERSION,
    profileId: FBD_PROFILE_ID,
    graphId: crypto.randomUUID(),
    name,
    networks: [{ id: crypto.randomUUID(), name: 'network_1', order: 0, nodes: [], wires: [] }]
  }
}

/**
 * Tab "Chương trình" của PGM-02 (`UJ-PROG-02`) — `ApplicationTree` + editor.
 * FBD là lối vào ưu tiên (UX §16.2): `StructuredFbdEditor` sẵn có
 * (`TASK-PROG-201`, keyboard-first, undo/redo bounded) được mount thẳng ở
 * đây, không viết model/reducer/shortcut thứ hai (TASK-PROG-502).
 */
export function ProgramsTab({
  document,
  saving,
  selectedProgramId,
  onSelectProgram,
  onSave
}: {
  document: ProgrammingDraftDocument
  saving: boolean
  selectedProgramId: string | undefined
  onSelectProgram: (programId: string) => void
  onSave: (operations: ProgrammingDraftOperation[]) => Promise<boolean>
}) {
  const { pick } = useI18n()
  const { session } = useAuth()
  const canEdit = roleAtLeast(session?.role, 'admin')
  const selected = document.programs.find((program) => program.programId === selectedProgramId)

  function addProgram(language: 'ST' | 'FBD') {
    const programId = crypto.randomUUID()
    const name = language === 'FBD' ? pick('FBD mới', 'New FBD') : pick('Chương trình mới', 'New program')
    const newProgram: ProgrammingProgram = {
      programId,
      name,
      kind: 'PROGRAM',
      language,
      document: language === 'FBD' ? canonicalFbdJson(emptyFbdDocument(name)) : '',
      executionOrder: document.programs.length,
      functionalTags: []
    }
    void onSave([
      { op: 'upsertProgram', program: newProgram },
      { op: 'setTask', task: { ...document.task, programOrder: [...document.task.programOrder, programId] } }
    ]).then((ok) => {
      if (ok) onSelectProgram(programId)
    })
  }

  return (
    <div className="grid gap-4 md:grid-cols-[280px_1fr]">
      <nav aria-label={pick('Cây ứng dụng', 'Application tree')} className="rounded-[var(--radius)] border border-[var(--c-border)] p-2">
        <div className="mb-2 flex items-center justify-between px-1">
          <h3 className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Chương trình', 'Programs')}</h3>
          {canEdit && (
            <span className="flex gap-1">
              <button
                type="button"
                className="rounded p-1 text-[var(--c-text-dim)] hover:text-[var(--c-accent)]"
                title={pick('Thêm chương trình FBD', 'Add FBD program')}
                onClick={() => addProgram('FBD')}
              >
                <FilePlus className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">{pick('FBD', 'FBD')}</span>
              </button>
              <button
                type="button"
                className="rounded p-1 text-xs font-semibold text-[var(--c-text-dim)] hover:text-[var(--c-accent)]"
                title={pick('Thêm chương trình ST', 'Add ST program')}
                onClick={() => addProgram('ST')}
              >
                ST+
              </button>
            </span>
          )}
        </div>
        {document.programs.length === 0 ? (
          <p className="px-1 text-sm text-[var(--c-text-dim)]">
            {canEdit
              ? pick('Chưa có chương trình. Bấm + để tạo.', 'No programs yet. Click + to create one.')
              : pick('Chưa có chương trình.', 'No programs yet.')}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {document.programs.map((program) => (
              <li key={program.programId}>
                <button
                  type="button"
                  aria-current={program.programId === selectedProgramId ? 'true' : undefined}
                  className={`w-full rounded px-2 py-1.5 text-left text-sm ${
                    program.programId === selectedProgramId ? 'bg-[var(--c-accent-bg)] text-[var(--c-accent)]' : 'text-[var(--c-text)] hover:bg-[var(--c-surface-2)]'
                  }`}
                  onClick={() => onSelectProgram(program.programId)}
                >
                  {program.name} <span className="text-[var(--c-text-dim)]">· {program.language}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>
      <div>
        {!selected ? (
          <p className="text-sm text-[var(--c-text-dim)]">{pick('Chọn một chương trình ở cây bên trái.', 'Select a program from the tree on the left.')}</p>
        ) : selected.language === 'ST' ? (
          <SourceEditor key={selected.programId} program={selected} canEdit={canEdit} saving={saving} onSave={onSave} />
        ) : (
          <FbdEditorPane key={selected.programId} program={selected} canEdit={canEdit} saving={saving} onSave={onSave} />
        )}
      </div>
    </div>
  )
}

function SourceEditor({
  program,
  canEdit,
  saving,
  onSave
}: {
  program: ProgrammingProgram
  canEdit: boolean
  saving: boolean
  onSave: (operations: ProgrammingDraftOperation[]) => Promise<boolean>
}) {
  const { pick } = useI18n()
  const committed = typeof program.document === 'string' ? program.document : ''
  const [source, setSource] = useState(committed)
  const dirty = source !== committed

  useEffect(() => {
    setSource(committed)
    // Component được `key`-ed theo programId ở cha nên effect này chỉ chạy
    // lại khi nội dung đã lưu của CÙNG program đổi (ví dụ sau khi save/409).
  }, [committed])

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
            onClick={() => void onSave([{ op: 'replaceProgramSource', programId: program.programId, language: 'ST', source }])}
          >
            {pick('Lưu', 'Save')}
          </Button>
        )}
      </div>
      <label className="sr-only" htmlFor={`programming-st-source-${program.programId}`}>
        {pick(`Mã nguồn ST của ${program.name}`, `ST source for ${program.name}`)}
      </label>
      <textarea
        id={`programming-st-source-${program.programId}`}
        className="mono h-96 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-3 text-sm text-[var(--c-text)]"
        value={source}
        readOnly={!canEdit}
        spellCheck={false}
        onChange={(event) => setSource(event.target.value)}
      />
      {dirty && <p className="text-xs text-[var(--c-warn-fg)]">{pick('Chưa lưu.', 'Not saved.')}</p>}
    </div>
  )
}

function parseFbdDocument(raw: unknown, fallbackName: string): FbdDocument {
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      return JSON.parse(raw) as FbdDocument
    } catch {
      // Rơi xuống tài liệu rỗng bên dưới — không được ném lỗi làm mất cả tab;
      // StructuredFbdEditor tự validate lại và hiện issue cho người dùng sửa.
    }
  }
  return emptyFbdDocument(fallbackName)
}

function FbdEditorPane({
  program,
  canEdit,
  saving,
  onSave
}: {
  program: ProgrammingProgram
  canEdit: boolean
  saving: boolean
  onSave: (operations: ProgrammingDraftOperation[]) => Promise<boolean>
}) {
  const { pick } = useI18n()
  const committedJson = useMemo(() => canonicalFbdJson(parseFbdDocument(program.document, program.name)), [program.document, program.name])
  const [local, setLocal] = useState<FbdDocument>(() => parseFbdDocument(program.document, program.name))
  const localJson = useMemo(() => canonicalFbdJson(local), [local])
  const dirty = localJson !== committedJson

  useEffect(() => {
    setLocal(parseFbdDocument(program.document, program.name))
    // Chỉ đồng bộ lại khi nội dung ĐÃ LƯU của cùng program đổi (save/409/reload).
  }, [committedJson, program.document, program.name])

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
      </div>
      <StructuredFbdEditor document={local} canEdit={canEdit} onChange={setLocal} />
      {dirty && <p className="text-xs text-[var(--c-warn-fg)]">{pick('Chưa lưu.', 'Not saved.')}</p>}
    </div>
  )
}
