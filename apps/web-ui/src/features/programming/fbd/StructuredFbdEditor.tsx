import { ArrowDown, ArrowUp, Plus, Redo2, RotateCcw, Trash2, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from 'react'

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
  type FbdWire,
} from './model'
import { FbdCanvas, buildPaletteNode } from './FbdCanvas'
import { fbdIssueTargets } from './issueTargets'
import {
  FBD_PALETTE,
  FBD_PALETTE_CATEGORY_ORDER,
  defaultConstantLiteral,
  isValidConstantLiteral,
  paletteEntriesCompatibleWith,
  type FbdPaletteEntry,
} from './palette'
import { userPouPaletteEntry, type UserPouInterface } from './userPou'
import { QuickLibraryHost } from '../design/library/QuickLibraryPanel'
import { type FbdNodeEditorChange, type FbdNodeEditorTarget } from './nodeEditor'

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
}

const EMPTY_USER_POU_INTERFACES: readonly UserPouInterface[] = []

function newUuid(): string {
  return createUuid()
}

function newNetwork(index: number): FbdNetwork {
  return { id: newUuid(), name: `NETWORK_${index + 1}`, order: index, nodes: [], wires: [] }
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

export function StructuredFbdEditor({ document, canEdit, onChange, userPouInterfaces = EMPTY_USER_POU_INTERFACES, projectId, onSelectionChange, onNodeEditorTargetChange, focusSelection }: StructuredFbdEditorProps) {
  const { pick } = useI18n()
  const [state, dispatch] = useReducer(fbdEditorReducer, createFbdEditorState(document, canEdit))
  const publishedDocument = useRef(canonicalFbdJson(state.document))
  /* Port nay là phần tử SVG (`<g role="button">`) chứ không còn là
   * `<button>` HTML — cả hai đều `.focus()` được, nên điều hướng port bằng
   * bàn phím giữ nguyên. */
  const portButtons = useRef(new Map<string, SVGGElement>())
  const sectionRef = useRef<HTMLElement>(null)
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
  const [libraryDockOpen, setLibraryDockOpen] = useState(false)
  const [pendingPlacement, setPendingPlacement] = useState<{ entryId: string } | null>(null)
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
    publishedDocument.current = canonicalFbdJson(document)
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

  const selectedNetworkId = state.selection?.networkId ?? state.document.networks[0]?.id
  const selectedPaletteEntry = paletteEntries.find((entry) => entry.id === paletteTypeRef)
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
      action = { type: 'ADD_NETWORK', network: newNetwork(state.document.networks.length) }
    } else if (command === 'ADD_BLOCK') {
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
      className="space-y-4 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4"
      onKeyDown={(event) => {
        const command = resolveFbdKeyboardCommand(event)
        if (!command || ignoresGraphCommand(event.target, command)) return
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">FBD · {state.document.name}</h2>
          <p id={keyboardHelpId} className="text-xs text-[var(--c-text-dim)]">
            {pick(
              'Chọn block/POU trong palette; Insert thêm lựa chọn đó · ↑/↓ chọn port · Enter nối · Alt+↑/↓ đổi thứ tự · Delete xóa · Ctrl+Z/Y hoàn tác/làm lại.',
              'Choose a block/POU in the palette; Insert adds the selected block/POU · arrows select port · Enter connects · Alt+arrows reorder · Delete removes · Ctrl+Z/Y undo/redo.',
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="toolbar" aria-label={pick('Lệnh FBD', 'FBD commands')}>
          <Button size="sm" icon={<Plus className="h-4 w-4" />} disabled={!canEdit} onClick={() => dispatchCommand('ADD_NETWORK')}>
            {pick('Network', 'Network')}
          </Button>
          <Button size="sm" icon={<ArrowUp className="h-4 w-4" />} disabled={!canEdit} onClick={() => dispatchCommand('MOVE_NODE_UP')} aria-label={pick('Đưa block lên', 'Move block up')} />
          <Button size="sm" icon={<ArrowDown className="h-4 w-4" />} disabled={!canEdit} onClick={() => dispatchCommand('MOVE_NODE_DOWN')} aria-label={pick('Đưa block xuống', 'Move block down')} />
          <Button size="sm" icon={<Trash2 className="h-4 w-4" />} disabled={!canEdit} onClick={() => dispatchCommand('DELETE_SELECTION')} aria-label={pick('Xóa vùng chọn', 'Delete selection')} />
          <Button size="sm" icon={<Undo2 className="h-4 w-4" />} disabled={!canEdit || state.past.length === 0} onClick={() => dispatchCommand('UNDO')} aria-label={pick('Hoàn tác', 'Undo')} />
          <Button size="sm" icon={<Redo2 className="h-4 w-4" />} disabled={!canEdit || state.future.length === 0} onClick={() => dispatchCommand('REDO')} aria-label={pick('Làm lại', 'Redo')} />
          <Button size="sm" icon={<RotateCcw className="h-4 w-4" />} disabled={!state.connectionFromPortId} onClick={() => dispatchCommand('CANCEL_CONNECTION')}>
            {pick('Hủy nối', 'Cancel wire')}
          </Button>
        </div>
      </div>

      {/* WP-05/06 (FBD_EDITOR_DESIGN.md §1/§2) — palette 9 nhóm + tạo node giao diện */}
      <div className="flex flex-wrap items-end gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-3" role="group" aria-label={pick('Palette FBD', 'FBD palette')}>
        <label className="flex flex-col gap-1 text-xs">
          {pick('Khối', 'Block')}
          <select
            className={inputClass}
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
        {/* `T59-804`: bộ lọc là LỰA CHỌN, không phải cắt bớt vĩnh viễn — "không
            khớp cổng này" khác hẳn "không tồn tại". Chỉ hiện khi đang đứng ở
            một cổng, và nói rõ còn lại bao nhiêu mục. */}
        <Button
          size="sm"
          variant="ghost"
          disabled={!canEdit || !selectedNetworkId}
          aria-pressed={libraryDockOpen}
          title={pick('Thư viện nhanh — cùng catalog với ST và PGM-04', 'Quick library — same catalog as ST and PGM-04')}
          onClick={() => setLibraryDockOpen((open) => !open)}
        >
          {pick('Thư viện', 'Library')}
        </Button>
        {libraryDockOpen && canEdit && (
          <div className="relative">
            <QuickLibraryHost
              projectId={projectId}
              language="FBD"
              /* Canvas chỉ vẽ được mục mà palette biết dựng port; mục PROJECT
                 chưa có entry palette phải nói ra lý do tại chỗ thay vì biến
                 mất khỏi danh sách và để người dùng đi tìm. */
              canInsert={(entry) =>
                paletteEntries.some((item) => item.id === entry.entryId)
                  ? { ok: true }
                  : { ok: false, reason: pick('Chưa vẽ được trên canvas', 'Not drawable on the canvas') }
              }
              onInsert={(entry) => {
                const paletteEntry = paletteEntries.find((item) => item.id === entry.entryId)
                const network = state.document.networks.find((item) => item.id === selectedNetworkId)
                if (!paletteEntry || !network) return false
                setPendingPlacement({ entryId: entry.entryId })
                setLibraryDockOpen(false)
                return true
              }}
              onClose={() => setLibraryDockOpen(false)}
            />
          </div>
        )}
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
        <Button size="sm" icon={<Plus className="h-4 w-4" />} disabled={!canEdit || !selectedNetworkId || !selectedPaletteEntry} onClick={addPaletteNode}>
          {pick('Thêm khối', 'Add block')}
        </Button>
        <Button size="sm" variant={creatingKind === 'INPUT' ? 'primary' : 'secondary'} disabled={!canEdit || !selectedNetworkId}
          onClick={() => { setCreatingKind(creatingKind === 'INPUT' ? null : 'INPUT'); setCreateError(null) }}>
          {pick('Input', 'Input')}
        </Button>
        <Button size="sm" variant={creatingKind === 'OUTPUT' ? 'primary' : 'secondary'} disabled={!canEdit || !selectedNetworkId}
          onClick={() => { setCreatingKind(creatingKind === 'OUTPUT' ? null : 'OUTPUT'); setCreateError(null) }}>
          {pick('Output', 'Output')}
        </Button>
        <Button size="sm" variant={creatingKind === 'CONSTANT' ? 'primary' : 'secondary'} disabled={!canEdit || !selectedNetworkId}
          onClick={() => {
            setCreatingKind(creatingKind === 'CONSTANT' ? null : 'CONSTANT')
            setCreateError(null)
            setConstantValue(String(defaultConstantLiteral(constantType)))
          }}>
          {pick('Constant', 'Constant')}
        </Button>
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
      </div>

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

      <div className="flex flex-wrap gap-2 text-xs" aria-label={pick('Trạng thái FBD', 'FBD status')}>
        <span className="rounded-full border border-[var(--c-border)] px-2 py-1">{state.document.networks.length}/256 network</span>
        <span className="rounded-full border border-[var(--c-border)] px-2 py-1">
          {state.document.networks.reduce((sum, item) => sum + item.nodes.length, 0)}/256 block
        </span>
        <span className="rounded-full border border-[var(--c-border)] px-2 py-1">
          {state.document.networks.reduce((sum, item) => sum + item.wires.length, 0)}/512 wire
        </span>
        <span className={issues.length ? 'rounded-full bg-[var(--c-warn-bg)] px-2 py-1 text-[var(--c-warn-fg)]' : 'rounded-full bg-[var(--c-good-bg)] px-2 py-1 text-[var(--c-good-fg)]'}>
          {issues.length ? pick(`${issues.length} lỗi Draft`, `${issues.length} Draft ${issues.length === 1 ? 'issue' : 'issues'}`) : pick('Canonical hợp lệ', 'Canonical valid')}
        </span>
        {!canEdit && <span className="rounded-full bg-[var(--c-surface-2)] px-2 py-1">{pick('Chỉ đọc', 'Read only')}</span>}
      </div>

      {issues.length > 0 && (
        /* `AC-FBD-007` — validator đã biết CHÍNH XÁC lỗi nằm ở block/dây nào
         * (đường dẫn `$.networks[0].nodes[2].typeRef`). Trước đây UI chỉ hiện
         * một con số, nên người dùng có toạ độ lỗi trong tay mà vẫn phải tự đi
         * tìm. Mỗi dòng dưới đây nhảy thẳng tới đúng phần tử. */
        <div className="rounded-[var(--radius)] border border-[var(--c-warn-fg)] bg-[var(--c-warn-bg)] p-2" role="group" aria-label={pick('Vấn đề FBD', 'FBD problems')}>
          <h4 className="text-xs font-semibold uppercase text-[var(--c-warn-fg)]">{pick('Vấn đề', 'Problems')}</h4>
          <ul className="mt-1 space-y-1">
            {issueTargets.map((target, index) => (
              <li key={`${target.issue.code}-${target.issue.path}-${index}`}>
                {target.selection ? (
                  <button
                    type="button"
                    data-fbd-canvas-control="true"
                    className="min-h-11 w-full rounded px-2 py-1 text-left text-xs text-[var(--c-warn-fg)] hover:bg-[var(--c-surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
                    onClick={() => dispatch({ type: 'SELECT', selection: target.selection })}
                  >
                    <span className="font-mono">{target.issue.code}</span> · {target.label}
                  </button>
                ) : (
                  /* Lỗi không neo được vào phần tử nào thì nói thẳng, thay vì
                   * đưa người dùng tới một block gần đúng. */
                  <p className="px-2 py-1 text-xs text-[var(--c-warn-fg)]">
                    <span className="font-mono">{target.issue.code}</span> · {pick('không neo vào block nào', 'not anchored to a block')} (<span className="font-mono">{target.issue.path}</span>)
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-3">
        {state.document.networks.map((network) => (
          <article key={network.id} className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-3">
            <button
              type="button"
              data-fbd-canvas-control="true"
              className="mb-3 min-h-11 text-left text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
              aria-pressed={state.selection?.kind === 'network' && state.selection.networkId === network.id}
              onClick={() => dispatch({ type: 'SELECT', selection: { kind: 'network', networkId: network.id } })}
            >
              {network.order + 1}. {network.name}
            </button>
            <FbdCanvas
              network={network}
              document={state.document}
              layout={state.document.layout}
              selection={state.selection}
              issueNodeIds={issueNodeIds}
              connectionFromPortId={state.connectionFromPortId}
              canEdit={canEdit}
              dispatch={dispatch}
              pick={pick}
              registerPort={(portId, element) => {
                if (element) portButtons.current.set(portId, element)
                else portButtons.current.delete(portId)
              }}
              pendingPlacement={network.id === selectedNetworkId ? pendingPlacement : null}
              onCancelPlacement={() => setPendingPlacement(null)}
              onCommitPlacement={() => setPendingPlacement(null)}
            />
          </article>
        ))}
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">{translateFbdAnnouncement(pick, state.announcement)}</p>
    </section>
  )
}
