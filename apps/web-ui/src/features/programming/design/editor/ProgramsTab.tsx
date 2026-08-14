import { useEffect, useMemo, useRef, useState } from 'react'
import { FilePlus, Save, Search } from 'lucide-react'
import { useI18n } from '../../../../shared/i18n'
import { createUuid } from '../../../../shared/crypto'
import { useAuth, roleAtLeast } from '../../../auth'
import { Button } from '../../../../shared/components/Button'
import { StructuredFbdEditor } from '../../fbd/StructuredFbdEditor'
import { canonicalFbdJson, FBD_PROFILE_ID, FBD_SCHEMA_VERSION, type FbdDocument } from '../../fbd/model'
import type { ProgrammingDiagnostic, ProgrammingDraftDocument, ProgrammingDraftOperation, ProgrammingProgram } from '../../model/types'

function emptyFbdDocument(name: string): FbdDocument {
  return {
    $schema: '../../fbd_v1.schema.json',
    schemaVersion: FBD_SCHEMA_VERSION,
    profileId: FBD_PROFILE_ID,
    graphId: createUuid(),
    name,
    networks: [{ id: createUuid(), name: 'network_1', order: 0, nodes: [], wires: [] }]
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
  onSave,
  diagnostics,
  focusDiagnostic,
  onPendingOperationsChange,
  discardVersion
}: {
  document: ProgrammingDraftDocument
  saving: boolean
  selectedProgramId: string | undefined
  onSelectProgram: (programId: string) => void
  onSave: (operations: ProgrammingDraftOperation[]) => Promise<boolean>
  diagnostics: ProgrammingDiagnostic[]
  focusDiagnostic: ProgrammingDiagnostic | null
  onPendingOperationsChange: (operations: ProgrammingDraftOperation[]) => void
  discardVersion: number
}) {
  const { pick } = useI18n()
  const { session } = useAuth()
  const canEdit = roleAtLeast(session?.role, 'admin')
  const selected = document.programs.find((program) => program.programId === selectedProgramId)
  const [buffers, setBuffers] = useState<Record<string, string>>({})
  const [projectTagsDraft, setProjectTagsDraft] = useState(() => document.project.functionalTags.join(', '))
  const [metadataDrafts, setMetadataDrafts] = useState<Record<string, ProgramMetadataDraft>>({})

  useEffect(() => {
    setBuffers((current) => {
      const next = { ...current }
      for (const program of document.programs) {
        if (next[program.programId] === undefined) next[program.programId] = programSource(program)
      }
      return next
    })
    setMetadataDrafts((current) => {
      const next = { ...current }
      for (const program of document.programs) {
        if (!next[program.programId]) next[program.programId] = metadataOf(program)
      }
      return next
    })
  }, [document.programs])

  const pendingOperations = useMemo<ProgrammingDraftOperation[]>(() => {
    const operations: ProgrammingDraftOperation[] = []
    const projectTags = parseTags(projectTagsDraft)
    if (!sameTags(projectTags, document.project.functionalTags)) operations.push({ op: 'setFunctionalTags', tags: projectTags })
    for (const program of document.programs) {
      const source = buffers[program.programId] ?? programSource(program)
      const metadata = metadataDrafts[program.programId] ?? metadataOf(program)
      if (source !== programSource(program) || !sameMetadata(metadata, metadataOf(program))) {
        operations.push({
          op: 'upsertProgram',
          program: {
            ...program,
            name: metadata.name.trim() || program.name,
            kind: metadata.kind,
            functionalTags: parseTags(metadata.functionalTags),
            document: source
          }
        })
      }
    }
    return operations
  }, [buffers, document.programs, document.project.functionalTags, metadataDrafts, projectTagsDraft])

  useEffect(() => onPendingOperationsChange(pendingOperations), [onPendingOperationsChange, pendingOperations])

  useEffect(() => {
    setProjectTagsDraft(document.project.functionalTags.join(', '))
    setBuffers(Object.fromEntries(document.programs.map((program) => [program.programId, programSource(program)])))
    setMetadataDrafts(Object.fromEntries(document.programs.map((program) => [program.programId, metadataOf(program)])))
  }, [discardVersion])

  function addProgram(language: 'ST' | 'FBD') {
    const programId = createUuid()
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
        <ProjectTagsEditor
          canEdit={canEdit}
          value={projectTagsDraft}
          saving={saving}
          onChange={setProjectTagsDraft}
          onSave={() => onSave([{ op: 'setFunctionalTags', tags: parseTags(projectTagsDraft) }])}
        />
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
          <SourceEditor
            program={selected}
            source={buffers[selected.programId] ?? programSource(selected)}
            canEdit={canEdit}
            saving={saving}
            diagnostics={diagnostics.filter((item) => item.location?.programId === selected.programId)}
            focusDiagnostic={focusDiagnostic?.location?.programId === selected.programId ? focusDiagnostic : null}
            onChange={(source) => setBuffers((current) => ({ ...current, [selected.programId]: source }))}
            onSave={onSave}
          />
        ) : (
          <FbdEditorPane
            program={selected}
            source={buffers[selected.programId] ?? programSource(selected)}
            canEdit={canEdit}
            saving={saving}
            onChange={(source) => setBuffers((current) => ({ ...current, [selected.programId]: source }))}
            onSave={onSave}
          />
        )}
        {selected && (
          <ProgramInspector
            program={selected}
            draft={metadataDrafts[selected.programId] ?? metadataOf(selected)}
            canEdit={canEdit}
            saving={saving}
            onChange={(draft) => setMetadataDrafts((current) => ({ ...current, [selected.programId]: draft }))}
            onSave={onSave}
          />
        )}
      </div>
    </div>
  )
}

