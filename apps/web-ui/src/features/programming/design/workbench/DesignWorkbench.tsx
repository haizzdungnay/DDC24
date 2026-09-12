import { useMemo } from 'react'

/** Hằng số module để tham chiếu ổn định giữa các lần render — mảng literal mặc
 * định sẽ làm mọi `useMemo` phụ thuộc nó trượt ở mỗi render. */
const EMPTY_CHECK_DIAGNOSTICS: readonly ProgrammingDiagnostic[] = []
import { useI18n } from '../../../../shared/i18n'
import { buildStReferenceIndex } from '../editor/stReferenceIndex'
import { fbdIssueTargets } from '../../fbd/issueTargets'
import { validateFbdDocument, type FbdDocument } from '../../fbd/model'
import { readFbdDocument } from '../../fbd/readDocument'
import type { FbdSelection } from '../../fbd/commands'
import type { ProgrammingDiagnostic, ProgrammingDraftDocument } from '../../model/types'
import { presentStRuntimeValue, type StRuntimeOverlayState, type StRuntimeQuality } from '../editor/StRuntimeValueOverlay'
import type { FbdCanvasBridge } from './WorkbenchMinimapPanel'
import { ProgrammingWorkbench, type WorkbenchMode, type WorkbenchProblem, type WorkbenchSymbol, type WorkbenchWatchRow } from './ProgrammingWorkbench'

