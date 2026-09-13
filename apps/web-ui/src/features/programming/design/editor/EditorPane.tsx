import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AlignLeft, ClipboardCheck, Command, GitCompare, Library, Maximize2, Minimize2, PlusSquare, Redo2, Save, Search, Undo2, X } from 'lucide-react'
import { useI18n } from '../../../../shared/i18n'
import { Button } from '../../../../shared/components/Button'
import { FbdEditorPane } from './FbdEditorPane'
import type { FbdSelection } from '../../fbd/commands'
import { readFbdDocument } from '../../fbd/readDocument'
import type { FbdNodeEditorTarget } from '../../fbd/nodeEditor'
import { FbdNodeInspector } from '../../fbd/FbdNodeInspector'
import { ContextInspector } from '../inspector/ContextInspector'
import { stSymbolContextFor } from '../inspector/inspectorContext'
import { hashBufferSource } from '../../shared/diagnosticFreshness'
import { stCheckProvenance, type StCheckProvenanceState } from './stCheckProvenance'
import type { UserPouInterface } from '../../fbd/userPou'
import { useLazyProgrammingLibraryCatalog, useLazyProgrammingPointCatalog } from '../../api/queries'
import type {
  ProgrammingCheckSymbol,
  ProgrammingDiagnostic,
  ProgrammingDraftDocument,
  ProgrammingDraftOperation,
  ProgrammingPointCatalogEntry,
  ProgrammingPouInterface,
  ProgrammingProgram,
  ProgrammingProgramDraftInput,
} from '../../model/types'
import {
  buildStCompletions,
  computeAutoIndent,
  createStEditorHistory,
  currentWordPrefix,
  findMatchingBracket,
  mergeDiagnosticRanges,
  recordStEditorEdit,
  redoStEditorEdit,
  scrollTopForLine,
  tokenizeStSource,
  undoStEditorEdit,
  updateStEditorSelection,
  type StCompletionItem,
  ST_TOKEN_CLASS,
  type StDiagnosticRange,
  type StTokenKind,
} from './stEditorSupport'
import { stSignatureHelp, stSignatureLabel, stSignatureParameterLabel,
  type StSignatureHelp } from './stSignatureHelp'
import { StRuntimeValueOverlay, type StRuntimeOverlayState } from './StRuntimeValueOverlay'
import { CommandPalette } from './CommandPalette'
import { InsertPointVariablePanel } from './InsertPointVariablePanel'
import { LIBRARY_DRAG_TYPE, QuickLibraryHost } from '../library/QuickLibraryPanel'
import {
  PROGRAMMING_FBD_FOUR_COLUMN_MIN_WIDTH_PX,
  useMinWidth,
} from '../../layout/useProgrammingViewport'
import { catalogEntriesOf, type CatalogEntry } from '../library/libraryCatalog'
import { insertCompatibilityStatement } from '../../library/libraryPresentation'
import { resolveLibraryInsertIntent, type LibraryInsertIntent } from '../../shared/libraryInsertIntent'
import { collectDeclaredInstances, nextInstanceName, planLibraryInsertion } from './stInstanceInsertion'
import { FbInstancePicker } from './FbInstancePicker'
import { buildStReferenceIndex, stSymbolAt, type StCursorSymbol } from './stReferenceIndex'
import { reconcileStSymbols } from './stSymbolReconciliation'
import { formatStDocument, formatStRange } from './stFormat'
import { stDropOffsetAtPoint, stHoverSymbolAtPoint, stVisualPositionAt, type StEditorTextMetrics } from './stHover'
import { PouTabBar } from './PouTabBar'
import {
  activatePouTab, closePouTab, emptyPouTabs, isPouTabMissing, openPouTab, pouTabKey,
  POU_TAB_LIMIT, type PouTabsState,
} from './pouTabs'
import { EditorStatusBar } from './EditorStatusBar'
import { stStatusFields } from './editorStatus'
import { StCodeMap, shouldShowCodeMap } from './StCodeMap'
import { StCrossReferencePanel } from './StCrossReferencePanel'
import { SelectionQuickActions } from './SelectionQuickActions'
import { useProgrammingActionAllowed } from '../../api/authorization'
import { buildCommandPaletteEntries, toggleComment, wrapInBlock, type PaletteEntry, type ProgramSymbolLike } from './quickControl'
import { collectStFunctionReturnType, collectStInterfaceVariables } from './stInterfaceVariables'
import { ProgramsWorkspace, WorkspaceResizeHandle, useProgramsWorkspaceGrid } from './ProgramsWorkspace'
import { EditorToolbar } from './EditorToolbar'


/** Nguồn chân lý DUY NHẤT cho số đo ST editor — gutter số dòng, overlay tô
 *  cú pháp, textarea, dải highlight active-line và điểm neo dropdown gợi ý
 *  ĐỀU phải dùng đúng các hằng số này, áp bằng INLINE STYLE (không qua class
 *  Tailwind `text-sm`/`leading-5`/`p-3`).
 *
 *  Lý do bắt buộc inline style — đây là nguyên nhân gốc thật của lỗi lệch
 *  dòng/nhoè chữ báo qua ảnh chụp 2026-08-17 (FE-ST-001..006), KHÔNG phải
 *  do tính sai `background-position` như bản vá trước đó tưởng: `styles.css`
 *  có rule `button, input, select, textarea { font: inherit }` nằm NGOÀI mọi
 *  `@layer` (chỉ có `@import "tailwindcss"` ở đầu file, còn lại là CSS trần).
 *  Theo CSS Cascade Layers, rule không-layer LUÔN thắng rule có layer bất kể
 *  độ đặc hiệu — nên nó âm thầm đè `text-sm`/`leading-5` của Tailwind CHỈ
 *  trên `<textarea>` (không đè `<pre>` gutter/overlay vì chúng không khớp
 *  selector đó), khiến textarea render chữ theo font-size/line-height KẾ
 *  THỪA từ phần tử cha — không phải 14px/20px như gutter/overlay giả định.
 *  Caret và vùng chọn thật của trình duyệt (do chính textarea vẽ) vì vậy
 *  lệch khỏi lưới 20px, và độ lệch CỘNG DỒN theo từng dòng — khớp chính xác
 *  hiện tượng "dòng đầu gần đúng, dòng 9-10 lệch hẳn" trong ảnh chụp. Textarea
 *  đã phải dùng inline style cho `color`/`caretColor` vì đúng lý do này (xem
 *  comment tại chỗ khai báo `style` của textarea) — nay áp dụng nhất quán
 *  cho CẢ BA lớp thay vì chỉ hai thuộc tính màu.
 *
 *  Theo khuyến nghị người dùng: KHÔNG kẻ lưới từng dòng nữa (mọi code editor
 *  chuẩn — VS Code, Sublime — chỉ highlight active-line, không kẻ toàn bộ
 *  hàng). Lưới cũ (`EDITOR_ROW_GRID`) đã bỏ hẳn. */
const EDITOR_FONT_SIZE_PX = 14
const EDITOR_ROW_HEIGHT_PX = 20
const EDITOR_PAD_TOP_PX = 12
const EDITOR_PAD_X_PX = 12
const EDITOR_GUTTER_PAD_X_PX = 8
const EDITOR_TAB_SIZE = 2
const EMPTY_USER_POU_INTERFACES: readonly UserPouInterface[] = []

/* `T59-820` — mẫu đo bề rộng ký tự cho hover. Chuỗi đủ dài để sai số làm tròn
 * của một ký tự không nhân lên thành lệch cột ở cuối dòng dài. */
/**
 * `T59-822` / `AC-PGM02-002` → `DEV-PROG-001` — chiều cao khung soạn thảo.
 *
 * `T59-822` đã bỏ chiều cao cố định 24rem vì nó không vừa màn 1280×750 và thay
 * bằng `clamp` theo viewport. Đúng hướng nhưng vẫn là một con số ĐOÁN: nó trừ
 * cứng 32rem cho chrome phía trên mà không ai đo lại khi chrome đổi.
 *
 * `DEV-PROG-001` bỏ nốt phép đoán đó — khung soạn thảo nay CO GIÃN theo chiều
 * cao còn lại thật của cột giữa.
 *
 * Vì sao đổi: workspace EDIT trước lát này xếp dọc không giới hạn (toolbar →
 * editor 288 px → danh sách `Ký hiệu & kiểu` KHÔNG chặn chiều cao → code map →
 * thanh trạng thái → tham chiếu). Đo trên bo Foxlinx 2026-08-28, viewport
 * 1280×800: tài liệu cao **2861 px** và dải tab của workbench nằm ở `y=2675`,
 * tức người dùng phải cuộn ~1900 px mới thấy Vấn đề/Tìm kiếm/Watch. Đó chính là
 * triệu chứng được báo là "tab bị sidebar che": tab không bị phủ, nó bị ĐẨY ra
 * khỏi màn hình, còn rail thì `sticky` nên vẫn nằm đó suốt lúc cuộn.
 *
 * `flex-1` chỉ có tác dụng khi cha có chiều cao xác định (`DesignWorkspacePage`
 * bọc editor + workbench trong một cột cao theo viewport). Ở màn hẹp, cha cao
 * `auto` nên `basis:0` + `min-h` cho ra đúng sàn 18rem — không bao giờ sập
 * thành một khe hai dòng.
 */
/* `DEV-PROG-021` — sàn chiều cao của chỗ gõ.
 *
 * `10rem` cũ (160 px, tám dòng) là sàn của một ô nhập, không phải của một trình
 * soạn thảo. Nâng lên `16rem` (256 px, mười hai dòng) và để workbench co lại
 * trước: khi màn hình chật, thứ bị cắt phải là nơi tra cứu chứ không phải nơi
 * làm việc. */
/* `DEV-PROG-024` — nhãn chữ của các nút PHỤ trên thanh công cụ soạn thảo.
 *
 * Đo trên Chrome thật 2026-08-29: hàng công cụ xuống 3 dòng và cao 100 px ở CẢ
 * 1280×800 lẫn 1680×812 — bằng 39% chính chỗ gõ ngay bên dưới nó. Cộng bề rộng
 * từng nút ở 1280 được 926 px trong khi cột giữa chỉ có 538 px, nên nó buộc
 * phải xuống dòng; bỏ chữ của năm nút phụ còn 571 px, vừa đúng MỘT hàng ở khổ
 * 1680 của người báo lỗi.
 *
 * `sr-only` chứ KHÔNG `hidden`: `display:none` gỡ phần tử khỏi cây trợ năng,
 * nên nút sẽ mất tên và trình đọc màn hình chỉ còn một icon câm. `sr-only` giấu
 * khỏi mắt mà giữ nguyên tên — và mỗi nút này đều đã có `title` nêu rõ phím tắt
 * cho người dùng chuột.
 *
 * Chỉ áp cho nút PHỤ: `Lưu`, `Kiểm tra`, `Khác` giữ chữ ở mọi khổ màn. Hai nút
 * đầu là hành động chính của màn hình, và một icon đĩa mềm không đáng để người
 * ta phải đoán trước khi bấm. */
const TOOLBAR_LABEL_CLASS = 'sr-only 2xl:not-sr-only'

const EDITOR_FRAME_CLASS = 'min-h-[18rem] min-w-0 flex-1 lg:min-h-[16rem]'

const HOVER_SAMPLE = '00000000000000000000'
const HOVER_METRICS: Omit<StEditorTextMetrics, 'charWidthPx'> = {
  rowHeightPx: EDITOR_ROW_HEIGHT_PX,
  padTopPx: EDITOR_PAD_TOP_PX,
  padLeftPx: EDITOR_PAD_X_PX,
  tabSize: EDITOR_TAB_SIZE,
}

interface StFormatRequest {
  programId: string
  nonce: number
}

/** Áp cho CẢ BA lớp (gutter/overlay/textarea) — chỉ khác `paddingLeft`/
 *  `paddingRight` giữa gutter (căn phải, đệm hẹp hơn) và overlay/textarea. */
const EDITOR_TEXT_METRICS: CSSProperties = {
  fontFamily: '"JetBrains Mono", "Roboto Mono", Consolas, ui-monospace, SFMono-Regular, monospace',
  fontSize: `${EDITOR_FONT_SIZE_PX}px`,
  lineHeight: `${EDITOR_ROW_HEIGHT_PX}px`,
  paddingTop: `${EDITOR_PAD_TOP_PX}px`,
  paddingBottom: `${EDITOR_PAD_TOP_PX}px`,
  tabSize: EDITOR_TAB_SIZE,
}

/**
 * Tab "Chương trình" của PGM-02 (`UJ-PROG-02`) — `ApplicationTree` + editor +
 * `Inspector`, bố cục 3 cột đúng `PROGRAMMING_UI_UX_DESIGN.md` §16.2
 * (`Cây 280 px ┬ Editor FBD/ST co giãn ┬ Inspector 308 px`, WP-11 — trước đó
 * `Inspector` (thuộc tính Program) bị đặt nằm DƯỚI editor thay vì làm cột
 * riêng, đúng finding G-7 trong gap report 2026-08-15). FBD là lối vào ưu
 * tiên (UX §16.2): `StructuredFbdEditor` sẵn có (`TASK-PROG-201`,
 * keyboard-first, undo/redo bounded) được mount thẳng ở đây, không viết
 * model/reducer/shortcut thứ hai (TASK-PROG-502).
 */

/**
 * `T59-807` / `WP-01` (phần đi cùng `WP-06`) — hai cột biên của workbench thu
 * gọn được.
 *
 * Ở 1280 px, ba cột `280px + 1fr + 308px` chỉ chừa ~690 px cho chính chỗ người
 * dùng gõ. Thu gọn một biên trả lại ~280 px cho editor — đúng thứ họ đang nhìn.
 *
 * Lớp lưới phải là chuỗi **nguyên văn** trong source: Tailwind quét tĩnh, một
 * lớp ghép bằng template string sẽ không có trong CSS build ra và cột sẽ im
 * lặng rơi về mặc định.
 */
/* `DEV-PROG-021` — bề rộng hai biên co theo màn hình.
 *
 * Đo thật ở 1280×800: `280 + 308 = 588 px` cho hai cột phụ, tức 46% màn hình,
 * và chỗ gõ còn 340 px — khoảng 38 ký tự mỗi dòng. Một dòng ST thật (`fbFanPI(
 * Enable := Running, SP := DspSetpoint, ...)`) dài hơn thế nhiều, nên người
 * dùng cuộn ngang liên tục ngay trên màn hình 1280 phổ biến nhất của tủ.
 *
 * Hai biên nay hẹp ở `lg` và chỉ nở lại từ `2xl` (≥1536 px), nơi có đủ chỗ cho
 * cả ba. Con số 44 px của cột đã thu gọn giữ nguyên — nó là bề rộng của cái
 * tay cầm, không co được nữa. */
export interface ProgramsSlotState { left: boolean; inspector: boolean }

/** Giữ contract thu gọn cũ cho test/telemetry trong khi grid mới dùng CSS vars. */
export function slotKey(slots: ProgramsSlotState): 'both-open' | 'left-closed' | 'inspector-closed' | 'both-closed' {
  if (slots.left && slots.inspector) return 'both-open'
  if (!slots.left && !slots.inspector) return 'both-closed'
  return slots.left ? 'inspector-closed' : 'left-closed'
}

const SLOT_STORAGE_KEY = 'mkddc-pgm02-slots'

/** Nhớ theo trình duyệt của từng người; hỏng storage thì mở cả hai, không ném. */
function useCollapsibleSlots(): [ProgramsSlotState, (next: ProgramsSlotState) => void] {
  const [slots, setSlots] = useState<ProgramsSlotState>(() => {
    try {
      const raw = window.localStorage.getItem(SLOT_STORAGE_KEY)
      if (!raw) return { left: true, inspector: true }
      const parsed = JSON.parse(raw) as Partial<ProgramsSlotState>
      return { left: parsed.left !== false, inspector: parsed.inspector !== false }
    } catch {
      return { left: true, inspector: true }
    }
  })
  return [slots, (next) => {
    setSlots(next)
    try { window.localStorage.setItem(SLOT_STORAGE_KEY, JSON.stringify(next)) } catch { /* riêng tư/hết quota — không chặn thao tác */ }
  }]
}

/**
 * EditorPane là bộ điều phối của cột soạn thảo và các panel phụ thuộc POU.
 * Tên export cũ `ProgramsTab` được giữ ở facade riêng để route và test hiện có
 * không phải biết chi tiết refactor G-11/G-26.
 */
