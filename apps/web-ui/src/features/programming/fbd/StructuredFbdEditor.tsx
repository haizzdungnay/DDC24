import {
  AlignHorizontalJustifyStart, AlignVerticalJustifyStart, ArrowDown, ArrowUp, BoxSelect,
  CircleDot, LayoutGrid, Plus, Redo2, RotateCcw, SquareDashed, Trash2, Undo2,
} from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'

import { Button } from '../../../shared/components/Button'
import { useI18n } from '../../../shared/i18n'
import { createUuid } from '../../../shared/crypto'
import {
  createFbdEditorState,
  fbdEditorReducer,
  resolveFbdKeyboardCommand,
  translateFbdAnnouncement,
  type FbdEditorAction,
  type FbdKeyboardCommand,
  type FbdSelection,
} from './commands'
import {
  FBD_DATA_TYPES,
  canonicalFbdJson,
  findFbdPort,
  isFbdIdentifier,
  validateFbdDocument,
  type FbdDataType,
  type FbdDocument,
  type FbdNetwork,
  type FbdNode,
  type FbdParameterValue,
  type FbdPoint,
  type FbdWire,
} from './model'
import {
  FbdCanvas,
  buildPaletteNode,
  type FbdCanvasClipboard,
  type FbdViewCommands,
} from './FbdCanvas'
import { buildFbdNetworkGeometry } from './geometry'
import { extractSubgraph, FBD_PASTE_OFFSET, remapSubgraph, type FbdSubgraph } from './clipboard'
import {
  FBD_SHORTCUT_MUTATES,
  nudgeDelta,
  resolveFbdEditorShortcut,
  type FbdEditorShortcut,
} from './fbdShortcuts'
import { fbdIssueTargets } from './issueTargets'
import { alignNodes, computeAutoLayout } from './layout'
import { snapPoint } from './viewport'
import {
  FBD_PALETTE,
  FBD_PALETTE_CATEGORY_ORDER,
  defaultConstantLiteral,
  isValidConstantLiteral,
  paletteEntriesCompatibleWith,
  type FbdPaletteEntry,
} from './palette'
import { userPouPaletteEntry, type UserPouInterface } from './userPou'
import { type FbdNodeEditorChange, type FbdNodeEditorTarget } from './nodeEditor'
import type { FbdNetworkViewPreference, FbdSnapSizePreference, FbdWireStylePreference } from './fbdPreferences'
import type { FbdCanvasBridge } from '../design/workbench/WorkbenchMinimapPanel'
import type { FbdRuntimeOverlay } from './runtimeOverlay'

export interface StructuredFbdEditorProps {
  /**
   * `T59-818` — nâng lựa chọn canvas lên cho `ContextInspector` dùng chung.
   *
   * Inspector là component DÙNG CHUNG giữa ST và FBD (handoff §9), nên nó không
   * được tự đọc state nội bộ của editor này. Đưa lựa chọn ra ngoài giữ đúng
   * ranh giới đó và tránh một đường đọc thứ hai vào cùng tài liệu.
   */
  onSelectionChange?: (selection: FbdSelection | null) => void
  /**
   * Cầu nối reducer -> dock Inspector: công bố mô tả node đang chọn kèm hàm apply.
   */
  onNodeEditorTargetChange?: (target: FbdNodeEditorTarget | null) => void
  /** Neo do một hành động có nhãn ở ngoài editor (vd. Compare). Không tự suy
   * từ elementId gần đúng; caller đã đối chiếu canonical graph trước khi gửi. */
  focusSelection?: FbdSelection | null
  document: FbdDocument
  canEdit: boolean
  onChange: (document: FbdDocument) => void
  /** Interface typed đến từ Draft/API. Editor không parse source ST để đoán pin. */
  userPouInterfaces?: readonly UserPouInterface[]
  /** `T59-804`: Quick Library dùng chung đọc catalog theo Project. Vắng thì dock
   *  vẫn mở được và chỉ thấy SYSTEM entry. */
  projectId?: string
  networkView?: FbdNetworkViewPreference
  activeNetworkId?: string
  wireStyle?: FbdWireStylePreference
  gridVisible?: boolean
  snapEnabled?: boolean
  snapSize?: FbdSnapSizePreference
  showInlineMinimap?: boolean
  /** Giá trị runtime chiếu lên canvas (LIVE/SIMULATE); `null` ở EDIT. */
  runtime?: FbdRuntimeOverlay | null
  /**
   * Điều khiển của tầng gọi, ghim vào CUỐI thanh công cụ canvas.
   *
   * Dùng cho những tuỳ chọn mà editor không sở hữu state (lưới, bám lưới, kiểu
   * dây, giao diện FBD, khung nhìn — tất cả thuộc `FbdEditorPane`). Trước đây
   * chúng nằm ở một dải riêng dưới canvas, tức một hàng 37 px lấy khỏi chỗ vẽ ở
   * mọi lúc, kể cả khi không ai đụng tới chúng. Gom vào một nút bánh răng của
   * thanh công cụ giữ nguyên quyền sở hữu state mà trả lại chiều cao ấy cho
   * canvas — đúng bố cục của ảnh chuẩn `PGM-02B`.
   */
  toolbarExtras?: ReactNode
  onBridgeChange?: (bridge: FbdCanvasBridge | null) => void
}

const EMPTY_USER_POU_INTERFACES: readonly UserPouInterface[] = []

/* Chặn trên cho hàng đợi tiếng vọng. Bình thường hàng đợi dài 0-2 vì mỗi bản
 * phát ra đều quay về trong một vòng render; giới hạn chỉ để một trang không
 * trả lại gì (không phải luồng nào hiện có) không làm ref phình mãi. */
const PENDING_ECHO_LIMIT = 128

function newUuid(): string {
  return createUuid()
}

/* WP-06 (FBD_EDITOR_DESIGN.md §2) — INPUT có 1 port OUTPUT (node "xuất" giá
 * trị biến), OUTPUT có 1 port INPUT (node "nhận" giá trị để ghi ra biến);
 * tên port "OUT"/"IN" khớp đúng golden `ahu_fan_enable.json`. */
function buildInterfaceNode(kind: 'INPUT' | 'OUTPUT', variable: string, dataType: FbdDataType, unit: string | null): FbdNode {
  return {
    id: newUuid(),
    kind,
    typeRef: dataType,
    executionOrder: 0,
    parameters: { variable },
    ports: [{
      id: newUuid(),
      name: kind === 'INPUT' ? 'OUT' : 'IN',
      direction: kind === 'INPUT' ? 'OUTPUT' : 'INPUT',
      dataType,
      unit,
      order: 0,
    }],
  }
}

function buildConstantNode(dataType: FbdDataType, value: FbdParameterValue): FbdNode {
  return {
    id: newUuid(),
    kind: 'CONSTANT',
    typeRef: dataType,
    executionOrder: 0,
    parameters: { value },
    ports: [{ id: newUuid(), name: 'OUT', direction: 'OUTPUT', dataType, unit: null, order: 0 }],
  }
}

const inputClass = 'rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1 text-xs'

/**
 * Shortcut graph không được nuốt Arrow/Delete/Ctrl+Z của ô nhập liệu. Với
 * button toolbar/palette, Enter/Arrow phải giữ hành vi native. `Insert` không
 * có hành vi native trên button và là shortcut toàn editor, nên vẫn phải thêm
 * block khi người dùng vừa Tab tới toolbar (đường E2E bàn phím chuẩn).
 */