function SourceEditor({
  program,
  source,
  canEdit,
  saving,
  diagnostics,
  focusDiagnostic,
  onChange,
  onSave
}: {
  program: ProgrammingProgram
  source: string
  canEdit: boolean
  saving: boolean
  diagnostics: ProgrammingDiagnostic[]
  focusDiagnostic: ProgrammingDiagnostic | null
  onChange: (source: string) => void
  onSave: (operations: ProgrammingDraftOperation[]) => Promise<boolean>
}) {
  const { pick } = useI18n()
  const committed = typeof program.document === 'string' ? program.document : ''
  const dirty = source !== committed
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lineGutterRef = useRef<HTMLPreElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const symbols = useMemo(() => collectStSymbols(source), [source])
  const matches = useMemo(() => findTextMatches(source, searchText), [searchText, source])

  function updateCursor() {
    const offset = textareaRef.current?.selectionStart ?? 0
    setCursor(offsetToLineColumn(source, offset))
  }

  function selectRange(offset: number, length: number) {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.focus()
    textarea.setSelectionRange(offset, Math.min(source.length, offset + Math.max(1, length)))
    updateCursor()
  }

  useEffect(() => {
    if (!focusDiagnostic?.location) return
    const line = typeof focusDiagnostic.location.line === 'number' ? focusDiagnostic.location.line : 1
    const column = typeof focusDiagnostic.location.column === 'number' ? focusDiagnostic.location.column : 1
    const length = typeof focusDiagnostic.location.length === 'number' ? focusDiagnostic.location.length : 1
    selectRange(lineColumnToOffset(source, line, column), length)
  }, [focusDiagnostic])

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--c-text)]">{program.name}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" icon={<Search className="h-4 w-4" aria-hidden="true" />} onClick={() => { setSearchOpen(true); window.setTimeout(() => searchRef.current?.focus(), 0) }}>
            {pick('Tìm', 'Find')}
          </Button>
          {canEdit && (
            <>
              <Button size="sm" variant="secondary" onClick={() => onChange(formatStSource(source))}>{pick('Định dạng', 'Format')}</Button>
              <Button
                size="sm"
                icon={<Save className="h-4 w-4" aria-hidden="true" />}
                loading={saving}
                disabled={!dirty}
                onClick={() => void onSave([{ op: 'replaceProgramSource', programId: program.programId, language: 'ST', source }])}
              >
                {pick('Lưu', 'Save')}
              </Button>
            </>
          )}
        </div>
      </div>
      {searchOpen && (
        <div role="search" className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-2">
          <label className="sr-only" htmlFor={`programming-st-find-${program.programId}`}>{pick('Tìm trong mã nguồn', 'Find in source')}</label>
          <input
            ref={searchRef}
            id={`programming-st-find-${program.programId}`}
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') { setSearchOpen(false); textareaRef.current?.focus() }
              if (event.key === 'Enter' && matches.length > 0) selectRange(matches[0], searchText.length)
            }}
            className="min-w-52 flex-1 rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1 text-sm text-[var(--c-text)]"
          />
          <span className="text-xs text-[var(--c-text-dim)]">{matches.length} {pick('kết quả', 'matches')}</span>
          <Button size="sm" variant="ghost" disabled={matches.length === 0} onClick={() => matches.length > 0 && selectRange(nextMatch(matches, textareaRef.current?.selectionEnd ?? 0), searchText.length)}>{pick('Tiếp', 'Next')}</Button>
        </div>
      )}
      <label className="sr-only" htmlFor={`programming-st-source-${program.programId}`}>
        {pick(`Mã nguồn ST của ${program.name}`, `ST source for ${program.name}`)}
      </label>
      <div className="grid h-96 grid-cols-[3.5rem_1fr] overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] focus-within:border-[var(--c-accent)]">
        <pre ref={lineGutterRef} aria-hidden="true" className="mono m-0 overflow-hidden border-r border-[var(--c-border)] bg-[var(--c-surface-2)] px-2 py-3 text-right text-sm leading-5 text-[var(--c-text-dim)]">
          {Array.from({ length: Math.max(1, source.split('\n').length) }, (_, index) => index + 1).join('\n')}
        </pre>
        <textarea
          ref={textareaRef}
          id={`programming-st-source-${program.programId}`}
          aria-describedby={diagnostics.length > 0 ? `programming-st-diagnostics-${program.programId}` : undefined}
          className="mono h-96 w-full resize-none border-0 bg-transparent p-3 text-sm leading-5 text-[var(--c-text)] outline-none"
          value={source}
          readOnly={!canEdit}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
          onClick={updateCursor}
          onKeyUp={updateCursor}
          onSelect={updateCursor}
          onScroll={(event) => { if (lineGutterRef.current) lineGutterRef.current.scrollTop = event.currentTarget.scrollTop }}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
              event.preventDefault(); setSearchOpen(true); window.setTimeout(() => searchRef.current?.focus(), 0)
            }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && canEdit && dirty) {
              event.preventDefault(); void onSave([{ op: 'replaceProgramSource', programId: program.programId, language: 'ST', source }])
            }
          }}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--c-text-dim)]">
        <span>{pick('Dòng', 'Line')} {cursor.line}, {pick('cột', 'column')} {cursor.column}</span>
        <span>{source.length} {pick('ký tự', 'characters')}</span>
      </div>
      <div className="rounded-[var(--radius)] border border-[var(--c-border)] p-2">
        <h4 className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Ký hiệu & kiểu', 'Symbols & types')}</h4>
        {symbols.length === 0 ? (
          <p className="mt-1 text-xs text-[var(--c-text-dim)]">{pick('Chưa nhận diện khai báo VAR.', 'No VAR declarations detected.')}</p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-1">
            {symbols.map((symbol) => (
              <li key={`${symbol.name}-${symbol.offset}`}>
                <button type="button" className="rounded bg-[var(--c-surface-2)] px-2 py-1 font-mono text-xs text-[var(--c-text)] hover:text-[var(--c-accent)]" onClick={() => selectRange(symbol.offset, symbol.name.length)}>
                  {symbol.name}: {symbol.type} · {symbol.references} {pick('tham chiếu', 'refs')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {diagnostics.length > 0 && (
        <p id={`programming-st-diagnostics-${program.programId}`} className="text-xs text-[var(--c-fault-fg)]">
          {pick(`${diagnostics.length} diagnostic. Chọn lỗi trong khay Vấn đề để tới đúng dòng/cột.`, `${diagnostics.length} diagnostic(s). Select one in Problems to jump to its line and column.`)}
        </p>
      )}
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
  source,
  canEdit,
  saving,
  onChange,
  onSave
}: {
  program: ProgrammingProgram
  source: string
  canEdit: boolean
  saving: boolean
  onChange: (source: string) => void
  onSave: (operations: ProgrammingDraftOperation[]) => Promise<boolean>
}) {
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
      </div>
      <StructuredFbdEditor document={local} canEdit={canEdit} onChange={(next) => onChange(canonicalFbdJson(next))} />
      {dirty && <p className="text-xs text-[var(--c-warn-fg)]">{pick('Chưa lưu.', 'Not saved.')}</p>}
    </div>
  )
}

interface ProgramMetadataDraft {
  name: string
  kind: ProgrammingProgram['kind']
  functionalTags: string
}

function metadataOf(program: ProgrammingProgram): ProgramMetadataDraft {
  return { name: program.name, kind: program.kind, functionalTags: (program.functionalTags ?? []).join(', ') }
}

function sameMetadata(left: ProgramMetadataDraft, right: ProgramMetadataDraft): boolean {
  return left.name === right.name && left.kind === right.kind && sameTags(parseTags(left.functionalTags), parseTags(right.functionalTags))
}

function parseTags(value: string): string[] {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))]
}