export function EditorPane({
  document,
  saving,
  selectedProgramId,
  onSelectProgram,
  onSave,
  diagnostics,
  hasCheckResult = false,
  checkSymbols,
  checkState = null,
  checkRevisionId = null,
  focusDiagnostic,
  focusFbdSelection,
  onPendingOperationsChange,
  discardVersion,
  onRunCheck,
  onOpenCompare,
  checkDisabledReason,
  compareDisabledReason,
  explorerSlot,
  runtimeOverlayByProgramId,
  userPouInterfaces = EMPTY_USER_POU_INTERFACES,
  selectedPouInterface = null,
  userScope,
  forceReadOnly = false,
  onWatchVariable,
  onOpenExecutionTab,
  insertIntent = null,
  onInsertIntentResolved,
}: {
  document: ProgrammingDraftDocument
  saving: boolean
  selectedProgramId: string | undefined
  onSelectProgram: (programId: string | undefined) => void
  onSave: (operations: ProgrammingDraftOperation[]) => Promise<boolean>
  diagnostics: ProgrammingDiagnostic[]
  /** `ISS-STED-04` — đã có kết quả Check gần nhất tải về hay chưa. Phân biệt
   * "chưa kiểm tra" với "kiểm rồi, sạch"; hai câu đó nói hai điều khác hẳn. */
  hasCheckResult?: boolean
  /** `ISS-STED-13` — bảng ký hiệu compiler công bố; `undefined` = không có. */
  checkSymbols?: readonly ProgrammingCheckSymbol[]
  checkState?: string | null
  /** Revision mà kết quả Check thuộc về — nhãn bắt buộc phải nêu được. */
  checkRevisionId?: string | null
  focusDiagnostic: ProgrammingDiagnostic | null
  focusFbdSelection?: { programId: string; selection: FbdSelection } | null
  onPendingOperationsChange: (operations: ProgrammingDraftOperation[]) => void
  discardVersion: number
  /** ST Editor Quick Control đề xuất #2 (Bảng lệnh nhanh), mục "Kiểm tra": PGM-02
   *  không tự chạy Check nữa từ D-01 — chỉ điều hướng sang PGM-05 giống hệt nút
   *  "Kiểm tra" ở `DesignWorkspacePage`, nên nhận callback thay vì tự `useNavigate`
   *  (giữ `ProgramsTab` không phụ thuộc router, đúng ranh giới hiện có). */
  onRunCheck: () => void
  /** `T59-821` — mở khay So sánh (`T59-819`). `undefined` ⇒ nút nêu lý do khoá. */
  onOpenCompare?: () => void
  /** Lý do `Kiểm tra`/`So sánh` đang khoá. Nút disabled phải nêu lý do đọc được. */
  checkDisabledReason?: string | null
  compareDisabledReason?: string | null
  /**
   * `T59-822` / `AC-PGM02-002` — cây POU render vào ĐÚNG cột trái của lưới.
   *
   * Trước lát này nó là một dải NGANG phía trên lưới, cao 337 px, nên mép trên
   * trình soạn thảo rơi xuống `y=849` trên viewport 750 — người dùng phải cuộn
   * trang mới thấy chỗ mình gõ. `UX §16.2` vốn đã quy định
   * `Cây 280px ┬ Editor ┬ Inspector 308px`; đây là đưa DOM về đúng điều đó.
   *
   * Trang cha chịu trách nhiệm chỉ truyền slot này ở chế độ EDIT và KHÔNG render
   * thêm một bản nào khác — `AC-PGM02-001` đòi đúng MỘT cây POU trong DOM.
   */
  explorerSlot?: ReactNode
  /**
   * `T61-405` — ý định chèn khối do PGM-04 gửi sang qua URL.
   *
   * Nó là một LỜI ĐỀ NGHỊ, không phải một lệnh: bộ soạn thảo hỏi lại rồi mới
   * chèn. Chèn thẳng khi trang vừa mở là một thay đổi mã nguồn mà người dùng
   * không hề bấm — và họ sẽ không biết `Ctrl+Z` là để hoàn tác cái gì.
   */
  insertIntent?: LibraryInsertIntent | null
  /** Gọi khi ý định đã ngã ngũ (đã chèn, đã bỏ qua, hoặc không phân giải được),
   *  để chỗ sở hữu URL gỡ nó đi. Một ý định nằm lại trên URL sẽ mời chèn lại
   *  cùng một khối sau mỗi lần tải trang. */
  onInsertIntentResolved?: () => void
  /** T59-506: dữ liệu chỉ đọc do workspace map từ monitor authority. Không có
   * prop nghĩa là lane monitor chưa được nối, editor không dựng giá trị giả. */
  runtimeOverlayByProgramId?: Readonly<Record<string, StRuntimeOverlayState | undefined>>
  /** Interface POU typed do Draft/API cung cấp; FBD không tự parse ST để đoán pin. */
  userPouInterfaces?: readonly UserPouInterface[]
  /** Interface canonical của chính POU đang mở, dùng cho Inspector FBD/FUNCTION. */
  selectedPouInterface?: ProgrammingPouInterface | null
  /** Danh tính cục bộ để preference FBD không rò giữa các tài khoản dùng chung HMI. */
  userScope?: string
  /** Policy viewport từ route: dưới 768 px thắng cả quyền admin. */
  forceReadOnly?: boolean
  /** `DEV-PROG-003` — nháy đúp một ký hiệu trong trình soạn thảo ST để theo dõi. */
  onWatchVariable?: (name: string) => void
  /**
   * Mở màn hình cấu hình chạy (`?tab=execution`). Trang cha sở hữu URL nên nó
   * cũng sở hữu bước điều hướng này: dựng địa chỉ ở đây sẽ là nơi thứ hai biết
   * luật canonical, và nơi thứ hai luôn là nơi quên cập nhật.
   */
  onOpenExecutionTab?: () => void
}) {
  const { pick } = useI18n()
  const canEdit = useProgrammingActionAllowed('editDraft') && !forceReadOnly
  const selected = document.programs.find((program) => program.programId === selectedProgramId)

  /* `T59-818` — ngữ cảnh cho Inspector dùng chung. Hai nguồn được NÂNG lên đây
   * thay vì để Inspector tự đọc state của editor: một Inspector dùng chung mà
   * tự đọc state riêng của từng editor sẽ có hai định nghĩa "đang chọn cái gì".
   */
  const [cursorSymbol, setCursorSymbol] = useState<StCursorSymbol | null>(null)
  const [fbdSelection, setFbdSelection] = useState<FbdSelection | null>(null)
  const [fbdNodeEditorTarget, setFbdNodeEditorTarget] = useState<FbdNodeEditorTarget | null>(null)
  const [buffers, setBuffers] = useState<Record<string, string>>({})

  /* CB-2: Reset fbdNodeEditorTarget khi selected.programId đổi hoặc selected.language !== 'FBD' */
  useEffect(() => {
    setFbdNodeEditorTarget(null)
  }, [selected?.programId, selected?.language])

  /* `ISS-STED-13` — đối chiếu chỉ mục ký hiệu của FE với bảng compiler công bố.
   *
   * Tính ở ĐÂY chứ không trong `SourceEditor`: chỉ tầng này có `checkSymbols`,
   * và phán quyết phải dùng chung cho Inspector lẫn mọi nơi khác đọc chỉ mục —
   * hai phép đối chiếu song song sẽ lệch nhau đúng lúc khó thấy nhất. */
  const selectedSource = selected ? (buffers[selected.programId] ?? programSource(selected)) : ''
  const symbolReconciliation = useMemo(() => {
    if (!selected || selected.language !== 'ST') return null
    return reconcileStSymbols({
      index: buildStReferenceIndex(selectedSource),
      /* Lọc theo POU: một Check phủ nhiều POU, và so bảng của POU khác sẽ báo
       * lệch cho mọi biến — cổng kêu oan là cổng sắp bị tắt. */
      compilerSymbols: checkSymbols?.filter((symbol) => symbol.pouId === selected.programId),
      checkState,
      /* Buffer đổi kể từ lần Check ⇒ không so. `hasCheckResult` cùng
       * `checkRevisionId` là cơ chế tươi/cũ sẵn có của `ISS-STED-18`; không
       * dựng phép so thứ hai ở đây. */
      bufferChanged: !hasCheckResult || checkRevisionId === null,
      interfaceVariables: collectStInterfaceVariables(selectedSource)
        .map((variable) => ({ name: variable.name, type: variable.type, direction: variable.direction })),
    })
  }, [selected, selectedSource, checkSymbols, checkState, hasCheckResult, checkRevisionId])
  /* Tài liệu FBD của POU đang chọn, parse MỘT lần cho Inspector. Chỉ dựng khi
   * POU thật sự là FBD: parse một tài liệu ST thành FBD sẽ cho một đồ thị rỗng
   * trông hợp lệ, và Inspector sẽ nói về một sơ đồ không tồn tại. */
  const inspectorFbdDocument = useMemo(
    () => {
      if (!selected || selected.language !== 'FBD') return null
      const result = readFbdDocument(buffers[selected.programId] ?? selected.document)
      return result.ok ? result.document : null
    },
    [buffers, selected],
  )
  const [projectTagsDraft, setProjectTagsDraft] = useState(() => document.project.functionalTags.join(', '))
  const [metadataDrafts, setMetadataDrafts] = useState<Record<string, ProgramMetadataDraft>>({})

  /* `T59-821` / `UD-PROG-014` phương án B — tab đa POU, bắc qua cả ST lẫn FBD.
   *
   * Trục định danh là `objectId` (`pouTabKey`), KHÔNG phải tên POU: đổi tên
   * không được sinh tab thứ hai cho cùng một thứ, và hai POU trùng tên phải là
   * hai tab riêng. Buffer vẫn sống ở `buffers` theo POU, nên hai tab không thể
   * chia chung một buffer soạn thảo. */
  const [tabs, setTabs] = useState<PouTabsState>(emptyPouTabs)
  const [tabLimitNotice, setTabLimitNotice] = useState<string | null>(null)
  const [pendingTabClose, setPendingTabClose] = useState<{ key: string; name: string } | null>(null)

  /* Tab bẩn = POU có buffer khác nội dung đã lưu. Mô hình tab không tự biết
   * điều đó, và đoán thay nó là cách một buffer bẩn bị đóng mất. */
  const dirtyTabKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const program of document.programs) {
      const buffer = buffers[program.programId]
      if (buffer !== undefined && buffer !== programSource(program)) keys.add(pouTabKey(program))
    }
    return keys
  }, [buffers, document.programs])

  const missingTabKeys = useMemo(
    () => new Set(tabs.tabs.filter((tab) => isPouTabMissing(tab, document.programs)).map((tab) => tab.key)),
    [document.programs, tabs.tabs],
  )

  /* POU đang chọn luôn có tab. Đây là đường DUY NHẤT mở tab, nên không thể có
   * tab nào tồn tại mà không đi qua luật trần/đuổi ở `openPouTab`. */
  useEffect(() => {
    if (!selected) return
    setTabs((current) => {
      const result = openPouTab(current, selected, dirtyTabKeys)
      if (!result.ok) {
        setTabLimitNotice(pick(
          `Đã mở tối đa ${POU_TAB_LIMIT} POU và tất cả đều có thay đổi chưa lưu. Hãy lưu hoặc đóng một tab trước.`,
          `The maximum of ${POU_TAB_LIMIT} POUs is open and all have unsaved changes. Save or close a tab first.`,
        ))
        return current
      }
      setTabLimitNotice(null)
      return result.state
    })
    /* `dirtyTabKeys` cố ý KHÔNG nằm trong deps: nó đổi theo TỪNG PHÍM GÕ, và
     * chạy lại hiệu ứng này mỗi lần gõ sẽ dựng lại thứ tự dùng gần đây liên
     * tục — làm luật đuổi tab chọn nhầm nạn nhân. Nó chỉ được đọc như một ảnh
     * chụp tại lúc mở tab, đúng ngữ nghĩa cần. */
  }, [pick, selected])

  /* ST Editor Quick Control (đã duyệt) — quyết định #02: hook LAZY, không
   * fetch `GET /point-catalog` khi mở tab Chương trình; sống ở đây (cha của
   * `SourceEditor`) để cache còn nguyên khi đổi Program đang chọn. */
  const pointCatalog = useLazyProgrammingPointCatalog()
  /* `T59-820` — cùng luật nạp trễ với `pointCatalog`, và cùng sống ở cha để
   * cache không mất khi đổi POU đang chọn. Chữ ký khối trong Inspector (§9) và
   * trong tooltip hover đọc CHUNG catalog này. */
  const libraryCatalog = useLazyProgrammingLibraryCatalog(document.project.projectId)
  const libraryEntries = useMemo(() => catalogEntriesOf(libraryCatalog.items), [libraryCatalog.items])
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [slots, setSlots] = useCollapsibleSlots()
  const [formatRequest, setFormatRequest] = useState<StFormatRequest | null>(null)
  /* `DEV-PROG-002` — Thư viện nhanh sống ở CỘT PHẢI, không phải trong trình
   * soạn thảo.
   *
   * Đã thử cắm nó vào hàng ngang cạnh khung soạn thảo và đo lại trên bo: ở
   * 1440 px, ba cột `280 + 1fr + 308` cộng thêm panel 288 px làm bề rộng vùng
   * gõ còn **188 px** — hẹp hơn cả một dòng khai báo. Cột phải đã là chỗ của
   * các khay phụ trợ, nên panel về đó và trình soạn thảo giữ nguyên bề ngang.
   *
   * Chèn đi bằng YÊU CẦU có `nonce` (cùng khuôn `formatRequest`): panel không
   * biết cách chèn, và sửa buffer từ ngoài sẽ làm mất lịch sử Undo. */
  const [libraryDockOpen, setLibraryDockOpen] = useState(true)
  /* Nút mở khay Thư viện nhanh — đích trả focus khi đóng khay. Nút chỉ tồn tại
   * khi khay ĐANG ĐÓNG, nên phải đợi một nhịp render rồi mới focus được. */
  const libraryDockToggleRef = useRef<HTMLButtonElement | null>(null)
  const fbdInspectorOpenerRef = useRef<HTMLButtonElement | null>(null)
  const [fbdInspectorDrawerOpen, setFbdInspectorDrawerOpen] = useState(false)
  /* `1440` LÀ NGƯỠNG CỦA HỢP ĐỒNG, KHÔNG PHẢI MỘT LỰA CHỌN THẨM MỸ.
   *
   * `TC-FBD-RESP-001` khoá sáu mốc của shell FBD: từ `1440 px` trở lên mới có
   * đồng thời Explorer | Canvas | Thư viện nhanh | Inspector; ở `1280` và
   * `1024` cả hai khay phải ĐÓNG và chỉ còn nút mở. Hạ ngưỡng này xuống `1024`
   * làm hai khay hiện thường trực ở hai mốc mà hợp đồng nói phải đóng — cổng
   * e2e đỏ ngay, nhưng nó đã đỏ sẵn nên không ai thấy (`#665`).
   *
   * Việc hạ ngưỡng nhằm chữa một triệu chứng THẬT: sau khi dock Thư viện trong
   * canvas bị gỡ, FBD dưới `1440 px` không còn lối vào Thư viện nhanh nào.
   * Nhưng cách chữa đó đổi hợp đồng bố cục mà không đi qua quyết định sản
   * phẩm. Khoảng trống ấy được ghi thành finding riêng để chọn đường đúng
   * (khay/popover có nút mở, hay nới chính AC) thay vì để hai thứ cùng sai. */
  const fbdWideDesktop = useMinWidth(PROGRAMMING_FBD_FOUR_COLUMN_MIN_WIDTH_PX)
  /* Bản đồ mã là ĐIỀU HƯỚNG trong POU đang mở, nên nó thuộc cột trái cùng cây
   * POU — không phải một khay nữa chồng dưới chỗ gõ. Mặc định mở: nó là cách
   * nhanh nhất để đi trong một POU 400 dòng. */
  const [codeMapOpen, setCodeMapOpen] = useState(true)
  const [libraryInsertRequest, setLibraryInsertRequest] = useState<{ entry: CatalogEntry; nonce: number } | null>(null)
  /*
   * `T61-405` — phân giải ý định của PGM-04 trên danh mục ĐANG TẢI ở đây.
   *
   * Danh mục thư viện nạp TRỄ (`useLazyProgrammingLibraryCatalog`): nó chỉ được
   * gọi khi ai đó mở khay Thư viện nhanh. Một ý định tới từ PGM-04 cũng là một
   * lý do để nạp, nên hiệu ứng dưới đây đánh thức nó.
   *
   * Và trong lúc chờ, trạng thái phải là "đang nạp" chứ KHÔNG phải
   * `unknown-entry`: nói "khối này không có trong thư viện" khi thật ra chưa
   * đọc xong danh mục là một câu sai, và nó sai đúng lúc người dùng vừa bấm
   * Chèn từ màn hình Thư viện — nơi họ vừa nhìn thấy khối ấy.
   */
  const { ensureLoaded: ensureLibraryLoaded } = libraryCatalog
  useEffect(() => {
    if (!insertIntent) return
    ensureLibraryLoaded()
  }, [insertIntent, ensureLibraryLoaded])
  const libraryCatalogReady = libraryCatalog.status === 'ready'
  const insertResolution = useMemo(() => {
    if (!insertIntent) return null
    if (!libraryCatalogReady) return { status: 'loading' as const }
    /* Ba kết quả tách bạch: đúng khối đúng bản; không có khối ấy; hoặc có khối
       nhưng thuộc bản khác. Gộp hai ca xấu lại sẽ nói "không chèn được" cho hai
       nguyên nhân đòi hai hành động khác nhau của người vận hành. */
    return resolveLibraryInsertIntent(insertIntent, libraryEntries)
  }, [insertIntent, libraryCatalogReady, libraryEntries])
  /* Điều hướng chéo Program khi chọn một biến ở Bảng lệnh nhanh: đổi
   * `selectedProgramId` rồi TÁI DÙNG đúng cơ chế `focusDiagnostic` đã có
   * (D-01) — không viết thêm một prop/hiệu ứng thứ hai cho cùng việc "chọn
   * vùng theo line/column sau khi Program mới mount". */
  const [paletteJumpTarget, setPaletteJumpTarget] = useState<ProgrammingDiagnostic | null>(null)
  /* POU FBD dưới ngưỡng bốn cột: Inspector là KHAY NỔI, không phải cột. Một
     biến duy nhất cho câu hỏi đó, dùng lại ở cả class, nút mở và hành vi Escape
     — ba nơi tự suy lấy là ba nơi có thể lệch nhau. */
  const inspectorAsDrawer = selected?.language === 'FBD' && !fbdWideDesktop
  const fbdInspectorOpen = inspectorAsDrawer ? fbdInspectorDrawerOpen : slots.inspector
  /* Task 8 đã đưa Quick Library FBD thành cột thứ ba ở desktop RỘNG. Sau khi
   * tách `ProgramsTab` thành facade, điều kiện mount phải sống tại owner mới
   * này. Dưới `1440 px` FBD không dựng cột — xem chú thích `fbdWideDesktop`. */
  const libraryColumnEligible = canEdit && (
    selected?.language === 'ST'
    || (selected?.language === 'FBD' && fbdWideDesktop)
  )
  const libraryColumnOpen = libraryColumnEligible && libraryDockOpen
  const workspaceGrid = useProgramsWorkspaceGrid({
    explorerOpen: slots.left,
    libraryOpen: libraryColumnOpen,
    libraryMounted: libraryColumnEligible,
    inspectorOpen: inspectorAsDrawer ? false : slots.inspector,
  })

  useEffect(() => {
    if (selected?.language !== 'FBD' || fbdWideDesktop || !fbdInspectorDrawerOpen) return undefined
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setFbdInspectorDrawerOpen(false)
      window.setTimeout(() => fbdInspectorOpenerRef.current?.focus(), 0)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [fbdInspectorDrawerOpen, fbdWideDesktop, selected?.language])

  /**
   * Đưa con trỏ tới một offset trong POU ĐANG MỞ, từ một khay nằm ngoài trình
   * soạn thảo (Bản đồ mã ở cột trái, Tham chiếu ở cột phải).
   *
   * Tái dùng đúng cơ chế `focusDiagnostic` đã có thay vì mở một đường thứ hai
   * chọc vào `textarea`: chỉ một nơi biết cách đặt con trỏ thì chỉ có một hành
   * vi cuộn/tiêu điểm, và nó đã được kiểm bằng chính bộ test của editor.
   */
  function jumpInSelectedPou(offset: number, length: number) {
    if (!selectedProgramId) return
    const source = buffers[selectedProgramId] ?? ''
    const { line, column } = offsetToLineColumn(source, offset)
    setPaletteJumpTarget({
      code: '', severity: 'ERROR', messageKey: '',
      location: { programId: selectedProgramId, line, column, length: Math.max(1, length) },
    })
  }

  /* Quyết định #04: chỉ mục Bảng lệnh nhanh tính lại theo `buffers`/
   * `document.programs` — KHÔNG theo chuỗi tìm kiếm (đó là việc lọc rẻ ở
   * `CommandPalette`, xem `quickControl.ts`). */
  const symbolsByProgramId = useMemo(() => {
    const index: Record<string, ProgramSymbolLike[]> = {}
    for (const program of document.programs) {
      if (program.language !== 'ST') continue
      index[program.programId] = collectStSymbols(buffers[program.programId] ?? programSource(program))
    }
    return index
  }, [buffers, document.programs])

  const paletteEntries = useMemo<PaletteEntry[]>(
    () => buildCommandPaletteEntries(document.programs, symbolsByProgramId, pick)
      .filter((entry) => canEdit || entry.kind !== 'command'),
    [canEdit, document.programs, symbolsByProgramId, pick],
  )

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
      const sourceChanged = source !== programSource(program)
      const metadataChanged = !sameIdentityMetadata(metadata, metadataOf(program))
      const nextName = metadata.name.trim()
      /* `DEV-PROG-004` — chú thích đi bằng operation RIÊNG (`annotateObject`),
         không ghép vào `upsertProgram`: `upsertProgram` mang theo cả `document`
         (mã nguồn), nên nếu sửa mô tả cũng phải đi qua nó thì một buffer cũ sẽ
         ghi đè mã nguồn của phiên khác. Chỉ POU có `objectId` mới ghi được —
         document v1 không có trục định danh đó. */
      const stored = metadataOf(program)
      if (program.objectId && (metadata.description !== stored.description || metadata.access !== stored.access)) {
        operations.push({
          op: 'annotateObject',
          objectId: program.objectId,
          ...(metadata.description !== stored.description ? { description: metadata.description } : {}),
          ...(metadata.access !== stored.access ? { access: metadata.access } : {}),
        })
      }
      if (metadataChanged && isValidPouName(nextName)) {
        operations.push({
          op: 'upsertProgram',
          program: programDraftInput(program, { name: nextName, kind: metadata.kind, document: source })
        })
      } else if (sourceChanged) {
        /* Metadata không hợp lệ không được lọt qua một nút Lưu khác. Phần mã
         * nguồn vẫn có operation riêng, nên người dùng không mất edit hợp lệ
         * chỉ vì ô tên đang mang một giá trị bị backend từ chối. */
        operations.push({ op: 'replaceProgramSource', programId: program.programId, language: program.language, source })
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

  /** Chỉ transform TEXT buffer local qua `setBuffers` — không tự Lưu, không
   *  tự Kiểm tra (đúng ranh giới ST Editor Quick Control đã duyệt). */
  function handlePaletteSelect(entry: PaletteEntry) {
    if (entry.kind === 'program') {
      onSelectProgram(entry.programId)
      return
    }
    if (entry.kind === 'variable') {
      onSelectProgram(entry.programId)
      const source = buffers[entry.programId] ?? ''
      const { line, column } = offsetToLineColumn(source, entry.offset)
      setPaletteJumpTarget({
        code: '', severity: 'ERROR', messageKey: '',
        location: { programId: entry.programId, line, column, length: entry.length },
      })
      return
    }
    if (!canEdit) return
    if (entry.commandId === 'format') {
      if (!selectedProgramId) return
      /* Chuyển lệnh vào SourceEditor để đi qua cùng history/cursor pipeline
       * với nút Định dạng; sửa buffer trực tiếp ở đây sẽ biến format từ
       * Command Palette thành baseline mới và làm mất toàn bộ Undo trước đó. */
      setFormatRequest((current) => ({ programId: selectedProgramId, nonce: (current?.nonce ?? 0) + 1 }))
      return
    }
    if (entry.commandId === 'save') {
      void onSave(pendingOperations)
      return
    }
    onRunCheck()
  }

  /**
   * `DEV-PROG-026` — chế độ TOÀN MÀN HÌNH cho trình soạn thảo.
   *
   * Vì sao phải là một chế độ, không phải cắt bớt chrome cho mọi người: yêu cầu
   * là chỗ gõ phải CAO GẤP ĐÔI ở khổ màn 800–812 px, và phép cộng nói thẳng rằng
   * cắt chrome không tới được đó. Đo trên bo: chrome trang 244 px, lề đáy 24 px,
   * nên cột còn 532 px; trong cột còn dải tab POU 35 + thanh công cụ 64 + thanh
   * trạng thái 26 + khay bàn làm việc 61 + khoảng cách 16 = 202 px. Kể cả XOÁ
   * SẠCH chrome trang — thanh app, sidebar, dải ngữ cảnh, tiêu đề, hàng tab —
   * chỗ gõ cũng chỉ đạt 800 − 24 − 202 = 574 px, tức 1,86× chứ chưa phải 2×, mà
   * đổi lại là phá nát điều hướng của cả sản phẩm.
   *
   * Một chế độ bật/tắt đạt ~2,1× vì nó bỏ được CẢ chrome trang lẫn khay tra
   * cứu, và chỉ bỏ đúng lúc người ta cần. Ở chế độ thường không ai mất gì.
   *
   * `position: fixed` (không phải `height: 100vh` trong dòng chảy) để panel neo
   * theo viewport bất kể tổ tiên nào đang cuộn. Cổng e2e đo trên Chrome thật
   * chốt tỉ lệ ≥ 2×, vì một tổ tiên có `transform` sẽ âm thầm biến `fixed`
   * thành neo-theo-tổ-tiên và không assertion nào trong jsdom thấy được.
   */
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!maximized) return undefined
    /* Nền vẫn cuộn được dưới panel là cách người dùng cuộn mất ngữ cảnh mà
     * không hiểu vì sao — panel phủ kín nên họ không thấy gì đang chuyển động. */
    /* `window.document`, không phải `document`: prop `document` của component
     * này là bản nháp Project và nó che mất global — đúng chỗ TypeScript vừa
     * kêu, và là một lỗi chạy-mới-biết nếu viết bằng JavaScript. */
    const previous = window.document.body.style.overflow
    window.document.body.style.overflow = 'hidden'
    return () => { window.document.body.style.overflow = previous }
  }, [maximized])

  return (
    /* `DEV-PROG-001` — lưới ba cột nay cao đúng bằng ô mà `DesignWorkspacePage`
       cấp cho nó (`lg:h-full`), và MỖI cột tự cuộn trong lòng nó
       (`lg:min-h-0 lg:overflow-y-auto`). Trước lát này cả ba cột cùng đẩy chiều
       cao tài liệu, nên cột nào dài nhất quyết định trang dài bao nhiêu — và
       workbench dưới đáy đi theo. Dưới `lg` giữ nguyên dòng chảy dọc: màn hẹp
       không có ngân sách chiều cao để chia. */
    <ProgramsWorkspace
      style={workspaceGrid.style}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
          event.preventDefault()
          setPaletteOpen(true)
        }
      }}
    >
      {/* F-UX-15: tab con phải có mốc tiêu đề riêng trong cây heading. `<h1>`
          thuộc layout của feature, `<h2>` thuộc màn hình cha, nên tab là
          `<h3>`. Ẩn thị giác vì thanh tab đã hiện tên. */}
      <h3 className="sr-only">{pick('Chương trình', 'Programs')}</h3>
      {/* `T61-405` — băng XÁC NHẬN cho ý định chèn tới từ PGM-04.
          PGM-04 chỉ điều hướng; phép chèn — và bước Hoàn tác của nó — xảy ra Ở
          ĐÂY, sau một lần bấm tường minh. Chèn thẳng khi trang vừa mở là một
          thay đổi mã nguồn người dùng không hề yêu cầu, và họ sẽ không biết
          `Ctrl+Z` là để hoàn tác cái gì. */}
      {insertResolution && (
        <div
          role="region"
          aria-label={pick('Đề nghị chèn khối từ Thư viện', 'Block insertion proposed from the Library')}
          data-testid="programs-insert-intent"
          data-status={insertResolution.status}
          className="mb-2 flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-[var(--c-border)] p-2 text-sm lg:col-span-7"
        >
          {insertResolution.status === 'loading' ? (
            <p role="status" className="min-w-0 flex-1 text-[var(--c-text-dim)]">
              {pick('Đang nạp danh mục thư viện để xác định khối…',
                    'Loading the library catalog to identify the block…')}
            </p>
          ) : insertResolution.status === 'ready' ? (
            <div className="flex min-w-0 flex-1 flex-col">
              <p>
                {pick('Chèn khối', 'Insert block')}{' '}
                <strong>{insertResolution.entry.name}</strong>{' '}
                {selected
                  ? pick(`vào ${selected.name}?`, `into ${selected.name}?`)
                  : pick('— hãy chọn một POU trước.', '— select a POU first.')}
              </p>
              {/* `ISS-PGM04-15` — `UNKNOWN` không chặn, nhưng phải NÓI RA ngay
                  tại chỗ người dùng bấm xác nhận. Đây chính là "flow được
                  authority phê duyệt" của `AUTH-PROG-2026-08-29-PGM04-003`: một
                  lần bấm tường minh, với sự thật đang hiện trên màn hình. Bỏ
                  câu này đi thì lần bấm ấy là một lần bấm mù, và im lặng đúng
                  là cách `UNKNOWN` bị đọc thành `COMPATIBLE`. */}
              {insertCompatibilityStatement(insertResolution.entry.compatibility) && (
                <p data-testid="programs-insert-compatibility" className="text-xs text-[var(--c-warn-fg)]">
                  {pick(
                    'Máy chủ chưa đo được mức tương thích của khối này với gói đang vận hành — chưa có nghĩa là tương thích.',
                    'The server could not determine this block’s compatibility with the running package — that does not mean it is compatible.'
                  )}
                </p>
              )}
            </div>
          ) : (
            <p role="alert" className="min-w-0 flex-1 text-[var(--c-warn-fg)]">
              {insertResolution.status === 'unknown-entry'
                ? pick(
                    'Không tìm thấy khối được đề nghị trong thư viện của Project này, nên không chèn gì cả.',
                    'The proposed block is not in this project library, so nothing was inserted.'
                  )
                : insertResolution.status === 'revision-mismatch'
                  ? pick(
                      'Khối được đề nghị nay thuộc một phiên bản thư viện khác phiên bản bạn đã xem, nên không chèn gì cả.',
                      'The proposed block now belongs to a different library version than the one you viewed, so nothing was inserted.'
                    )
                  /* `T61-406` — cùng luật, đọc lại từ danh mục của MÁY CHỦ. Một
                     URL gõ tay không đi qua nút Chèn của PGM-04, nên nếu luật
                     chỉ sống ở cái nút ấy thì đường này là một cửa sau. */
                  : insertResolution.reason === 'REVIEW_REQUIRED'
                    ? pick(
                        'Khối được đề nghị đang chờ review Controls/Safety, nên không chèn gì cả.',
                        'The proposed block is awaiting Controls/Safety review, so nothing was inserted.'
                      )
                    : insertResolution.reason === 'DEPRECATED'
                      ? pick(
                          'Phiên bản thư viện của khối được đề nghị đã ngừng sử dụng, nên không chèn gì cả.',
                          'The proposed block’s library version is deprecated, so nothing was inserted.'
                        )
                      : insertResolution.reason === 'SIGNATURE_UNAVAILABLE'
                        ? pick(
                            'Không đọc được chữ ký của khối được đề nghị, nên không chèn gì cả.',
                            'The proposed block’s signature could not be read, so nothing was inserted.'
                          )
                        : pick(
                            'Gói đang vận hành pin một phiên bản khác của khối được đề nghị; cần migrate trước, nên không chèn gì cả.',
                            'The running package pins a different version of the proposed block; it needs a migration first, so nothing was inserted.'
                          )}
            </p>
          )}
          {insertResolution.status === 'ready' && (
            <Button
              size="sm"
              disabled={!selected || forceReadOnly}
              onClick={() => {
                setLibraryInsertRequest((current) => ({
                  entry: insertResolution.entry, nonce: (current?.nonce ?? 0) + 1,
                }))
                onInsertIntentResolved?.()
              }}
            >
              {pick('Chèn vào POU đang mở', 'Insert into the open POU')}
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => onInsertIntentResolved?.()}>
            {pick('Bỏ qua', 'Dismiss')}
          </Button>
        </div>
      )}
      <CommandPalette open={paletteOpen} entries={paletteEntries} onClose={() => setPaletteOpen(false)} onSelect={handlePaletteSelect} />
      {/* `T59-803`: cây POU nay do `PouExplorer` sở hữu (đúng MỘT navigation
          trong DOM). Ở đây chỉ còn thứ thuộc về Project chứ không thuộc về cây:
          nhãn chức năng và lối vào Bảng lệnh nhanh. */}
      {slots.left ? (
      <div data-testid="pou-explorer-column" className="rounded-[var(--radius)] border border-[var(--c-border)] p-2 lg:min-h-0 lg:overflow-y-auto">
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            className="rounded px-2 py-1 text-xs text-[var(--c-text-dim)] hover:text-[var(--c-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
            aria-expanded
            aria-controls="programs-slot-left"
            onClick={() => setSlots({ ...slots, left: false })}
          >
            {pick('Thu gọn cột trái', 'Collapse left column')}
          </button>
        </div>
        <div id="programs-slot-left">
        {explorerSlot}
        {/* `DEV-PROG-011` — `ProjectTagsEditor` đã rời khỏi đây. Nhãn chức năng
            thuộc về PROJECT chứ không thuộc về cây POU, và để nó dưới cây làm
            người đọc tưởng nó là nhãn của POU đang chọn. Nó nay ở cột phải,
            dưới Inspector, trong một mục gập được. */}
        <div className="mt-2 flex justify-end px-1">
          <button
            type="button"
            className="rounded p-1 text-[var(--c-text-dim)] hover:text-[var(--c-accent)]"
            title={pick('Bảng lệnh nhanh (Ctrl+P)', 'Command palette (Ctrl+P)')}
            onClick={() => setPaletteOpen(true)}
          >
            <Command className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{pick('Bảng lệnh nhanh', 'Command palette')}</span>
          </button>
        </div>
        </div>
      </div>
      ) : (
        <div data-testid="pou-explorer-column" className="rounded-[var(--radius)] border border-[var(--c-border)] p-1">
          <button
            type="button"
            className="min-h-11 w-full rounded px-1 py-2 text-[10px] leading-tight text-[var(--c-text-dim)] hover:text-[var(--c-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
            aria-expanded={false}
            aria-controls="programs-slot-left"
            onClick={() => setSlots({ ...slots, left: true })}
          >
            {pick('Mở cột trái', 'Expand left column')}
          </button>
        </div>
      )}
      <WorkspaceResizeHandle
        label={pick('Đổi kích thước cây POU', 'Resize the POU explorer')}
        panel="explorer"
        direction={1}
        onPointerDown={workspaceGrid.beginResize}
      />
      {/* `min-w-0` KHÔNG phải trang trí: ô lưới mặc định `min-width: auto`, nên
          một con rộng bên trong (canvas FBD, thanh công cụ ST, khay workbench)
          kéo track `1fr` phình ra thay vì tự cuộn — và cả trang tràn ngang.
          Đo được ở 1024 px: document 1039 px trên viewport 1024 px. Tràn ngang
          trên tủ điều khiển đẩy nút thao tác ra ngoài vùng chạm, mà người vận
          hành không có chuột để cuộn ngang. */}
      <div
        data-testid="programming-editor-column"
        data-maximized={maximized ? 'true' : 'false'}
        className={maximized
          ? 'fixed inset-0 z-40 flex min-w-0 flex-col gap-2 bg-[var(--c-bg)] p-3'
          : 'flex min-w-0 flex-col lg:min-h-0'}
        onKeyDown={(event) => {
          if (!maximized || event.key !== 'Escape') return
          /* `defaultPrevented` là điều kiện then chốt: gợi ý tự động và khay Tìm
           * đều nuốt `Escape` bằng `preventDefault()`. Không hỏi nó thì một lần
           * Escape vừa đóng gợi ý vừa thoát toàn màn hình — người dùng mất chế
           * độ đang làm việc chỉ vì muốn tắt một popup. */
          if (event.defaultPrevented) return
          event.preventDefault()
          setMaximized(false)
        }}
      >
        {inspectorAsDrawer && (
          <div className="mb-2 flex justify-end">
            <button
              ref={fbdInspectorOpenerRef}
              type="button"
              className="min-h-11 rounded border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 text-xs"
              aria-expanded={fbdInspectorDrawerOpen}
              aria-controls="programs-slot-inspector"
              onClick={() => setFbdInspectorDrawerOpen(true)}
            >
              {pick('Mở Thuộc tính', 'Open inspector')}
            </button>
          </div>
        )}
        <PouTabBar
          state={tabs}
          missingKeys={missingTabKeys}
          dirtyKeys={dirtyTabKeys}
          limitNotice={tabLimitNotice}
          onActivate={(key) => {
            setTabs((current) => activatePouTab(current, key))
            const target = document.programs.find((program) => pouTabKey(program) === key)
            // Tab trỏ tới POU đã bị xoá ở phiên khác vẫn bấm được, nhưng không
            // có gì để mở — nó ở lại để NÓI ra điều đó, không phải để mở.
            if (target) onSelectProgram(target.programId)
          }}
          /* `DEV-PROG-005` — nút `+` mở Bảng lệnh nhanh (Ctrl+P), là bộ chọn POU
             ĐÃ CÓ: nó liệt kê mọi POU của Project và chọn một mục sẽ gọi đúng
             `onSelectProgram`, tức đi qua cùng đường mở/lấy-lại-tiêu-điểm tab.
             Dựng thêm một hộp thoại chọn POU thứ hai chỉ để phục vụ một nút là
             thêm một danh sách nữa có thể lệch với cây POU. */
          onOpenPicker={() => setPaletteOpen(true)}
          onClose={(key) => {
            const tab = tabs.tabs.find((candidate) => candidate.key === key)
            const attempt = closePouTab(tabs, key, { dirty: dirtyTabKeys.has(key) })
            if (!attempt.ok) {
              setPendingTabClose({ key, name: tab?.lastKnownName ?? key })
              return
            }
            setTabs(attempt.state)
            setTabLimitNotice(null)
          }}
        />

        {pendingTabClose && (
          /* Đóng tab bẩn PHẢI xác nhận. Mất buffer im lặng là mất công việc của
             người ta cho một thao tác họ tưởng chỉ là dọn màn hình. */
          <div role="alertdialog" aria-label={pick('Xác nhận đóng tab', 'Confirm closing the tab')}
               data-testid="pou-tab-close-confirm"
               className="my-2 rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-2 text-sm">
            <p className="text-[var(--c-warn-fg)]">
              {pick(`"${pendingTabClose.name}" có thay đổi chưa lưu. Đóng tab sẽ bỏ những thay đổi đó.`,
                    `"${pendingTabClose.name}" has unsaved changes. Closing the tab discards them.`)}
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const forced = closePouTab(tabs, pendingTabClose.key, { dirty: true, confirmed: true })
                  if (forced.ok) setTabs(forced.state)
                  setPendingTabClose(null)
                  setTabLimitNotice(null)
                }}
              >
                {pick('Đóng và bỏ thay đổi', 'Close and discard')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPendingTabClose(null)}>
                {pick('Giữ lại', 'Keep')}
              </Button>
            </div>
          </div>
        )}

        {/* Ô này nhận TOÀN BỘ chiều cao còn lại của cột giữa; `min-h-0` là bắt
            buộc để con của nó được phép cuộn thay vì phình ra (DEV-PROG-001).
            `flex flex-col` cũng bắt buộc, và đây là chỗ nó từng thiếu: ô này là
            FLEX ITEM của cột (nên `flex-1`/`min-h-0` giới hạn được CHÍNH nó),
            nhưng nó lại là khối `display:block` với con của nó. `flex-1` của vỏ
            FBD bên trong vì thế không có ngữ cảnh flex nào để bám, nên vỏ ấy cao
            bằng nội dung và tràn ra ngoài. Đo tại 1680×941 trước khi sửa: ô cao
            495 px, `fbd-workspace-shell` bên trong cao 2023 px — canvas bị cắt
            mất hai phần ba, còn dải trạng thái bị đẩy hẳn khỏi màn hình. */}
        <div className="flex min-h-0 flex-1 flex-col">
        {!selected ? (
          /* `Kiểm tra` và `So sánh` có phạm vi GÓI, không phải POU. Toolbar của
             trình soạn thảo là chỗ của chúng khi đang soạn (`PGM-02A §3`),
             nhưng khoá chúng lại chỉ vì chưa ai bấm vào một POU là bắt người
             dùng chọn bừa một POU để làm một việc không liên quan tới POU nào.
             Đúng MỘT bản hiện tại mỗi thời điểm — không bao giờ hai. */
          <div className="space-y-2">
            <p className="text-sm text-[var(--c-text-dim)]">{pick('Chọn một chương trình ở cây bên trái.', 'Select a program from the tree on the left.')}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                icon={<ClipboardCheck className="h-4 w-4" aria-hidden="true" />}
                disabled={Boolean(checkDisabledReason)}
                title={checkDisabledReason ?? pick('Kiểm tra gói (mở PGM-05)', 'Check the package (opens PGM-05)')}
                onClick={onRunCheck}
              >
                {pick('Kiểm tra', 'Check')}
              </Button>
              {onOpenCompare && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<GitCompare className="h-4 w-4" aria-hidden="true" />}
                  disabled={Boolean(compareDisabledReason)}
                  title={compareDisabledReason ?? pick('So sánh với bản đang vận hành', 'Compare with the running revision')}
                  onClick={onOpenCompare}
                >
                  {pick('So sánh', 'Compare')}
                </Button>
              )}
            </div>
          </div>
        ) : selected.language === 'ST' ? (
          <SourceEditor
            program={selected}
            source={buffers[selected.programId] ?? programSource(selected)}
            canEdit={canEdit}
            saving={saving}
            onCursorSymbolChange={setCursorSymbol}
            onWatchVariable={onWatchVariable}
            libraryOpen={libraryDockOpen}
            onToggleLibrary={() => setLibraryDockOpen((open) => !open)}
            codeMapOpen={codeMapOpen}
            onToggleCodeMap={() => setCodeMapOpen((open) => !open)}
            maximized={maximized}
            onToggleMaximized={() => setMaximized((current) => !current)}
            libraryInsertRequest={libraryInsertRequest}
            libraryEntries={libraryEntries}
            onEnsureLibraryLoaded={libraryCatalog.ensureLoaded}
            onRunCheck={onRunCheck}
            onOpenCompare={onOpenCompare}
            checkDisabledReason={checkDisabledReason}
            compareDisabledReason={compareDisabledReason}
            diagnostics={diagnostics.filter((item) => item.location?.programId === selected.programId)}
            hasCheckResult={hasCheckResult}
            checkRevisionId={checkRevisionId}
            focusDiagnostic={
              paletteJumpTarget?.location?.programId === selected.programId ? paletteJumpTarget
              : focusDiagnostic?.location?.programId === selected.programId ? focusDiagnostic
              : null
            }
            onChange={(source) => setBuffers((current) => ({ ...current, [selected.programId]: source }))}
            onSave={onSave}
            pointCatalogStatus={pointCatalog.status}
            pointCatalogItems={pointCatalog.data?.items ?? []}
            pointCatalogError={pointCatalog.error}
            onEnsurePointCatalogLoaded={pointCatalog.ensureLoaded}
            runtimeOverlay={runtimeOverlayByProgramId?.[selected.programId]}
            formatRequest={formatRequest?.programId === selected.programId ? formatRequest : undefined}
          />
        ) : (
          <FbdEditorPane
            program={selected}
            source={buffers[selected.programId] ?? programSource(selected)}
            canEdit={canEdit}
            saving={saving}
            onChange={(source) => setBuffers((current) => ({ ...current, [selected.programId]: source }))}
            onSave={onSave}
            userPouInterfaces={userPouInterfaces}
            projectId={document.project.projectId}
            userScope={userScope}
            onSelectionChange={setFbdSelection}
            onNodeEditorTargetChange={setFbdNodeEditorTarget}
            focusSelection={focusFbdSelection?.programId === selected.programId ? focusFbdSelection.selection : null}
            onRunCheck={onRunCheck}
            onOpenCompare={onOpenCompare}
            checkDisabledReason={checkDisabledReason}
            compareDisabledReason={compareDisabledReason}
          />
        )}
        </div>
      </div>
      <WorkspaceResizeHandle
        label={pick('Đổi kích thước Thư viện nhanh', 'Resize the quick library')}
        panel="library"
        direction={-1}
        onPointerDown={workspaceGrid.beginResize}
      />
      <aside
        data-testid="quick-library-column"
        aria-label={pick('Thư viện nhanh', 'Quick library')}
        /* Khổ không dựng cột thì ẩn HẲN, không để lại một thanh ray rỗng:
           `TC-FBD-RESP-001` đo `quick-library-column` phải khuất ở `1280`/`1024`,
           và một `aside` rỗng cao hết cột vẫn là "hiện" với cả người dùng lẫn
           phép đo. Track tương ứng cũng về `0` (xem `libraryMounted`). */
        className={`min-w-0 lg:min-h-0 lg:overflow-y-auto ${libraryColumnEligible ? '' : 'hidden'}`}
      >
        {libraryColumnEligible && libraryDockOpen && selected ? (
          <QuickLibraryHost
            variant="docked"
            projectId={document.project.projectId}
            language={selected.language}
            onInsert={(entry) => {
              if (!canEdit) return false
              setLibraryInsertRequest((current) => ({ entry, nonce: (current?.nonce ?? 0) + 1 }))
              return true
            }}
            onClose={() => {
              setLibraryDockOpen(false)
              window.setTimeout(() => libraryDockToggleRef.current?.focus(), 0)
            }}
          />
        ) : libraryColumnEligible ? (
          <button
            ref={libraryDockToggleRef}
            type="button"
            className="flex min-h-11 w-full items-center justify-center rounded-[var(--radius)] border border-[var(--c-border)] p-2 text-xs text-[var(--c-text-dim)] hover:text-[var(--c-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
            aria-expanded={false}
            onClick={() => setLibraryDockOpen(true)}
          >
            <Library className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="ml-2 lg:sr-only">{pick('Mở Thư viện nhanh', 'Open quick library')}</span>
          </button>
        ) : null}
      </aside>
      <WorkspaceResizeHandle
        label={pick('Đổi kích thước Inspector', 'Resize the inspector')}
        panel="inspector"
        direction={-1}
        onPointerDown={workspaceGrid.beginResize}
      />
      <aside
        data-testid="inspector-column"
        /* HAI NHÁNH LOẠI TRỪ NHAU, KHÔNG PHẢI MỘT CHUỖI CHỒNG BIẾN THỂ.
         *
         * TRIỆU CHỨNG. Ở mọi khổ desktop, cột này nổi đè lên thanh hành động
         * header — nút `LIVE`/`SIMULATE`/`Details` không bấm được — và track
         * lưới 240 px dành cho nó bỏ trống thành một mảng trắng mép phải. Nó
         * cũng đè luôn lên cột Thư viện nhanh, làm Thư viện chỉ còn ~60 px đọc
         * được.
         *
         * NGUYÊN NHÂN GỐC. Bản trước viết `md:fixed` cạnh một biến thể
         * arbitrary cho 1440 px, tin
         * rằng biến thể có ngưỡng cao hơn sẽ thắng. Tailwind v4 xuất MỌI biến
         * thể breakpoint không-mặc-định (arbitrary `min-[…]` lẫn breakpoint tự
         * khai trong `@theme`) vào một cụm đứng TRƯỚC `sm/md/lg/xl` — đo được
         * 2026-09-13: cụm ấy ở thứ tự 765, `md` ở 813. Hai rule cùng khớp ở
         * ≥1440 px và cùng độ đặc hiệu, nên `md:fixed` đứng sau thắng. Đo tại
         * 1680 px: `position: fixed`, rect `x=1296 y=64 w=384 h=813`. Đổi thứ
         * tự chữ trong `className` không cứu được — CSS không đọc thứ tự ấy.
         *
         * CÁCH SỬA. Một biến JavaScript quyết chế độ, rồi mỗi chế độ có MỘT bộ
         * class không giao nhau: nhánh cột không chứa `md:` nào, nhánh khay
         * không chứa gì cho khổ ≥1440 vì nó không bao giờ chạy ở đó. Không có
         * hai rule cùng khớp thì không có gì để thua. */
        className={inspectorAsDrawer
          ? `min-w-0 ${fbdInspectorOpen ? 'md:fixed' : 'md:hidden'} md:inset-y-16 md:right-0 md:z-40 md:w-[min(24rem,100vw)] md:overflow-y-auto md:bg-[var(--c-bg)] md:p-3 md:shadow-2xl`
          : 'min-w-0 lg:min-h-0 lg:overflow-y-auto'}
        aria-label={pick('Thuộc tính', 'Inspector')}
        onKeyDown={(event) => {
          if (!inspectorAsDrawer || event.key !== 'Escape') return
          event.preventDefault()
          setFbdInspectorDrawerOpen(false)
          window.setTimeout(() => fbdInspectorOpenerRef.current?.focus(), 0)
        }}
      >
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            className="rounded px-2 py-1 text-xs text-[var(--c-text-dim)] hover:text-[var(--c-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
            aria-expanded={fbdInspectorOpen}
            aria-controls="programs-slot-inspector"
            onClick={() => {
              const nextOpen = !fbdInspectorOpen
              if (inspectorAsDrawer) setFbdInspectorDrawerOpen(nextOpen)
              else setSlots({ ...slots, inspector: nextOpen })
              if (!nextOpen && inspectorAsDrawer) {
                window.setTimeout(() => fbdInspectorOpenerRef.current?.focus(), 0)
              }
            }}
          >
            {fbdInspectorOpen ? pick('Thu gọn Thuộc tính', 'Collapse inspector') : pick('Mở Thuộc tính', 'Expand inspector')}
          </button>
        </div>
        <div id="programs-slot-inspector" hidden={!fbdInspectorOpen}>
        {selected ? (
            /* `T59-818` — khay này TỪNG có đúng hai trường (`Tên`, `Loại`), tức
               rơi trúng điều handoff §9 cấm: chiếm 300px cho hai trường. Nay nó
               là Inspector năm ngữ cảnh dùng chung ST↔FBD; phần sửa metadata vẫn
               do `ProgramsTab` sở hữu vì nó gắn với transaction Draft. */
            <ContextInspector
              /* Cả hai lối vào cấu hình chạy đều tắt khi workspace không sửa
                 được (LIVE/SIMULATE, dưới 768 px, vai không đủ quyền): vắng
                 mặt là câu trả lời cho "chế độ này không sửa", đúng
                 `AC-PGM02-006`/`T59-812`. Gỡ một lối mà để lối kia là vẫn lộ
                 nguyên đường ghi. */
              executionTabHref={canEdit
                ? `/eng/programming/programs?project=${encodeURIComponent(document.project.projectId)}&mode=EDIT&tab=execution`
                : undefined}
              onOpenExecutionTab={canEdit ? onOpenExecutionTab : undefined}
              input={{
                program: selected,
                programs: document.programs,
                /* Chu kỳ đi theo TỪNG POU (`programs[]`), không lấy từ
                   `task.periodMs` — trong Project nhiều chu kỳ, giá trị đó chỉ là
                   chu kỳ của Program đầu tiên. */
                cycleMs: selected.periodMs ?? null,
                /* `DEV-PROG-004` — tên Task đọc từ Draft; Task chưa đặt tên thì
                   truyền `null` để Inspector chỉ hiện chu kỳ. */
                taskName: document.task.name ?? null,
                /* Cổng vào/ra của POU ST, phân tích từ CHÍNH buffer đang mở (kể
                   cả phần chưa lưu) — đọc từ bản đã lưu sẽ nói sai về giao diện
                   mà người dùng vừa gõ. POU FBD chưa có đường phân tích tương
                   đương ⇒ `undefined` ⇒ Inspector nói "không xác định được". */
                parameters: selected.language === 'ST'
                  ? collectStInterfaceVariables(buffers[selected.programId] ?? programSource(selected))
                      .map((variable) => ({
                        name: variable.name,
                        direction: variable.direction === 'INOUT' ? 'IN_OUT' as const : variable.direction,
                        dataType: variable.type,
                      }))
                  : selectedPouInterface
                    ? [
                        ...selectedPouInterface.inputs.map((port) => ({ name: port.name, direction: 'INPUT' as const, dataType: port.type })),
                        ...(selectedPouInterface.outputs ?? []).map((port) => ({ name: port.name, direction: 'OUTPUT' as const, dataType: port.type })),
                      ]
                    : undefined,
                returnType: selected.language === 'ST'
                  ? collectStFunctionReturnType(buffers[selected.programId] ?? programSource(selected))
                  : selectedPouInterface?.returnType ?? null,
                /* Intent Enable/Disable sống ở API runtime-intent, chưa được nối
                   vào tab này. Để `null` ⇒ Inspector hiện "không xác định được";
                   hiện `Đã tắt` cho một thứ chưa đọc là nói dối về thiết bị. */
                enabled: null,
                cursorSymbol,
                /* `ISS-STED-12` — Draft là AUTHORITY cho Phạm vi/Khởi tạo/Điểm
                   ánh xạ/Đơn vị. Inspector không tự đọc catalog Point và không
                   tự suy phạm vi từ văn bản: hai đường sẽ lệch nhau, và lệch ở
                   đây nghĩa là Inspector nói biến nối tới một điểm mà Kiểm tra
                   không thấy.

                   Lọc theo `programId` vì hai POU được phép có biến TRÙNG TÊN;
                   không lọc thì Inspector sẽ gán điểm của POU khác cho biến đang
                   xem — sai một cách rất khó nhận ra. */
                variables: document.variables.filter((variable) => variable.programId === selected.programId),
                bindings: document.bindings,
                /* `ISS-STED-13` — phán quyết đối chiếu chỉ mục regex của FE với
                   bảng ký hiệu compiler công bố. Lệch ⇒ Inspector hạ các trường
                   suy ra từ chỉ mục xuống "không xác định được" thay vì hiển thị
                   thông tin sai. */
                reconciliation: symbolReconciliation,
                /* Trước `T59-820` khoá này không được truyền, nên trường `Chữ ký`
                   của handoff §9 luôn hiện "không xác định được" — trung thực về
                   hình thức nhưng nói "thư viện không công bố" trong khi sự thật
                   là "chưa ai hỏi thư viện". */
                catalog: libraryEntries,
                fbd: inspectorFbdDocument
                  ? { document: inspectorFbdDocument, selection: fbdSelection }
                  : null,
                runtime: runtimeOverlayByProgramId?.[selected.programId] ?? null,
              }}
              editableProgramSlot={
                (
                  <ProgramInspector
                    program={selected}
                    programs={document.programs}
                    draft={metadataDrafts[selected.programId] ?? metadataOf(selected)}
                    canEdit={canEdit}
                    saving={saving}
                    onChange={(draft) => setMetadataDrafts((current) => ({ ...current, [selected.programId]: draft }))}
                    onSave={onSave}
                  />
                )
              }
              editableFbdSlot={
                fbdNodeEditorTarget ? (
                  <FbdNodeInspector
                    target={fbdNodeEditorTarget}
                    pick={pick}
                    pointCatalogStatus={pointCatalog.status}
                    pointCatalogItems={pointCatalog.data?.items ?? []}
                    pointCatalogError={pointCatalog.error}
                    onEnsurePointCatalogLoaded={pointCatalog.ensureLoaded}
                  />
                ) : undefined
              }
            />
        ) : (
          <section className="rounded-[var(--radius)] bg-[var(--c-surface-2)] p-3">
            <h3 className="text-xs font-semibold text-[var(--c-text-dim)]">{pick('Thuộc tính', 'Inspector')}</h3>
            <p className="mt-2 text-xs text-[var(--c-text-dim)]">
              {pick('Chọn một chương trình để xem thuộc tính.', 'Select a program to see its properties.')}
            </p>
          </section>
        )}
        {/* Tham chiếu tại con trỏ: nó mô tả KÝ HIỆU ĐANG CHỌN, đúng loại thông
            tin mà cột Thuộc tính đã sở hữu. Để nó dưới chỗ gõ như trước làm cột
            giữa dài ra và tách nó khỏi phần Inspector nói về chính ký hiệu đó. */}
        {selected && selected.language === 'ST' && (
          <div className="mt-2">
            <StCrossReferencePanel
              cursorSymbol={cursorSymbol}
              note={null}
              onJump={(offset, length) => jumpInSelectedPou(offset, length)}
            />
          </div>
        )}
        {/* `DEV-PROG-011` — nhãn chức năng của PROJECT. Gập lại theo mặc định:
            nó là cấu hình đặt một lần, không phải thứ đọc trong lúc soạn. */}
        <details className="mt-2 border-t border-[var(--c-border)]/70 pt-2">
          <summary className="cursor-pointer text-xs font-semibold text-[var(--c-text-dim)]">
            {pick('Nhãn chức năng (Project)', 'Functional tags (project)')}
          </summary>
          <ProjectTagsEditor
            canEdit={canEdit}
            value={projectTagsDraft}
            saving={saving}
            onChange={setProjectTagsDraft}
            onSave={() => onSave([{ op: 'setFunctionalTags', tags: parseTags(projectTagsDraft) }])}
          />
        </details>
        </div>
      </aside>
    </ProgramsWorkspace>
  )
}

