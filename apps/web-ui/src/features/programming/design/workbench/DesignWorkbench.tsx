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
/**
 * `DEV-PROG-003` — mẫu để vẽ xu hướng, hoặc `null` nếu không vẽ được.
 *
 * `invalid` KHÔNG bao giờ thành một điểm trên đường: một giá trị không đọc được
 * mà bị vẽ thành 0 sẽ tạo ra một cú rơi thẳng đứng trông hệt như thiết bị vừa
 * tắt — đúng kiểu kết luận sai mà luật "null không bao giờ thành 0" tồn tại để
 * chặn. BOOL quy về 0/1 vì đó là biểu diễn thật của nó ở lớp điều khiển.
 */
function trendSample(value: unknown, state: 'live' | 'uncertain' | 'stale' | 'invalid'): number | null {
  if (state === 'invalid') return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  return null
}

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
  watchAddRequest,
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
  /** `DEV-PROG-003` — chuyển tiếp yêu cầu theo dõi biến tới khay Watch. */
  watchAddRequest?: { name: string; nonce: number } | null
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
      /* `DEV-PROG-017` — từng chỗ dùng kèm dòng và đoạn mã của dòng đó. Cắt
         120 ký tự: một dòng ST dài hơn thế trong khay rộng ~700 px chỉ tràn ra,
         và phần đuôi không giúp nhận ra dòng nào. */
      occurrences: entry.occurrences.map((item) => {
        const lineStart = source.lastIndexOf('\n', item.offset - 1) + 1
        const lineEnd = source.indexOf('\n', item.offset)
        return {
          line: source.slice(0, item.offset).split('\n').length,
          role: item.role,
          preview: source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd).trim().slice(0, 120),
          onJump: () => onJumpToOffset(item.offset, entry.name.length),
        }
      }),
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

  /* Kiểu dữ liệu của biến KHÔNG có trong snapshot runtime — Core trả giá trị,
   * không trả khai báo. Tra từ chính chỉ mục ký hiệu của POU đang mở là đọc từ
   * nguồn thật (mã nguồn), không phải suy từ hình dạng giá trị: `0` có thể là
   * INT, REAL hay một BOOL đã bị ép kiểu, và đoán sai kiểu ở đây sẽ dẫn người
   * chỉnh định tới một kết luận sai về tràn số. */
  const typeByName = useMemo(() => {
    if (source === null) return new Map<string, string>()
    return new Map(buildStReferenceIndex(source).symbols.map((entry) => [entry.name, entry.typeName]))
  }, [source])

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
            quality: item.quality,
            unit: item.unit,
            ...(typeByName.get(item.variableName) ? { typeName: typeByName.get(item.variableName) } : {}),
            ...(item.observedAt ? { observedAt: item.observedAt } : {}),
            numeric: trendSample(item.value, presented.state),
          }
        })
      : []

  return (
    <ProgrammingWorkbench
      mode={mode}
      watch={watch}
      traceOwnerHref={traceOwnerHref}
      watchAddRequest={watchAddRequest}
      sourceLabel={sourceLabel}
      problems={problems}
      symbols={symbols}
      source={source}
      onJumpToOffset={onJumpToOffset}
      checkOwnerHref={checkOwnerHref}
    />
  )
}