function sameTags(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function programSource(program: ProgrammingProgram): string {
  if (typeof program.document === 'string') return program.document
  return JSON.stringify(program.document)
}

function ProjectTagsEditor({ canEdit, value, saving, onChange, onSave }: { canEdit: boolean; value: string; saving: boolean; onChange: (value: string) => void; onSave: () => Promise<boolean> }) {
  const { pick } = useI18n()
  return (
    <div className="mb-3 border-b border-[var(--c-border)] pb-3">
      <label className="text-xs font-semibold uppercase text-[var(--c-text-dim)]" htmlFor="programming-project-functional-tags">{pick('Nhóm chức năng', 'Functional tags')}</label>
      <input id="programming-project-functional-tags" value={value} readOnly={!canEdit} onChange={(event) => onChange(event.target.value)} placeholder={pick('AHU, Nhiệt độ gió cấp', 'AHU, Supply air temperature')} className="mt-1 w-full rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1 text-xs text-[var(--c-text)]" />
      {canEdit && <Button className="mt-1" size="sm" variant="ghost" loading={saving} onClick={() => void onSave()}>{pick('Lưu nhóm', 'Save tags')}</Button>}
    </div>
  )
}

function ProgramInspector({ program, draft, canEdit, saving, onChange, onSave }: { program: ProgrammingProgram; draft: ProgramMetadataDraft; canEdit: boolean; saving: boolean; onChange: (draft: ProgramMetadataDraft) => void; onSave: (operations: ProgrammingDraftOperation[]) => Promise<boolean> }) {
  const { pick } = useI18n()
  const dirty = !sameMetadata(draft, metadataOf(program))
  return (
    <section className="mt-4 rounded-[var(--radius)] border border-[var(--c-border)] p-3" aria-label={pick('Thuộc tính chương trình', 'Program properties')}>
      <h3 className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Thuộc tính', 'Inspector')}</h3>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <label className="text-xs text-[var(--c-text-dim)]">{pick('Tên', 'Name')}<input className="mt-1 w-full rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1 text-sm text-[var(--c-text)]" value={draft.name} readOnly={!canEdit} onChange={(event) => onChange({ ...draft, name: event.target.value })} /></label>
        <label className="text-xs text-[var(--c-text-dim)]">{pick('Loại', 'Kind')}<select className="mt-1 w-full rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1 text-sm text-[var(--c-text)]" value={draft.kind} disabled={!canEdit} onChange={(event) => onChange({ ...draft, kind: event.target.value as ProgrammingProgram['kind'] })}><option value="PROGRAM">PROGRAM</option><option value="FUNCTION_BLOCK">FUNCTION_BLOCK</option><option value="FUNCTION">FUNCTION</option></select></label>
        <label className="text-xs text-[var(--c-text-dim)]">{pick('Tag chức năng', 'Functional tags')}<input className="mt-1 w-full rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1 text-sm text-[var(--c-text)]" value={draft.functionalTags} readOnly={!canEdit} onChange={(event) => onChange({ ...draft, functionalTags: event.target.value })} /></label>
      </div>
      {canEdit && <Button className="mt-2" size="sm" loading={saving} disabled={!dirty || draft.name.trim().length === 0} onClick={() => void onSave([{ op: 'upsertProgram', program: { ...program, name: draft.name.trim(), kind: draft.kind, functionalTags: parseTags(draft.functionalTags) } }])}>{pick('Lưu thuộc tính', 'Save properties')}</Button>}
    </section>
  )
}

interface StSymbol { name: string; type: string; offset: number; references: number }

function collectStSymbols(source: string): StSymbol[] {
  const output: StSymbol[] = []
  const declaration = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(BOOL|INT|DINT|UINT|REAL|TIME)\b/gim
  let match: RegExpExecArray | null
  while ((match = declaration.exec(source)) !== null) {
    const nameOffset = match.index + match[0].indexOf(match[1])
    const references = source.match(new RegExp(`\\b${escapeRegExp(match[1])}\\b`, 'gi'))?.length ?? 0
    output.push({ name: match[1], type: match[2].toUpperCase(), offset: nameOffset, references })
  }
  return output
}

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
function findTextMatches(source: string, query: string): number[] {
  if (!query) return []
  const output: number[] = []
  const haystack = source.toLocaleLowerCase()
  const needle = query.toLocaleLowerCase()
  let offset = 0
  while ((offset = haystack.indexOf(needle, offset)) >= 0 && output.length < 1000) { output.push(offset); offset += Math.max(1, needle.length) }
  return output
}
function nextMatch(matches: number[], after: number): number { return matches.find((offset) => offset >= after) ?? matches[0] ?? 0 }
function offsetToLineColumn(source: string, offset: number): { line: number; column: number } {
  const before = source.slice(0, offset)
  const lines = before.split('\n')
  return { line: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 }
}
function lineColumnToOffset(source: string, line: number, column: number): number {
  const lines = source.split('\n')
  const lineIndex = Math.max(0, Math.min(lines.length - 1, line - 1))
  let offset = 0
  for (let index = 0; index < lineIndex; index += 1) offset += lines[index].length + 1
  return offset + Math.max(0, Math.min(lines[lineIndex]?.length ?? 0, column - 1))
}
function formatStSource(source: string): string {
  const normalized = source.replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/[\t ]+$/g, '').replace(/^\t+/g, (tabs) => '  '.repeat(tabs.length))).join('\n')
  return normalized.length === 0 ? '' : `${normalized.replace(/\n+$/g, '')}\n`
}