/**
 * `T59-820` / `PGM-02A §4` — thẻ chú giải ký hiệu khi rê chuột.
 *
 * Nội dung dựng bằng **đúng** hàm mà `ContextInspector` dùng
 * (`stSymbolContextFor`), không phải một bản phân giải thứ hai. Hai đường sẽ
 * lệch nhau đúng lúc khó thấy nhất — một định danh mà thư viện không công bố
 * chữ ký — và người đọc sẽ thấy khay bên phải nói một đằng, tooltip nói một nẻo
 * về cùng một cái tên.
 *
 * Mọi trường không tra được đều hiện "không xác định được". Không có `—` ngầm
 * hiểu là 0, không có kiểu mặc định.
 */
function StHoverCard({
  symbol,
  catalog,
  source,
  runtimeOverlay,
}: {
  symbol: StCursorSymbol
  catalog?: readonly CatalogEntry[]
  source: string
  runtimeOverlay?: StRuntimeOverlayState
}) {
  const { pick } = useI18n()
  const context = stSymbolContextFor({ cursorSymbol: symbol, catalog, runtime: runtimeOverlay ?? null })
  if (!context) return null
  const position = stVisualPositionAt(source, symbol.start, EDITOR_TAB_SIZE)
  const unknownLabel = pick('không xác định được', 'not determinable')

  return (
    <div
      role="tooltip"
      data-testid="st-hover-card"
      /* `pointer-events-none`: thẻ nằm ĐÈ lên chữ, nên nếu nó bắt chuột thì rê
         vào chính nó sẽ kích `onMouseLeave` của textarea và thẻ tự tắt — nhấp
         nháy vô hạn. */
      className="pointer-events-none absolute z-20 max-w-sm rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] px-2 py-1.5 text-xs shadow-lg"
      style={{
        top: `${(position.row + 1) * EDITOR_ROW_HEIGHT_PX + EDITOR_PAD_TOP_PX}px`,
        left: `${Math.min(position.column * 8.4 + EDITOR_PAD_X_PX, 320)}px`,
      }}
    >
      <p className="font-mono font-semibold text-[var(--c-text)]">{context.identifier}</p>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
        <dt className="text-[var(--c-text-dim)]">{pick('Kiểu', 'Type')}</dt>
        <dd className="text-[var(--c-text)]" data-testid="st-hover-type">
          {context.dataType.known ? context.dataType.value : unknownLabel}
        </dd>
        {/* Chữ ký chỉ có nghĩa với instance khối; hiện nó cho một biến `BOOL`
            là bày ra một ô luôn rỗng. */}
        {context.signature.known && (
          <>
            <dt className="text-[var(--c-text-dim)]">{pick('Chữ ký', 'Signature')}</dt>
            <dd className="font-mono text-[var(--c-text)]" data-testid="st-hover-signature">
              {context.signature.value}
            </dd>
          </>
        )}
        <dt className="text-[var(--c-text-dim)]">{pick('Nơi tham chiếu', 'References')}</dt>
        <dd className="text-[var(--c-text)]">
          {context.referenceCount.known ? context.referenceCount.value : unknownLabel}
        </dd>
      </dl>
      {!context.dataType.known && (
        /* Nói rõ GIỚI HẠN THẨM QUYỀN: chỉ mục này dựng từ nguồn đang gõ, không
           phải từ compiler. "Không tra được" ở đây không có nghĩa nguồn sai. */
        <p className="mt-1 text-[var(--c-text-dim)]">
          {pick('Chỉ mục dựng từ nguồn đang gõ, không phải từ compiler — Kiểm tra ở Core mới là nơi phán nguồn đúng hay sai.',
                'The index is built from the source being typed, not from the compiler — Check on the Core is what judges the source.')}
        </p>
      )}
    </div>
  )
}

