import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useI18n } from '../../../shared/i18n'
import { useAuth } from '../../auth'
import { StateBlock } from '../../../shared/components/StateBlock'
import { Button } from '../../../shared/components/Button'
import { useDraftWorkspace } from './useDraftWorkspace'
import { useViewportFillHeight } from './useViewportFillHeight'
import { clearLibraryInsertIntent, readLibraryInsertIntent } from '../shared/libraryInsertIntent'
const ProgramsTab = lazy(() => import('./editor/ProgramsTab').then((m) => ({ default: m.ProgramsTab })))
import { MappingTab } from './mapping/MappingTab'
import { ExecutionTab } from './task/ExecutionTab'
import { Modal } from '../../../shared/components/Modal'
import { useProgrammingRuntimeContext } from '../layout/ProgrammingLayout'
import type { ProgrammingDiagnostic, ProgrammingDraftOperation } from '../model/types'
import { toWorkspaceDocument } from '../model/draftV2'
import { draftSignals } from '../model/signals'
import { PouExplorer } from './pou/PouExplorer'
import { programmingCompatibility } from '../shared/programmingCompatibility'
import { useProgrammingRuntimeMonitor, useProgrammingCapabilities, useProgrammingRuntime, useProgrammingRevision, useProgrammingRevisionComparison, useProgrammingCheck } from '../api/queries'
import { runtimeOverlayByProgramId, userPouInterfacesFromDraft } from './editor/workspaceAdapters'
import { programsWorkspacePath } from '../shared/programsRoute'
import { PROGRAMS_WORKSPACE_V2_ENABLED } from '../../../shared/config'
import { DesignWorkbench } from './workbench/DesignWorkbench'
import { LiveProgramView } from './LiveProgramView'
import { SimulateWorkspace } from '../simulation/SimulateWorkspace'
import { useSimulation } from '../simulation/useSimulation'
import { currentSession, simulationWatchRows } from '../simulation/simulationSession'
import { activeProgramSource } from '../overview/activeProgramSet'
import { ProgramsModeSwitcher } from './ProgramsModeSwitcher'
import { programsModeCapabilities } from '../shared/programsMode'
import { isProgramsWorkspaceMode, type ProgramsWorkspaceMode } from '../shared/programsRoute'
import { useProgrammingMobileReadOnly } from '../layout/useProgrammingViewport'
import { CompareDrawer } from './compare/CompareDrawer'
import { compareGateFor, type CompareEntry } from './compare/compareModel'
import type { FbdSelection } from '../fbd/commands'
import type { FbdDocument } from '../fbd/model'
import { useProgrammingActionAllowed } from '../api/authorization'

const VALID_TABS = ['programs', 'mapping', 'execution'] as const
type DesignTab = (typeof VALID_TABS)[number]

const TAB_LABEL: Record<DesignTab, [string, string]> = {
  programs: ['Chương trình', 'Programs'],
  mapping: ['Điểm & Ánh xạ', 'Points & Mapping'],
  execution: ['Thực thi', 'Execution']
}

/* D-01: PGM-02 không còn tự chạy Check nên không còn nguồn diagnostic nào ở
 * trang này — hằng số module-level tránh tạo mảng rỗng mới mỗi render. */
const EMPTY_DIAGNOSTICS: ProgrammingDiagnostic[] = []

function fbdSelectionForCompare(
  source: unknown,
  change: Extract<CompareEntry, { kind: 'FBD' }>['change'],
): FbdSelection | null {
  if (!change.elementId) return null
  let candidate: unknown = source
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate) as unknown
    } catch {
      return null
    }
  }
  if (!candidate || typeof candidate !== 'object' || !Array.isArray((candidate as { networks?: unknown }).networks)) {
    return null
  }
  const document = candidate as FbdDocument
  if (change.element === 'NETWORK') {
    return document.networks.some((network) => network.id === change.elementId)
      ? { kind: 'network', networkId: change.elementId }
      : null
  }
  for (const network of document.networks) {
    if (change.element === 'NODE' && network.nodes.some((node) => node.id === change.elementId)) {
      return { kind: 'node', networkId: network.id, nodeId: change.elementId }
    }
    if (change.element === 'WIRE' && network.wires.some((wire) => wire.id === change.elementId)) {
      return { kind: 'wire', networkId: network.id, wireId: change.elementId }
    }
    if (change.element === 'PORT') {
      const node = network.nodes.find((item) => item.ports.some((port) => port.id === change.elementId))
      if (node) return { kind: 'port', networkId: network.id, nodeId: node.id, portId: change.elementId }
    }
  }
  return null
}

/**
 * PGM-02 Thiết kế — `UJ-PROG-02/03/04` (TASK-PROG-501..503). Một workspace,
 * ba tab, một context Draft/ETag. D-01: Check/Problems giờ ở PGM-05
 * (`CheckCommissionPage`) — trang này chỉ lưu rồi điều hướng, có dirty guard
 * (DDD-FE-PROG-001 §0.1). Tab là trạng thái URL, đọc/ghi bằng `replace`
 * trong `useEffect` (không setState lúc render).
 */
/**
 * T59-306: `route` cố định tab theo ROUTE ĐÍCH của IA sáu trang (DDD §8). Route
 * thắng query vì URL đích là nguồn sự thật — nếu query thắng thì
 * `/mapping?tab=programs` sẽ hiện một trang không khớp địa chỉ của chính nó.
 *
 * T59-501 sửa hai hệ quả mà `--wave W3` không bắt được vì ma trận cổng của W3
 * không có `e2e`:
 *
 * 1. Thanh tab BẤM KHÔNG ĂN trên `/programs` và `/mapping`. Nút chỉ ghi lại
 *    `?tab=`, mà `route` thì ghi đè query — người dùng bấm và không có gì xảy
 *    ra. Nay nút ĐIỀU HƯỚNG sang đúng route của IA.
 * 2. `execution` mất chỗ hiển thị. Nó KHÔNG phải một trong sáu trang IA mà là
 *    một tab con, nên nó chỉ sống dưới dạng `?tab=execution` — và đúng dạng đó
 *    lại bị `route` ghi đè. Nay `execution` là ngoại lệ tường minh: query
 *    thắng route CHỈ cho giá trị này, đúng nơi mà `/task` (lối vào cũ) và nút
 *    tab cùng trỏ tới.
 */