function ignoresGraphCommand(target: EventTarget | null, command: FbdKeyboardCommand): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target.closest('input, select, textarea')) return true
  const button = target.closest('button')
  return Boolean(
    button &&
    !button.dataset.fbdCanvasControl &&
    command !== 'ADD_BLOCK' &&
    command !== 'UNDO' &&
    command !== 'REDO'
  )
}

function ignoresEditorShortcut(target: EventTarget | null, shortcut: FbdEditorShortcut): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target.closest('input, select, textarea, [role="menuitem"]')) return true
  const button = target.closest('button')
  return Boolean(button && (
    shortcut === 'DELETE_SELECTION' ||
    shortcut === 'NUDGE_LEFT' ||
    shortcut === 'NUDGE_RIGHT' ||
    shortcut === 'NUDGE_UP' ||
    shortcut === 'NUDGE_DOWN'
  ))
}

function selectedNodeIds(selection: FbdSelection | null): string[] {
  if (!selection) return []
  if (selection.kind === 'node' || selection.kind === 'port') return [selection.nodeId]
  if (selection.kind === 'multi-node') return [...selection.nodeIds]
  return []
}

export function StructuredFbdEditor({
  document,
  canEdit: canEditProp,
  onChange,
  userPouInterfaces = EMPTY_USER_POU_INTERFACES,
  projectId: _projectId,
  onSelectionChange,
  onNodeEditorTargetChange,
  focusSelection,
  networkView = 'ALL',
  activeNetworkId,
  wireStyle = 'BEZIER',
  gridVisible = true,
  snapEnabled = true,
  snapSize = 8,
  showInlineMinimap = true,
  runtime,
  toolbarExtras,
  onBridgeChange,
}: StructuredFbdEditorProps) {
  const { pick } = useI18n()
  const [state, dispatch] = useReducer(
    fbdEditorReducer,
    createFbdEditorState(document, canEditProp && document.networks.length <= 1),
  )
  /* Mô hình MỘT canvas (`#674`). Editor chỉ soạn `networks[0]`, nên tài liệu
   * mang nhiều hơn một Network là tài liệu của mô hình cũ: nó vẫn ĐỌC được,
   * nhưng mọi đường sửa phải đóng lại. Khóa bằng chính `canEdit` — nguồn duy
   * nhất mà reducer (`mutationAllowed`), toolbar và canvas cùng hỏi — nên
   * không có nhánh nào lọt: `mutationAllowed` chặn ở reducer thì `onChange`
   * không bao giờ được gọi, tức 0 mutation phát ra. Tuyệt đối KHÔNG tự gộp
   * hay xóa Network thừa: dữ liệu người dùng giữ nguyên từng byte. */
  const multiNetworkLocked = state.document.networks.length > 1
  const canEdit = canEditProp && !multiNetworkLocked
  const publishedDocument = useRef(canonicalFbdJson(state.document))
  /* Các canonical editor đã phát ra ngoài nhưng CHƯA thấy quay về qua prop
   * `document`. Trang chỉ là buffer: nó nhận `onChange` rồi trả lại chính
   * chuỗi ấy — nhưng trả lại TRỄ. Khi phím tới nhanh hơn một vòng effect của
   * React (Insert liên tiếp, kéo node), cái quay về là bản CŨ HƠN state hiện
   * tại; `REPLACE_DOCUMENT` nhận vô điều kiện nên nuốt luôn các thay đổi vừa
   * làm. Đây là gốc của `TC-FBD-NAV-001` chập chờn (25 lần Insert chỉ còn
   * 16-22 block) và cũng là một đường MẤT DỮ LIỆU thật của người dùng, không
   * riêng của test. Nhận diện tiếng vọng của chính mình rồi bỏ qua; thay đổi
   * thật từ bên ngoài (Làm mới, đổi POU, draft đồng bộ) không nằm trong hàng
   * đợi này nên vẫn được áp dụng ngay. */
  const pendingEchoes = useRef<string[]>([])
  /* Nội dung của prop `document` mà editor ĐÃ thấy lần gần nhất. Effect dưới
   * chạy theo IDENTITY của prop, mà trang có thể dựng lại cùng một tài liệu
   * thành object mới (draft refetch ngay sau khi tạo POU trả về chuỗi khác
   * nhau về hình thức nhưng giống nhau về nội dung). Không so nội dung thì
   * `REPLACE_DOCUMENT` coi đó là thay đổi từ bên ngoài và cuốn theo thao tác
   * vừa làm nhưng chưa kịp đi hết một vòng buffer — đúng triệu chứng phím
   * `Insert` ĐẦU TIÊN bị nuốt (badge tụt về `0/256`) khi gõ ngay sau khi tạo
   * POU. Mốc này đi lên theo cả tiếng vọng, nên `Làm mới` vẫn hoàn tác được:
   * lúc ấy nội dung committed KHÁC nội dung editor vừa phát ra. */
  const propBaseline = useRef(canonicalFbdJson(document))
  /* Port nay là phần tử SVG (`<g role="button">`) chứ không còn là
   * `<button>` HTML — cả hai đều `.focus()` được, nên điều hướng port bằng
   * bàn phím giữ nguyên. */
  const portButtons = useRef(new Map<string, SVGGElement>())
  const sectionRef = useRef<HTMLElement>(null)
  const viewCommandsRef = useRef<FbdViewCommands | null>(null)
  const keyboardHelpId = useId()
  const [paletteTypeRef, setPaletteTypeRef] = useState(FBD_PALETTE[0]?.id ?? '')
  const [creatingKind, setCreatingKind] = useState<'INPUT' | 'OUTPUT' | 'CONSTANT' | null>(null)
  const [ioVariable, setIoVariable] = useState('')
  const [ioType, setIoType] = useState<FbdDataType>('BOOL')
  const [ioUnit, setIoUnit] = useState('')
  const [constantType, setConstantType] = useState<FbdDataType>('BOOL')
  const [constantValue, setConstantValue] = useState('false')
  const [createError, setCreateError] = useState<string | null>(null)
  const [compatibleFilterOn, setCompatibleFilterOn] = useState(true)
  const [pendingPlacement, setPendingPlacement] = useState<{ entryId: string } | null>(null)
  const [marqueeMode, setMarqueeMode] = useState(false)
  const [layoutPreview, setLayoutPreview] = useState<{
    networkId: string
    positions: Record<string, FbdPoint>
    expectedSelectionRevision: number
    expectedSelectionKey: string
    expectedDocumentCanonical: string
  } | null>(null)
  const [toolbarStatus, setToolbarStatus] = useState<string | null>(null)
  const [clipboardSubgraph, setClipboardSubgraph] = useState<FbdSubgraph | null>(null)

  const userPouPalette = useMemo(() => {
    const entries: FbdPaletteEntry[] = []
    const issues: string[] = []
    const seen = new Set(FBD_PALETTE.map((entry) => entry.typeRef.toLocaleUpperCase('en-US')))
    for (const pou of userPouInterfaces) {
      try {
        const entry = userPouPaletteEntry(pou)
        const key = entry.typeRef.toLocaleUpperCase('en-US')
        if (seen.has(key)) throw new Error('duplicate-pou-name')
        seen.add(key)
        entries.push(entry)
      } catch {
        issues.push(pou.name || '?')
      }
    }
    return { entries, issues }
  }, [userPouInterfaces])
  const paletteEntries = useMemo(
    () => [...FBD_PALETTE, ...userPouPalette.entries],
    [userPouPalette.entries],
  )

  useEffect(() => {
    dispatch({ type: 'SET_CAN_EDIT', canEdit })
    if (!canEdit) {
      setCreatingKind(null)
      setCreateError(null)
    }
  }, [canEdit])

  useEffect(() => {
    const incoming = canonicalFbdJson(document)
    if (incoming === propBaseline.current) return
    propBaseline.current = incoming
    const echoIndex = pendingEchoes.current.indexOf(incoming)
    if (echoIndex >= 0) {
      /* Tiếng vọng của chính mình. Cắt luôn các bản cũ hơn: trang có thể gộp
       * nhiều lần `setState` nên vài bản trung gian không bao giờ quay về. */
      pendingEchoes.current = pendingEchoes.current.slice(echoIndex + 1)
      return
    }
    pendingEchoes.current = []
    publishedDocument.current = incoming
    setLayoutPreview(null)
    dispatch({ type: 'REPLACE_DOCUMENT', document })
  }, [document])

  useEffect(() => {
    if (!focusSelection) return
    dispatch({ type: 'SELECT', selection: focusSelection })
  }, [focusSelection])

  useEffect(() => {
    const current = canonicalFbdJson(state.document)
    if (publishedDocument.current !== current) {
      publishedDocument.current = current
      pendingEchoes.current = [...pendingEchoes.current, current].slice(-PENDING_ECHO_LIMIT)
      onChange(state.document)
    }
  }, [onChange, state.document])

  /* `T59-818` — phát lựa chọn ra ngoài cho Inspector dùng chung. Chỉ phát khi
   * lựa chọn ĐỔI, không phát theo mỗi lần render: Inspector dựng lại ngữ cảnh
   * từ đó, và một luồng phát liên tục sẽ làm nó nhấp nháy. */
  useEffect(() => {
    onSelectionChange?.(state.selection)
  }, [onSelectionChange, state.selection])

  const selectedNodeInfo = useMemo(() => {
    if (state.selection?.kind !== 'node' && state.selection?.kind !== 'port') return null
    const netId = state.selection.networkId
    const nId = state.selection.nodeId
    const network = state.document.networks.find((net) => net.id === netId)
    const node = network?.nodes.find((item) => item.id === nId)
    if (!network || !node) return null
    return { networkId: network.id, node }
  }, [state.selection, state.document])

  const applyNodeEditorChange = useCallback(
    (change: FbdNodeEditorChange) => {
      if (!selectedNodeInfo) return
      const { networkId, node } = selectedNodeInfo
      if (change.kind === 'variable') {
        dispatch({
          type: 'SET_NODE_VARIABLE',
          networkId,
          nodeId: node.id,
          variable: change.variable,
          unit: change.unit,
        })
      } else if (change.kind === 'value') {
        dispatch({
          type: 'SET_NODE_VALUE',
          networkId,
          nodeId: node.id,
          value: change.value,
        })
      } else if (change.kind === 'dataType') {
        dispatch({
          type: 'SET_NODE_TYPE',
          networkId,
          nodeId: node.id,
          dataType: change.dataType,
        })
      } else if (change.kind === 'fbParams') {
        dispatch({
          type: 'SET_NODE_FB_PARAMS',
          networkId,
          nodeId: node.id,
          instance: change.instance,
          retained: change.retained,
        })
      } else if (change.kind === 'parameters') {
        dispatch({
          type: 'SET_NODE_PARAMETERS',
          networkId,
          nodeId: node.id,
          parameters: change.parameters,
        })
      } else if (change.kind === 'attributes') {
        dispatch({
          type: 'UPDATE_NODE_ATTRIBUTES',
          networkId,
          nodeId: node.id,
          dataType: change.dataType,
          variable: change.variable,
          unit: change.unit,
          value: change.value,
          instance: change.instance,
          retained: change.retained,
        })
      }
    },
    [selectedNodeInfo, dispatch]
  )

  useEffect(() => {
    if (!selectedNodeInfo) {
      onNodeEditorTargetChange?.(null)
      return
    }
    onNodeEditorTargetChange?.({
      networkId: selectedNodeInfo.networkId,
      node: selectedNodeInfo.node,
      canEdit,
      apply: applyNodeEditorChange,
    })
    return () => onNodeEditorTargetChange?.(null)
  }, [selectedNodeInfo, canEdit, applyNodeEditorChange, onNodeEditorTargetChange])

  useEffect(() => {
    if (state.selection?.kind === 'port') {
      portButtons.current.get(state.selection.portId)?.focus()
      return
    }
    // Xóa phần tử đang focus (vd. port bị DELETE_SELECTION gỡ khỏi DOM)
    // khiến trình duyệt tự đưa focus về `document.body`, cắt luôn chuỗi
    // bàn phím (DDD-FE-PROG-001 §0.1 đòi "hoàn tất bằng bàn phím"). Phát
    // hiện qua Playwright E2E (TASK-PROG-506): Ctrl+Z sau Delete không còn
    // tới được `onKeyDown` của editor. Chỉ thu hồi focus khi thật sự bị mất
    // (activeElement rơi về body) — không cướp focus lúc mount.
    const active = window.document.activeElement
    if (sectionRef.current && (!active || active === window.document.body)) sectionRef.current.focus()
  }, [state.selection])

  /* Draft/library refresh có thể gỡ POU đang chọn khỏi palette. Không được
   * âm thầm dùng một block khác cho lệnh Insert trong render chuyển tiếp; trả
   * lựa chọn về entry chuẩn đầu tiên rồi mới cho phép thêm node. */
  useEffect(() => {
    if (paletteEntries.some((entry) => entry.id === paletteTypeRef)) return
    setPaletteTypeRef(FBD_PALETTE[0]?.id ?? '')
  }, [paletteEntries, paletteTypeRef])

  /* `activeNetworkId` là GỢI Ý từ ngoài, không phải thẩm quyền. `FbdEditorPane`
   * sửa nó bằng một passive effect nên nó đi SAU tài liệu đúng một commit: ngay
   * sau khi tạo POU, `document` đã là bản của draft (network mang UUID khác)
   * trong khi gợi ý còn trỏ network của bản lạc quan trước đó. Nếu tin gợi ý vô
   * điều kiện thì trong cửa sổ đó canvas coi như KHÔNG có network nào, và lệnh
   * `ADD_BLOCK` rơi vào nhánh `action = null` — phím bị nuốt lặng lẽ: không
   * announcement, không đổi badge, không dấu vết. Đó là kênh mất block cuối
   * cùng của `TC-FBD-NAV-001` (badge dừng ở 24/25, dãy vẫn tăng đơn điệu nên
   * không phải rollback). Gợi ý không giải được thì rơi về chuỗi cũ. */
  const hintedNetworkId = activeNetworkId && state.document.networks.some((network) => network.id === activeNetworkId)
    ? activeNetworkId
    : undefined
  const selectionNetworkId = state.selection?.networkId
  const selectedNetworkId = hintedNetworkId
    ?? (selectionNetworkId && state.document.networks.some((network) => network.id === selectionNetworkId) ? selectionNetworkId : undefined)
    ?? state.document.networks[0]?.id
  const visibleNetworks = networkView === 'SELECTED'
    ? state.document.networks.filter((network) => network.id === selectedNetworkId)
    : state.document.networks
  const activeNetwork = state.document.networks.find((network) => network.id === selectedNetworkId)
  const selectedPaletteEntry = paletteEntries.find((entry) => entry.id === paletteTypeRef)
  const selectionKey = JSON.stringify(state.selection)
  const documentCanonical = canonicalFbdJson(state.document)

  function extractNodes(network: FbdNetwork, nodeIds: readonly string[]): FbdSubgraph | null {
    const geometry = buildFbdNetworkGeometry(network, state.document.layout, { wireStyle })
    return extractSubgraph(network, nodeIds, geometry.byNodeId)
  }

  function copyNodes(network: FbdNetwork, nodeIds: readonly string[]): FbdSubgraph | null {
    const subgraph = extractNodes(network, nodeIds)
    if (!subgraph) return null
    setClipboardSubgraph(subgraph)
    setToolbarStatus(pick(
      `Đã sao chép ${subgraph.nodes.length} khối${subgraph.wires.length ? ` và ${subgraph.wires.length} dây nội bộ` : ''}.`,
      `Copied ${subgraph.nodes.length} ${subgraph.nodes.length === 1 ? 'block' : 'blocks'}${subgraph.wires.length ? ` and ${subgraph.wires.length} internal wires` : ''}.`,
    ))
    return subgraph
  }

  function selectAndDelete(network: FbdNetwork, nodeIds: readonly string[]) {
    if (nodeIds.length === 0) return
    dispatch({
      type: 'SELECT',
      selection: nodeIds.length === 1
        ? { kind: 'node', networkId: network.id, nodeId: nodeIds[0] }
        : { kind: 'multi-node', networkId: network.id, nodeIds: [...nodeIds] },
    })
    dispatch({ type: 'DELETE_SELECTION' })
  }

  function cutNodes(network: FbdNetwork, nodeIds: readonly string[]) {
    if (!canEdit) return
    const subgraph = copyNodes(network, nodeIds)
    if (!subgraph) return
    selectAndDelete(network, subgraph.nodes.map((node) => node.id))
  }

  function pasteNodes(network: FbdNetwork, at: FbdPoint | null) {
    if (!canEdit || !clipboardSubgraph) return
    const subgraph = remapSubgraph(clipboardSubgraph, {
      newId: newUuid,
      ...(at ? { origin: snapPoint(at, snapEnabled ? snapSize : 0) } : { offset: FBD_PASTE_OFFSET }),
    })
    dispatch({
      type: 'PASTE_SUBGRAPH',
      targetNetworkId: network.id,
      nodes: [...subgraph.nodes],
      wires: [...subgraph.wires],
      layoutNodes: { ...subgraph.layout },
    })
  }

  function duplicateNodes(network: FbdNetwork, nodeIds: readonly string[]) {
    if (!canEdit) return
    const source = extractNodes(network, nodeIds)
    if (!source) return
    const subgraph = remapSubgraph(source, { newId: newUuid, offset: FBD_PASTE_OFFSET })
    dispatch({
      type: 'PASTE_SUBGRAPH',
      targetNetworkId: network.id,
      nodes: [...subgraph.nodes],
      wires: [...subgraph.wires],
      layoutNodes: { ...subgraph.layout },
    })
  }

  function clipboardFor(network: FbdNetwork): FbdCanvasClipboard {
    return {
      hasContent: clipboardSubgraph !== null,
      copy: (nodeIds) => { copyNodes(network, nodeIds) },
      cut: (nodeIds) => cutNodes(network, nodeIds),
      paste: (at) => pasteNodes(network, at),
      duplicate: (nodeIds) => duplicateNodes(network, nodeIds),
    }
  }

  function dispatchEditorShortcut(shortcut: FbdEditorShortcut) {
    if (FBD_SHORTCUT_MUTATES[shortcut] && !canEdit) return
    const network = activeNetwork
    const nodeIds = selectedNodeIds(state.selection)
    switch (shortcut) {
      case 'DELETE_SELECTION': dispatch({ type: 'DELETE_SELECTION' }); return
      case 'COPY': if (network) copyNodes(network, nodeIds); return
      case 'CUT': if (network) cutNodes(network, nodeIds); return
      case 'PASTE': if (network) pasteNodes(network, null); return
      case 'DUPLICATE': if (network) duplicateNodes(network, nodeIds); return
      case 'SELECT_ALL':
        if (network) dispatch({
          type: 'SELECT',
          selection: network.nodes.length === 0
            ? null
            : network.nodes.length === 1
              ? { kind: 'node', networkId: network.id, nodeId: network.nodes[0].id }
              : { kind: 'multi-node', networkId: network.id, nodeIds: network.nodes.map((node) => node.id) },
        })
        return
      case 'UNDO': dispatch({ type: 'UNDO' }); return
      case 'REDO': dispatch({ type: 'REDO' }); return
      case 'ZOOM_100': viewCommandsRef.current?.zoom100(); return
      case 'FIT_ALL': viewCommandsRef.current?.fitAll(); return
      case 'FIT_SELECTION': viewCommandsRef.current?.fitSelection(); return
      default: {
        if (!network || nodeIds.length === 0) return
        const delta = nudgeDelta(shortcut, snapEnabled ? snapSize : 1)
        if (!delta) return
        const geometry = buildFbdNetworkGeometry(network, state.document.layout, { wireStyle })
        const moves = nodeIds.flatMap((nodeId) => {
          const node = geometry.byNodeId.get(nodeId)
          return node ? [{ nodeId, x: node.x + delta.dx, y: node.y + delta.dy }] : []
        })
        if (moves.length > 0) dispatch({ type: 'MULTI_MOVE', networkId: network.id, moves })
      }
    }
  }

  useEffect(() => {
    if (!layoutPreview) return
    if (!canEdit) {
      setLayoutPreview(null)
      setToolbarStatus(pick('Quyền chỉnh sửa đã đổi; xem trước bị hủy.', 'Edit permission changed; the preview was cancelled.'))
      return
    }
    if (layoutPreview.networkId !== selectedNetworkId) {
      setLayoutPreview(null)
      setToolbarStatus(pick('Network hoạt động đã đổi; xem trước bị hủy.', 'The active network changed; the preview was cancelled.'))
      return
    }
    if (layoutPreview.expectedSelectionKey !== selectionKey ||
        layoutPreview.expectedDocumentCanonical !== documentCanonical) {
      setLayoutPreview(null)
      setToolbarStatus(pick('Vùng chọn hoặc tài liệu đã đổi; xem trước bị hủy.', 'The selection or document changed; the preview was cancelled.'))
    }
  }, [canEdit, documentCanonical, layoutPreview, pick, selectedNetworkId, selectionKey])

  /* `T59-804`: kiểu của cổng đang chọn — cơ sở để lọc palette theo tương thích.
   * `null` khi không đứng ở cổng nào; khi đó không lọc gì cả. */
  const selectedPortType = useMemo<FbdDataType | null>(() => {
    const selection = state.selection
    if (selection?.kind !== 'port') return null
    for (const network of state.document.networks) {
      for (const node of network.nodes) {
        const port = node.ports.find((item) => item.id === selection.portId)
        if (port) return port.dataType
      }
    }
    return null
  }, [state.selection, state.document])
  const compatibleOnly = compatibleFilterOn && selectedPortType !== null
  const visiblePaletteEntries = useMemo(
    () => (compatibleOnly ? paletteEntriesCompatibleWith(paletteEntries, selectedPortType) : paletteEntries),
    [compatibleOnly, paletteEntries, selectedPortType]
  )

  function dispatchCommand(command: FbdKeyboardCommand) {
    let action: FbdEditorAction | null = null
    if (command === 'ADD_NETWORK') {
      /* `#674` chốt mô hình MỘT canvas: không còn đường nào tạo Network thứ
       * hai. Phím `Control+Shift+n` vẫn nằm trong
       * `contracts/programming/fbd_keyboard_commands_v1.json`, nên bỏ nhánh
       * này mà không nói gì sẽ thành một phím hợp đồng im lặng. Trả lời bằng
       * chính dải trạng thái của thanh công cụ và KHÔNG phát mutation. */
      setToolbarStatus(pick(
        'FBD dùng mô hình một canvas: không tạo Network mới.',
        'FBD uses a single-canvas model: no new network is created.',
      ))
      return
    }
    if (command === 'ADD_BLOCK') {
      const network = state.document.networks.find((item) => item.id === selectedNetworkId)
      if (network && selectedPaletteEntry) {
        action = { type: 'ADD_NODE', networkId: network.id, node: buildPaletteNode(selectedPaletteEntry) }
      }
    } else if (command === 'SELECT_NEXT_PORT') {
      action = { type: 'SELECT_PORT_OFFSET', offset: 1 }
    } else if (command === 'SELECT_PREVIOUS_PORT') {
      action = { type: 'SELECT_PORT_OFFSET', offset: -1 }
    } else if (command === 'BEGIN_OR_COMMIT_CONNECTION') {
      if (state.selection?.kind === 'port') {
        const selected = findFbdPort(state.document, state.selection.portId)
        const source = state.connectionFromPortId ? findFbdPort(state.document, state.connectionFromPortId) : undefined
        const wire: FbdWire | undefined = source && selected ? {
          id: newUuid(),
          from: { nodeId: source.node.id, portId: source.port.id },
          to: { nodeId: selected.node.id, portId: selected.port.id },
        } : undefined
        action = { type: 'BEGIN_OR_COMMIT_CONNECTION', portId: state.selection.portId, wire }
      }
    } else if (command === 'CANCEL_CONNECTION') {
      action = { type: 'CANCEL_CONNECTION' }
      dispatch({ type: 'SELECT', selection: null })
    } else if (command === 'DELETE_SELECTION') {
      action = { type: 'DELETE_SELECTION' }
    } else if (command === 'MOVE_NODE_UP') {
      action = { type: 'MOVE_NODE', delta: -1 }
    } else if (command === 'MOVE_NODE_DOWN') {
      action = { type: 'MOVE_NODE', delta: 1 }
    } else if (command === 'UNDO') {
      action = { type: 'UNDO' }
    } else if (command === 'REDO') {
      action = { type: 'REDO' }
    }
    if (action) dispatch(action)
  }

  function addPaletteNode() {
    const network = state.document.networks.find((item) => item.id === selectedNetworkId)
    if (!selectedPaletteEntry || !network) return
    dispatch({ type: 'ADD_NODE', networkId: network.id, node: buildPaletteNode(selectedPaletteEntry) })
  }

  function submitInterfaceNode(kind: 'INPUT' | 'OUTPUT') {
    const network = state.document.networks.find((item) => item.id === selectedNetworkId)
    if (!network) return
    if (!isFbdIdentifier(ioVariable)) { setCreateError(pick('Tên biến không hợp lệ', 'Invalid variable name')); return }
    setCreateError(null)
    const unit = ioUnit.trim().length > 0 ? ioUnit.trim() : null
    dispatch({ type: 'ADD_NODE', networkId: network.id, node: buildInterfaceNode(kind, ioVariable, ioType, unit) })
    setCreatingKind(null)
    setIoVariable('')
    setIoUnit('')
  }

  function submitConstantNode() {
    const network = state.document.networks.find((item) => item.id === selectedNetworkId)
    if (!network) return
    const parsed: FbdParameterValue = constantType === 'BOOL' ? constantValue === 'true'
      : constantType === 'TIME' ? constantValue
      : Number(constantValue)
    if (!isValidConstantLiteral(constantType, parsed)) { setCreateError(pick('Giá trị không hợp lệ với kiểu đã chọn', 'Value is not valid for the selected type')); return }
    setCreateError(null)
    dispatch({ type: 'ADD_NODE', networkId: network.id, node: buildConstantNode(constantType, parsed) })
    setCreatingKind(null)
  }

  function networkPositions(network: FbdNetwork): Record<string, FbdPoint> {
    const geometry = buildFbdNetworkGeometry(network, state.document.layout, { wireStyle })
    return Object.fromEntries(geometry.nodes.map((node) => [node.id, { x: node.x, y: node.y }]))
  }

  function snapLayoutPositions(positions: Record<string, FbdPoint>): Record<string, FbdPoint> {
    return Object.fromEntries(Object.entries(positions).map(([nodeId, point]) => [
      nodeId,
      snapPoint(point, snapSize),
    ]))
  }

  function createLayoutPreview(networkId: string, positions: Record<string, FbdPoint>) {
    setLayoutPreview({
      networkId,
      positions,
      expectedSelectionRevision: state.selectionRevision,
      expectedSelectionKey: selectionKey,
      expectedDocumentCanonical: documentCanonical,
    })
  }

  function previewAutoLayout() {
    const network = state.document.networks.find((item) => item.id === selectedNetworkId)
    if (!network) return
    if (network.nodes.length < 2) {
      setLayoutPreview(null)
      setToolbarStatus(pick('Cần ít nhất 2 block để tự sắp xếp.', 'Select a network with at least 2 blocks to auto layout.'))
      return
    }
    const current = networkPositions(network)
    const result = computeAutoLayout(network, current)
    const snapped = snapLayoutPositions(result.positions)
    const positions = Object.fromEntries(network.nodes
      .map((node) => [node.id, snapped[node.id]] as const)
      .filter(([nodeId, point]) => point && (point.x !== current[nodeId]?.x || point.y !== current[nodeId]?.y)))
    if (Object.keys(positions).length === 0) {
      setLayoutPreview(null)
      setToolbarStatus(pick('Bố cục hiện tại đã đúng; không có thay đổi để áp dụng.', 'The current layout is already up to date; there is nothing to apply.'))
      return
    }
    createLayoutPreview(network.id, positions)
    setToolbarStatus(result.warnings.length > 0
      ? pick(`Xem trước có ${result.warnings.length} cảnh báo; chưa thay đổi Draft.`, `Preview has ${result.warnings.length} warnings; the draft is unchanged.`)
      : pick(`Đang xem trước vị trí mới cho ${Object.keys(positions).length} block; Draft chưa thay đổi.`, `Previewing new positions for ${Object.keys(positions).length} blocks; the draft is unchanged.`))
  }

  function previewAlignment(alignment: 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM') {
    const network = state.document.networks.find((item) => item.id === selectedNetworkId)
    if (!network) return
    const selectedIds = state.selection?.kind === 'multi-node'
      ? state.selection.nodeIds
      : state.selection?.kind === 'node'
        ? [state.selection.nodeId]
        : []
    if (selectedIds.length < 2) {
      setLayoutPreview(null)
      setToolbarStatus(pick('Chọn ít nhất 2 block trong cùng network để căn lề.', 'Select at least 2 blocks in the same network to align them.'))
      return
    }
    const current = networkPositions(network)
    const selectedNodes = network.nodes.filter((node) => selectedIds.includes(node.id))
    const aligned = snapLayoutPositions(alignNodes(selectedNodes, current, alignment))
    const positions = Object.fromEntries(selectedNodes
      .map((node) => [node.id, aligned[node.id]] as const)
      .filter(([nodeId, point]) => point && (point.x !== current[nodeId]?.x || point.y !== current[nodeId]?.y)))
    if (Object.keys(positions).length === 0) {
      setLayoutPreview(null)
      setToolbarStatus(pick('Các block đã thẳng hàng; không có thay đổi để áp dụng.', 'The blocks are already aligned; there is nothing to apply.'))
      return
    }
    createLayoutPreview(network.id, positions)
    setToolbarStatus(pick(`Đang xem trước căn lề ${Object.keys(positions).length} block; Draft chưa thay đổi.`, `Previewing alignment for ${Object.keys(positions).length} blocks; the draft is unchanged.`))
  }

  function applyLayoutPreview() {
    if (!layoutPreview) return
    if (!canEdit) {
      setLayoutPreview(null)
      setToolbarStatus(pick('Không có quyền chỉnh sửa; xem trước bị hủy.', 'Editing is not allowed; the preview was cancelled.'))
      return
    }
    if (layoutPreview.networkId !== selectedNetworkId) {
      setLayoutPreview(null)
      setToolbarStatus(pick('Network hoạt động đã đổi; xem trước bị hủy.', 'The active network changed; the preview was cancelled.'))
      return
    }
    if (layoutPreview.expectedSelectionKey !== selectionKey ||
        layoutPreview.expectedDocumentCanonical !== documentCanonical) {
      setLayoutPreview(null)
      setToolbarStatus(pick('Vùng chọn hoặc tài liệu đã đổi; xem trước bị hủy.', 'The selection or document changed; the preview was cancelled.'))
      return
    }
    if (layoutPreview.expectedSelectionRevision !== state.selectionRevision) {
      setLayoutPreview(null)
      setToolbarStatus(pick('Vùng chọn đã đổi; xem trước bị hủy để tránh áp sai block.', 'The selection changed; the preview was cancelled to avoid moving the wrong blocks.'))
      return
    }
    dispatch({
      type: 'SET_LAYOUT_BATCH',
      networkId: layoutPreview.networkId,
      positions: layoutPreview.positions,
      expectedSelectionRevision: layoutPreview.expectedSelectionRevision,
    })
    setToolbarStatus(pick('Đã áp dụng bố cục trong một bước hoàn tác.', 'The layout was applied as one undo step.'))
    setLayoutPreview(null)
  }

  const issues = validateFbdDocument(state.document)
  const issueTargets = useMemo(() => fbdIssueTargets(state.document, issues), [state.document, issues])
  const issueNodeIds = useMemo(() => {
    const ids = new Set<string>()
    for (const target of issueTargets) {
      if (target.selection?.kind === 'node') ids.add(target.selection.nodeId)
    }
    return ids
  }, [issueTargets])
  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-label={pick('Bộ dựng FBD có cấu trúc', 'Structured FBD editor')}
      aria-describedby={keyboardHelpId}
      className="flex min-h-0 flex-1 flex-col gap-2"
      onKeyDown={(event) => {
        const command = resolveFbdKeyboardCommand(event)
        if (!command) {
          const shortcut = resolveFbdEditorShortcut(event)
          if (!shortcut || ignoresEditorShortcut(event.target, shortcut)) return
          event.preventDefault()
          dispatchEditorShortcut(shortcut)
          return
        }
        if (ignoresGraphCommand(event.target, command)) return
        const insertStartedFromToolbar =
          command === 'ADD_BLOCK' &&
          event.target instanceof HTMLElement &&
          Boolean(event.target.closest('button'))
        event.preventDefault()
        dispatchCommand(command)
        // Sau `Insert` từ một nút toolbar, chuyển focus về vùng editor để
        // Arrow/Enter kế tiếp thuộc keyboard contract của graph. Giữ focus ở
        // nút sẽ buộc Enter kích hoạt chính nút đó (thêm Network) thay vì nối
        // port, dù block vừa được thêm thành công.
        if (insertStartedFromToolbar) sectionRef.current?.focus()
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-[var(--c-border)] pb-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Tên POU đã nằm trên thanh tab ngay phía trên, nên hiện nó lần
              thứ hai chỉ lấy mất chiều ngang của thanh công cụ và đẩy nó xuống
              thành ba hàng. Giữ làm mốc trợ năng, bỏ khỏi thị giác. */}
          <h2 className="sr-only">FBD · {state.document.name}</h2>
          <p id={keyboardHelpId} className="sr-only">
            {pick(
              'Chọn block/POU trong palette; Insert thêm lựa chọn đó · ↑/↓ chọn port · Enter nối · Ctrl+click hoặc kéo vùng để chọn nhiều · Shift+mũi tên dịch khối · Delete/Backspace xóa · Ctrl+C/X/V/D sao chép, cắt, dán, nhân đôi · Ctrl+Z/Y hoàn tác/làm lại.',
              'Choose a block/POU in the palette; Insert adds it · arrows select ports · Enter wires · Ctrl+click or box-drag selects multiple blocks · Shift+arrows nudges blocks · Delete/Backspace removes · Ctrl+C/X/V/D copies, cuts, pastes, or duplicates · Ctrl+Z/Y undoes/redoes.',
            )}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 text-xs" aria-label={pick('Trạng thái FBD', 'FBD status')}>
            {/* Số đếm giữ nguyên ý nghĩa nhưng bỏ chữ `block`/`wire`: hai từ
                ấy chiếm ~90 px của một thanh công cụ vốn đã phải xuống ba hàng,
                trong khi biểu tượng + `title` nói đúng cùng một điều. */}
            <span
              data-testid="fbd-block-count"
              className="inline-flex items-center gap-1 rounded-full border border-[var(--c-border)] px-1.5 py-0.5 text-[11px]"
              title={pick('Số khối trên tổng số khối tối đa', 'Blocks used of the maximum')}
            >
              <SquareDashed className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only">{pick('Khối', 'Blocks')}</span>
              {state.document.networks.reduce((sum, item) => sum + item.nodes.length, 0)}/256
            </span>
            <span
              data-testid="fbd-wire-count"
              className="inline-flex items-center gap-1 rounded-full border border-[var(--c-border)] px-1.5 py-0.5 text-[11px]"
              title={pick('Số dây nối trên tổng số dây tối đa', 'Wires used of the maximum')}
            >
              <CircleDot className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only">{pick('Dây nối', 'Wires')}</span>
              {state.document.networks.reduce((sum, item) => sum + item.wires.length, 0)}/512
            </span>
            <span className={issues.length ? 'rounded-full bg-[var(--c-warn-bg)] px-1.5 py-0.5 text-[11px] text-[var(--c-warn-fg)]' : 'rounded-full bg-[var(--c-good-bg)] px-1.5 py-0.5 text-[11px] text-[var(--c-good-fg)]'}>
              {issues.length ? pick(`${issues.length} lỗi Draft`, `${issues.length} Draft ${issues.length === 1 ? 'issue' : 'issues'}`) : pick('Canonical hợp lệ', 'Canonical valid')}
            </span>
            {!canEdit && <span className="rounded-full bg-[var(--c-surface-2)] px-1.5 py-0.5 text-[11px]">{pick('Chỉ đọc', 'Read only')}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label={pick('Lệnh FBD', 'FBD commands')}>
          <label className="flex items-center gap-1 text-xs">
            {pick('Khối', 'Block')}
            <select
              className={`${inputClass} max-w-[8.5rem]`}
              value={paletteTypeRef}
              disabled={!canEdit || !selectedNetworkId}
              onChange={(event) => setPaletteTypeRef(event.target.value)}
            >
              {FBD_PALETTE_CATEGORY_ORDER.filter((category) => category.id !== 'interface' && category.id !== 'constants').map((category) => (
                <optgroup key={category.id} label={pick(category.labelVi, category.labelEn)}>
                  {visiblePaletteEntries.filter((item) => item.category === category.id && !item.id.startsWith('__user__')).map((item) => (
                    <option key={item.id} value={item.id}>{pick(item.labelVi, item.labelEn)}</option>
                  ))}
                </optgroup>
              ))}
              {userPouPalette.entries.length > 0 && (
                <optgroup label={pick('POU dự án / thư viện', 'Project / library POUs')}>
                  {userPouPalette.entries.filter((entry) => visiblePaletteEntries.includes(entry)).map((entry) => (
                    <option key={`pou-${entry.id}`} value={entry.id}>
                      {pick(entry.labelVi, entry.labelEn)} · {entry.kind}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          {selectedPortType !== null && (
            <label className="flex items-center gap-1.5 text-xs text-[var(--c-text-dim)]">
              <input
                type="checkbox"
                checked={compatibleFilterOn}
                onChange={(event) => setCompatibleFilterOn(event.target.checked)}
              />
              {pick(
                `Chỉ khối khớp cổng ${selectedPortType} (${visiblePaletteEntries.length})`,
                `Only blocks matching the ${selectedPortType} port (${visiblePaletteEntries.length})`
              )}
            </label>
          )}
          <Button size="sm" icon={<Plus className="h-4 w-4" />} disabled={!canEdit || !selectedNetworkId || !selectedPaletteEntry} onClick={addPaletteNode}
            aria-label={pick('Thêm khối', 'Add block')} title={pick('Thêm khối', 'Add block')} />
          <Button size="sm" variant={creatingKind === 'INPUT' ? 'primary' : 'secondary'} disabled={!canEdit || !selectedNetworkId}
            className="px-2 font-mono"
            title={pick('Thêm biến vào (INPUT)', 'Add an input variable')}
            onClick={() => { setCreatingKind(creatingKind === 'INPUT' ? null : 'INPUT'); setCreateError(null) }}>
            {pick('Input', 'Input')}
          </Button>
          <Button size="sm" variant={creatingKind === 'OUTPUT' ? 'primary' : 'secondary'} disabled={!canEdit || !selectedNetworkId}
            className="px-2 font-mono"
            title={pick('Thêm biến ra (OUTPUT)', 'Add an output variable')}
            onClick={() => { setCreatingKind(creatingKind === 'OUTPUT' ? null : 'OUTPUT'); setCreateError(null) }}>
            {pick('Output', 'Output')}
          </Button>
          <Button size="sm" variant={creatingKind === 'CONSTANT' ? 'primary' : 'secondary'} disabled={!canEdit || !selectedNetworkId}
            className="px-2 font-mono"
            title={pick('Thêm hằng số', 'Add a constant')}
            onClick={() => {
              setCreatingKind(creatingKind === 'CONSTANT' ? null : 'CONSTANT')
              setCreateError(null)
              setConstantValue(String(defaultConstantLiteral(constantType)))
            }}>
            {pick('Constant', 'Constant')}
          </Button>
          <Button size="sm" icon={<ArrowUp className="h-4 w-4" />} disabled={!canEdit} onClick={() => dispatchCommand('MOVE_NODE_UP')} aria-label={pick('Đưa block lên', 'Move block up')} />
          <Button size="sm" icon={<ArrowDown className="h-4 w-4" />} disabled={!canEdit} onClick={() => dispatchCommand('MOVE_NODE_DOWN')} aria-label={pick('Đưa block xuống', 'Move block down')} />
          <Button size="sm" icon={<Trash2 className="h-4 w-4" />} disabled={!canEdit} onClick={() => dispatchCommand('DELETE_SELECTION')} aria-label={pick('Xóa vùng chọn', 'Delete selection')} />
          <Button size="sm" icon={<Undo2 className="h-4 w-4" />} disabled={!canEdit || state.past.length === 0} onClick={() => dispatchCommand('UNDO')} aria-label={pick('Hoàn tác', 'Undo')} />
          <Button size="sm" icon={<Redo2 className="h-4 w-4" />} disabled={!canEdit || state.future.length === 0} onClick={() => dispatchCommand('REDO')} aria-label={pick('Làm lại', 'Redo')} />
          <Button size="sm" icon={<RotateCcw className="h-4 w-4" />} disabled={!state.connectionFromPortId} onClick={() => dispatchCommand('CANCEL_CONNECTION')}
            aria-label={pick('Hủy nối', 'Cancel wire')} title={pick('Hủy nối', 'Cancel wire')} />
          <Button size="sm" icon={<LayoutGrid className="h-4 w-4" />} disabled={!canEdit || !activeNetwork} onClick={previewAutoLayout}
            aria-label={pick('Tự sắp xếp', 'Auto layout')} title={pick('Tự sắp xếp', 'Auto layout')} />
          <Button size="sm" variant="secondary" icon={<AlignHorizontalJustifyStart className="h-4 w-4" />} disabled={!canEdit || !activeNetwork} onClick={() => previewAlignment('LEFT')}
            aria-label={pick('Căn trái', 'Align left')} title={pick('Căn trái', 'Align left')} />
          <Button size="sm" variant="secondary" icon={<AlignVerticalJustifyStart className="h-4 w-4" />} disabled={!canEdit || !activeNetwork} onClick={() => previewAlignment('TOP')}
            aria-label={pick('Căn trên', 'Align top')} title={pick('Căn trên', 'Align top')} />
          {layoutPreview && (
            <>
              <Button size="sm" disabled={!canEdit} onClick={applyLayoutPreview}>{pick('Áp dụng bố cục', 'Apply layout')}</Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setLayoutPreview(null)
                  setToolbarStatus(pick('Đã hủy xem trước; Draft không thay đổi.', 'Preview cancelled; the draft is unchanged.'))
                }}
              >
                {pick('Hủy xem trước', 'Cancel preview')}
              </Button>
            </>
          )}
          <button
            type="button"
            className="hidden min-h-11 items-center gap-1 rounded border border-[var(--c-border)] px-2 text-xs md:inline-flex lg:hidden"
            aria-pressed={marqueeMode}
            disabled={!canEdit}
            onClick={() => setMarqueeMode((enabled) => !enabled)}
          >
            <BoxSelect className="h-4 w-4" aria-hidden="true" />
            {pick('Chọn vùng', 'Marquee select')}
          </button>
          {toolbarExtras}
        </div>
        {selectedPaletteEntry?.warning && (
          <p className="basis-full rounded bg-[var(--c-warn-bg)] px-2 py-1 text-xs text-[var(--c-warn-fg)]">
            {pick(selectedPaletteEntry.warning.vi, selectedPaletteEntry.warning.en)}
          </p>
        )}
        {userPouPalette.issues.length > 0 && (
          <div className="basis-full rounded bg-[var(--c-warn-bg)] px-2 py-1 text-xs text-[var(--c-warn-fg)]" role="status">
            <p className="font-semibold">{pick('Một số POU không thể đưa vào palette vì interface không hợp lệ:', 'Some POUs are unavailable because their interfaces are invalid:')}</p>
            <ul className="list-disc pl-4">
              {userPouPalette.issues.map((name, index) => (
                <li key={`${name}-${index}`}>
                  {name}: {pick('tên/signature/pin trùng hoặc không hợp lệ', 'duplicate or invalid name/signature/pins')}
                </li>
              ))}
            </ul>
          </div>
        )}
        {toolbarStatus && <p role="status" className="basis-full text-xs text-[var(--c-text-dim)]">{toolbarStatus}</p>}
      </div>

      {multiNetworkLocked && (
        <div
          role="status"
          data-testid="fbd-multi-network-lock"
          className="rounded-[var(--radius)] border border-[var(--c-warn-fg)] bg-[var(--c-warn-bg)] p-2 text-xs text-[var(--c-warn-fg)]"
        >
          {pick(
            `Tài liệu này có ${state.document.networks.length} Network, còn FBD đã chốt mô hình một canvas. Bản này vì thế mở ở chế độ chỉ đọc: không thao tác sửa nào được ghi, và không Network nào bị xóa hay gộp. Tách thủ công thành các POU một Network rồi mở lại để sửa tiếp.`,
            `This document has ${state.document.networks.length} networks while FBD is now a single-canvas model. It therefore opens read-only: no edit is written, and no network is deleted or merged. Split it manually into single-network POUs, then reopen it to keep editing.`,
          )}
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">

      {canEdit && (creatingKind === 'INPUT' || creatingKind === 'OUTPUT') && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-[var(--radius)] border border-[var(--c-accent)] bg-[var(--c-accent-bg)] p-3"
          onSubmit={(event) => { event.preventDefault(); submitInterfaceNode(creatingKind) }}
        >
          <label className="flex flex-col gap-1 text-xs">
            {pick('Tên biến', 'Variable name')}
            <input className={inputClass} value={ioVariable} onChange={(event) => setIoVariable(event.target.value)} autoFocus />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {pick('Kiểu', 'Type')}
            <select className={inputClass} value={ioType} onChange={(event) => setIoType(event.target.value as FbdDataType)}>
              {FBD_DATA_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {pick('Đơn vị (tuỳ chọn)', 'Unit (optional)')}
            <input className={inputClass} value={ioUnit} onChange={(event) => setIoUnit(event.target.value)} />
          </label>
          <Button size="sm" type="submit">{pick('Tạo', 'Create')}</Button>
          <Button size="sm" variant="secondary" type="button" onClick={() => setCreatingKind(null)}>{pick('Hủy', 'Cancel')}</Button>
          {createError && <span className="text-xs text-[var(--c-danger-fg)]">{createError}</span>}
        </form>
      )}
      {canEdit && creatingKind === 'CONSTANT' && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-[var(--radius)] border border-[var(--c-accent)] bg-[var(--c-accent-bg)] p-3"
          onSubmit={(event) => { event.preventDefault(); submitConstantNode() }}
        >
          <label className="flex flex-col gap-1 text-xs">
            {pick('Kiểu', 'Type')}
            <select
              className={inputClass}
              value={constantType}
              onChange={(event) => { const next = event.target.value as FbdDataType; setConstantType(next); setConstantValue(String(defaultConstantLiteral(next))) }}
            >
              {FBD_DATA_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {pick('Giá trị', 'Value')}
            {constantType === 'BOOL' ? (
              <select className={inputClass} value={constantValue} onChange={(event) => setConstantValue(event.target.value)}>
                <option value="true">TRUE</option>
                <option value="false">FALSE</option>
              </select>
            ) : (
              <input className={inputClass} value={constantValue} onChange={(event) => setConstantValue(event.target.value)}
                placeholder={constantType === 'TIME' ? 'T#30s' : undefined} autoFocus />
            )}
          </label>
          <Button size="sm" type="submit">{pick('Tạo', 'Create')}</Button>
          <Button size="sm" variant="secondary" type="button" onClick={() => setCreatingKind(null)}>{pick('Hủy', 'Cancel')}</Button>
          {createError && <span className="text-xs text-[var(--c-danger-fg)]">{createError}</span>}
        </form>
      )}

      <div className={networkView === 'ALL' ? 'flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto' : 'flex min-h-0 flex-1 flex-col gap-2'}>
        {visibleNetworks.map((network) => (
          <article
            key={network.id}
            data-fbd-network-id={network.id}
            className={networkView === 'ALL'
              ? 'rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-2'
              : 'flex min-h-0 flex-1 flex-col rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-2'}
          >
            <FbdCanvas
              network={network}
              document={state.document}
              layout={state.document.layout}
              selection={state.selection}
              issueNodeIds={issueNodeIds}
              connectionFromPortId={state.connectionFromPortId}
              canEdit={canEdit}
              wireStyle={wireStyle}
              gridVisible={gridVisible}
              snapEnabled={snapEnabled}
              snapSize={snapSize}
              marqueeMode={marqueeMode}
              selectionRevision={state.selectionRevision}
              dispatch={dispatch}
              pick={pick}
              registerPort={(portId, element) => {
                if (element) portButtons.current.set(portId, element)
                else portButtons.current.delete(portId)
              }}
              pendingPlacement={network.id === selectedNetworkId ? pendingPlacement : null}
              layoutPreview={layoutPreview?.networkId === network.id ? layoutPreview.positions : null}
              onCancelPlacement={() => setPendingPlacement(null)}
              onCommitPlacement={() => setPendingPlacement(null)}
              showInlineMinimap={showInlineMinimap}
              runtime={runtime}
              onBridgeChange={onBridgeChange}
              clipboard={clipboardFor(network)}
              viewCommandsRef={network.id === selectedNetworkId ? viewCommandsRef : undefined}
              onAddBlockAt={canEdit && selectedPaletteEntry?.featureState === 'AVAILABLE'
                ? (at) => dispatch({
                    type: 'ADD_NODE',
                    networkId: network.id,
                    node: buildPaletteNode(selectedPaletteEntry),
                    position: snapPoint(at, snapEnabled ? snapSize : 0),
                  })
                : undefined}
              userPouInterfaces={userPouInterfaces}
            />
          </article>
        ))}
      </div>
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">{translateFbdAnnouncement(pick, state.announcement)}</p>
    </section>
  )
}
