import { Boxes, ChevronDown, ChevronRight, Command, FileCode2, FilePlus, FolderTree, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '../../../../shared/components/Button'
import { useI18n } from '../../../../shared/i18n'
import type { ProgrammingProgram } from '../../model/types'

export function ProgramExplorer({
  canEdit,
  saving,
  functionalTags,
  projectFunctionalTags,
  programs,
  projectName,
  activeProgramIds,
  runtimeConfirmed,
  selectedProgramId,
  onFunctionalTagsChange,
  onSaveFunctionalTags,
  onOpenCommandPalette,
  onAddProgram,
  onSelectProgram,
  onRequestDelete,
}: {
  canEdit: boolean
  saving: boolean
  functionalTags: string
  projectFunctionalTags: string[]
  programs: ProgrammingProgram[]
  projectName: string
  activeProgramIds: ReadonlySet<string>
  runtimeConfirmed: boolean
  selectedProgramId: string | undefined
  onFunctionalTagsChange: (value: string) => void
  onSaveFunctionalTags: () => Promise<boolean>
  onOpenCommandPalette: () => void
  onAddProgram: (language: 'ST' | 'FBD') => void
  onSelectProgram: (programId: string) => void
  onRequestDelete: (programId: string) => void
}) {
  const { pick } = useI18n()
  const [applicationExpanded, setApplicationExpanded] = useState(true)
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() => new Set())
  const groups = useMemo(
    () => buildFunctionalGroups(projectFunctionalTags, programs, pick('Chưa phân nhóm', 'Unassigned')),
    [pick, programs, projectFunctionalTags],
  )

  function toggleGroup(groupId: string) {
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  return (
    <>
      <div className="mb-2 flex items-center justify-between px-1">
        <h3 className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Chương trình', 'Programs')}</h3>
        <span className="flex gap-1">
          <button type="button" className="flex min-h-10 min-w-10 items-center justify-center rounded text-[var(--c-text-dim)] hover:bg-[var(--c-surface-2)] hover:text-[var(--c-accent)]" title={pick('Bảng lệnh nhanh (Ctrl+P)', 'Command palette (Ctrl+P)')} onClick={onOpenCommandPalette}>
            <Command className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{pick('Bảng lệnh nhanh', 'Command palette')}</span>
          </button>
          {canEdit && (
            <>
              <button type="button" className="flex min-h-10 min-w-10 items-center justify-center rounded text-[var(--c-text-dim)] hover:bg-[var(--c-surface-2)] hover:text-[var(--c-accent)]" title={pick('Thêm chương trình FBD', 'Add FBD program')} onClick={() => onAddProgram('FBD')}>
                <FilePlus className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">FBD</span>
              </button>
              <button type="button" className="flex min-h-10 min-w-10 items-center justify-center rounded text-xs font-semibold text-[var(--c-text-dim)] hover:bg-[var(--c-surface-2)] hover:text-[var(--c-accent)]" title={pick('Thêm chương trình ST', 'Add ST program')} onClick={() => onAddProgram('ST')}>
                ST+
              </button>
            </>
          )}
        </span>
      </div>
      <div className="mb-2 border-t border-[var(--c-border)] pt-1">
        <label className="text-xs font-semibold uppercase text-[var(--c-text-dim)]" htmlFor="programming-project-functional-tags">
          {pick('Nhóm chức năng', 'Functional tags')}
        </label>
        <input
          id="programming-project-functional-tags"
          value={functionalTags}
          readOnly={!canEdit}
          onChange={(event) => onFunctionalTagsChange(event.target.value)}
          placeholder={pick('AHU, Nhiệt độ gió cấp', 'AHU, Supply air temperature')}
          className="mt-1 w-full rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1 text-xs text-[var(--c-text)]"
        />
        {canEdit && (
          <Button className="mt-1" size="sm" variant="ghost" loading={saving} onClick={() => void onSaveFunctionalTags()}>
            {pick('Lưu nhóm', 'Save tags')}
          </Button>
        )}
      </div>
      <div role="tree" aria-label={pick('Cây chương trình theo nhóm chức năng', 'Program tree by functional group')} className="border-t border-[var(--c-border)] pt-1">
        <div
          role="treeitem"
          aria-level={1}
          aria-expanded={applicationExpanded}
          aria-controls="programming-explorer-application-children"
          aria-label={`Application ${projectName}`}
          onClick={() => setApplicationExpanded((expanded) => !expanded)}
        >
          <button
            type="button"
            className="flex min-h-10 w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-[var(--c-surface-2)]"
          >
            {applicationExpanded ? <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />}
            <Boxes className="h-4 w-4 shrink-0 text-[var(--c-accent)]" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--c-text-dim)]">Application</span>
              <span className="block truncate text-sm font-semibold text-[var(--c-text)]">{projectName}</span>
            </span>
          </button>
          {applicationExpanded && (
            <div id="programming-explorer-application-children" role="group" className="ml-3 border-l border-[var(--c-border)] pl-2">
            {groups.map((group) => {
              const expanded = !collapsedGroups.has(group.id)
              const childId = `programming-explorer-group-${group.id}`
              return (
                <div
                  key={group.id}
                  role="treeitem"
                  aria-level={2}
                  aria-label={pick(`${group.name}, ${group.programs.length} chương trình`, `${group.name}, ${group.programs.length} programs`)}
                  aria-expanded={expanded}
                  aria-controls={childId}
                  onClick={(event) => { event.stopPropagation(); toggleGroup(group.id) }}
                >
                  <button
                    type="button"
                    className="flex min-h-10 w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--c-surface-2)]"
                  >
                    {expanded ? <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />}
                    <FolderTree className="h-4 w-4 shrink-0 text-[var(--c-text-dim)]" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate font-medium text-[var(--c-text)]">{group.name}</span>
                    <span className="text-[10px] text-[var(--c-text-dim)]">{group.programs.length}</span>
                  </button>
                  {expanded && (
                    <div id={childId} role="group" className="ml-4 space-y-0.5 border-l border-[var(--c-border)] pl-2">
                      {group.programs.map((program) => {
                        const secondaryTags = secondaryFunctionalTags(program.functionalTags)
                        return (
                        <div
                          key={`${group.id}-${program.programId}`}
                          role="treeitem"
                          aria-level={3}
                          aria-label={`${program.name} ${program.kind} · ${program.language}`}
                          aria-current={program.programId === selectedProgramId ? 'true' : undefined}
                          className="flex items-center gap-1"
                          onClick={(event) => { event.stopPropagation(); onSelectProgram(program.programId) }}
                        >
                          <button
                            type="button"
                            className={`flex min-h-10 w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${program.programId === selectedProgramId ? 'bg-[var(--c-accent-bg)] text-[var(--c-accent)]' : 'text-[var(--c-text)] hover:bg-[var(--c-surface-2)]'}`}
                          >
                            <FileCode2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{program.name}</span>
                              <span className="flex items-center gap-1 text-[10px] text-[var(--c-text-dim)]">
                                <span>{program.kind} · {program.language}</span>
                                {secondaryTags.length > 0 && <span className="rounded border border-[var(--c-border)] px-1" title={pick(`Tag phụ: ${secondaryTags.join(', ')}`, `Additional tags: ${secondaryTags.join(', ')}`)}>+{secondaryTags.length} {pick('tag', 'tags')}</span>}
                              </span>
                            </span>
                            {runtimeConfirmed && activeProgramIds.has(program.programId) && <span className="rounded-full bg-[var(--c-good-bg)] px-1.5 py-0.5 text-[9px] font-bold text-[var(--c-good-fg)]">LIVE</span>}
                          </button>
                          {canEdit && (
                            <button type="button" className="flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded text-[var(--c-text-dim)] hover:bg-[var(--c-fault-bg)] hover:text-[var(--c-fault-fg)]" title={pick(`Xóa chương trình ${program.name}`, `Delete program ${program.name}`)} aria-label={pick(`Xóa chương trình ${program.name}`, `Delete program ${program.name}`)} onClick={(event) => { event.stopPropagation(); onRequestDelete(program.programId) }}>
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          )}
        </div>
      </div>
      {programs.length === 0 && (
        <p className="px-2 py-1.5 text-sm text-[var(--c-text-dim)]">
          {canEdit ? pick('Chưa có chương trình. Bấm + để tạo.', 'No programs yet. Click + to create one.') : pick('Chưa có chương trình.', 'No programs yet.')}
        </p>
      )}
    </>
  )
}

interface FunctionalGroup {
  id: string
  name: string
  programs: ProgrammingProgram[]
}

export function primaryFunctionalTag(programTags: string[] | undefined, projectTags: string[]): string | undefined {
  const programPrimary = programTags?.find((tag) => tag.trim())?.trim()
  if (programPrimary) return programPrimary
  // Một tag Project duy nhất là context chung rõ ràng; nhiều tag Project không
  // đủ authority để suy diễn Program thuộc nhóm nào.
  const uniqueProjectTags = [...new Map(projectTags.map((tag) => [tag.trim().toLocaleLowerCase(), tag.trim()])).values()].filter(Boolean)
  return uniqueProjectTags.length === 1 ? uniqueProjectTags[0] : undefined
}

function secondaryFunctionalTags(programTags: string[] | undefined): string[] {
  const tags = (programTags ?? []).map((tag) => tag.trim()).filter(Boolean)
  return tags.slice(1).filter((tag, index, values) => values.findIndex((item) => item.toLocaleLowerCase() === tag.toLocaleLowerCase()) === index)
}

function buildFunctionalGroups(projectTags: string[], programs: ProgrammingProgram[], unassignedLabel: string): FunctionalGroup[] {
  const names = new Map<string, string>()
  const groupOrder: string[] = []
  const addGroup = (tag: string) => {
    const name = tag.trim()
    if (!name) return
    const key = name.toLocaleLowerCase()
    if (!names.has(key)) {
      names.set(key, name)
      groupOrder.push(key)
    }
  }
  projectTags.forEach(addGroup)
  for (const program of programs) addGroup(primaryFunctionalTag(program.functionalTags, projectTags) ?? '')

  const groups = groupOrder.map((key, index) => ({ id: `tag-${index}-${key.replace(/[^a-z0-9]+/gi, '-') || 'group'}`, name: names.get(key)!, programs: [] as ProgrammingProgram[] }))
  const byKey = new Map(groups.map((group) => [group.name.toLocaleLowerCase(), group]))
  const unassigned: FunctionalGroup = { id: 'unassigned', name: unassignedLabel, programs: [] }

  for (const program of programs) {
    const primary = primaryFunctionalTag(program.functionalTags, projectTags)
    if (!primary) {
      unassigned.programs.push(program)
      continue
    }
    byKey.get(primary.toLocaleLowerCase())?.programs.push(program)
  }
  return [...groups.filter((group) => group.programs.length > 0), ...(unassigned.programs.length > 0 ? [unassigned] : [])]
}