export function DesignWorkspacePage({
  route,
  projectIdOverride,
  mobileReadOnlyOverride
}: {
  route?: DesignTab
  projectIdOverride?: string
  mobileReadOnlyOverride?: boolean
} = {}) {
  const { pick } = useI18n()
  const { session } = useAuth()
  const navigate = useNavigate()
  /* `T59-814` — capability là nguồn sự thật cho SIMULATE. Đọc ở đây thay vì
     hardcode trong `programsModeCapabilities` để một thiết bị thiếu worker mô
     phỏng không bị hứa hẹn một chế độ nó không có. */
  const capabilities = useProgrammingCapabilities()
  /* `T59-815` — vòng đời phiên SIMULATE. Hook luôn được gọi (luật hook), nhưng
     nó chỉ poll khi thực sự có phiên sống, nên EDIT/LIVE không sinh tải nào. */
  const simulation = useSimulation()
  const runtime = useProgrammingRuntime()
  const { setEditingContext } = useProgrammingRuntimeContext()
  const detectedMobileReadOnly = useProgrammingMobileReadOnly()
  const mobileReadOnly = mobileReadOnlyOverride ?? detectedMobileReadOnly
  const { projectId: routeProjectId } = useParams<{ projectId: string }>()
  const projectId = projectIdOverride ?? routeProjectId
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('tab')
  /* Mode là state URL. Tính trước mọi hook/query để LIVE là nơi DUY NHẤT mở
   * monitor subscription; rời LIVE phải cleanup ngay cả khi component không
   * unmount vì route canonical chỉ đổi query. */
  const modeParam = searchParams.get('mode')
  const workspaceMode: ProgramsWorkspaceMode = isProgramsWorkspaceMode(modeParam) ? modeParam : 'EDIT'
  /* `ISS-STED-19` — CỔNG TƯƠNG THÍCH PHIÊN BẢN.
   *
   * Bundle FE mang sẵn hồ sơ ngôn ngữ ST, registry thư viện POU và ABI của
   * phiên bản nó được build ra. Nếu thiết bị chạy phiên bản khác thì palette,
   * từ khoá và chữ ký hàm trên màn hình đang nói về một ngôn ngữ KHÁC với
   * ngôn ngữ bo sẽ biên dịch. Trước đây các hằng này được sinh vào bundle
   * nhưng không ai đọc, nên lệch đi qua trong im lặng.
   *
   * Chặn ở `canEdit` (chứ không chỉ hiện băng cảnh báo) là có chủ ý: cảnh báo
   * mà vẫn cho gõ thì người dùng vẫn gõ, và cái họ gõ ra mới là thứ gây hại. */
  const compatibility = programmingCompatibility(
    capabilities.data?.compatibility,
    /* PENDING chỉ khi CHƯA có gì để so. Lần poll 5 s sau đó cũng đặt
     * `status === 'loading'` trong chốc lát; coi đó là PENDING sẽ nháy chặn
     * soạn thảo mỗi 5 giây dù đã biết thừa hai phiên bản là khớp. */
    capabilities.status === 'loading' && !capabilities.data,
  )
  const canEdit =
    useProgrammingActionAllowed('editDraft') &&
    !mobileReadOnly &&
    workspaceMode === 'EDIT' &&
    compatibility.editingAllowed
  const canSimulate = useProgrammingActionAllowed('simulation')
  /* `DEV-PROG-024` — xem khối chú thích ở chỗ dùng, phía dưới. Sàn `24rem`
   * (384 px) cố ý NHỎ hơn ngân sách của khổ 800 px: sàn lớn hơn ngân sách chính
   * là cách `DEV-PROG-021` tạo ra tràn dọc. */
  const [workspaceColumnRef, workspaceColumnHeight] = useViewportFillHeight<HTMLDivElement>({
    bottomGapPx: 24,
    minPx: 384,
    minViewportWidthPx: 1024,
  })
  const fromQuery: DesignTab = (VALID_TABS as readonly string[]).includes(requested ?? '') ? (requested as DesignTab) : 'programs'
  /* `execution` là tab con, không phải trang IA: nó chỉ có địa chỉ dưới dạng
   * `?tab=execution` trên route `programs`. Mọi giá trị khác thì route thắng. */
  const tab: DesignTab = requested === 'execution' ? 'execution' : (route ?? fromQuery)
  // BUG-007 — cho phép deep-link `?program=<id>` từ ProblemsDrawer của PGM-05
  // (Check) chọn sẵn đúng Program bị lỗi khi mở workspace Thiết kế.
  /*
   * `T61-405` / `ISS-PGM04-14` — ý định chèn khối do PGM-04 gửi sang.
   *
   * Nó là một lệnh DÙNG MỘT LẦN: gỡ khỏi URL ngay khi đã ngã ngũ, nếu không mỗi
   * lần tải lại trang lại mời chèn cùng một khối, và người dùng bấm Đồng ý theo
   * phản xạ sẽ chèn nó hai lần. `replace: true` để nút Quay lại của trình duyệt
   * không đưa họ về đúng cái URL vừa dọn.
   */
  const insertIntent = useMemo(() => readLibraryInsertIntent(searchParams), [searchParams])
  const clearInsertIntent = useCallback(() => {
    setSearchParams((current) => clearLibraryInsertIntent(current), { replace: true })
  }, [setSearchParams])

  const [selectedPouId, setSelectedPouId] = useState<string | undefined>(() => searchParams.get('pou') ?? searchParams.get('program') ?? undefined)
  const queryPouId = searchParams.get('pou') ?? undefined
  /* URL là nguồn chân lý của POU đang mở, không chỉ ở lần mount đầu.
   *
   * Trước `T59-803`, `selectedPouId` chỉ đọc query MỘT LẦN lúc mount. Điều đó
   * còn chạy được khi mỗi Project có route riêng — đi tới đó là remount. Sau
   * cut-over PGM-02, một cú nhảy chẩn đoán từ PGM-05 chỉ đổi QUERY trên cùng
   * route, nên workspace giữ nguyên POU cũ và người dùng bấm vào lỗi mà không
   * có gì mở ra. Effect này nhận thay đổi query; chọn POU trong ứng dụng thì
   * ghi ngược lại query (bằng `replace`) để reload giữ đúng POU đang mở. */
  useEffect(() => {
    if (queryPouId === undefined || queryPouId === selectedPouId) return
    setSelectedPouId(queryPouId)
  }, [queryPouId, selectedPouId])
  /* D-01/F-PROG-ASBUILT-003: PGM-05 giờ sở hữu Check/Problems (không phải ở
   * đây nữa) — khi người dùng bấm một diagnostic ở đó, nó điều hướng sang đây
   * kèm `line/column/length` trong query string thay vì state cùng trang.
   * Đọc một lần lúc mount, đúng pattern `selectedProgramId` ở trên.
   *
   * `T59-807`: setter được mở lại — KHÔNG phải để trang tự chạy Check (D-01 vẫn
   * giữ nguyên: PGM-05 sở hữu Check), mà để workbench nhảy tới một vị trí trong
   * POU đang mở. Dùng lại đúng cơ chế neo `line/column/length` đã có thay vì
   * dựng đường nhảy thứ hai. */
  const [focusDiagnostic, setFocusDiagnostic] = useState<ProgrammingDiagnostic | null>(() => {
    const programId = searchParams.get('program')
    const line = searchParams.get('line')
    const column = searchParams.get('column')
    if (!programId || !line || !column) return null
    const length = searchParams.get('length')
    return {
      code: '', severity: 'ERROR', messageKey: '',
      location: { programId, line: Number(line), column: Number(column), length: length ? Number(length) : 1 }
    }
  })
  const [programOperations, setProgramOperations] = useState<ProgrammingDraftOperation[]>([])
  const [executionOperations, setExecutionOperations] = useState<ProgrammingDraftOperation[]>([])
  const [discardVersion, setDiscardVersion] = useState(0)
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null)
  const [savingBeforeNavigation, setSavingBeforeNavigation] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  /* `DEV-PROG-003` — yêu cầu theo dõi một biến, phát từ nháy đúp trong trình
   * soạn thảo và tiêu thụ ở workbench. `nonce` là bắt buộc: nháy đúp hai lần
   * vào CÙNG một biến vẫn phải mở lại khay Watch, mà so theo tên thì lần thứ
   * hai không có gì đổi để `useEffect` bên kia nhận ra. */
  const [watchAddRequest, setWatchAddRequest] = useState<{ name: string; nonce: number } | null>(null)
  const watchVariable = useCallback((name: string) => {
    setWatchAddRequest((current) => ({ name, nonce: (current?.nonce ?? 0) + 1 }))
  }, [])
  const compareTriggerRef = useRef<HTMLButtonElement>(null)
  const [compareFbdFocus, setCompareFbdFocus] = useState<{ programId: string; selection: FbdSelection } | null>(null)

  useEffect(() => {
    /* Trên route của IA sáu trang, ĐỊA CHỈ đã mang tab — ghi thêm `?tab=` chỉ
     * tạo một URL thứ hai cho cùng một trang, và chính vòng ghi đó là thứ làm
     * `/programs` điều hướng lại chính nó ở e2e. Chỉ đồng bộ query cho lối vào
     * cũ (không có `route`) và cho `execution`, thứ không có route riêng. */
    if (route && tab !== 'execution') {
      if (requested && requested !== 'execution') {
        setSearchParams(
          (current) => {
            const next = new URLSearchParams(current)
            next.delete('tab')
            return next
          },
          { replace: true }
        )
      }
      return
    }
    if (requested === tab) return
    /* Trên route canonical PGM-02 v2, tab do query quyết định (không có prop
     * `route`). Tab mặc định KHÔNG được ghi `?tab=programs`: canonical URL phải
     * là một chuỗi ổn định, còn mỗi param thừa lại là một biến thể mà resolver
     * phải so lại và có thể tự điều hướng vòng. */
    if (!route && !requested && tab === 'programs') return
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.set('tab', tab)
        return next
      },
      { replace: true }
    )
  }, [requested, route, tab, setSearchParams])

  const workspace = useDraftWorkspace(projectId)
  const monitor = useProgrammingRuntimeMonitor(workspaceMode === 'LIVE')
  /* `toWorkspaceDocument` cấp object/array mới. Nếu gọi trực tiếp dưới render,
   * mỗi lần monitor poll sẽ làm ProgramsTab tưởng Draft đổi, phát lại
   * `onPendingOperationsChange([])` rồi cha set state bằng một mảng mới: vòng
   * render vô hạn (`Maximum update depth exceeded`) chỉ lộ trên browser thật.
   * Neo adapter theo đúng payload Draft authority; monitor thay đổi không được
   * làm identity của tài liệu chỉnh sửa thay đổi theo. */
  const workspaceDocument = useMemo(
    () => workspace.project?.draft ? toWorkspaceDocument(workspace.project.draft) : null,
    [workspace.project?.draft]
  )
  const pendingOperations = useMemo(() => [...programOperations, ...executionOperations], [executionOperations, programOperations])
  const draftDirty = pendingOperations.length > 0
  const compareGate = useMemo(() => compareGateFor({
    dirty: draftDirty,
    activeRevisionId: workspace.project?.activeRevisionId ?? null,
    // `dirty === false` là read-back duy nhất xác nhận base hiện tại đại diện
    // đúng nội dung Draft. `null` không được suy thành sạch.
    sealedRevisionId: workspace.project?.dirty === false ? workspace.project.baseRevisionId : null,
  }), [draftDirty, workspace.project?.activeRevisionId, workspace.project?.baseRevisionId, workspace.project?.dirty])
  const comparison = useProgrammingRevisionComparison(
    compareOpen && compareGate.kind === 'READY' ? compareGate.fromRevisionId : undefined,
    compareOpen && compareGate.kind === 'READY' ? compareGate.toRevisionId : undefined,
  )

  /* `T59-821` — ĐÚNG MỘT đường đổi mode. Nút "Về bản nháp" của thanh LIVE gọi
   * chính hàm này thay vì tự navigate: hai đường đổi mode sẽ lệch nhau đúng lúc
   * một trong hai bị quên cập nhật, và mode là trạng thái của TOÀN workspace. */
  const switchWorkspaceMode = useCallback((next: ProgramsWorkspaceMode) => {
    setCompareOpen(false)
    const query = new URLSearchParams(searchParams)
    query.set('mode', next)
    navigate(programsWorkspacePath(projectId ?? '', { search: query.toString() }), { replace: true })
  }, [navigate, projectId, searchParams])

  const closeCompare = useCallback(() => {
    setCompareOpen(false)
    window.requestAnimationFrame(() => compareTriggerRef.current?.focus())
  }, [])

  /* `T59-815` — phiên mô phỏng chỉ mở được trên Revision ĐÃ Kiểm tra đạt.
   *
   * Không tự chọn `draftRevisionId` hay `baseRevisionId`: worker chỉ nhận
   * artifact bất biến do chính pipeline Check sinh ra (`ADR-053` §3), nên một
   * Revision chưa Check thì chưa có gì để chạy. Nói ra điều đó tốt hơn là gửi
   * lên rồi nhận lỗi. */
  const latestCheck = workspace.project?.latestCheck
  const simulateRevisionId = latestCheck && latestCheck.state === 'PASSED' ? latestCheck.revisionId : null
  /* `ISS-STED-04` — nối lại đường ĐỌC kết quả Check gần nhất về trang soạn thảo.
   *
   * `D-01` chuyển quyền SỞ HỮU Check sang PGM-05 (một luồng seal/run/poll duy
   * nhất) và đó vẫn đúng — đây chỉ là đường đọc, KHÔNG dựng bộ kiểm thứ hai ở
   * FE và KHÔNG biến thành check-as-you-type. Khi gỡ Check khỏi PGM-02 thì
   * đường đọc này bị bỏ quên, nên toàn bộ hạ tầng gạch lỗi trong `SourceEditor`
   * trở thành mã chết: `diagnostics={EMPTY_DIAGNOSTICS}` là hằng số rỗng. */
  const latestCheckResult = useProgrammingCheck(latestCheck?.checkId)
  const checkDiagnostics = latestCheckResult.data?.diagnostics ?? EMPTY_DIAGNOSTICS
  /* "Đã từng Kiểm tra" bám vào việc CÓ kết quả tải về, không bám vào việc có
   * diagnostic: một Check đạt cũng là đã kiểm, và trạng thái "chưa kiểm tra"
   * phải khác hẳn "kiểm rồi, sạch". */
  const hasCheckResult = latestCheckResult.data !== undefined
  /* `ISS-STED-13` — bảng ký hiệu của compiler, để `ProgramsTab` đối chiếu với
   * chỉ mục regex của mình. `undefined` (server đời cũ) khác `[]` (POU không
   * khai cổng nào): chỉ cái sau mới là một câu trả lời. */
  const checkSymbols = latestCheckResult.data?.symbols
  const checkState = latestCheckResult.data?.state ?? latestCheck?.state ?? null
  /* Revision mà PHIÊN đang mở đã niêm phong — khác `simulateRevisionId` (bản
   * Check đạt gần nhất): một phiên đang chạy có thể neo vào bản cũ hơn nếu
   * người dùng vừa lưu và Check thêm một lần nữa. Workbench phải nói theo
   * phiên, không theo bản mới nhất. */
  const simulationSourceRevisionId = currentSession(simulation.slice)?.sourceDraftRevisionId
    ?? simulateRevisionId
  const simulateRevision = useProgrammingRevision(
    workspaceMode === 'SIMULATE' ? simulationSourceRevisionId : null)
  /* LIVE đọc bản đang chạy ở TRANG CHA rồi truyền xuống, cùng lý do như
   * `monitor`: hai lần đọc cùng một endpoint cho hai câu trả lời có thể lệch. */
  const liveRevision = useProgrammingRevision(
    workspaceMode === 'LIVE' ? (workspace.project?.activeRevisionId ?? null) : null)
  const startSimulation = useCallback(() => {
    const controllerId = runtime.data?.controllerId
    /* `useProgrammingRevision` trả `unknown` vì snapshot Revision là tài liệu
     * mở; đọc đúng một trường ở đây và kiểm kiểu tại chỗ, thay vì ép kiểu cả
     * đối tượng thành một hình dạng mà nó không hứa. */
    const revisionData = simulateRevision.data as { contentHash?: unknown } | undefined
    const contentHash = typeof revisionData?.contentHash === 'string' ? revisionData.contentHash : null
    /* Thiếu bất kỳ mảnh danh tính nào thì KHÔNG gửi: `sourceContentSha256` là
     * thứ duy nhất phân biệt "mô phỏng bản tôi vừa lưu" với "mô phỏng thứ gì
     * đó", nên gửi một chuỗi rỗng để server tự đoán là bỏ đúng chốt chặn ấy. */
    if (!controllerId || !simulateRevisionId || !contentHash || !projectId) return
    void simulation.start({
      controllerId,
      projectId,
      sourceDraftRevisionId: simulateRevisionId,
      sourceContentSha256: contentHash,
    })
  }, [projectId, runtime.data?.controllerId, simulateRevision.data, simulateRevisionId, simulation])

  const updateProgramOperations = useCallback((operations: ProgrammingDraftOperation[]) => setProgramOperations(operations), [])
  const updateExecutionOperations = useCallback((operations: ProgrammingDraftOperation[]) => setExecutionOperations(operations), [])

  /* Dùng chung cho nút "Kiểm tra" ở đây VÀ mục lệnh "Kiểm tra" của Bảng lệnh
   * nhanh (ST Editor Quick Control #2, đã duyệt) — cùng một "dirty guard"
   * D-01: không điều hướng sang Commission khi Draft còn thay đổi chưa lưu. */
  const goToCommission = useCallback(() => {
    if (!canEdit || draftDirty || !projectId) return
    navigate(`/eng/programming/projects/${projectId}/commission`)
  }, [canEdit, draftDirty, navigate, projectId])

  /* D-01: PGM-02 không còn tự chạy Check nên không có `checkState` thật để
   * báo — Check/Commission (PGM-05) là nơi duy nhất cập nhật giá trị này giờ
   * (`CheckCommissionPage`). Giữ nguyên `idle` ở đây thay vì suy đoán. */
  useEffect(() => {
    if (workspace.status !== 'ready' || !workspace.project) return
    setEditingContext({
      projectId: workspace.project.projectId,
      projectName: workspace.project.name,
      draftRevisionId: workspace.project.draftRevisionId,
      dirty: draftDirty,
      checkState: 'idle',
      /* `DEV-PROG-009` — workspace ĐĂNG KÝ hai hành động của nó để header ở
         trên cùng gọi lại. Header không tự dựng batch operation: luật dirty,
         danh sách operation và đường sang PGM-05 đều thuộc về đây, và hai nơi
         cùng dựng một lệnh là hai nơi để luật khoá lệch nhau.

         KHÔNG đăng ký gì khi không được sửa (LIVE, SIMULATE, dưới 768 px, vai
         không đủ quyền). Một nút Lưu bị vô hiệu hoá vẫn là một nút Lưu có mặt
         trên màn hình — và `AC-PGM02-006`/`T59-812` đòi bề mặt LIVE **không lộ
         mutation**, tức đếm bằng 0, chứ không phải "có nhưng bấm không được".
         Vô hiệu hoá là câu trả lời cho "chưa lưu được lúc này"; vắng mặt là câu
         trả lời cho "chế độ này không sửa". */
      ...(canEdit ? {
        actions: {
          onSave: () => { void workspace.save(pendingOperations) },
          saving: workspace.saving,
          saveDisabledReason: draftDirty ? null : pick('Không có thay đổi nào để lưu.', 'There is nothing to save.'),
          onCheck: goToCommission,
          checkDisabledReason: draftDirty
            ? pick('Lưu bản nháp trước khi Kiểm tra — Kiểm tra chạy trên Revision đã niêm phong, không chạy trên buffer đang gõ.',
                   'Save the draft before checking — Check runs on a sealed revision, not on the buffer being typed.')
            : null
        }
      } : {})
    })
    return () => setEditingContext(null)
  }, [canEdit, draftDirty, goToCommission, pendingOperations, pick, setEditingContext, workspace.project, workspace.save, workspace.saving, workspace.status])

  useEffect(() => {
    if (!draftDirty) return undefined
    const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    const interceptInternalLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target
      const anchor = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null
      if (!anchor || anchor.target || anchor.download) return
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin || url.href === window.location.href) return
      event.preventDefault()
      event.stopPropagation()
      setPendingNavigation(`${url.pathname}${url.search}${url.hash}`)
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    globalThis.document.addEventListener('click', interceptInternalLink, true)
    return () => {
      window.removeEventListener('beforeunload', warnBeforeUnload)
      globalThis.document.removeEventListener('click', interceptInternalLink, true)
    }
  }, [draftDirty])

  if (workspace.status === 'loading') {
    return <StateBlock state="loading" title={pick('Đang tải Draft…', 'Loading draft…')} />
  }
  if (workspace.status === 'error' || !workspace.project?.draft) {
    return <StateBlock state="error" title={pick('Không tải được Project.', 'Could not load the project.')} detail={workspace.error ?? undefined} onRetry={workspace.reload} />
  }
  // T59-301: BE trả document v2; adapter chiếu về view model của bốn tab.
  const document = workspaceDocument as NonNullable<typeof workspaceDocument>
  /* Route v2 chọn POU bằng `objectId`; editor cũ vẫn nhận `programId`. Adapter
   * hẹp này chỉ nối hai định danh khi cùng một record Draft khai cả hai, không
   * suy theo tên/index và không dùng objectId làm mutation target sai. */
  const selectedProgram = document.programs.find((program) => (program.objectId ?? program.programId) === selectedPouId)
    ?? (searchParams.has('program') ? document.programs.find((program) => program.programId === searchParams.get('program')) : undefined)
  const selectedProgramId = selectedProgram?.programId
  const selectedObjectId = selectedProgram ? (selectedProgram.objectId ?? selectedProgram.programId) : selectedPouId
  const selectPou = (objectId: string | undefined) => {
    setSelectedPouId(objectId)
    /* Chỉ ghi vào URL khi route canonical đang sở hữu địa chỉ; trên route cũ,
     * `?pou=` không phải là hợp đồng và ghi vào đó là tạo một URL thứ hai cho
     * cùng một trang. */
    if (!PROGRAMS_WORKSPACE_V2_ENABLED) return
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (objectId) next.set('pou', objectId)
        else next.delete('pou')
        return next
      },
      { replace: true }
    )
  }

  const selectProgram = (programId: string | undefined) => {
    if (!programId) {
      selectPou(undefined)
      return
    }
    const program = document.programs.find((item) => item.programId === programId)
    selectPou(program?.objectId ?? programId)
  }
  /* `T59-807` — dữ liệu cho workbench dùng chung.
   *
   * Nguồn văn bản chỉ có với POU ngôn ngữ ST; POU FBD trả `null` để tab Tìm
   * kiếm nói thẳng "không phải mã nguồn văn bản" thay vì hiện một ô nhập vô
   * nghĩa. */
  const draftSource = selectedProgram?.language === 'ST' && typeof selectedProgram.document === 'string'
    ? selectedProgram.document
    : null

  /* `T59-816` — workbench phải đọc ĐÚNG tài liệu của chế độ đang mở.
   *
   * Trước lát này nó luôn đọc buffer Draft, kể cả khi người dùng đang ở LIVE
   * hay SIMULATE. Hậu quả không phải thẩm mỹ: tab Tìm kiếm tìm trong Draft
   * trong khi màn hình chiếu bản đã niêm phong, và khay Tham chiếu đếm số lần
   * dùng của một biến trong một tài liệu KHÁC tài liệu đang chạy. Hai câu trả
   * lời cho cùng một câu hỏi, không có dấu hiệu nào cho biết cái nào đang
   * hiển thị.
   *
   * `sealedSource` là kết quả trang cha đã đọc — LIVE và SIMULATE nhận nó qua
   * prop thay vì tự gọi hook, đúng lý do đã áp cho `monitor`: một endpoint
   * được đọc hai lần cho hai câu trả lời có thể lệch nhau. */
  const sealedSource = workspaceMode === 'SIMULATE'
    ? activeProgramSource({
        activeRevisionId: simulationSourceRevisionId,
        status: simulateRevision.status,
        revision: simulateRevision.data,
        objectId: selectedObjectId ?? null,
      })
    : workspaceMode === 'LIVE'
      ? activeProgramSource({
          activeRevisionId: workspace.project.activeRevisionId ?? null,
          status: liveRevision.status,
          revision: liveRevision.data,
          objectId: selectedObjectId ?? null,
        })
      : null

  const workbenchSource = workspaceMode === 'EDIT' ? draftSource : sealedSource?.source ?? null
  const workbenchSourceLabel = workspaceMode === 'EDIT'
    ? (selectedProgram
        ? `Draft · ${selectedProgram.name}`
        : pick('Draft · chưa chọn POU', 'Draft · no POU selected'))
    : workspaceMode === 'SIMULATE'
      ? pick(`Bản đã niêm phong · ${selectedProgram?.name ?? 'chưa chọn POU'}`,
             `Sealed revision · ${selectedProgram?.name ?? 'no POU selected'}`)
      : pick(`Đang chạy · ${selectedProgram?.name ?? 'chưa chọn POU'}`,
             `Running · ${selectedProgram?.name ?? 'no POU selected'}`)

  /** Nhảy tới một offset trong POU đang mở, dùng lại đúng cơ chế neo
   *  `line/column/length` mà PGM-05 đã dùng — không dựng đường nhảy thứ hai. */
  const jumpToSourceOffset = (offset: number, length: number) => {
    if (!selectedProgramId || workbenchSource === null) return
    const before = workbenchSource.slice(0, offset)
    const lines = before.split('\n')
    setFocusDiagnostic({
      code: '', severity: 'ERROR', messageKey: '',
      location: {
        programId: selectedProgramId,
        line: lines.length,
        column: lines[lines.length - 1].length + 1,
        length: Math.max(1, length),
      },
    })
  }

  /** `ISS-STED-05` — nhảy tới một diagnostic từ khay Vấn đề của workbench.
   *
   * Chọn đúng POU RỒI neo dòng/cột, dùng lại chính `focusDiagnostic` mà PGM-05
   * và khay So sánh đã dùng — không mở đường nhảy thứ hai. Hai đường nhảy song
   * song sẽ lệch nhau đúng lúc một trong hai được sửa. */
  const jumpToDiagnostic = (diagnostic: ProgrammingDiagnostic) => {
    const programId = diagnostic.location?.programId
    if (typeof programId !== 'string') return
    const program = document.programs.find((candidate) => candidate.programId === programId)
    if (program) selectPou(program.objectId ?? program.programId)
    setFocusDiagnostic(diagnostic)
  }

  /* `signals[]` KHÔNG đi qua `toWorkspaceDocument`, nên phải đọc từ draft THÔ.
   * Explorer cần nó để biết POU nào đang publish — điều kiện backend dùng để
   * từ chối `removeProgram`. */
  const publishedSignals = draftSignals(workspace.project.draft)
  const simulationWatch = simulationWatchRows(simulation.slice.frame)
  const runtimeOverlays = runtimeOverlayByProgramId(document.programs, monitor, workspace.project.activeRevisionId)
  const userPouInterfaces = userPouInterfacesFromDraft(workspace.project.draft, selectedProgramId)
  const pouNameByObjectId = new Map(
    document.programs.map((program) => [program.objectId ?? program.programId, program.name] as const),
  )

  const revealCompareEntry = (entry: CompareEntry) => {
    const program = document.programs.find((candidate) => (candidate.objectId ?? candidate.programId) === entry.objectId)
    if (!program) return
    selectPou(entry.objectId)
    if (entry.kind === 'ST') {
      setCompareFbdFocus(null)
      setFocusDiagnostic({
        code: '', severity: 'ERROR', messageKey: '',
        location: {
          programId: program.programId,
          line: entry.hunk.afterStartLine,
          column: 1,
          length: Math.max(1, entry.hunk.afterText[0]?.length ?? 1),
        },
      })
    } else {
      setFocusDiagnostic(null)
      const selection = fbdSelectionForCompare(program.document, entry.change)
      setCompareFbdFocus(selection ? { programId: program.programId, selection } : null)
    }
    // Đây là cú nhảy CÓ NHÃN: để editor nhận focus, không trả focus về trigger
    // như đường Đóng/Escape.
    setCompareOpen(false)
  }

  return (
    <div className="space-y-3">
      {/* F-UX-15 (`REV-FE-UIUX-UC-2026-08-18` §7.1): mỗi màn/tab phải có mốc
          tiêu đề riêng trong cây heading. `<h1>` của route Programming nằm ở
          `ProgrammingLayout` (một và chỉ một), nên ở đây là `<h2>`/`<h3>`.
          Ẩn thị giác vì thanh tab đã hiện tên — thứ còn thiếu là mốc điều
          hướng cho trình đọc màn hình, không phải thêm chữ lên màn hình. */}
      <h2 className="sr-only">{pick('Workspace Thiết kế', 'Design workspace')}</h2>
      {/* `ISS-STED-19` — nêu RÕ HAI PHIÊN BẢN. Một câu "phiên bản không tương
          thích" trống không thì người vận hành không biết phải nạp lại bản nào,
          và cũng không biết bo hay giao diện mới là bên cũ. */}
      {!compatibility.editingAllowed && compatibility.state !== 'PENDING' && (
        <p
          role="alert"
          data-testid="programming-compatibility-block"
          data-compatibility-state={compatibility.state}
          className="rounded-[var(--radius)] border border-[var(--c-danger)] bg-[var(--c-surface-2)] p-3 text-sm text-[var(--c-text)]"
        >
          {compatibility.reason}
        </p>
      )}
      {mobileReadOnly && (
        <p role="status" data-testid="programming-mobile-read-only" className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 text-sm text-[var(--c-text-dim)]">
          {pick('Màn hình nhỏ — chỉ hỗ trợ xem sơ đồ', 'Small screen — diagram view only')}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--c-border)] pb-2">
        <div role="tablist" aria-label={pick('Tab workspace Thiết kế', 'Design workspace tabs')} className="flex gap-1">
          {VALID_TABS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={candidate === tab}
              className={`rounded-t-[var(--radius)] border-b-2 px-3 py-1.5 text-sm font-medium ${
                candidate === tab ? 'border-[var(--c-accent)] text-[var(--c-accent)]' : 'border-transparent text-[var(--c-text-dim)] hover:text-[var(--c-text)]'
              }`}
              onClick={() => {
                /* Điều hướng sang ROUTE của IA thay vì chỉ ghi `?tab=`: trên
                 * `/programs` và `/mapping`, query bị `route` ghi đè nên ghi
                 * query là bấm vào chỗ không có gì xảy ra. */
                const query = new URLSearchParams(searchParams)
                query.delete('tab')
                if (PROGRAMS_WORKSPACE_V2_ENABLED) {
                  /* Cut-over BẬT: cả ba tab ở LẠI route canonical và chỉ đổi
                   * query. Cho tab Ánh xạ nhảy sang `/projects/:id/mapping` sẽ
                   * unmount workspace — và cùng với nó là buffer ST chưa lưu
                   * của người dùng. Trước khi siết chỗ này, journey "đổi tab
                   * không mất nội dung đang gõ" mất trắng nội dung, vì hai địa
                   * chỉ mount hai cây component khác nhau. */
                  if (candidate !== 'programs') query.set('tab', candidate)
                  navigate(programsWorkspacePath(projectId ?? '', { search: query.toString() }), { replace: true })
                  return
                }
                if (candidate === 'execution') query.set('tab', 'execution')
                const target = candidate === 'mapping' ? 'mapping' : 'programs'
                const suffix = query.toString()
                const destination = target === 'programs'
                  ? programsWorkspacePath(projectId ?? '', { search: suffix })
                  : `/eng/programming/projects/${projectId}/${target}${suffix ? `?${suffix}` : ''}`
                navigate(destination, { replace: true })
              }}
            >
              {pick(...TAB_LABEL[candidate])}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* `T59-807` — trước lát này `?mode=` chỉ đổi được bằng cách GÕ TAY
              vào URL, và giao diện không nói workspace đang ở chế độ nào. */}
          <ProgramsModeSwitcher
            mode={workspaceMode}
            draftDirty={draftDirty}
            /* `T59-814` — SIMULATE lấy capability TỪ SERVER. Thiếu
               `workspaceModes` (server đời cũ) thì `simulation` là undefined và
               mode ở trạng thái UNAVAILABLE, không phải "chắc là có". */
            capabilities={programsModeCapabilities(pick, capabilities.data?.workspaceModes?.simulation)}
            onSwitch={switchWorkspaceMode}
          />
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            {/* `T59-821` — `Kiểm tra` và `So sánh` ĐÃ CHUYỂN vào toolbar của
             * chính trình soạn thảo, đúng `PGM-02A §3`. Giữ thêm một bản ở đây
             * sẽ là HAI nút cho cùng một hành động: người dùng phải đoán chúng
             * có khác nhau không, và một lần sửa điều kiện khoá sẽ chỉ áp cho
             * một trong hai.
             *
             * D-01 vẫn nguyên: PGM-02 không tự seal/run Check: nó điều hướng
             * sang PGM-05, nơi sở hữu trọn vòng seal/run/poll/result. */}
          </div>
        )}
      </div>

      {compareOpen && (
        <div className="fixed inset-y-0 right-0 z-50 w-full overflow-y-auto bg-[var(--c-bg)]/95 p-3 shadow-2xl sm:max-w-3xl">
          <CompareDrawer
            gate={compareGate}
            changes={comparison.data}
            pouNameByObjectId={pouNameByObjectId}
            loading={compareGate.kind === 'READY' && comparison.status === 'loading'}
            errorMessage={compareGate.kind === 'READY' ? comparison.error : null}
            loadingMore={comparison.loadingMore}
            loadMoreErrorMessage={comparison.loadMoreError}
            sealing={workspace.sealing}
            sealingErrorMessage={workspace.sealError}
            canSeal={canEdit}
            onSeal={() => { void workspace.seal() }}
            onLoadMore={comparison.loadMore}
            onClose={closeCompare}
            onRevealInEditor={revealCompareEntry}
          />
        </div>
      )}

      {workspace.conflict && (
        <div role="alert" className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-3 text-sm">
          <p className="font-semibold text-[var(--c-warn-fg)]">{pick('Bản nháp đã thay đổi ở phiên khác.', 'The draft changed in another session.')}</p>
          <p className="mt-1 text-[var(--c-text)]">
            {pick('Bản mong đợi', 'Expected')}: <span className="font-mono">{workspace.conflict.expected ?? '—'}</span> · {pick('Bản hiện tại', 'Current')}:{' '}
            <span className="font-mono">{workspace.conflict.actual ?? '—'}</span>
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={workspace.reload}>{pick('Tải lại', 'Reload')}</Button>
            <Button size="sm" variant="ghost" onClick={workspace.dismissConflict}>{pick('Giữ bản đang gõ', 'Keep my edits')}</Button>
          </div>
        </div>
      )}
      {draftDirty && (
        <div role="status" className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-3 text-sm text-[var(--c-warn-fg)]">
          {pick('Draft có thay đổi chưa lưu. Hãy lưu trước khi Kiểm tra.', 'The draft has unsaved changes. Save before running Check.')}
        </div>
      )}

      {/* Cả ba tab luôn MOUNTED, chỉ ẩn bằng CSS (không unmount/remount theo
          `tab`). Bắt buộc: unmount xoá state cục bộ của `SourceEditor`/
          `FbdEditorPane` (buffer đang gõ, chưa lưu), nên đổi tab rồi quay lại
          sẽ "mất nội dung đang gõ" — đúng hành vi bị cấm ở
          DDD-FE-PROG-001 §0.1 ràng buộc 1. Phát hiện qua Playwright E2E
          (TASK-PROG-506), sửa ngay trong cùng phiên. */}
      <div hidden={tab !== 'programs'}>
        {/* T59-306/PGM-02: cây POU gom ba nhóm Programs/Functions/Function
            Blocks và inspector kind-aware. Nó đọc document v2 TRỰC TIẾP, không
            qua adapter — đây là phần IA mới, còn `ProgramsTab` bên dưới vẫn là
            editor cũ cho tới khi lane editor chuyển sang v2. */}
        {/* MỘT POU Explorer duy nhất (T59-803): trước đây cây này và cây
            "Cây ứng dụng" bên trong ProgramsTab cùng nằm trong DOM, đọc hai
            nguồn khác nhau và có thể nói khác nhau về cùng một Project. */}
        {/* `T59-822` / `AC-PGM02-002` — ở EDIT, cây POU đi vào ĐÚNG cột trái
            của lưới ba cột (`explorerSlot` của `ProgramsTab`), không còn là một
            dải ngang phía trên. Dải ngang cũ cao 337 px và đẩy mép trên trình
            soạn thảo xuống `y=849` trên viewport 750 — người dùng phải cuộn
            trang mới thấy chỗ mình gõ, đúng điều `AC-PGM02-002` cấm. Phép đo
            này trước nay chỉ chạy cho PGM-01 nên chưa ai thấy.

            LIVE/SIMULATE không mount `ProgramsTab` nên vẫn dùng dải trên; hai
            chế độ đó ít chrome hơn hẳn và không có ngân sách chiều cao bị ép.

            Điều kiện dưới đây phải LOẠI TRỪ NHAU: `AC-PGM02-001` đòi đúng MỘT
            cây POU trong DOM, và hai bản cùng lúc là chính lỗi `T59-803` đã
            phải đi sửa một lần. */}
        {workspaceMode !== 'EDIT' && (
          <div className="mb-3 rounded border border-[var(--c-border)] p-3">
            <PouExplorer
              document={document}
              publishedSignals={publishedSignals}
              canEdit={canEdit}
              saving={workspace.saving}
              selectedObjectId={selectedObjectId}
              onSelect={selectPou}
              onSave={workspace.save}
            />
          </div>
        )}
        {/* `T59-811` — LIVE KHÔNG phải "editor với nút Lưu bị khoá". Nó là một
            tài liệu khác: nguồn của gói ĐANG CHẠY. Dùng lại đúng component
            editor rồi tắt sửa là cách chắc chắn nhất để một hôm nào đó Draft rò
            vào chỗ đáng lẽ phải là Active, mà không có dấu hiệu bên ngoài nào. */}
        {/* `DEV-PROG-001` — bề mặt soạn thảo và workbench nằm trong MỘT cột cao
            theo viewport. Trước lát này cả hai chỉ xếp nối nhau trong dòng chảy
            của trang: đo trên bo Foxlinx (1280×800, POU AHU_MasterSequence 128
            dòng) tài liệu cao 2861 px và dải tab workbench ở `y=2675` — người
            dùng phải cuộn gần 1900 px mới tới được Vấn đề/Tìm kiếm/Watch.

            `18rem` là chrome phía trên ĐO ĐƯỢC trên Chrome thật, không phải
            một con số đoán: sau khi `DEV-PROG-009/013/014` rút gọn tiêu đề, mép
            trên của vùng này nằm ở `y=252` trên viewport 900, và trừ thêm lề đáy của
            trang ra 18rem (17rem đo lại cho tài liệu cao 912 px — tràn 12 px). Con số cũ (20rem) để thừa 68 px trống dưới đáy
            trang — 68 px đó thuộc về chỗ người ta gõ. Sàn `34rem` giữ cho màn
            thấp vẫn còn chỗ gõ; dưới `lg` KHÔNG chốt chiều cao vì màn hẹp không
            có ngân sách để chia và workspace ở đó là chỉ-đọc. */}
        {/* `DEV-PROG-024` — chiều cao cột nay ĐO, không đoán.
            `calc(100vh - 18rem)` là lần đoán thứ ba của cùng một con số (32rem
            → 20rem → 18rem), và nó sai theo cả hai chiều tuỳ máy: đo ở đây
            2026-08-29 cho mép trên `y=304` trên mọi khổ màn, tức chrome thật
            lớn hơn 18rem (288 px) và trang tràn dọc 16 px; còn trên bo — nơi
            thanh ngữ cảnh không kèm banner — chrome nhỏ hơn hẳn và phần chênh
            trở thành một dải trống dưới đáy, lấy mất đúng chỗ người ta gõ.
            `useViewportFillHeight` hỏi thẳng trình duyệt cột đang bắt đầu ở
            đâu, nên chrome đổi bao nhiêu cũng không cần ai sửa lại hằng số.
            Sàn giữ trong hook (`minPx`), KHÔNG đặt bằng `lg:min-h-*`: một sàn
            Tailwind lớn hơn ngân sách đo được sẽ thắng và tự tạo lại đúng cú
            tràn dọc của `DEV-PROG-021`. */}
        <div
          ref={workspaceColumnRef}
          className="flex flex-col"
          style={workspaceColumnHeight === null ? undefined : { height: workspaceColumnHeight }}
        >
        <div className="min-h-0 lg:flex-1 lg:overflow-hidden">
        {workspaceMode === 'SIMULATE' ? (
          /* `T59-815` — SIMULATE cũng KHÔNG phải editor bị khoá: nó là bản đã
             lưu và đã Kiểm tra mà phiên đang chạy, pin theo Revision của phiên
             chứ không theo Active của thiết bị. */
          <SimulateWorkspace
            capability={capabilities.data?.workspaceModes?.simulation}
            role={session?.role}
            slice={simulation.slice}
            inputs={simulation.inputs}
            objectId={selectedObjectId}
            draftDirty={draftDirty}
            draftRevisionId={simulateRevisionId}
            allowMutation={canSimulate}
            onStart={startSimulation}
            onAction={simulation.act}
            onSetInput={simulation.setInput}
            onStop={simulation.stop}
          />
        ) : workspaceMode === 'LIVE' ? (
          <LiveProgramView
            program={selectedProgram}
            objectId={selectedObjectId}
            activeRevisionId={workspace.project.activeRevisionId ?? null}
            monitor={monitor}
            onReturnToDraft={() => switchWorkspaceMode('EDIT')}
          />
        ) : (
          <Suspense fallback={<StateBlock state="loading" title={pick('Đang tải trình soạn thảo…', 'Loading editor…')} />}>
            <ProgramsTab
              /* `T61-405` — ý định chèn khối tới từ PGM-04 nằm trên URL, và
                 trang này là nơi SỞ HỮU URL. Đọc ở đây rồi truyền xuống, thay
                 vì để bộ soạn thảo tự đọc `window.location`: một component đọc
                 thẳng URL sẽ không tuân theo router trong test lẫn khi điều
                 hướng nội bộ. */
              insertIntent={insertIntent}
              onInsertIntentResolved={clearInsertIntent}
              document={document}
              saving={workspace.saving}
              selectedProgramId={selectedProgramId}
              onSelectProgram={selectProgram}
              onSave={workspace.save}
              diagnostics={checkDiagnostics}
              checkSymbols={checkSymbols}
              checkState={checkState}
              hasCheckResult={hasCheckResult}
              checkRevisionId={latestCheckResult.data?.revisionId ?? latestCheck?.revisionId ?? null}
              focusDiagnostic={focusDiagnostic}
              focusFbdSelection={compareFbdFocus}
              onPendingOperationsChange={updateProgramOperations}
              discardVersion={discardVersion}
              onRunCheck={goToCommission}
              onOpenCompare={() => setCompareOpen(true)}
              checkDisabledReason={draftDirty
                ? pick('Lưu bản nháp trước khi Kiểm tra — Kiểm tra chạy trên Revision đã niêm phong, không chạy trên buffer đang gõ.',
                       'Save the draft before checking — Check runs on a sealed revision, not on the buffer being typed.')
                : null}
              compareDisabledReason={null}
              explorerSlot={(
                <div className="mb-3">
                  <PouExplorer
                    document={document}
                    publishedSignals={publishedSignals}
                    canEdit={canEdit}
                    saving={workspace.saving}
                    selectedObjectId={selectedObjectId}
                    onSelect={selectPou}
                    onSave={workspace.save}
                  />
                </div>
              )}
              userPouInterfaces={userPouInterfaces}
              forceReadOnly={mobileReadOnly}
              onWatchVariable={watchVariable}
            />
          </Suspense>
        )}
        {/* `T59-807` / `WP-06-R1` — MỘT workbench dùng chung. Trước đây mỗi
            loại thông tin sống ở một chỗ và theo một luật khác nhau: lỗi Draft
            FBD nằm trong editor FBD, tham chiếu ST nằm trong editor ST, tìm
            kiếm nằm trong thanh công cụ ST. Không có chỗ nào để hỏi "Draft này
            đang có vấn đề gì" cho CẢ Project. */}
        </div>
        <DesignWorkbench
          mode={workspaceMode}
          {...(workspaceMode === 'LIVE' && selectedProgramId
            ? { runtimeOverlay: runtimeOverlays[selectedProgramId] ?? { status: 'unavailable' as const } }
            : {})}
          {...(workspaceMode === 'SIMULATE'
            ? { simulationWatch: simulationWatch }
            : {})}
          traceOwnerHref="/eng/programming/runtime?tab=watch"
          watchAddRequest={watchAddRequest}
          document={document}
          source={workbenchSource}
          sourceLabel={workbenchSourceLabel}
          checkOwnerHref={`/eng/programming/projects/${projectId}/commission`}
          onSelectProgram={selectProgram}
          onJumpToOffset={jumpToSourceOffset}
          checkDiagnostics={checkDiagnostics}
          hasCheckResult={hasCheckResult}
          checkRevisionId={latestCheckResult.data?.revisionId ?? latestCheck?.revisionId ?? null}
          onJumpToDiagnostic={jumpToDiagnostic}
        />
        </div>
      </div>
      <div hidden={tab !== 'mapping'}>
        <MappingTab
          active={tab === 'mapping'}
          draft={workspace.project.draft}
          document={document}
          project={workspace.project}
          projectId={projectId}
          saving={workspace.saving}
          onSave={workspace.save}
          forceReadOnly={mobileReadOnly}
        />
      </div>
      <div hidden={tab !== 'execution'}>
        <ExecutionTab document={document} saving={workspace.saving} onSave={workspace.save} onPendingOperationsChange={updateExecutionOperations} discardVersion={discardVersion} forceReadOnly={mobileReadOnly} />
      </div>

      {canEdit && <Modal
        open={pendingNavigation !== null}
        title={pick('Draft có thay đổi chưa lưu', 'Draft has unsaved changes')}
        cancelLabel={pick('Ở lại', 'Stay')}
        confirmLabel={pick('Lưu Draft', 'Save Draft')}
        confirmLoading={savingBeforeNavigation}
        onClose={() => setPendingNavigation(null)}
        onConfirm={() => {
          if (!pendingNavigation) return
          setSavingBeforeNavigation(true)
          void workspace.save(pendingOperations).then((saved) => {
            setSavingBeforeNavigation(false)
            if (!saved) return
            const destination = pendingNavigation
            setPendingNavigation(null)
            navigate(destination)
          })
        }}
      >
        <p>{pick('Lưu toàn bộ thay đổi trong một batch, bỏ thay đổi cục bộ, hoặc ở lại trang.', 'Save all changes in one batch, discard local changes, or stay on this page.')}</p>
        <Button
          className="mt-3"
          variant="danger"
          disabled={savingBeforeNavigation}
          onClick={() => {
            if (!pendingNavigation) return
            const destination = pendingNavigation
            setDiscardVersion((current) => current + 1)
            setProgramOperations([])
            setExecutionOperations([])
            setPendingNavigation(null)
            navigate(destination)
          }}
        >
          {pick('Bỏ thay đổi cục bộ', 'Discard local changes')}
        </Button>
      </Modal>}
    </div>
  )
}