/** Nhãn trạng thái kết quả Check cho POU đang mở (`ISS-STED-04`).
 *
 * Ba câu, ba tình huống KHÁC NHAU — gộp chúng lại là làm hỏng chính thứ issue
 * yêu cầu:
 *  - chưa Kiểm tra ≠ "không có lỗi". Nói "không có lỗi" khi chưa ai kiểm là
 *    khẳng định một điều chưa được xác lập.
 *  - buffer đã đổi ⇒ chạy lại Kiểm tra là đúng việc cần làm.
 *  - kết quả thuộc revision khác ⇒ chạy lại KHÔNG giúp gì; phải nói ra để người
 *    dùng không thử sai cách. */
function StCheckStateLabel({
  provenance,
  programId,
  diagnosticCount,
  pick
}: {
  provenance: StCheckProvenanceState
  programId: string
  diagnosticCount: number
  pick: (vi: string, en: string) => string
}) {
  if (provenance.freshness === 'NEVER_CHECKED') {
    return (
      <p className="text-xs text-[var(--c-text-dim)]">
        {pick('Chưa Kiểm tra — chưa có kết quả nào cho POU này.',
              'Not checked yet — no result for this POU.')}
      </p>
    )
  }

  if (provenance.freshness === 'STALE') {
    const reason = provenance.bufferChanged
      ? pick('buffer đã đổi sau Kiểm tra', 'buffer changed after the check')
      : provenance.revisionId
        ? pick(`kết quả thuộc revision ${provenance.revisionId}`, `result belongs to revision ${provenance.revisionId}`)
        : pick('kết quả thuộc revision khác', 'result belongs to another revision')
    return (
      <p className="text-xs text-[var(--c-warn-fg)]">
        {pick(`Kết quả Kiểm tra không còn khớp nội dung đang mở (${reason}) — không gạch lỗi để tránh chỉ sai dòng.`,
              `Check result no longer matches the open content (${reason}) — not marking, to avoid pointing at the wrong line.`)}
      </p>
    )
  }

  const revisionText = provenance.revisionId
    ? pick(`revision ${provenance.revisionId}`, `revision ${provenance.revisionId}`)
    : pick('revision đã niêm phong', 'the sealed revision')
  if (diagnosticCount === 0) {
    return (
      <p className="text-xs text-[var(--c-text-dim)]">
        {pick(`Kiểm tra ${revisionText}: POU này không có lỗi.`,
              `Check on ${revisionText}: no problems in this POU.`)}
      </p>
    )
  }
  return (
    /* `ISS-STED-15` — `aria-live` chứ không chỉ `aria-describedby`.
       `aria-describedby` được đọc lúc NHẬN focus. Nhưng kết quả Kiểm tra về
       khi người dùng ĐANG gõ, tức đang giữ focus — không có `aria-live` thì
       số lỗi vừa đổi không được nói ra, và người dùng screen reader phải rời
       ô gõ rồi quay lại mới biết. */
    <p
      id={`programming-st-diagnostics-${programId}`}
      role="status"
      aria-live="polite"
      className="text-xs text-[var(--c-fault-fg)]"
    >
      {pick(`${diagnosticCount} diagnostic từ Kiểm tra ${revisionText}, khớp nội dung đang mở. Chọn lỗi trong khay Vấn đề để tới đúng dòng/cột.`,
            `${diagnosticCount} diagnostic(s) from the check on ${revisionText}, matching the open content. Select one in Problems to jump to its line and column.`)}
    </p>
  )
}