function copyFbdSelection(selection: FbdSelection): FbdSelection {
  return selection.kind === 'multi-node'
    ? { ...selection, nodeIds: [...selection.nodeIds] }
    : { ...selection }
}

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
  simulationWatch,
  document,
  source,
  sourceLabel,
  checkOwnerHref,
  onSelectProgram,
  onJumpToOffset,
  runtimeOverlay,
  traceOwnerHref,
  watchAddRequest,
  checkDiagnostics = EMPTY_CHECK_DIAGNOSTICS,
  hasCheckResult = false,
  checkRevisionId = null,
  onJumpToDiagnostic,
  onJumpToFbdSelection,
  fbdBridge,
}: {
  mode: WorkbenchMode
  document: ProgrammingDraftDocument
  source: string | null
  sourceLabel: string
  checkOwnerHref: string
  onSelectProgram: (programId: string | undefined) => void
  onJumpToOffset: (offset: number, length: number) => void
  fbdBridge?: FbdCanvasBridge | null
  /**
   * Lớp giá trị của POU đang mở, chiếu từ **chính** snapshot trang cha đã poll.
   * `undefined` = chế độ hiện tại không có nguồn giá trị nào (EDIT).
   */
  runtimeOverlay?: StRuntimeOverlayState
  /**
   * `T59-816` — lớp giá trị của phiên MÔ PHỎNG.
   *
   * Tách khỏi `runtimeOverlay` một cách có chủ ý: hai nguồn này không bao giờ
   * được cộng vào nhau. Giá trị mô phỏng và giá trị của gói đang chạy trông
   * giống hệt nhau trên màn hình, và trộn chúng là cách người trực ca đọc một
   * con số mô phỏng như thể tủ đang cho ra con số đó.
   */
  simulationWatch?: readonly { observationId: string; name: string; value: unknown;
    quality: string; dataType: string }[] | null
  traceOwnerHref?: string
  /** `DEV-PROG-003` — chuyển tiếp yêu cầu theo dõi biến tới khay Watch. */
  watchAddRequest?: { name: string; nonce: number } | null
  /** `ISS-STED-05` — diagnostic của Check gần nhất, nguồn DUY NHẤT cho POU ST.
   *
   * Không dựng bộ kiểm thứ hai ở FE: POU FBD được validate cấu trúc phía FE vì
   * FBD là đồ thị mà FE tự đọc được, còn ST cần compiler thật. Bịa một bộ phân
   * tích ST ở FE sẽ tạo ra một nguồn sự thật thứ hai, và nó sẽ lệch khỏi
   * compiler đúng vào lúc người dùng cần tin nó nhất. */
  checkDiagnostics?: readonly ProgrammingDiagnostic[]
  /** Đã có kết quả Check nào chưa — để trạng thái rỗng phân biệt được "chưa
   * kiểm tra" với "đã kiểm tra, không có lỗi". */
  hasCheckResult?: boolean
  checkRevisionId?: string | null
  /** Nhảy tới một diagnostic: chọn đúng POU RỒI neo đúng dòng/cột. */
  onJumpToDiagnostic?: (diagnostic: ProgrammingDiagnostic) => void
  /** Chỉ được cấp khi caller có thể chọn đúng POU rồi truyền exact canonical
   * selection xuống canvas; thiếu callback thì diagnostic FBD giữ dạng text. */
  onJumpToFbdSelection?: (programId: string, selection: FbdSelection) => void
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
      /* `ISS-STED-05` — POU ST cũng có mục ở đây.
       *
       * Trước đây `if (program.language !== 'FBD') continue` bỏ qua MỌI POU ST,
       * nên người dùng ST đọc "không có mục nào" thành "không có lỗi" — một
       * kết luận sai mà giao diện không cho họ cách nào phát hiện.
       *
       * Nguồn cho ST là diagnostic Check (ISS-STED-04), KHÔNG phải một bộ kiểm
       * thứ hai ở FE. */
      if (program.language !== 'FBD') {
        for (const diagnostic of checkDiagnostics) {
          if (diagnostic.location?.programId !== program.programId) continue
          const line = diagnostic.location?.line
          const column = diagnostic.location?.column
          const position = typeof line === 'number'
            ? pick(`dòng ${line}${typeof column === 'number' ? `, cột ${column}` : ''}`,
                   `line ${line}${typeof column === 'number' ? `, col ${column}` : ''}`)
            : pick('không rõ vị trí', 'position unknown')
          output.push({
            id: `${program.programId}:${diagnostic.detailCode ?? diagnostic.code}:${line ?? 0}:${column ?? 0}`,
            code: diagnostic.detailCode ?? diagnostic.code,
            detail: diagnostic.message ?? position,
            severity: diagnostic.severity,
            jumpLabel: `${program.name} › ${position}`,
            onJump: onJumpToDiagnostic ? () => onJumpToDiagnostic(diagnostic) : undefined,
          })
        }
        continue
      }
      const parsedResult = readFbdDocument(program.document)
      if (!parsedResult.ok) {
        output.push({
          id: `${program.programId}:parse`,
          code: 'FBD-SCHEMA-JSON-001',
          detail: pick('Tài liệu FBD không đọc được.', 'The FBD document cannot be parsed.'),
          /* Không có graph hợp lệ để neo. Gắn tên POU vào `jumpLabel` sẽ làm
           * ProblemsDrawer trình bày mục này như một điều khiển có thể nhảy,
           * dù không có callback và không có đích chính xác. */
          jumpLabel: null,
        })
        continue
      }
      const parsed: FbdDocument = parsedResult.document
      for (const target of fbdIssueTargets(parsed, validateFbdDocument(parsed))) {
        const selection = target.selection
        const jumpToSelection = onJumpToFbdSelection
        const onJump = selection && jumpToSelection
          ? () => {
              onSelectProgram(program.programId)
              /* Mỗi lần click phải là một focus request mới. Nếu tái dùng
               * object từ memo, chuỗi A → người dùng chọn B → click lại A sẽ
               * không kích hoạt effect `[focusSelection]` của editor. */
              jumpToSelection(program.programId, copyFbdSelection(selection))
            }
          : undefined
        output.push({
          id: `${program.programId}:${target.issue.code}:${target.issue.path}`,
          code: target.issue.code,
          detail: target.issue.path,
          jumpLabel: onJump && target.label ? `${program.name} › ${target.label}` : null,
          onJump,
        })
      }
    }
    return output
  }, [document.programs, pick, checkDiagnostics, onJumpToDiagnostic, onJumpToFbdSelection, onSelectProgram])

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
  /* `T59-816` — ở SIMULATE, khay Watch đọc khung của phiên. `presentStRuntimeValue`
     vẫn là nơi duy nhất quyết định cách trình bày, nên một giá trị `UNAVAILABLE`
     của mô phỏng hiện `—` giống hệt một giá trị runtime không đọc được — không
     có đường nào nó thành `0`. */
  const simulationRows: WorkbenchWatchRow[] | null = useMemo(() => {
    if (simulationWatch === undefined || simulationWatch === null) return null
    return simulationWatch.map((row) => {
      /* Ánh xạ chất lượng của worker sang bảng runtime. `UNAVAILABLE` của mô
       * phỏng nghĩa là "chưa tính được ở nhịp này" — đúng nghĩa `BAD` ở bảng
       * kia, và cả hai đều phải hiện `—`. Mô phỏng KHÔNG có khái niệm cũ/mới:
       * khung nào cũng là khung mới nhất của đồng hồ ảo, nên `freshness` luôn
       * `LIVE` chứ không phải một phỏng đoán theo thời gian tường. */
      const quality: StRuntimeQuality = row.quality === 'GOOD' ? 'GOOD'
        : row.quality === 'UNCERTAIN' ? 'UNCERTAIN' : 'BAD'
      const presented = presentStRuntimeValue({
        variableId: row.observationId, variableName: row.name, value: row.value,
        valid: row.quality !== 'UNAVAILABLE',
        quality, freshness: 'LIVE',
      })
      return {
        variableId: row.observationId,
        name: row.name,
        display: presented.displayValue,
        state: presented.state,
        quality,
        typeName: row.dataType,
        numeric: trendSample(row.value, presented.state),
      }
    })
  }, [simulationWatch])

  const watch: WorkbenchWatchRow[] | null = simulationRows !== null
    ? simulationRows
    : runtimeOverlay === undefined
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
      problemsEmptyState={hasCheckResult ? 'no-problems' : 'not-checked'}
      problemsRevisionId={checkRevisionId}
      symbols={symbols}
      source={source}
      onJumpToOffset={onJumpToOffset}
      checkOwnerHref={checkOwnerHref}
      fbdBridge={fbdBridge}
    />
  )
}
