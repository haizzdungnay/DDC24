import { useMemo } from 'react'
import { useI18n } from '../../../../shared/i18n'
import { buildStReferenceIndex } from '../editor/stReferenceIndex'
import { fbdIssueTargets } from '../../fbd/issueTargets'
import { validateFbdDocument, type FbdDocument } from '../../fbd/model'
import type { ProgrammingDraftDocument } from '../../model/types'
import { presentStRuntimeValue, type StRuntimeOverlayState } from '../editor/StRuntimeValueOverlay'
import { ProgrammingWorkbench, type WorkbenchMode, type WorkbenchProblem, type WorkbenchSymbol, type WorkbenchWatchRow } from './ProgrammingWorkbench'

/**
 * `T59-807` — chỗ dựng dữ liệu cho workbench của PGM-02.
 *
 * Tách khỏi `DesignWorkspacePage` vì trang đó có early return (`loading`,
 * `error`) TRƯỚC chỗ biết được POU nào đang mở. Đặt `useMemo` sau early return
 * là vi phạm luật hook — React ném "Rendered more hooks than during the
 * previous render" ngay lần đầu Draft tải xong. Một component con render sau
 * mọi guard thì có vòng đời hook của riêng nó.
 */
export function DesignWorkbench({
  mode,
  document,
  source,
  sourceLabel,
  checkOwnerHref,
  onSelectProgram,
  onJumpToOffset,
  runtimeOverlay,
  traceOwnerHref,
}: {
  mode: WorkbenchMode
  document: ProgrammingDraftDocument
  source: string | null
  sourceLabel: string
  checkOwnerHref: string
  onSelectProgram: (programId: string | undefined) => void
  onJumpToOffset: (offset: number, length: number) => void
  /**
   * Lớp giá trị của POU đang mở, chiếu từ **chính** snapshot trang cha đã poll.
   * `undefined` = chế độ hiện tại không có nguồn giá trị nào (EDIT).
   */
  runtimeOverlay?: StRuntimeOverlayState
  traceOwnerHref?: string
}) {
  const { pick } = useI18n()

  const symbols = useMemo<WorkbenchSymbol[]>(() => {
    if (source === null) return []
    return buildStReferenceIndex(source).symbols.map((entry) => ({
      name: entry.name,
      typeName: entry.typeName,
      kindLabel: entry.kind === 'FB_INSTANCE' ? pick('instance FB', 'FB instance') : pick('biến', 'variable'),
      reads: entry.occurrences.filter((item) => item.role === 'READ').length,
      writes: entry.occurrences.filter((item) => item.role === 'WRITE').length,
      onJump: () => onJumpToOffset(entry.declarationOffset, entry.name.length),
    }))
    /* `onJumpToOffset` cố ý KHÔNG nằm trong deps: nó là callback dựng mới mỗi
     * render ở trang cha, đưa vào đây thì memo không bao giờ trúng. Closure vẫn
     * đúng vì nó chỉ đọc POU đang mở, mà đổi POU thì `source` đã đổi theo. */
  }, [source, pick])

  /* Vấn đề của CẢ Project, không chỉ POU đang mở: khay lỗi trong editor FBD chỉ
   * thấy tài liệu nó đang vẽ, nên một POU khác hỏng vẫn im lặng cho tới lúc
   * Check đỏ. Nhảy ở đây là CHỌN đúng POU — chính xác tới mức trang này biết,
   * và không giả vờ biết hơn (vị trí trong sơ đồ thuộc canvas của POU đó). */
  const problems = useMemo<WorkbenchProblem[]>(() => {
    const output: WorkbenchProblem[] = []
    for (const program of document.programs) {
      if (program.language !== 'FBD') continue
      let parsed: FbdDocument | null = null
      try {
        parsed = typeof program.document === 'string' ? (JSON.parse(program.document) as FbdDocument) : null
      } catch {
        parsed = null
      }
      if (!parsed || !Array.isArray(parsed.networks)) {
        output.push({
          id: `${program.programId}:parse`,
          code: 'FBD-SCHEMA-JSON-001',
          detail: pick('Tài liệu FBD không đọc được.', 'The FBD document cannot be parsed.'),
          jumpLabel: program.name,
          onJump: () => onSelectProgram(program.programId),
        })
        continue
      }
      for (const target of fbdIssueTargets(parsed, validateFbdDocument(parsed))) {
        output.push({
          id: `${program.programId}:${target.issue.code}:${target.issue.path}`,
          code: target.issue.code,
          detail: target.issue.path,
          jumpLabel: target.label ? `${program.name} › ${target.label}` : program.name,
          onJump: () => onSelectProgram(program.programId),
        })
      }
    }
    return output
    /* `onSelectProgram` không nằm trong deps vì cùng lý do như trên; nó chỉ
     * chuyển hướng theo `programId` đã chốt lúc dựng danh sách. */
  }, [document.programs, pick])

  /* Chiếu overlay thành dòng Watch. `presentStRuntimeValue` là nơi DUY NHẤT
   * biết luật "null/BAD/OFFLINE không bao giờ thành 0"; diễn giải lại ở đây là
   * dựng một bản luật thứ hai có thể lệch. */
  const watch: WorkbenchWatchRow[] | null = runtimeOverlay === undefined
    ? null
    : runtimeOverlay.status === 'ready'
      ? runtimeOverlay.items.map((item) => {
          const presented = presentStRuntimeValue(item)
          return {
            variableId: item.variableId,
            name: item.variableName,
            display: presented.displayValue,
            state: presented.state,
            unit: item.unit,
          }
        })
      : []

  return (
    <ProgrammingWorkbench
      mode={mode}
      watch={watch}
      traceOwnerHref={traceOwnerHref}
      sourceLabel={sourceLabel}
      problems={problems}
      symbols={symbols}
      source={source}
      onJumpToOffset={onJumpToOffset}
      checkOwnerHref={checkOwnerHref}
    />
  )
}