export function SourceEditor({
  program,
  source,
  canEdit,
  saving,
  diagnostics,
  hasCheckResult = false,
  checkRevisionId = null,
  focusDiagnostic,
  onChange,
  onSave,
  pointCatalogStatus,
  pointCatalogItems,
  pointCatalogError,
  onEnsurePointCatalogLoaded,
  runtimeOverlay,
  formatRequest,
  onCursorSymbolChange,
  onWatchVariable,
  libraryOpen = false,
  onToggleLibrary,
  codeMapOpen = false,
  onToggleCodeMap,
  maximized = false,
  onToggleMaximized,
  libraryInsertRequest,
  libraryEntries,
  onEnsureLibraryLoaded,
  onRunCheck,
  onOpenCompare,
  checkDisabledReason,
  compareDisabledReason,
}: {
  program: ProgrammingProgram
  source: string
  canEdit: boolean
  saving: boolean
  diagnostics: ProgrammingDiagnostic[]
  hasCheckResult?: boolean
  checkRevisionId?: string | null
  focusDiagnostic: ProgrammingDiagnostic | null
  onChange: (source: string) => void
  onSave: (operations: ProgrammingDraftOperation[]) => Promise<boolean>
  /** ST Editor Quick Control đề xuất #3 (Panel chèn nhanh Point/Variable) —
   *  trạng thái/cache của `useLazyProgrammingPointCatalog`, sống ở
   *  `ProgramsTab` (cha) để không refetch khi đổi Program đang mở. */
  pointCatalogStatus: 'idle' | 'loading' | 'ready' | 'error'
  pointCatalogItems: readonly ProgrammingPointCatalogEntry[]
  pointCatalogError: string | null
  onEnsurePointCatalogLoaded: () => void
  runtimeOverlay?: StRuntimeOverlayState
  /** Lệnh Định dạng từ Command Palette cha; vẫn phải ghi history như nút local. */
  formatRequest?: StFormatRequest
  /**
   * `T59-818` — nâng ký hiệu dưới con trỏ lên cho `ContextInspector` dùng chung.
   *
   * Inspector phục vụ cả ST lẫn FBD nên nó không được tự đọc state con trỏ của
   * editor này; nếu tự đọc thì có hai nơi cùng tính "ký hiệu đang chọn" và
   * chúng sẽ lệch nhau đúng lúc con trỏ nằm ở ranh giới một định danh.
   */
  onCursorSymbolChange?: (symbol: StCursorSymbol | null) => void
  /** `DEV-PROG-003` — người dùng nháy đúp một ký hiệu và muốn theo dõi nó. */
  onWatchVariable?: (name: string) => void
  /** `DEV-PROG-002` — Thư viện nhanh (cột phải) đang mở hay không. */
  libraryOpen?: boolean
  onToggleLibrary?: () => void
  /** `DEV-PROG-001` (sửa vị trí) — Bản đồ mã nay sống ở CỘT TRÁI cùng cây POU;
   *  nút bật/tắt vẫn ở thanh công cụ nên trạng thái do cha giữ. */
  codeMapOpen?: boolean
  onToggleCodeMap?: () => void
  /** `DEV-PROG-026` — trình soạn thảo đang phủ kín viewport hay không. */
  maximized?: boolean
  onToggleMaximized?: () => void
  /**
   * `DEV-PROG-002` — yêu cầu chèn một mục thư viện, phát từ panel ở cột phải.
   * Cùng khuôn với `formatRequest`: panel KHÔNG biết cách chèn (ST dựng đoạn mã
   * tại con trỏ, FBD thêm node), nên nó gửi yêu cầu và bề mặt tự xử theo đúng
   * pipeline history/cursor của mình. Sửa buffer từ ngoài sẽ làm mất Undo.
   */
  libraryInsertRequest?: { entry: CatalogEntry; nonce: number } | null
  /** `T59-820` — catalog thư viện đã nạp, dùng CHUNG với Inspector. */
  libraryEntries?: readonly CatalogEntry[]
  onEnsureLibraryLoaded?: () => void
  /** `T59-821` — `Kiểm tra` đi thẳng sang PGM-05, nơi SỞ HỮU `useCheckWorkflow`.
   *  Không dựng luồng seal/run/poll thứ hai ở đây (D-01). */
  onRunCheck?: () => void
  onOpenCompare?: () => void
  checkDisabledReason?: string | null
  compareDisabledReason?: string | null
}) {
  const { pick } = useI18n()
  const committed = typeof program.document === 'string' ? program.document : ''
  const dirty = source !== committed
  /* D-02: chặn lưu ST rỗng — compiler luôn Check FAILED, Save không nên để
   * người dùng tự khám phá điều đó sau một vòng round-trip mạng. */
  const isEmptySource = source.trim().length === 0
  const canSave = dirty && !isEmptySource
  /* FE-ST-008: phân biệt rõ Saved/Saving/Failed thay vì chỉ disable nút Save
   * không giải thích. `lastAttemptedSourceRef` neo trạng thái 'saved'/'failed'
   * vào ĐÚNG giá trị buffer đã thử lưu — gõ tiếp sau một lần lưu thất bại
   * phải rơi về "Chưa lưu" (ưu tiên hơn), không giữ mãi "Lưu thất bại" cho một
   * buffer đã khác. */
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'failed'>('idle')
  const lastAttemptedSourceRef = useRef<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lineGutterRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLPreElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const [cursorOffset, setCursorOffset] = useState(0)
  /* `ISS-STED-11` — `null` nghĩa là con trỏ không nằm trong lời gọi nào mà
   * registry biết. Không dùng cờ `open` riêng: một chữ ký "đang mở nhưng rỗng"
   * là trạng thái không có nghĩa gì. */
  const [signature, setSignature] = useState<StSignatureHelp | null>(null)
  const [completion, setCompletion] = useState<{ open: boolean; items: StCompletionItem[]; selected: number; anchor: number }>(
    { open: false, items: [], selected: 0, anchor: 0 },
  )
  /* ST Editor Quick Control #1 (Thanh lệnh nhanh nổi): vùng chọn KHÔNG rỗng
   * hiện tại — `null` khi con trỏ chỉ là một điểm (không hiện thanh lệnh). */
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number } | null>(null)
  const [insertPanelOpen, setInsertPanelOpen] = useState(false)
  /* `DEV-PROG-002` — trạng thái mở/đóng của Thư viện nhanh nay do `ProgramsTab`
   * sở hữu, vì panel đã ra khỏi trình soạn thảo và nằm ở cột phải. Nút trên
   * thanh công cụ vẫn là chỗ bật/tắt, nhưng nó chỉ báo lên chứ không tự giữ
   * trạng thái — hai bản trạng thái cho cùng một panel sẽ lệch nhau ngay lần
   * đầu người dùng đóng panel bằng nút `Thu gọn` của chính nó. */
  /* T59-506: một lịch sử riêng cho MỖI POU đang mount. Ref cho phép mọi đường
   * edit (gõ thường/autocomplete/Format/Replace/quick action) ghi snapshot trước
   * khi callback cha echo lại prop `source`; state rỗng chỉ dùng để render lại
   * trạng thái nút Undo/Redo. */
  const historyProgramIdRef = useRef(program.programId)
  const historyRef = useRef(createStEditorHistory(source))
  const [, bumpHistoryVersion] = useState(0)
  const symbols = useMemo(() => collectStSymbols(source), [source])
  /* `AC-ST-005` — chỉ mục tham chiếu dựng từ nguồn đang gõ. Dùng cho ĐIỀU
   * HƯỚNG (nhảy tới khai báo, đếm nơi đọc/ghi), không phải để phán nguồn
   * đúng/sai: việc đó vẫn của Check ở Core. */
  const referenceIndex = useMemo(() => buildStReferenceIndex(source), [source])
  const cursorSymbol = useMemo(
    () => stSymbolAt(source, cursorOffset, referenceIndex),
    [source, cursorOffset, referenceIndex],
  )
  /* `T59-820` / `PGM-02A §4` — hover ký hiệu.
   *
   * Không có editor engine nào ở đây, nên bề rộng ký tự phải ĐO từ DOM. Đo
   * hỏng (chưa layout, font chưa tải) ⇒ `stHoverSymbolAtPoint` trả `null` ⇒
   * không hover. Một bề rộng đoán sẽ làm tooltip chỉ vào ký hiệu KHÁC thứ chuột
   * đang trỏ, và người đọc không có cách nào biết mình đang bị chỉ sai.
   *
   * Thông tin này KHÔNG chỉ có ở hover: cùng ký hiệu đó, khi đưa con trỏ gõ
   * vào, hiện đầy đủ ở `ContextInspector`. Hover là lối tắt cho chuột, không
   * phải kênh duy nhất — bàn phím vẫn đọc được mọi thứ. */
  const hoverMeasureRef = useRef<HTMLSpanElement>(null)
  const charWidthRef = useRef(0)
  const [hoverSymbol, setHoverSymbol] = useState<StCursorSymbol | null>(null)
  /* `DEV-PROG-020` — độ cuộn của chỗ gõ.
   *
   * Popup gợi ý được đặt tuyệt đối theo `cursor.line * ROW_HEIGHT`, tức toạ độ
   * trong TOÀN BỘ văn bản. Khung soạn thảo lại là một hộp cao cố định có
   * `overflow-hidden`, nên khi người dùng cuộn xuống làm việc ở dòng 200, popup
   * được vẽ ở `top: 4000px` — nằm ngoài hộp và bị cắt sạch. Với một POU thật
   * (AHU_MasterSequence hơn 350 dòng) thì tính năng gợi ý coi như KHÔNG tồn
   * tại, và nó im lặng: không lỗi, không cảnh báo, chỉ là không có gì hiện ra.
   *
   * Bộ test cũ không bắt được vì nó gõ ở dòng 1, nơi độ cuộn luôn bằng 0. */
  const [editorScroll, setEditorScroll] = useState({ top: 0, left: 0 })
  /* `T59-821` — Code Map bật/tắt được, và từ 2026-08-30 hiện với MỌI độ dài.
   * Ngưỡng 80 dòng cũ ẩn nó im lặng: một POU ngắn nhìn từ ngoài không phân biệt
   * được với tính năng hỏng. Cổng còn lại chỉ là "có mục để chỉ tới không". */

  /* Phát ra ngoài khi ký hiệu đổi. `useEffect` chứ không gọi trong render: gọi
   * trong render sẽ set state của cha giữa lúc con đang render. */
  useEffect(() => {
    onCursorSymbolChange?.(cursorSymbol)
  }, [cursorSymbol, onCursorSymbolChange])
  const matches = useMemo(() => findTextMatches(source, searchText), [searchText, source])
  const tokens = useMemo(() => tokenizeStSource(source), [source])
  /* `ISS-STED-04` × `ISS-STED-18` — băm buffer để biết kết quả Check có còn nói
   * về nội dung đang mở không. Băm là bất đồng bộ (WebCrypto) nên chạy trong
   * effect mỗi lần buffer đổi, KHÔNG chạy trong lượt render. */
  const [bufferSha256, setBufferSha256] = useState<string | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    hashBufferSource(source)
      .then((hash) => { if (!cancelled) setBufferSha256(hash) })
      /* Không băm được (môi trường thiếu WebCrypto) ⇒ để `undefined`. Khi đó
       * `diagnosticFreshness` trả `UNVERIFIABLE` và KHÔNG gạch gì — thiếu bằng
       * chứng không phải bằng chứng khớp. */
      .catch(() => { if (!cancelled) setBufferSha256(undefined) })
    return () => { cancelled = true }
  }, [source])

  const checkProvenance = useMemo(() => stCheckProvenance({
    hasCheckResult,
    diagnostics,
    buffer: {
      revisionId: checkRevisionId ?? undefined,
      pouId: program.programId,
      sourceSha256: bufferSha256
    }
  }), [hasCheckResult, diagnostics, checkRevisionId, program.programId, bufferSha256])

  /* CHỈ gạch những mục đã chứng minh được là khớp buffer. Gạch một chỗ trên
   * buffer đã đổi là chỉ vào dòng không còn là dòng sinh ra lỗi — người dùng
   * sẽ sửa đúng chỗ bị chỉ, tức sửa một chỗ không hỏng. */
  const markableDiagnostics = checkProvenance.markable

  const diagnosticRanges = useMemo<StDiagnosticRange[]>(() => markableDiagnostics
    .map((diagnostic, index): StDiagnosticRange | null => {
      if (!diagnostic.location) return null
      const line = typeof diagnostic.location.line === 'number' ? diagnostic.location.line : undefined
      const column = typeof diagnostic.location.column === 'number' ? diagnostic.location.column : undefined
      if (line === undefined || column === undefined) return null
      const length = typeof diagnostic.location.length === 'number' ? diagnostic.location.length : 1
      const start = lineColumnToOffset(source, line, column)
      return { start, end: Math.min(source.length, start + Math.max(1, length)), index }
    })
    .filter((range): range is StDiagnosticRange => range !== null), [markableDiagnostics, source])
  const segments = useMemo(() => mergeDiagnosticRanges(tokens, diagnosticRanges), [tokens, diagnosticRanges])
  const bracketMatch = useMemo(() => findMatchingBracket(source, textareaRef.current?.selectionStart ?? -1), [source, cursor])

  function replaceHistory(next: ReturnType<typeof createStEditorHistory>) {
    historyRef.current = next
    bumpHistoryVersion((version) => version + 1)
  }

  useEffect(() => {
    if (historyProgramIdRef.current === program.programId) return
    historyProgramIdRef.current = program.programId
    replaceHistory(createStEditorHistory(source))
    setCursor({ line: 1, column: 1 })
    setSelectionRange(null)
    closeCompletion()
  }, [program.programId, source])

  /* Thay đổi prop không đi qua editor (Discard, reload hoặc command ngoài
   * editor) là một baseline mới. Echo của chính edit thì đã khớp `current` và
   * không được xóa lịch sử vừa ghi. */
  useEffect(() => {
    if (historyRef.current.current.source === source) return
    const textarea = textareaRef.current
    replaceHistory(createStEditorHistory(
      source,
      textarea?.selectionStart ?? 0,
      textarea?.selectionEnd ?? textarea?.selectionStart ?? 0,
    ))
  }, [source])

  function updateCursor() {
    const textarea = textareaRef.current
    const offset = textarea?.selectionStart ?? 0
    setCursor(offsetToLineColumn(source, offset))
    setCursorOffset(offset)
    const start = textarea?.selectionStart ?? 0
    const end = textarea?.selectionEnd ?? 0
    setSelectionRange(start === end ? null : { start, end })
    historyRef.current = updateStEditorSelection(historyRef.current, start, end)
  }

  /* `DEV-PROG-012` — hộp "Tới dòng". Mở bằng cách bấm ô `Dòng:Cột` trên thanh
   * trạng thái hoặc `Ctrl+G`. Không dùng `window.prompt`: nó chặn cả tiến
   * trình, không đi được bằng trình đọc màn hình theo cách dự đoán được, và
   * trên bo đặt trong tủ điều khiển thì hộp thoại gốc của trình duyệt nằm ngoài
   * mọi luật giao diện của sản phẩm. */
  const [goToOpen, setGoToOpen] = useState(false)
  const [goToDraft, setGoToDraft] = useState('')
  const goToInputRef = useRef<HTMLInputElement | null>(null)

  /**
   * `DEV-PROG-016` — offset văn bản dưới con trỏ của một sự kiện kéo/thả.
   *
   * Trả `null` khi chưa đo được bề rộng ký tự (font chưa tải, chưa layout):
   * đoán một bề rộng sẽ thả khối vào một dòng KHÁC dòng người dùng nhắm, và
   * chèn nhầm chỗ trong mã điều khiển tệ hơn hẳn không chèn.
   */
  function dropOffsetFrom(event: { clientX: number; clientY: number; currentTarget: HTMLTextAreaElement }): number | null {
    if (charWidthRef.current <= 0 && hoverMeasureRef.current) {
      const sample = hoverMeasureRef.current.getBoundingClientRect().width / HOVER_SAMPLE.length
      if (sample > 0) charWidthRef.current = sample
    }
    if (charWidthRef.current <= 0) return null
    const textarea = event.currentTarget
    const rect = textarea.getBoundingClientRect()
    return stDropOffsetAtPoint(
      source,
      {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        scrollLeft: textarea.scrollLeft,
        scrollTop: textarea.scrollTop,
      },
      { ...HOVER_METRICS, charWidthPx: charWidthRef.current },
    )
  }

  /** Đồng bộ hai lớp ăn theo `scrollTop`/`scrollLeft` của textarea. Dùng chung
   *  cho cả cuộn tay (`onScroll`) lẫn cuộn do mã lệnh (`revealOffset`) —
   *  gán `scrollTop` bằng mã KHÔNG bảo đảm phát sự kiện `scroll` đồng bộ, nên
   *  dựa vào `onScroll` sẽ để gutter và overlay trượt khỏi chữ trong một khung
   *  hình. */
  function syncEditorScroll(top: number, left: number) {
    setEditorScroll({ top, left })
    if (lineGutterRef.current) lineGutterRef.current.scrollTop = top
    if (overlayRef.current) {
      overlayRef.current.scrollTop = top
      overlayRef.current.scrollLeft = left
    }
  }

  /**
   * `DEV-PROG-023` — cuộn cho `offset` thật sự lọt vào tầm nhìn.
   *
   * `setSelectionRange` không cuộn: trình duyệt chỉ cuộn tới con trỏ khi CHÍNH
   * NÓ dời con trỏ. Thiếu bước này thì mọi đường "nhảy tới một chỗ trong nguồn"
   * — Bản đồ mã, kết quả Tìm kiếm, `Tiếp`, `Ctrl+G`, bấm một diagnostic — đổi
   * vùng chọn và đổi khay Dòng/cột trong khi màn hình đứng yên, đúng triệu
   * chứng người dùng báo 2026-08-29.
   */
  function revealOffset(textarea: HTMLTextAreaElement, offset: number) {
    const before = source.slice(0, offset)
    const line = before.split('\n').length
    const column = offset - (before.lastIndexOf('\n') + 1) + 1
    const top = scrollTopForLine({
      line,
      scrollTop: textarea.scrollTop,
      viewportHeightPx: textarea.clientHeight,
      contentHeightPx: textarea.scrollHeight,
      rowHeightPx: EDITOR_ROW_HEIGHT_PX,
      padTopPx: EDITOR_PAD_TOP_PX,
    })
    /* Về đầu dòng thì cũng phải về mép trái. Bản đồ mã và `Ctrl+G` luôn đáp
     * xuống cột 1; giữ nguyên `scrollLeft` cũ (có thể đang ở 400 px vì vừa đọc
     * một dòng dài) là đưa người dùng tới đúng dòng nhưng nhìn vào khoảng trắng
     * bên phải của nó. */
    const left = column === 1 ? 0 : textarea.scrollLeft
    if (top === textarea.scrollTop && left === textarea.scrollLeft) return
    textarea.scrollTop = top
    textarea.scrollLeft = left
    syncEditorScroll(top, left)
  }

  function selectRange(offset: number, length: number) {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.focus()
    textarea.setSelectionRange(offset, Math.min(source.length, offset + Math.max(1, length)))
    revealOffset(textarea, offset)
    updateCursor()
  }

  /**
   * `DEV-PROG-012` — đưa con trỏ tới đầu một dòng.
   *
   * Số dòng ngoài phạm vi bị KẸP về dòng cuối thay vì bị từ chối: người gõ
   * `9999` đang nói "xuống cuối tệp", và một thông báo lỗi ở đó chỉ bắt họ gõ
   * lại một con số họ không biết. Số không hợp lệ (chữ, số âm) thì không làm gì.
   */
  function goToLine(rawLine: string) {
    const requested = Number.parseInt(rawLine, 10)
    if (!Number.isFinite(requested) || requested < 1) return
    const lines = source.split('\n')
    const line = Math.min(requested, lines.length)
    let offset = 0
    for (let index = 0; index < line - 1; index += 1) offset += lines[index].length + 1
    setGoToOpen(false)
    selectRange(offset, 0)
  }

  useEffect(() => {
    if (!goToOpen) return
    window.setTimeout(() => goToInputRef.current?.focus(), 0)
  }, [goToOpen])

  useEffect(() => {
    if (!focusDiagnostic?.location) return
    const line = typeof focusDiagnostic.location.line === 'number' ? focusDiagnostic.location.line : 1
    const column = typeof focusDiagnostic.location.column === 'number' ? focusDiagnostic.location.column : 1
    const length = typeof focusDiagnostic.location.length === 'number' ? focusDiagnostic.location.length : 1
    selectRange(lineColumnToOffset(source, line, column), length)
  }, [focusDiagnostic])

  function closeCompletion() {
    setCompletion({ open: false, items: [], selected: 0, anchor: 0 })
  }

  /* `ISS-STED-11` — gợi ý chữ ký.
   *
   * Tách khỏi `completion` chứ không gộp: hai thứ này sống theo hai nhịp khác
   * nhau. Danh sách gợi ý đóng ngay khi gõ `(`, còn chữ ký phải SỐNG SUỐT lời
   * gọi cho tới dấu `)`. Gộp state sẽ buộc một trong hai hành xử sai. */
  function closeSignature() {
    setSignature(null)
  }

  function refreshSignature(nextSource: string, offset: number) {
    setSignature(stSignatureHelp(nextSource, offset, collectStSymbols(nextSource)))
  }

  /* WP-10 P0 (CTO/Owner approval §5): gợi ý sau MỖI keystroke dựa trên
   * `nextSource`/`offset` truyền trực tiếp từ sự kiện — không đọc `source`
   * (state cũ, chưa kịp cập nhật khi hàm này chạy trong cùng handler). */
  function refreshCompletion(nextSource: string, offset: number) {
    const info = currentWordPrefix(nextSource, offset)
    if (!info) { closeCompletion(); return }
    const items = buildStCompletions(info.prefix, collectStSymbols(nextSource))
    if (items.length === 0) { closeCompletion(); return }
    setCompletion({ open: true, items, selected: 0, anchor: info.start })
  }

  /* `<textarea value={source}>` là controlled component — React tự đồng bộ
   * `.value` từ prop `source` mỗi lần render lại. Bản trước ghi tay
   * `textarea.value = next` NGAY TRONG `applyEdit()` rồi mới gọi
   * `setCursor(...)`: `setCursor` là state cục bộ nên kích hoạt một lần
   * render lại ngay lập tức, và ở lần render đó React thấy prop `source`
   * VẪN CHƯA đổi (nó đổi qua `onChange` → state component cha, một nhịp
   * khác) nên reconciliation ghi `.value` VỀ LẠI giá trị `source` cũ —
   * xoá mất chữ vừa gõ ngay trước mắt (lộ rõ khi `onChange` không thật sự
   * cập nhật lại prop `source` đồng bộ, ví dụ test cô lập dùng `vi.fn()`
   * làm `onChange`, nhưng vẫn là rủi ro thật trong app nếu component cha
   * re-render bởi nguồn khác xen giữa). Sửa bằng `pendingCursorRef` +
   * `useLayoutEffect` không phụ thuộc gì (chạy lại sau MỌI lần commit):
   * ghi `.value`/selection SAU KHI React đã tự xử lý xong prop `source` ở
   * lần render đó — không còn ai ghi đè lại nữa, và không cần đợi
   * `requestAnimationFrame` (~16ms) như bản gốc trước ngày 2026-08-15. */
  const pendingCursorRef = useRef<{ value: string; selectionStart: number; selectionEnd: number } | null>(null)

  useLayoutEffect(() => {
    const pending = pendingCursorRef.current
    const textarea = textareaRef.current
    if (!pending || !textarea) return
    pendingCursorRef.current = null
    textarea.value = pending.value
    textarea.selectionStart = pending.selectionStart
    textarea.selectionEnd = pending.selectionEnd
  })

  /** Ghi đè bằng một VÙNG chọn (không chỉ một điểm) — dùng cho "Bọc IF"/"Ghi
   *  chú" (ST Editor Quick Control #1) để người dùng thấy ngay phần vừa đổi,
   *  thay vì con trỏ rơi về một điểm không rõ ràng. `applyEdit` (một điểm,
   *  dùng cho Enter/autocomplete/Find-Replace có sẵn) chỉ còn là trường hợp
   *  riêng của hàm này. */
  function applyEditRange(next: string, selectionStart: number, selectionEnd: number) {
    /* `T59-805` AC: LIVE và màn <768 px KHÔNG được sửa nguồn qua BẤT KỲ đường
     * nào — gõ, dán, thả tệp, IME hay lệnh. `readOnly` của textarea chặn được
     * đường trình duyệt, nhưng nó là một THUỘC TÍNH: một lần refactor quên nó
     * là mọi đường mutation mở lại cùng lúc. Đây là chốt duy nhất mà mọi đường
     * sửa (onChange, chèn, định dạng, tìm-thay, autocomplete, auto-indent) đều
     * đi qua, nên guard đặt ở đây là guard đúng chỗ. */
    if (!canEdit) return
    replaceHistory(recordStEditorEdit(historyRef.current, { source: next, selectionStart, selectionEnd }))
    pendingCursorRef.current = { value: next, selectionStart, selectionEnd }
    onChange(next)
    setCursor(offsetToLineColumn(next, selectionEnd))
    setCursorOffset(selectionEnd)
    setSelectionRange(selectionStart === selectionEnd ? null : { start: selectionStart, end: selectionEnd })
  }

  function applyEdit(next: string, newCursor: number) {
    applyEditRange(next, newCursor, newCursor)
  }

  function applyHistorySnapshot(direction: 'undo' | 'redo') {
    if (!canEdit) return
    const current = historyRef.current
    const next = direction === 'undo' ? undoStEditorEdit(current) : redoStEditorEdit(current)
    if (next === current) return
    historyRef.current = next
    bumpHistoryVersion((version) => version + 1)
    const snapshot = next.current
    pendingCursorRef.current = {
      value: snapshot.source,
      selectionStart: snapshot.selectionStart,
      selectionEnd: snapshot.selectionEnd,
    }
    onChange(snapshot.source)
    setCursor(offsetToLineColumn(snapshot.source, snapshot.selectionEnd))
    setCursorOffset(snapshot.selectionEnd)
    setSelectionRange(snapshot.selectionStart === snapshot.selectionEnd ? null : {
      start: snapshot.selectionStart,
      end: snapshot.selectionEnd,
    })
    closeCompletion()
    textareaRef.current?.focus()
  }

  /** Định dạng lại (nút "Định dạng") và "Thay tất cả" (Find & Replace) từng
   *  gọi thẳng `onChange(next)` — không qua `applyEditRange`/`pendingCursorRef`
   *  — nên sau khi bấm, `cursor` (khay Dòng/cột + dải active-line + hàng
   *  gutter tô đậm) ĐỨNG YÊN ở vị trí CŨ trong khi con trỏ DOM thật của
   *  textarea bị React/trình duyệt đặt lại (thường về offset 0) khi `.value`
   *  bị thay toàn bộ mà không có `pendingCursorRef` ghi đè — lộ đúng lỗi
   *  "chọn dòng A lại hiện dòng B" báo trực tiếp 2026-08-17: khay hiện Dòng
   *  30 trong khi con trỏ thật đã nhảy về Dòng 1. Hai hàm bên dưới ánh xạ vị
   *  trí con trỏ CŨ sang bản MỚI rồi đi qua `applyEditRange` như mọi đường
   *  sửa nội dung khác — giữ khay/høghlight luôn khớp con trỏ thật.
   *
   *  Cả hai đều gọi từ NÚT BẤM ngoài textarea nên focus lúc đó KHÔNG ở
   *  textarea — Chrome âm thầm đặt lại `selectionStart`/`selectionEnd` của
   *  MỘT textarea đang không có focus về 0 ngay sau khi script gán `.value`
   *  (xác nhận bằng log trực tiếp qua Playwright — không tái hiện được bằng
   *  jsdom). `textarea.focus()` NGAY SAU `applyEditRange` — cùng vị trí
   *  tương đối `acceptCompletion` đã dùng từ trước (focus sau khi áp edit,
   *  không phải trong `useLayoutEffect` dùng chung cho MỌI đường sửa nội
   *  dung: gọi `focus()` ở đó ảnh hưởng cả đường gõ phím thường, không cần
   *  thiết và từng gây lệch `cursor` React state trong môi trường test). */
  /**
   * `DEV-PROG-019` — nút Định dạng.
   *
   * Đường đi: `Parse → AST → in lại → parse lần hai → so cây`. Không đọc lại
   * được hoặc cây khác đi ⇒ **KHÔNG đổi buffer** và nói ra lý do. Bản trước làm
   * bằng regex và nó phá chú thích thật (`;` và chữ `IF` nằm trong chú thích bị
   * xé làm ba dòng) — người dùng chỉ phát hiện ở lần Kiểm tra sau đó.
   *
   * Định dạng KHÔNG tự Lưu, KHÔNG tự Kiểm tra, KHÔNG tự Commission: nó chỉ đổi
   * buffer, và người dùng vẫn chủ động `Kiểm tra → Lưu → Đưa vào vận hành`.
   */
  function handleFormat(scope: 'document' | 'selection' = 'document') {
    const textarea = textareaRef.current
    const rawStart = textarea?.selectionStart ?? 0
    const rawEnd = textarea?.selectionEnd ?? 0
    setFormatNote(null)

    if (scope === 'selection' && rawStart === rawEnd) {
      setFormatNote(pick('Chưa chọn vùng nào để định dạng.', 'No selection to format.'))
      return
    }

    const outcome = scope === 'document'
      ? { result: formatStDocument(source), selectionStart: rawStart, selectionEnd: rawEnd }
      : formatStRange(source, rawStart, rawEnd)

    if (!outcome.result.ok) {
      const where = outcome.result.line === null ? '' : pick(` (dòng ${outcome.result.line})`, ` (line ${outcome.result.line})`)
      setFormatNote(pick(
        `Không định dạng được — mã nguồn giữ nguyên. ${outcome.result.reason}${where}`,
        `Could not format — the source is unchanged. ${outcome.result.reason}${where}`,
      ))
      textarea?.focus()
      return
    }
    if (!outcome.result.changed) {
      setFormatNote(pick('Mã nguồn đã đúng định dạng.', 'The source already matches the style.'))
      textarea?.focus()
      return
    }

    const next = outcome.result.text
    applyEditRange(
      next,
      scope === 'selection' ? outcome.selectionStart : mapOffsetByNonWhitespaceCount(source, next, rawStart),
      scope === 'selection' ? outcome.selectionEnd : mapOffsetByNonWhitespaceCount(source, next, rawEnd),
    )
    textarea?.focus()
  }

  /** Mục thư viện đang chờ người dùng chọn instance (chỉ FB có trạng thái,
   *  và chỉ khi nguồn ĐÃ có instance cùng kiểu — nếu chưa có thì không hỏi,
   *  giữ đúng "≤2 thao tác" của `AC-ST-001`). */
  const [pendingLibraryEntry, setPendingLibraryEntry] = useState<CatalogEntry | null>(null)
  const [libraryInsertionNote, setLibraryInsertionNote] = useState<string | null>(null)
  const [referenceNote, setReferenceNote] = useState<string | null>(null)
  /** Kết quả lần Định dạng gần nhất — kể cả khi nó TỪ CHỐI. Im lặng khi từ chối
   *  là để người dùng bấm nút rồi không thấy gì xảy ra và tưởng nút hỏng. */
  const [formatNote, setFormatNote] = useState<string | null>(null)
  const [formatMenuOpen, setFormatMenuOpen] = useState(false)

  const consumedFormatRequestRef = useRef<string | null>(null)
  useEffect(() => {
    if (!formatRequest || formatRequest.programId !== program.programId) return
    const requestKey = `${formatRequest.programId}:${formatRequest.nonce}`
    if (consumedFormatRequestRef.current === requestKey) return
    consumedFormatRequestRef.current = requestKey
    handleFormat()
  }, [formatRequest, program.programId])

  /* `DEV-PROG-002` — yêu cầu chèn từ Thư viện nhanh ở cột phải, cùng khuôn
   * `nonce` với `formatRequest`: chèn HAI LẦN cùng một khối là một yêu cầu hợp
   * lệ, nên so sánh theo nội dung sẽ nuốt lần thứ hai. */
  const consumedLibraryRequestRef = useRef<number | null>(null)
  useEffect(() => {
    if (!libraryInsertRequest || !canEdit) return
    if (consumedLibraryRequestRef.current === libraryInsertRequest.nonce) return
    consumedLibraryRequestRef.current = libraryInsertRequest.nonce
    const entry = libraryInsertRequest.entry
    /* Đã có instance cùng kiểu thì HỎI: dùng lại hay tạo mới. Tự dùng lại là
     * sai (hai lời gọi chung một timer là lỗi điều khiển thật), mà tự tạo mới
     * cũng sai khi người dùng đang muốn gọi lại đúng instance đó. */
    if (entry.stateful && collectDeclaredInstances(source, entry.name).length > 0) {
      setPendingLibraryEntry(entry)
      return
    }
    applyLibraryInsertion(entry)
  }, [libraryInsertRequest, canEdit])

  /** FE-ST-008: một hàm lưu DUY NHẤT cho cả nút Lưu và `Ctrl+S` — ghi lại kết
   *  quả (`saved`/`failed`) neo vào đúng buffer vừa thử, để trạng thái hiển
   *  thị không nói dối khi người dùng gõ tiếp sau một lần lưu thất bại. */
  function handleSaveSource() {
    const attempted = source
    lastAttemptedSourceRef.current = attempted
    void onSave([{ op: 'replaceProgramSource', programId: program.programId, language: 'ST', source: attempted }]).then((ok) => {
      setSaveStatus(ok ? 'saved' : 'failed')
    })
  }

  function acceptCompletion(item: StCompletionItem) {
    const textarea = textareaRef.current
    if (!textarea) return
    const cursorOffset = textarea.selectionStart
    const next = source.slice(0, completion.anchor) + item.label + source.slice(cursorOffset)
    applyEdit(next, completion.anchor + item.label.length)
    textarea.focus()
    closeCompletion()
  }

  /* Enter tự thụt lề theo độ sâu khối hiện tại (`computeAutoIndent`) — chỉ
   * áp dụng khi KHÔNG có dropdown gợi ý đang mở (Enter lúc đó dùng để chấp
   * nhận gợi ý, xử lý ở `onKeyDown`). */
  function handleAutoIndentEnter() {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const insertion = `\n${computeAutoIndent(source, start)}`
    const next = source.slice(0, start) + insertion + source.slice(end)
    applyEdit(next, start + insertion.length)
  }

  function replaceAllMatches() {
    if (!searchText || matches.length === 0) return
    const textarea = textareaRef.current
    const rawStart = textarea?.selectionStart ?? 0
    const rawEnd = textarea?.selectionEnd ?? 0
    const next = source.split(searchText).join(replaceText)
    applyEditRange(
      next,
      mapOffsetAcrossReplaceAll(source, searchText, replaceText, rawStart),
      mapOffsetAcrossReplaceAll(source, searchText, replaceText, rawEnd),
    )
    textarea?.focus()
  }

  function replaceNextMatch() {
    const textarea = textareaRef.current
    if (!searchText || matches.length === 0 || !textarea) return
    const at = nextMatch(matches, textarea.selectionEnd ?? 0)
    const next = source.slice(0, at) + replaceText + source.slice(at + searchText.length)
    applyEdit(next, at + replaceText.length)
  }

  /* ST Editor Quick Control #1 (đã duyệt) — cả ba chỉ transform buffer local
   * qua `applyEditRange`, không tự Lưu/Kiểm tra. Chỉ tác động khi có vùng
   * chọn không rỗng (thanh lệnh chỉ hiện trong trường hợp đó). */
  function handleToggleComment() {
    if (!canEdit || !selectionRange) return
    const result = toggleComment(source, selectionRange.start, selectionRange.end)
    applyEditRange(result.text, result.selectionStart, result.selectionEnd)
  }

  function handleWrapIf() {
    if (!canEdit || !selectionRange) return
    const result = wrapInBlock(source, selectionRange.start, selectionRange.end, 'IF')
    applyEditRange(result.text, result.selectionStart, result.selectionEnd)
  }

  /** `AC-ST-005` — nhảy tới khai báo của định danh dưới con trỏ (F12 hoặc
   *  Ctrl+Click). Không tra được thì NÓI RÕ là không tra được: một định danh
   *  chưa khai báo là thông tin thật về nguồn, không phải chỗ để đoán bừa một
   *  đích đến gần đúng. */
  function handleGoToDefinition() {
    const textarea = textareaRef.current
    const offset = textarea?.selectionStart ?? cursorOffset
    const found = stSymbolAt(source, offset, referenceIndex)
    if (!found) {
      setReferenceNote(pick('Con trỏ không đứng trên một định danh.', 'The cursor is not on an identifier.'))
      return
    }
    if (!found.entry) {
      setReferenceNote(pick(`Không tìm thấy khai báo của ${found.identifier}.`, `No declaration found for ${found.identifier}.`))
      return
    }
    setReferenceNote(null)
    selectRange(found.entry.declarationOffset, found.entry.name.length)
  }

  function handleJumpBracket() {
    if (!bracketMatch) return
    const textarea = textareaRef.current
    const current = textarea?.selectionStart ?? -1
    const target = current === bracketMatch.open ? bracketMatch.close : bracketMatch.open
    selectRange(target, 1)
  }

  function handleInsertAtCursor(text: string) {
    const textarea = textareaRef.current
    const offset = textarea?.selectionStart ?? source.length
    const next = source.slice(0, offset) + text + source.slice(offset)
    applyEdit(next, offset + text.length)
    setInsertPanelOpen(false)
    textarea?.focus()
  }

  /** `AC-ST-002` — chèn một mục Quick Library vào nguồn ST.
   *
   *  Khác `handleInsertAtCursor` (chèn thô một chuỗi tại con trỏ) ở chỗ nó
   *  tôn trọng CẤU TRÚC của POU: khai báo instance thuộc vùng khai báo, lời
   *  gọi thuộc thân. Cả hai phần đi qua đúng MỘT `applyEditRange` nên vẫn là
   *  một bước hoàn tác (`AC-ST-003`). */
  function applyLibraryInsertion(entry: CatalogEntry, instanceName?: string) {
    const textarea = textareaRef.current
    const offset = textarea?.selectionStart ?? source.length
    const plan = planLibraryInsertion(source, entry, offset, instanceName ? { instanceName } : {})
    applyEditRange(plan.text, plan.selectionStart, plan.selectionEnd)
    setPendingLibraryEntry(null)
    /* Hai điều người dùng KHÔNG nhìn thấy nếu không nói: một dòng khai báo vừa
     * được thêm ở chỗ khác trên màn hình, và lời gọi có thể đã bị dời khỏi con
     * trỏ vì con trỏ đang ở vùng khai báo. Im lặng ở đây là để người dùng tự
     * đoán tại sao nguồn đổi nhiều hơn họ nghĩ. */
    const notes: string[] = []
    if (plan.declarationAdded && plan.instanceName) {
      notes.push(pick(`Đã khai ${plan.instanceName} : ${entry.name} trong khối VAR.`, `Declared ${plan.instanceName} : ${entry.name} in the VAR block.`))
    }
    if (plan.callRelocated) {
      notes.push(pick('Lời gọi đặt ở đầu thân vì con trỏ đang ở vùng khai báo.', 'Call placed at the start of the body because the cursor was in the declaration section.'))
    }
    setLibraryInsertionNote(notes.length > 0 ? notes.join(' ') : null)
    textarea?.focus()
  }


  return (
    /* `DEV-PROG-001` — cột giữa là một CỘT FLEX cao bằng ô lưới của nó, không
       còn là một chồng `space-y-2` dài vô hạn. Chỉ khung soạn thảo co giãn
       (`flex-1`); thanh công cụ giữ nguyên kích thước, còn các khay phụ bên
       dưới nằm trong một vùng cuộn RIÊNG có trần. Trước lát này chính các khay
       phụ đó (danh sách `Ký hiệu & kiểu` liệt kê đủ 36 ký hiệu, cao ~900 px)
       đẩy workbench ra khỏi màn hình. */
    <div className="flex h-full min-h-0 flex-col gap-2">
      <EditorToolbar heading={program.name}>
        {/* `DEV-PROG-024` — tên POU ở đây là bản SAO của thứ đã hiện ngay phía
            trên trong dải tab (`FB_SafetyLatch ST ×`), mà nó lại tự chiếm trọn
            một dòng: đo ở 1280 px, nhóm nút rộng hơn cột nên `justify-between`
            đẩy tiêu đề xuống hàng riêng, mất 32 px chỉ để nhắc lại một cái tên
            đang hiện cách đó 8 px. `sr-only` giữ nguyên tiêu đề của vùng cho
            trình đọc màn hình — bỏ hẳn thì vùng soạn thảo mất tên. */}
        {/* `gap-1` chứ không `gap-2`: chín khoảng cách × 4 px = 36 px, đủ để
            nhóm nút gói vào một hàng ở khổ 1680 thay vì hai. */}
          {/* G-09/G-10: nhóm theo tần suất thao tác, có separator mềm giữa
           * các nhóm nhưng không bọc thêm card/border quanh cả toolbar. */}
          {canEdit && (
            <>
              <span role="group" aria-label={pick('Lịch sử chỉnh sửa', 'Edit history')} className="inline-flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Undo2 className="h-4 w-4" aria-hidden="true" />}
                  disabled={historyRef.current.past.length === 0}
                  aria-label={pick('Hoàn tác thay đổi ST', 'Undo ST edit')}
                  title={pick('Hoàn tác (Ctrl+Z)', 'Undo (Ctrl+Z)')}
                  onClick={() => applyHistorySnapshot('undo')}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Redo2 className="h-4 w-4" aria-hidden="true" />}
                  disabled={historyRef.current.future.length === 0}
                  aria-label={pick('Làm lại thay đổi ST', 'Redo ST edit')}
                  title={pick('Làm lại (Ctrl+Y)', 'Redo (Ctrl+Y)')}
                  onClick={() => applyHistorySnapshot('redo')}
                />
              </span>
              <span role="group" aria-label={pick('Chèn nội dung', 'Insert content')} className="inline-flex items-center gap-1 border-l border-[var(--c-border)] pl-1">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<PlusSquare className="h-4 w-4" aria-hidden="true" />}
                  aria-pressed={insertPanelOpen}
                  title={pick('Chèn nhanh Point/Variable (Ctrl+I)', 'Quick insert Point/Variable (Ctrl+I)')}
                  onClick={() => setInsertPanelOpen((open) => !open)}
                >
                  <span className={TOOLBAR_LABEL_CLASS}>{pick('Chèn Point/Variable', 'Insert Point/Variable')}</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Library className="h-4 w-4" aria-hidden="true" />}
                  aria-pressed={libraryOpen}
                  title={pick('Thư viện nhanh — cùng catalog với PGM-04', 'Quick library — same catalog as PGM-04')}
                  onClick={onToggleLibrary}
                >
                  <span className={TOOLBAR_LABEL_CLASS}>{pick('Thư viện', 'Library')}</span>
                </Button>
              </span>
            </>
          )}
          <span role="group" aria-label={pick('Tìm kiếm', 'Search')} className="inline-flex items-center border-l border-[var(--c-border)] pl-1">
            <Button
              size="sm"
              variant="ghost"
              icon={<Search className="h-4 w-4" aria-hidden="true" />}
              aria-pressed={searchOpen}
              title={pick('Tìm/Thay (Ctrl+F)', 'Find/Replace (Ctrl+F)')}
              onClick={() => {
                setSearchOpen((open) => {
                  const next = !open
                  if (next) window.setTimeout(() => searchRef.current?.focus(), 0)
                  else textareaRef.current?.focus()
                  return next
                })
              }}
            >
              <span className={TOOLBAR_LABEL_CLASS}>{pick('Tìm', 'Find')}</span>
            </Button>
          </span>
          {canEdit && (
            <>
              {/* `DEV-PROG-019` — hai mức, không phải 20 tuỳ chọn. Bấm thẳng
                  vào nút = Định dạng tài liệu (việc chiếm ~95% số lần dùng);
                  mũi tên mở thêm Định dạng vùng chọn. */}
              <span role="group" aria-label={pick('Định dạng mã', 'Code formatting')} className="relative inline-flex border-l border-[var(--c-border)] pl-1">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<AlignLeft className="h-4 w-4" aria-hidden="true" />}
                  title={pick('Định dạng tài liệu (Ctrl+Shift+F)', 'Format document (Ctrl+Shift+F)')}
                  onClick={() => { setFormatMenuOpen(false); handleFormat('document') }}
                >
                  <span className={TOOLBAR_LABEL_CLASS}>{pick('Định dạng', 'Format')}</span>
                </Button>
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={formatMenuOpen}
                  aria-label={pick('Tuỳ chọn định dạng', 'Formatting options')}
                  className="ml-0.5 rounded border border-[var(--c-border)] px-1 text-xs text-[var(--c-text-dim)] hover:text-[var(--c-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
                  onClick={() => setFormatMenuOpen((open) => !open)}
                >
                  ▾
                </button>
                {formatMenuOpen && (
                  <div
                    role="menu"
                    aria-label={pick('Tuỳ chọn định dạng', 'Formatting options')}
                    className="panel-shadow absolute right-0 top-full z-30 mt-1 min-w-56 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] py-1"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      className="block w-full px-3 py-1.5 text-left text-sm text-[var(--c-text)] hover:bg-[var(--c-surface-2)]"
                      onClick={() => { setFormatMenuOpen(false); handleFormat('document') }}
                    >
                      {pick('Định dạng tài liệu', 'Format document')}
                      <span className="ml-2 text-xs text-[var(--c-text-dim)]">Ctrl+Shift+F</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="block w-full px-3 py-1.5 text-left text-sm text-[var(--c-text)] hover:bg-[var(--c-surface-2)]"
                      onClick={() => { setFormatMenuOpen(false); handleFormat('selection') }}
                    >
                      {pick('Định dạng vùng chọn', 'Format selection')}
                    </button>
                  </div>
                )}
              </span>
              <span role="group" aria-label={pick('Lưu và Kiểm tra', 'Save and Check')} className="inline-flex items-center gap-1 border-l border-[var(--c-border)] pl-1">
                <Button
                  size="sm"
                  icon={<Save className="h-4 w-4" aria-hidden="true" />}
                  loading={saving}
                  disabled={!canSave}
                  title={
                    isEmptySource ? pick('Mã nguồn ST không được để trống', 'ST source cannot be empty')
                    : !dirty ? pick('Không có thay đổi để lưu', 'No changes to save')
                    : pick('Lưu (Ctrl+S)', 'Save (Ctrl+S)')
                  }
                  onClick={handleSaveSource}
                >
                  {pick('Lưu', 'Save')}
                </Button>
                {/* `PGM-02A §3` — `Check` và `Compare` thuộc CHÍNH hàng này.
                * `Check` điều hướng sang PGM-05, nơi sở hữu trọn vòng
                * seal/run/poll/result (`useCheckWorkflow`); ở đây tuyệt đối
                * không dựng luồng thứ hai (D-01).
                * `SIMULATE`/`LIVE` KHÔNG nhân bản thành nút toolbar — chúng là
                * mode switch ở `ProgramsModeSwitcher`. Hai đường đổi mode sẽ
                * lệch nhau đúng lúc một trong hai bị quên cập nhật. */}
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
              </span>
              <Button
                size="sm"
                variant="ghost"
                icon={<GitCompare className="h-4 w-4" aria-hidden="true" />}
                disabled={!onOpenCompare || Boolean(compareDisabledReason)}
                title={compareDisabledReason ?? pick('So sánh với bản đang vận hành', 'Compare with the running revision')}
                onClick={() => onOpenCompare?.()}
              >
                <span className={TOOLBAR_LABEL_CLASS}>{pick('So sánh', 'Compare')}</span>
              </Button>
              {/* `DEV-PROG-026` — nút toàn màn hình đứng NGAY TRƯỚC `Khác`, không
                  nằm trong đó: nó là cách duy nhất đạt được chiều cao gõ mà khổ
                  màn 800 px đòi hỏi, nên nó phải nhìn thấy được chứ không nấp
                  sau một menu. Chỉ icon, như Hoàn tác/Làm lại — `aria-label` và
                  `title` mang đủ nghĩa, và `aria-pressed` nói trạng thái. */}
              {onToggleMaximized && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={maximized
                    ? <Minimize2 className="h-4 w-4" aria-hidden="true" />
                    : <Maximize2 className="h-4 w-4" aria-hidden="true" />}
                  aria-pressed={maximized}
                  aria-label={maximized
                    ? pick('Thoát toàn màn hình', 'Exit full screen')
                    : pick('Gõ toàn màn hình', 'Edit full screen')}
                  title={maximized
                    ? pick('Thoát toàn màn hình (Esc)', 'Exit full screen (Esc)')
                    : pick('Gõ toàn màn hình (Ctrl+Shift+M)', 'Edit full screen (Ctrl+Shift+M)')}
                  onClick={onToggleMaximized}
                />
              )}
              <details className="relative" data-testid="st-toolbar-more">
                <summary
                  className="cursor-pointer list-none rounded-[var(--radius)] px-2 py-1 text-sm text-[var(--c-text-dim)] hover:bg-[var(--c-surface-2)]"
                  title={pick('Lệnh khác', 'More commands')}
                >
                  {pick('Khác', 'More')}
                </summary>
                <div className="absolute right-0 z-20 mt-1 w-56 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-1 shadow-lg">
                  <button
                    type="button"
                    className="w-full rounded px-2 py-1 text-left text-sm hover:bg-[var(--c-surface-2)]"
                    onClick={onToggleCodeMap}
                  >
                    {codeMapOpen ? pick('Ẩn bản đồ mã', 'Hide code map') : pick('Hiện bản đồ mã', 'Show code map')}
                  </button>
                </div>
              </details>
            </>
          )}
      </EditorToolbar>
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
          {canEdit && (
            <>
              <label className="sr-only" htmlFor={`programming-st-replace-${program.programId}`}>{pick('Thay bằng', 'Replace with')}</label>
              <input
                id={`programming-st-replace-${program.programId}`}
                value={replaceText}
                onChange={(event) => setReplaceText(event.target.value)}
                placeholder={pick('Thay bằng…', 'Replace with…')}
                className="min-w-40 flex-1 rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1 text-sm text-[var(--c-text)]"
              />
              <Button size="sm" variant="ghost" disabled={matches.length === 0} onClick={replaceNextMatch}>{pick('Thay', 'Replace')}</Button>
              <Button size="sm" variant="ghost" disabled={matches.length === 0} onClick={replaceAllMatches}>{pick('Thay tất cả', 'Replace all')}</Button>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            icon={<X className="h-4 w-4" aria-hidden="true" />}
            aria-label={pick('Đóng tìm kiếm', 'Close find')}
            onClick={() => { setSearchOpen(false); textareaRef.current?.focus() }}
          />
        </div>
      )}
      <label className="sr-only" htmlFor={`programming-st-source-${program.programId}`}>
        {pick(`Mã nguồn ST của ${program.name}`, `ST source for ${program.name}`)}
      </label>
      {/* Bản đồ mã là một DẢI DỌC bám mép phải chỗ gõ, cùng chiều cao với nó.
          Trước lát này nó nằm trong cột trái dưới cây POU: cùng chiều cao với
          cây nên chỉ hiện được vài mục, và mắt phải rời hẳn khỏi vùng mã để
          liếc nó. Một bản đồ của đúng tài liệu đang mở thì phải đứng cạnh tài
          liệu ấy và cao bằng nó — đó là thứ làm nó dùng được khi cuộn.

          `min-w-0` trên khung mã là bắt buộc: thiếu nó, `flex` để textarea nở
          theo nội dung và dải bản đồ bị đẩy khỏi màn hình. */}
      <div className={`flex ${EDITOR_FRAME_CLASS} min-h-0 gap-2`}>
      <div className={`relative grid min-w-0 flex-1 grid-cols-[3.5rem_1fr] overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] focus-within:border-[var(--c-accent)]`}>
        {/* Con trỏ lệch dòng (báo trực tiếp trên board, 2026-08-15 và
         * 2026-08-17 — ảnh chụp cho thấy lưới kẻ cắt xuyên chữ, không phải
         * chỉ lệch nhẹ): tắt word-wrap (`whitespace-pre` + `wrap="off"`) đã
         * đúng hướng (một dòng logic = đúng một hàng hiển thị), nhưng gốc
         * lệch THẬT là `styles.css` có rule `button, input, select, textarea
         * { font: inherit }` KHÔNG nằm trong `@layer` nào — theo CSS Cascade
         * Layers, rule không-layer luôn thắng rule có layer bất kể độ đặc
         * hiệu, nên nó âm thầm đè `text-sm`/`leading-5` (Tailwind, có layer)
         * CHỈ trên `<textarea>` (không đè `<pre>` gutter/overlay) — ba lớp
         * vì vậy KHÔNG cùng font-size/line-height thật, dù số liệu tính lưới
         * đúng. Sửa tận gốc bằng `EDITOR_TEXT_METRICS` (inline style, luôn
         * thắng mọi rule stylesheet bất kể layer) áp thống nhất cho cả ba
         * lớp — xem chỗ khai báo hằng số phía trên. Bỏ hẳn lưới kẻ từng dòng
         * theo khuyến nghị: chỉ highlight active-line, khớp mọi code editor
         * chuẩn (VS Code/Sublime không kẻ lưới toàn bộ hàng). */}
        <div
          ref={lineGutterRef}
          aria-hidden="true"
          className="mono m-0 overflow-hidden border-r border-[var(--c-border)] bg-[var(--c-surface-2)] text-right text-[var(--c-text-dim)]"
          style={{ ...EDITOR_TEXT_METRICS, paddingLeft: `${EDITOR_GUTTER_PAD_X_PX}px`, paddingRight: `${EDITOR_GUTTER_PAD_X_PX}px` }}
        >
          {Array.from({ length: Math.max(1, source.split('\n').length) }, (_, index) => index + 1).map((lineNumber) => (
            <div
              key={lineNumber}
              style={{ height: `${EDITOR_ROW_HEIGHT_PX}px` }}
              className={lineNumber === cursor.line ? 'bg-[var(--c-surface)] font-semibold text-[var(--c-text)]' : undefined}
            >
              {lineNumber}
            </div>
          ))}
        </div>
        <div className="relative h-full overflow-hidden">
          {/* WP-10 P0: overlay tô cú pháp + gạch chân diagnostic, nằm DƯỚI
           * textarea (chữ trong suốt, chỉ hiện con trỏ) — `EDITOR_TEXT_METRICS`
           * (inline) khớp pixel-cho-pixel với textarea phía trên, xem lý do ở
           * comment phía trên container. */}
          <pre
            ref={overlayRef}
            aria-hidden="true"
            className="mono pointer-events-none absolute inset-0 m-0 overflow-hidden whitespace-pre"
            style={{ ...EDITOR_TEXT_METRICS, paddingLeft: `${EDITOR_PAD_X_PX}px`, paddingRight: `${EDITOR_PAD_X_PX}px` }}
          >
            {/* Dải highlight active-line — con ĐẦU TIÊN của chính `<pre>` đang
             * cuộn (không phải phần tử ngoài) nên tự cuộn theo `scrollTop`
             * đồng bộ sẵn có, không cần state/effect riêng.
             *
             * `zIndex` ở ĐÂY VÀ ở span bọc chữ bên dưới là BẮT BUỘC, không phải
             * dọn dẹp. Dải này `position:absolute`, còn các span tô cú pháp là
             * nội dung inline TRONG LUỒNG của cùng `<pre>`. Theo thứ tự vẽ của
             * CSS, phần tử được định vị (z-index auto) vẽ SAU nội dung inline
             * trong luồng — nên dải nền vẽ ĐÈ LÊN CHỮ của chính dòng đang sửa,
             * và `opacity: 0.55` biến nó thành một tấm màn phủ.
             *
             * Đo trên Chromium: chữ dòng trong dải sáng 129/255 trong khi dòng
             * ngay trên và ngay dưới sáng 233/255 — mờ 45%. Triệu chứng người
             * dùng thấy là "dòng đang gõ bị xám đi so với các dòng y hệt ở chỗ
             * khác", và nó chỉ lộ ra ở dòng có con trỏ nên rất dễ bị bỏ qua.
             *
             * Không dùng z-index ÂM cho dải: `<pre>` và các tổ tiên của nó đều
             * `z-index: auto` nên không tạo stacking context, và một giá trị âm
             * sẽ đẩy dải ra sau nền của tổ tiên gần nhất có nền đặc — tức mất
             * hẳn dải. Nâng CHỮ lên trên là cách giữ được cả hai. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-0 right-0 bg-[var(--c-surface-2)]"
              style={{ top: `${(cursor.line - 1) * EDITOR_ROW_HEIGHT_PX + EDITOR_PAD_TOP_PX}px`, height: `${EDITOR_ROW_HEIGHT_PX}px`, opacity: 0.55, zIndex: 0 }}
            />
            <span data-testid="st-overlay-text" style={{ position: 'relative', zIndex: 1 }}>
            {segments.map((segment, index) => {
              const isBracket = bracketMatch !== null && (segment.start === bracketMatch.open || segment.start === bracketMatch.close) && segment.kind === 'punctuation'
              const classes = [ST_TOKEN_CLASS[segment.kind as StTokenKind] ?? '']
              if (isBracket) classes.push('rounded bg-[var(--c-accent-bg)]')
              const diagnostic = segment.diagnosticIndex !== null ? markableDiagnostics[segment.diagnosticIndex] : undefined
              if (diagnostic) {
                const wavyColor = diagnostic.severity === 'WARNING' ? 'var(--c-warn)' : 'var(--c-fault)'
                classes.push(`underline decoration-wavy decoration-2 [text-decoration-color:${wavyColor}]`)
              }
              const shared = segment.text === '' ? '​' : segment.text
              if (segment.diagnosticIndex !== null) {
                const titleParts = diagnostic
                  ? [
                    `${diagnostic.code}${diagnostic.detailCode ? ` (${diagnostic.detailCode})` : ''}`,
                    diagnostic.message
                  ].filter(Boolean)
                  : []
                return (
                  <span
                    key={index}
                    className={`${classes.join(' ')} pointer-events-auto cursor-pointer`}
                    title={titleParts.length > 0 ? titleParts.join(' — ') : undefined}
                    onClick={() => {
                      const line = typeof diagnostic?.location?.line === 'number' ? diagnostic.location.line : 1
                      const column = typeof diagnostic?.location?.column === 'number' ? diagnostic.location.column : 1
                      const length = typeof diagnostic?.location?.length === 'number' ? diagnostic.location.length : 1
                      selectRange(lineColumnToOffset(source, line, column), length)
                    }}
                  >
                    {shared}
                  </span>
                )
              }
              return <span key={index} className={classes.join(' ')}>{shared}</span>
            })}
            </span>
          </pre>
          <textarea
            ref={textareaRef}
            id={`programming-st-source-${program.programId}`}
            aria-describedby={diagnostics.length > 0 ? `programming-st-diagnostics-${program.programId}` : undefined}
            wrap="off"
            className="absolute inset-0 h-full w-full resize-none whitespace-pre border-0 bg-transparent outline-none"
            /* `color`/`caretColor` VÀ toàn bộ `EDITOR_TEXT_METRICS` (font-size/
             * line-height/padding/tab-size) đều phải là inline style — lý do
             * đầy đủ ở comment tại chỗ khai báo `EDITOR_TEXT_METRICS` phía
             * trên (rule `textarea { font: inherit }` không-layer trong
             * `styles.css` đè bất kỳ class Tailwind nào, kể cả `text-sm`/
             * `leading-5`/`p-3`, không chỉ `text-transparent`/`caret-*`). */
            style={{ ...EDITOR_TEXT_METRICS, paddingLeft: `${EDITOR_PAD_X_PX}px`, paddingRight: `${EDITOR_PAD_X_PX}px`, color: 'transparent', caretColor: 'var(--c-text)' }}
            value={source}
            readOnly={!canEdit}
            spellCheck={false}
            onChange={(event) => {
              /* Đường GÕ TAY không đi qua `applyEditRange` (trình duyệt tự ghi
               * `.value`), nên guard read-only phải lặp lại ở đây. `readOnly`
               * chặn được người dùng thật; guard này chặn cả những đường mà
               * `readOnly` không phủ — thao tác lập trình, và một lần refactor
               * quên thuộc tính đó. */
              if (!canEdit) return
              const next = event.target.value
              const selectionStart = event.target.selectionStart
              const selectionEnd = event.target.selectionEnd
              /* Tính lại Dòng/cột ngay từ `next`/`offset` tươi của chính sự
               * kiện này — không dựa vào `onKeyUp`/`onSelect` đọc lại closure
               * `source` có thể còn là giá trị của lần render trước, đúng
               * nguyên nhân khay "Dòng/cột" từng hiện lệch dòng thật (lỗi
               * người dùng báo). Bàn phím thường (không qua `applyEdit`) vẫn
               * cần đường riêng này vì trình duyệt tự chèn ký tự, không đi
               * qua `handleAutoIndentEnter`/`acceptCompletion`.
               *
               * Đặt `pendingCursorRef` NGAY Ở ĐÂY (giống hệt `applyEditRange`)
               * dù trình duyệt đã tự ghi `.value` này rồi: `setCursor`/
               * `refreshCompletion` bên dưới có thể kích hoạt render lại
               * TRƯỚC KHI prop `source` (đổi qua `onChange` → state cha) kịp
               * cập nhật, và React reconciliation của controlled input khi đó
               * ghi `.value` VỀ LẠI prop `source` cũ — y hệt lỗi đã sửa ở
               * `applyEdit()`, chỉ khác đường vào (gõ tay thường, không qua
               * Enter/autocomplete/Find-Replace). Trong app thật, cha luôn
               * batch kịp nên hiếm khi lộ ra — nhưng không nên dựa vào đúng
               * thời điểm batch của React để đúng, `useLayoutEffect` đảm bảo
               * đúng bất kể cha cập nhật nhanh hay chậm. */
              replaceHistory(recordStEditorEdit(historyRef.current, { source: next, selectionStart, selectionEnd }))
              pendingCursorRef.current = { value: next, selectionStart, selectionEnd }
              onChange(next)
              setCursor(offsetToLineColumn(next, selectionEnd))
              setSelectionRange(selectionStart === selectionEnd ? null : { start: selectionStart, end: selectionEnd })
              refreshCompletion(next, selectionEnd)
              refreshSignature(next, selectionEnd)
            }}
            onClick={(event) => {
              updateCursor()
              closeCompletion()
              refreshSignature(source, event.currentTarget.selectionStart ?? 0)
              /* Ctrl/Cmd+Click = tới khai báo, đường chuột của F12. */
              if (event.ctrlKey || event.metaKey) handleGoToDefinition()
            }}
            onDoubleClick={(event) => {
              /* `DEV-PROG-003` — nháy đúp một ký hiệu = "cho tôi xem giá trị
                 của biến này". Dùng chính `stSymbolAt` mà Inspector và hover
                 đang dùng: một bản phân giải thứ hai sẽ nhận diện khác ở đúng
                 chỗ khó thấy nhất (instance FB, tên trùng một phần).

                 Nháy đúp vào chỗ KHÔNG phải ký hiệu thì không làm gì — không
                 gửi một cái tên rỗng và cũng không nhảy khay, vì nháy đúp còn
                 là thao tác chọn từ bình thường của người đang gõ. */
              const symbol = stSymbolAt(source, event.currentTarget.selectionStart ?? 0, referenceIndex)
              if (symbol) onWatchVariable?.(symbol.identifier)
            }}
            onKeyUp={updateCursor}
            onSelect={updateCursor}
            onScroll={(event) => syncEditorScroll(event.currentTarget.scrollTop, event.currentTarget.scrollLeft)}
            onKeyDown={(event) => {
              if (completion.open) {
                if (event.key === 'ArrowDown') { event.preventDefault(); setCompletion((c) => ({ ...c, selected: (c.selected + 1) % c.items.length })); return }
                if (event.key === 'ArrowUp') { event.preventDefault(); setCompletion((c) => ({ ...c, selected: (c.selected - 1 + c.items.length) % c.items.length })); return }
                if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); acceptCompletion(completion.items[completion.selected]); return }
                if (event.key === 'Escape') { event.preventDefault(); closeCompletion(); return }
              }
              /* `Esc` đóng chữ ký trước khi đụng tới hộp Tìm kiếm: thứ vừa
               * bật lên là thứ người dùng muốn tắt trước. */
              if (event.key === 'Escape' && signature) {
                event.preventDefault(); closeSignature(); return
              }
              if (event.key === 'Escape' && searchOpen) {
                event.preventDefault(); setSearchOpen(false); return
              }
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && canEdit) {
                event.preventDefault()
                applyHistorySnapshot(event.shiftKey ? 'redo' : 'undo')
                return
              }
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y' && canEdit) {
                event.preventDefault(); applyHistorySnapshot('redo'); return
              }
              /* `Ctrl+Shift+F` phải xét TRƯỚC `Ctrl+F`: `Ctrl+Shift+F` cũng
                 thoả điều kiện của `Ctrl+F`, nên đặt sau thì nó không bao giờ
                 chạy — người dùng bấm Định dạng và nhận ô Tìm kiếm. */
              if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f' && canEdit) {
                event.preventDefault(); handleFormat('document'); return
              }
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
                event.preventDefault(); setSearchOpen(true); window.setTimeout(() => searchRef.current?.focus(), 0); return
              }
              if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'm' && onToggleMaximized) {
                event.preventDefault(); onToggleMaximized(); return
              }
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'g') {
                event.preventDefault(); setGoToDraft(String(cursor.line)); setGoToOpen(true); return
              }
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && canEdit && canSave) {
                event.preventDefault(); handleSaveSource(); return
              }
              /* ST Editor Quick Control (đã duyệt) — phím tắt cho thanh lệnh
               * nhanh vùng chọn (#1) và panel chèn nhanh (#3). */
              if ((event.ctrlKey || event.metaKey) && event.key === '/') {
                event.preventDefault(); handleToggleComment(); return
              }
              if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === '\\') {
                event.preventDefault(); handleJumpBracket(); return
              }
              /* `AC-ST-005` — F12 là phím tiêu chuẩn cho "tới khai báo" ở mọi
               * editor kỹ thuật; Ctrl+Click ở `onClick` là đường chuột tương
               * ứng. Cả hai dùng được cả khi chỉ đọc (điều hướng không sửa
               * nguồn). */
              if (event.key === 'F12') {
                event.preventDefault(); handleGoToDefinition(); return
              }
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'i' && canEdit) {
                event.preventDefault(); setInsertPanelOpen((open) => !open); return
              }
              if (event.key === 'Enter' && canEdit && !event.ctrlKey && !event.metaKey) {
                event.preventDefault(); handleAutoIndentEnter()
              }
            }}
            onMouseMove={(event) => {
              /* Đo bề rộng ký tự một lần rồi giữ lại. Đo hỏng ⇒ giữ 0 ⇒
                 `stHoverSymbolAtPoint` trả `null` ⇒ không hover, thay vì hover
                 chỉ sai chỗ. */
              if (charWidthRef.current <= 0 && hoverMeasureRef.current) {
                const sample = hoverMeasureRef.current.getBoundingClientRect().width / HOVER_SAMPLE.length
                if (sample > 0) charWidthRef.current = sample
              }
              const textarea = event.currentTarget
              const rect = textarea.getBoundingClientRect()
              const next = stHoverSymbolAtPoint(
                source,
                {
                  x: event.clientX - rect.left,
                  y: event.clientY - rect.top,
                  scrollLeft: textarea.scrollLeft,
                  scrollTop: textarea.scrollTop,
                },
                { ...HOVER_METRICS, charWidthPx: charWidthRef.current },
                referenceIndex,
              )
              /* Chỉ set state khi ĐỔI ký hiệu: rê chuột trong cùng một tên phát
                 hàng chục sự kiện, và render lại editor cho mỗi cái là chi phí
                 trả cho việc không có gì thay đổi. */
              setHoverSymbol((current) => (
                current && next && current.start === next.start && current.end === next.end ? current : next
              ))
              if (next?.entry?.kind === 'FB_INSTANCE') onEnsureLibraryLoaded?.()
            }}
            onMouseLeave={() => setHoverSymbol(null)}
            /* `DEV-PROG-016` — nhận khối kéo từ Thư viện nhanh.
             *
             * `onDragOver` phải `preventDefault()` mới cho thả; nó cũng dời con
             * trỏ tới chỗ sắp thả, để người dùng THẤY nơi khối sẽ rơi vào trước
             * khi buông tay. Thiếu phản hồi đó thì kéo-thả là một thao tác mù.
             *
             * `onDrop` cũng `preventDefault()` để trình duyệt KHÔNG tự chèn gì:
             * việc chèn đi qua đúng `applyLibraryInsertion` như khi bấm chuột,
             * nên khai báo instance và một-bước-hoàn-tác giữ nguyên. */
            onDragOver={(event) => {
              if (!canEdit || !event.dataTransfer.types.includes(LIBRARY_DRAG_TYPE)) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
              const offset = dropOffsetFrom(event)
              if (offset !== null) selectRange(offset, 0)
            }}
            onDrop={(event) => {
              if (!canEdit || !event.dataTransfer.types.includes(LIBRARY_DRAG_TYPE)) return
              event.preventDefault()
              const entryId = event.dataTransfer.getData(LIBRARY_DRAG_TYPE)
              const entry = libraryEntries?.find((candidate) => candidate.entryId === entryId)
              /* Không tìm thấy mục ⇒ không làm gì. Catalog có thể đã tải lại
                 giữa lúc kéo, và chèn "một khối nào đó" thay cho khối người
                 dùng chọn còn tệ hơn không chèn. */
              if (!entry) return
              const offset = dropOffsetFrom(event)
              if (offset !== null) selectRange(offset, 0)
              if (entry.stateful && collectDeclaredInstances(source, entry.name).length > 0) {
                setPendingLibraryEntry(entry)
                return
              }
              applyLibraryInsertion(entry)
            }}
          />
          {/* Phần tử đo, không đọc được bằng trình đọc màn hình và không chiếm
              chỗ. Nó tồn tại chỉ để hover có một bề rộng ký tự THẬT. */}
          <span
            ref={hoverMeasureRef}
            aria-hidden="true"
            className="pointer-events-none absolute -z-10 select-none opacity-0"
            style={{ ...EDITOR_TEXT_METRICS, padding: 0, whiteSpace: 'pre' }}
          >
            {HOVER_SAMPLE}
          </span>

          {hoverSymbol && (
            <StHoverCard
              symbol={hoverSymbol}
              catalog={libraryEntries}
              source={source}
              runtimeOverlay={runtimeOverlay}
            />
          )}

          {/* `ISS-STED-11` — chữ ký của lời gọi đang gõ.
              `role="status"` + `aria-live="polite"` chứ không phải `dialog`:
              nó KHÔNG nhận focus và KHÔNG chặn gõ tiếp — người dùng vẫn đang
              gõ tham số, cướp focus giữa chừng sẽ phá đúng thao tác nó định
              giúp. Trình đọc màn hình đọc lại khi tham số đang nhập đổi. */}
          {signature && (
            <div
              role="status"
              aria-live="polite"
              data-testid="st-signature-help"
              data-signature-callee={signature.calleeName}
              data-signature-active={signature.activeParameter}
              className="absolute z-10 max-w-[28rem] rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] px-2 py-1 text-xs shadow-lg"
              /* Nằm TRÊN dòng đang gõ, ngược với danh sách gợi ý nằm dưới:
                 hai thứ có thể cùng hiện, và chồng lên nhau thì cả hai đều
                 không đọc được. */
              style={{
                top: `${Math.max(0, (cursor.line - 1) * EDITOR_ROW_HEIGHT_PX - editorScroll.top)}px`,
                left: `${Math.max(EDITOR_PAD_TOP_PX, Math.min(220, (cursor.column - 1) * 8.4 + EDITOR_PAD_TOP_PX) - editorScroll.left)}px`,
              }}
            >
              <span className="sr-only">{stSignatureLabel(signature)}</span>
              <span aria-hidden className="mono text-[var(--c-text)]">
                {signature.calleeName}
                {signature.kind === 'function-block' && (
                  <span className="text-[var(--c-text-dim)]">{` : ${signature.typeRef}`}</span>
                )}
                {'('}
                {signature.parameters.map((parameter, index) => (
                  <span key={parameter.name}>
                    {index > 0 && ', '}
                    <span
                      className={index === signature.activeParameter
                        ? 'font-semibold text-[var(--c-accent)] underline'
                        : 'text-[var(--c-text-dim)]'}
                    >
                      {stSignatureParameterLabel(parameter, signature.namedArgumentsRequired)}
                    </span>
                  </span>
                ))}
                {')'}
              </span>
              {signature.namedArgumentsRequired && (
                /* `D4` của `ST_SUBSET_SPEC` §9: FB chỉ gọi được THEO TÊN. Nói
                   ra ở đây vì đây là chỗ người dùng đang quyết định viết gì;
                   để họ phát hiện ở bước Kiểm tra là muộn mất một vòng. */
                <span className="ml-2 text-[var(--c-text-dim)]">
                  {pick('gọi theo tên (D4)', 'named arguments only (D4)')}
                </span>
              )}
              {signature.reviewGated && (
                <span className="ml-2 text-[var(--c-warn-fg)]">
                  {pick('chờ review Controls/Safety — Kiểm tra sẽ từ chối',
                        'awaiting Controls/Safety review — Check will reject')}
                </span>
              )}
            </div>
          )}

          {completion.open && (
            <ul
              role="listbox"
              aria-label={pick('Gợi ý', 'Suggestions')}
              className="absolute z-10 max-h-48 w-56 overflow-y-auto rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] text-sm shadow-lg"
              /* Trừ độ cuộn: `cursor.line` đếm theo văn bản, còn `top` đo
                 theo khung đang nhìn. Không trừ thì popup nằm ngoài hộp. */
              style={{
                top: `${cursor.line * EDITOR_ROW_HEIGHT_PX - editorScroll.top}px`,
                left: `${Math.max(EDITOR_PAD_TOP_PX, Math.min(220, (cursor.column - 1) * 8.4 + EDITOR_PAD_TOP_PX) - editorScroll.left)}px`,
              }}
            >
              {completion.items.map((item, index) => (
                <li key={`${item.kind}-${item.label}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === completion.selected}
                    className={`flex w-full items-center justify-between px-2 py-1 text-left ${index === completion.selected ? 'bg-[var(--c-accent-bg)]' : 'hover:bg-[var(--c-surface-2)]'}`}
                    onMouseDown={(event) => { event.preventDefault(); acceptCompletion(item) }}
                  >
                    <span className="mono">{item.label}</span>
                    {/* `T61-407` — khối đang chờ review Controls/Safety phải
                        đọc được NGAY trong danh sách gợi ý. Cùng màu cảnh báo
                        mà Thư viện điều khiển dùng, để hai màn hình nói cùng
                        một thứ bằng cùng một tín hiệu. */}
                    <span className={`text-xs ${item.reviewGated ? 'text-[var(--c-warn-fg)]' : 'text-[var(--c-text-dim)]'}`}>
                      {item.detail}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {canEdit && selectionRange && (() => {
            const { line, column } = offsetToLineColumn(source, selectionRange.start)
            return (
              <SelectionQuickActions
                top={Math.max(0, (line - 1) * EDITOR_ROW_HEIGHT_PX - 32)}
                left={Math.min(220, (column - 1) * 8.4 + EDITOR_PAD_TOP_PX)}
                onComment={handleToggleComment}
                onWrapIf={handleWrapIf}
                onJumpBracket={handleJumpBracket}
                canJumpBracket={bracketMatch !== null}
              />
            )
          })()}
        </div>
        {pendingLibraryEntry && canEdit && (
          <FbInstancePicker
            entry={pendingLibraryEntry}
            instances={collectDeclaredInstances(source, pendingLibraryEntry.name)}
            suggestedName={nextInstanceName(source, pendingLibraryEntry.name)}
            onPick={(instanceName) => applyLibraryInsertion(pendingLibraryEntry, instanceName)}
            onCreate={() => applyLibraryInsertion(pendingLibraryEntry)}
            onClose={() => setPendingLibraryEntry(null)}
          />
        )}
        {insertPanelOpen && canEdit && (
          <InsertPointVariablePanel
            variables={symbols}
            pointCatalogStatus={pointCatalogStatus}
            pointCatalogItems={pointCatalogItems}
            pointCatalogError={pointCatalogError}
            onEnsureLoaded={onEnsurePointCatalogLoaded}
            onInsert={handleInsertAtCursor}
            onClose={() => setInsertPanelOpen(false)}
          />
        )}
      </div>
      {/* Dải bản đồ mã: cao BẰNG khung mã (`h-full` trong hàng flex), cuộn
          riêng, và chỉ hiện từ `2xl` (≥1536 px) — KHÔNG phải `lg`, một chú
          thích cũ ở đây từng ghi sai như vậy. Đo thật ở 1280 px: cột giữa chỉ
          rộng ~660 px, và một dải 192 px lấy mất gần một phần ba — chỗ gõ tụt
          xuống 340 px, khoảng 38 ký tự mỗi dòng. Một bản đồ mã không đáng giá
          bằng chính chỗ viết mã.

          Ngưỡng ĐỘ DÀI thì đã bỏ (2026-08-30): bản đồ hiện với mọi POU. Chỉ
          ngưỡng BỀ NGANG này còn lại, và nó là ràng buộc vật lý chứ không phải
          một phán đoán về việc người dùng có cần bản đồ hay không.

          Điều kiện `shouldShowCodeMap` phải hỏi Ở ĐÂY, không để bên trong
          component tự trả `null`: bản trước bọc `StCodeMap` trong một khung
          `w-48` rồi mới để nó trả `null` cho POU ngắn — kết quả là một dải
          rỗng 12rem vẫn chiếm chỗ và ăn mất bề ngang của chính chỗ gõ. Khung
          chỉ được tồn tại khi có nội dung để đặt vào. */}
      {codeMapOpen && shouldShowCodeMap(source) && (
        <div className="hidden h-full w-44 shrink-0 2xl:block">
          <StCodeMap source={source} onNavigate={(offset) => selectRange(offset, 1)} />
        </div>
      )}
      </div>
      {/* `DEV-PROG-001`/`DEV-PROG-012` — khay phụ nằm trong vùng cuộn RIÊNG có
          trần, không còn đẩy chiều cao của cả trang. Hàng "Dòng x, cột y ·
          n ký tự" từng đứng ở đây đã bỏ: thanh trạng thái phía dưới nói đúng
          hai số đó, và hai chỗ cùng nói một điều là hai chỗ để lệch nhau. */}
      <div className="min-h-0 space-y-2 overflow-y-auto lg:max-h-[15rem]">
      {libraryInsertionNote && (
        <p role="status" className="text-xs text-[var(--c-text-dim)]">{libraryInsertionNote}</p>
      )}
      {/* `DEV-PROG-019` — kết quả Định dạng, kể cả khi nó TỪ CHỐI. `alert` chứ
          không `status`: từ chối format là thứ người dùng phải biết ngay, vì
          buffer của họ KHÔNG đổi và họ đang chờ nó đổi. */}
      {formatNote && (
        <p role="alert" className="text-xs text-[var(--c-warn-fg)]">{formatNote}</p>
      )}
      {/* Ghi chú của "Tới khai báo (F12)" ở LẠI cạnh trình soạn thảo: nó nói về
          cú bấm vừa xảy ra trong editor, không phải về ký hiệu dưới con trỏ. */}
      {referenceNote && (
        <p role="status" className="text-xs text-[var(--c-warn-fg)]">{referenceNote}</p>
      )}
      {runtimeOverlay && <StRuntimeValueOverlay state={runtimeOverlay} />}
      </div>
      {/* Thanh trạng thái GHIM ở đáy cột, ngoài vùng cuộn: nó phải đọc được mà
          không phải cuộn đi tìm — đúng vai trò của một status bar. */}
      {goToOpen && (
        <form
          data-testid="editor-go-to-line"
          aria-label={pick('Tới dòng', 'Go to line')}
          className="flex items-center gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] px-2 py-1"
          onSubmit={(event) => { event.preventDefault(); goToLine(goToDraft) }}
        >
          <label className="text-xs text-[var(--c-text-dim)]" htmlFor={`programming-st-goto-${program.programId}`}>
            {pick(`Tới dòng (1–${source.split('\n').length})`, `Go to line (1–${source.split('\n').length})`)}
          </label>
          <input
            id={`programming-st-goto-${program.programId}`}
            ref={goToInputRef}
            inputMode="numeric"
            value={goToDraft}
            onChange={(event) => setGoToDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape') { setGoToOpen(false); textareaRef.current?.focus() } }}
            className="w-20 rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1 text-sm text-[var(--c-text)]"
          />
          <Button size="sm" type="submit">{pick('Tới', 'Go')}</Button>
          <Button size="sm" variant="ghost" onClick={() => { setGoToOpen(false); textareaRef.current?.focus() }}>
            {pick('Đóng', 'Close')}
          </Button>
        </form>
      )}
      <EditorStatusBar
        onGoToPosition={() => { setGoToDraft(String(cursor.line)); setGoToOpen(true) }}
        fields={stStatusFields({
          line: cursor.line,
          column: cursor.column,
          source,
          dirty,
          /* Bảng mã: trình duyệt đã giải mã tệp TRƯỚC KHI FE thấy nó, nên FE
             không có cách nào biết bảng mã gốc. Không truyền gì ⇒ `—`. Điền
             `UTF-8` ở đây sẽ không bao giờ trông sai, và đó đúng là lý do nó bị
             cấm: nó vẫn hiện `UTF-8` cho chính cái tệp đang làm hỏng ký tự
             tiếng Việt của người dùng.
             Chế độ chèn: trình duyệt không cho đọc trạng thái phím Insert đáng
             tin cậy trên `<textarea>`, nên cũng để `—`. */
        })}
      />
      {/* `ISS-STED-04` — nhãn BẮT BUỘC: diagnostic thuộc revision nào, và buffer
        * đã đổi hay chưa. Gạch lỗi mà không nói hai điều đó thì người dùng
        * không có cách nào biết dấu gạch còn đáng tin không. */}
      <StCheckStateLabel
        provenance={checkProvenance}
        programId={program.programId}
        diagnosticCount={markableDiagnostics.length}
        pick={pick}
      />
      {isEmptySource && (
        <p className="text-xs text-[var(--c-fault-fg)]">
          {pick('Mã nguồn ST không được để trống — cần ít nhất khung PROGRAM/END_PROGRAM để lưu.', 'ST source cannot be empty — needs at least a PROGRAM/END_PROGRAM skeleton to save.')}
        </p>
      )}
      {/* FE-ST-008: bốn trạng thái tách biệt, ưu tiên "Lưu thất bại" trước
       * "Chưa lưu" chung chung — `lastAttemptedSourceRef` bảo đảm chỉ hiện
       * đúng khi buffer hiện tại CHÍNH LÀ buffer vừa thử lưu (gõ tiếp sau khi
       * thất bại phải rơi về "Chưa lưu", không giữ mãi thông báo lỗi cũ). */}
      {saving && <p className="text-xs text-[var(--c-text-dim)]">{pick('Đang lưu…', 'Saving…')}</p>}
      {!saving && saveStatus === 'failed' && source === lastAttemptedSourceRef.current && (
        <p className="text-xs text-[var(--c-fault-fg)]">{pick('Lưu thất bại — thử lại.', 'Save failed — try again.')}</p>
      )}
      {!saving && !(saveStatus === 'failed' && source === lastAttemptedSourceRef.current) && dirty && !isEmptySource && (
        <p className="text-xs text-[var(--c-warn-fg)]">{pick('Chưa lưu.', 'Not saved.')}</p>
      )}
      {!saving && !dirty && saveStatus === 'saved' && source === lastAttemptedSourceRef.current && (
        <p className="text-xs text-[var(--c-good-fg)]">{pick('Đã lưu.', 'Saved.')}</p>
      )}
    </div>
  )
}

interface ProgramMetadataDraft {
  name: string
  kind: ProgrammingProgram['kind']
  /** `DEV-PROG-004` — chuỗi rỗng = "chưa ghi" HOẶC "xoá đi"; hai nghĩa đó gộp
   *  được vì thao tác gửi lên (`annotateObject` với chuỗi rỗng) là như nhau. */
  description: string
  access: string
}

function metadataOf(program: ProgrammingProgram): ProgramMetadataDraft {
  return {
    name: program.name,
    kind: program.kind,
    description: program.description ?? '',
    access: program.access ?? '',
  }
}

function sameMetadata(left: ProgramMetadataDraft, right: ProgramMetadataDraft): boolean {
  return sameIdentityMetadata(left, right)
    && left.description === right.description && left.access === right.access
}

/**
 * Chỉ phần metadata đi qua `upsertProgram` (tên + loại).
 *
 * Tách khỏi `sameMetadata` là điểm mấu chốt của `DEV-PROG-004`: `upsertProgram`
 * gửi kèm CẢ mã nguồn, nên nếu "đổi mô tả" cũng tính là metadata đổi thì mỗi
 * lần gõ vào ô Mô tả sẽ kéo theo một lần ghi đè `document` — đúng cách một
 * buffer cũ nuốt mất mã nguồn của phiên khác. Chú thích đi đường riêng
 * (`annotateObject`, vá tại chỗ).
 */
function sameIdentityMetadata(left: ProgramMetadataDraft, right: ProgramMetadataDraft): boolean {
  return left.name === right.name && left.kind === right.kind
}

function parseTags(value: string): string[] {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))]
}

function sameTags(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

const POU_RESERVED_NAMES = new Set([
  'PROGRAM', 'FUNCTION', 'FUNCTION_BLOCK', 'VAR', 'END_VAR', 'IF', 'THEN',
  'ELSE', 'END_IF', 'TRUE', 'FALSE', 'AND', 'OR', 'XOR', 'NOT', 'MOD',
])

/** Đồng bộ `validPouName` ở backend: ASCII identifier tối đa 64 ký tự và
 * không trùng từ khoá IEC/ST bị giữ chỗ. Validation phía client chỉ giúp chặn
 * request chắc chắn 400; backend vẫn là authority cuối cùng. */
export function isValidPouName(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) && !POU_RESERVED_NAMES.has(name.toUpperCase())
}

/** So khớp tên không phân biệt hoa/thường và khoảng trắng đầu/cuối. */
export function isDuplicateProgramName(programs: ProgrammingProgram[], name: string, excludeProgramId?: string): boolean {
  const normalized = name.trim().toLocaleLowerCase()
  if (!normalized) return false
  return programs.some((program) => program.programId !== excludeProgramId && program.name.trim().toLocaleLowerCase() === normalized)
}

/** Sinh tên duy nhất kiểu `NewProgram_2`, `NewProgram_3`; hậu tố luôn giữ tên
 * trong grammar POU thay vì tái đưa khoảng trắng vào token (BUG-006). */
export function uniqueProgramName(programs: ProgrammingProgram[], baseName: string): string {
  if (!isDuplicateProgramName(programs, baseName)) return baseName
  let suffix = 2
  while (isDuplicateProgramName(programs, `${baseName}_${suffix}`)) suffix += 1
  return `${baseName}_${suffix}`
}

/** Chuyển view model sang đúng năm field decoder `upsertProgramCompat` nhận.
 * Không dùng spread ở biên transport: view còn giữ field legacy phục vụ đọc. */
function programDraftInput(
  program: ProgrammingProgram,
  changes: Partial<Omit<ProgrammingProgramDraftInput, 'programId'>> = {},
): ProgrammingProgramDraftInput {
  return {
    programId: program.programId,
    name: changes.name ?? program.name,
    kind: changes.kind ?? program.kind,
    language: changes.language ?? program.language,
    document: changes.document ?? program.document,
  }
}

function programSource(program: ProgrammingProgram): string {
  if (typeof program.document === 'string') return program.document
  return JSON.stringify(program.document)
}

function ProjectTagsEditor({ canEdit, value, saving, onChange, onSave }: { canEdit: boolean; value: string; saving: boolean; onChange: (value: string) => void; onSave: () => Promise<boolean> }) {
  const { pick } = useI18n()
  return (
    <div className="mb-3 border-b border-[var(--c-border)] pb-3">
      <label className="text-xs font-semibold text-[var(--c-text-dim)]" htmlFor="programming-project-functional-tags">{pick('Nhóm chức năng', 'Functional tags')}</label>
      <input id="programming-project-functional-tags" value={value} readOnly={!canEdit} onChange={(event) => onChange(event.target.value)} placeholder={pick('AHU, Nhiệt độ gió cấp', 'AHU, Supply air temperature')} className="mt-1 w-full rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1 text-xs text-[var(--c-text)]" />
      {canEdit && <Button className="mt-1" size="sm" variant="ghost" loading={saving} onClick={() => void onSave()}>{pick('Lưu nhóm', 'Save tags')}</Button>}
    </div>
  )
}

/**
 * `DEV-PROG-004` — nút "Lưu thuộc tính" phát ĐÚNG những operation cần thiết.
 *
 * Tên/loại đi `upsertProgram`; chú thích đi `annotateObject`. Gộp cả hai vào
 * `upsertProgram` sẽ kéo theo mã nguồn trong cùng một lần ghi — xem
 * `sameIdentityMetadata`. Không có gì đổi ở nhóm nào thì nhóm đó KHÔNG phát
 * operation: một batch chứa thao tác thừa vẫn ghi đè, chỉ là ghi đè bằng đúng
 * giá trị cũ, và nó che mất xung đột ETag thật.
 */
function programPropertyOperations(
  program: ProgrammingProgram,
  draft: ProgramMetadataDraft,
  normalizedName: string,
): ProgrammingDraftOperation[] {
  const stored = metadataOf(program)
  const operations: ProgrammingDraftOperation[] = []
  if (!sameIdentityMetadata(draft, stored)) {
    operations.push({ op: 'upsertProgram', program: programDraftInput(program, { name: normalizedName, kind: draft.kind }) })
  }
  if (program.objectId && (draft.description !== stored.description || draft.access !== stored.access)) {
    operations.push({
      op: 'annotateObject',
      objectId: program.objectId,
      ...(draft.description !== stored.description ? { description: draft.description } : {}),
      ...(draft.access !== stored.access ? { access: draft.access } : {}),
    })
  }
  return operations
}

function ProgramInspector({ program, programs, draft, canEdit, saving, onChange, onSave }: { program: ProgrammingProgram; programs: ProgrammingProgram[]; draft: ProgramMetadataDraft; canEdit: boolean; saving: boolean; onChange: (draft: ProgramMetadataDraft) => void; onSave: (operations: ProgrammingDraftOperation[]) => Promise<boolean> }) {
  const { pick } = useI18n()
  const dirty = !sameMetadata(draft, metadataOf(program))
  const normalizedName = draft.name.trim()
  /* Draft cũ có thể chứa display name từng được backend chấp nhận trước khi
   * grammar POU được siết (ví dụ tên có khoảng trắng). Không tô lỗi đỏ ngay
   * khi chỉ mở Inspector, và đặc biệt không khoá việc lưu Mô tả/Truy cập của
   * POU đó. Validation fail-closed bắt đầu khi người dùng THỰC SỰ đổi tên;
   * backend vẫn là authority cuối cùng cho request đổi tên. */
  const nameChanged = normalizedName !== program.name.trim()
  const invalidName = nameChanged && !isValidPouName(normalizedName)
  const duplicateName = nameChanged && isDuplicateProgramName(programs, normalizedName, program.programId)
  const nameHelpId = `program-name-help-${program.programId}`
  const nameInputId = `program-name-${program.programId}`
  const kindInputId = `program-kind-${program.programId}`
  const kindHelpId = `program-kind-help-${program.programId}`
  const accessInputId = `program-access-${program.programId}`
  const descriptionInputId = `program-description-${program.programId}`
  return (
    <section className="rounded-[var(--radius)] bg-[var(--c-surface-2)] p-2">
      <h3 className="text-xs font-semibold text-[var(--c-text-dim)]">{pick('Thuộc tính POU', 'POU properties')}</h3>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div className="text-xs text-[var(--c-text-dim)]">
          <label htmlFor={nameInputId}>{pick('Tên', 'Name')}</label>
          <input
            id={nameInputId}
            className="mt-1 w-full rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1 text-sm text-[var(--c-text)]"
            value={draft.name}
            readOnly={!canEdit}
            aria-invalid={invalidName || duplicateName || undefined}
            aria-describedby={(invalidName || duplicateName) ? nameHelpId : undefined}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
          />
          {invalidName && (
            <span id={nameHelpId} className="mt-1 block text-xs font-normal normal-case text-[var(--c-fault-fg)]">
              {pick('Tên phải bắt đầu bằng chữ, chỉ gồm chữ, số hoặc dấu gạch dưới, dài tối đa 64 ký tự và không là từ khóa ST.', 'Name must start with a letter, contain only letters, digits or underscores, be at most 64 characters, and not be an ST keyword.')}
            </span>
          )}
          {!invalidName && duplicateName && <span id={nameHelpId} className="mt-1 block text-xs font-normal normal-case text-[var(--c-fault-fg)]">{pick('Tên đã được dùng bởi chương trình khác.', 'This name is already used by another program.')}</span>}
        </div>
        {/* Help text nằm NGOÀI <label> và nối bằng `aria-describedby`: nhét nó
            vào trong label làm accessible name của <select> bị dính cả câu giải
            thích ("Loại ..." thay vì "Loại"), đúng cái bẫy mà bản cũ phải lách
            bằng regex `/^Loại/` trong test. */}
        <div className="text-xs text-[var(--c-text-dim)]">
          <label htmlFor={kindInputId}>{pick('Loại', 'Kind')}</label>
          {/* `PPI-001` — bản WP-02 ở đây nói SAI về backend kể từ khi user POU
           * hạ cánh. `attachLocalPOUSources()` (checks.go) thu MỌI
           * `revision.POUObjects` kind khác PROGRAM cùng PROJECT library entry
           * vào `LinkedPOUs` và gửi kèm source cho compiler; `compilerInputs()`
           * đếm chúng vào `MaxUserPou`. Nên FUNCTION/FUNCTION_BLOCK ĐƯỢC Check
           * biên dịch, và `PouExplorer` cũng đã cho tạo cả hai loại. Giữ lại
           * cảnh báo "đổi về PROGRAM trước khi Kiểm tra" là hướng người dùng
           * phá chính POU của họ.
           *
           * Kind là IDENTITY lúc tạo, không phải thuộc tính sửa sau: mỗi kind
           * ra đời với header source riêng (`pouSourceTemplate()`), và BE chỉ
           * kiểm kind thuộc `pouKinds` chứ KHÔNG kiểm header khớp kind — đổi
           * kind mà không viết lại source thì Check đỏ ở tầng parser với lỗi
           * không nói gì về nguyên nhân. Vì vậy hiện đúng giá trị thật ở dạng
           * chỉ đọc và chỉ tay tới đường tạo POU, thay vì mở một dropdown dẫn
           * tới trạng thái không biên dịch được. */}
          <select id={kindInputId} className="mt-1 w-full rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1 text-sm text-[var(--c-text)] disabled:opacity-100" value={draft.kind} disabled aria-describedby={kindHelpId}>
            <option value="PROGRAM">PROGRAM</option>
            <option value="FUNCTION">FUNCTION</option>
            <option value="FUNCTION_BLOCK">FUNCTION_BLOCK</option>
            {!['PROGRAM', 'FUNCTION', 'FUNCTION_BLOCK'].includes(draft.kind) && <option value={draft.kind}>{draft.kind}</option>}
          </select>
          <span id={kindHelpId} className="mt-1 block text-xs font-normal normal-case text-[var(--c-text-dim)]">
            {pick('Loại được đặt khi tạo POU và không đổi được ở đây — mỗi loại có khung mã nguồn riêng. Tạo POU mới trong cây POU nếu cần loại khác.', 'Kind is set when the POU is created and cannot be changed here — each kind has its own source skeleton. Create a new POU in the POU tree if you need a different kind.')}
          </span>
        </div>
      </div>
      {/* `DEV-PROG-004` — Mô tả (nhiều dòng) và Truy cập (một dòng). Hai ô này
          ghi bằng `annotateObject`, KHÔNG bằng `upsertProgram`: xem lý do ở
          `sameIdentityMetadata`. */}
      <div className="mt-2 grid gap-2">
        <label className="text-xs text-[var(--c-text-dim)]" htmlFor={accessInputId}>
          {pick('Truy cập', 'Access')}
          <input
            id={accessInputId}
            className="mt-1 w-full rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1 text-sm text-[var(--c-text)]"
            value={draft.access}
            readOnly={!canEdit}
            maxLength={120}
            placeholder={pick('ví dụ: Kỹ sư vận hành', 'e.g. Commissioning engineer')}
            onChange={(event) => onChange({ ...draft, access: event.target.value })}
          />
          <span className="mt-1 block text-[10px] font-normal normal-case text-[var(--c-text-dim)]">
            {pick('Ghi chú của người dùng. Quyền thật do máy chủ quyết định, không phải ô này.',
                  'A human note. Real permissions are decided by the server, not by this field.')}
          </span>
        </label>
        <label className="text-xs text-[var(--c-text-dim)]" htmlFor={descriptionInputId}>
          {pick('Mô tả', 'Description')}
          <textarea
            id={descriptionInputId}
            rows={3}
            className="mt-1 w-full rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1 text-sm text-[var(--c-text)]"
            value={draft.description}
            readOnly={!canEdit}
            maxLength={2048}
            onChange={(event) => onChange({ ...draft, description: event.target.value })}
          />
        </label>
      </div>
      {canEdit && !program.objectId && (draft.description !== '' || draft.access !== '') && (
        /* POU không có `objectId` (document v1) thì `annotateObject` không có
           đích để vá. Nói ra thay vì để nút Lưu chạy xong mà chú thích biến
           mất ở lần tải lại kế tiếp. */
        <p role="status" className="mt-1 text-xs text-[var(--c-warn-fg)]">
          {pick('POU này chưa có objectId nên chưa lưu được Mô tả/Truy cập. Lưu mã nguồn một lần để Draft nâng lên v2 rồi thử lại.',
                'This POU has no objectId yet, so description/access cannot be stored. Save the source once to upgrade the draft to v2, then retry.')}
        </p>
      )}
      {canEdit && <Button className="mt-2" size="sm" loading={saving} disabled={!dirty || invalidName || duplicateName} onClick={() => void onSave(programPropertyOperations(program, draft, normalizedName))}>{pick('Lưu thuộc tính', 'Save properties')}</Button>}
    </section>
  )
}

interface StSymbol { name: string; type: string; offset: number; references: number }

/**
 * Bảng ký hiệu cho khay "Ký hiệu & kiểu", autocomplete và bảng lệnh nhanh.
 *
 * `T59-805`: đọc từ `buildStReferenceIndex` thay vì tự quét regex lần thứ hai.
 * Bản cũ chỉ nhận sáu kiểu cơ bản nên **instance FUNCTION_BLOCK không tồn tại**
 * với editor: chèn `TON_1 : TON;` xong thì gõ `TON_` không được gợi ý và khay
 * ký hiệu không thấy nó. Một nguồn duy nhất cho cả điều hướng lẫn gợi ý thì
 * không có chỗ cho hai câu trả lời khác nhau về cùng một nguồn.
 *
 * `references` nay đếm nơi DÙNG (không tính chính dòng khai báo) và phân biệt
 * hoa thường đúng như grammar §10 — con số cũ đếm cả khai báo và gộp hoa
 * thường, tức luôn lớn hơn thực tế ít nhất một.
 */
export function collectStSymbols(source: string): StSymbol[] {
  return buildStReferenceIndex(source).symbols.map((entry) => ({
    name: entry.name,
    type: entry.typeName,
    offset: entry.declarationOffset,
    references: entry.occurrences.length,
  }))
}

export { type StInterfaceVariable, collectStFunctionReturnType, collectStInterfaceVariables } from './stInterfaceVariables'

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

/** `formatStSource` chỉ thêm/bớt khoảng trắng (thụt lề, xuống dòng) — KHÔNG
 *  bao giờ đổi thứ tự hay nội dung ký tự không-trắng (đúng theo cách cài
 *  đặt: tách dòng + trim + thêm indent, không đụng ký tự thật). Giữ đúng vị
 *  trí con trỏ qua Format bằng cách đếm số ký tự không-trắng trước con trỏ ở
 *  bản cũ rồi tìm lại đúng vị trí đó ở bản mới — không dùng offset thô (offset
 *  thô sai ngay khi số dòng đổi). */
export function mapOffsetByNonWhitespaceCount(before: string, after: string, offset: number): number {
  const target = before.slice(0, offset).replace(/\s/g, '').length
  if (target === 0) return 0
  let count = 0
  for (let index = 0; index < after.length; index += 1) {
    if (!/\s/.test(after[index])) {
      count += 1
      if (count === target) return index + 1
    }
  }
  return after.length
}

/** "Thay tất cả" đổi cả nội dung (không chỉ khoảng trắng) nên không dùng
 *  được cách đếm ký tự không-trắng ở trên — cộng dồn đúng chênh lệch độ dài
 *  của từng lần thay THẬT SỰ xảy ra trước vị trí con trỏ cũ. */
export function mapOffsetAcrossReplaceAll(before: string, searchText: string, replaceText: string, offset: number): number {
  if (!searchText) return offset
  let delta = 0
  let cursor = 0
  while (true) {
    const index = before.indexOf(searchText, cursor)
    if (index === -1 || index >= offset) break
    delta += replaceText.length - searchText.length
    cursor = index + searchText.length
  }
  return Math.max(0, offset + delta)
}
/**
 * `DEV-PROG-019` — `formatStSource` (formatter bằng regex) ĐÃ BỊ GỠ.
 *
 * Nó tách dòng bằng `.replace(/;/g, ';\n')` và một regex từ khoá, cả hai đều
 * không biết mình đang ở trong chú thích hay chuỗi. Đo được:
 *
 * ```text
 * vào : (* chú thích có dấu ; và chữ IF bên trong *)
 * ra  : (* chú thích có dấu ;\n và chữ \nIF\n bên trong *)
 * ```
 *
 * Tức nó phá chú thích của người dùng, và với ST thật (IF lồng, CASE, chuỗi,
 * chú thích khối) nó phá được cả mã. Bản thay thế nằm ở `./stFormat`: lexer →
 * parser → AST → in lại → parse lần hai → so cây; khác cây thì KHÔNG format.
 */
