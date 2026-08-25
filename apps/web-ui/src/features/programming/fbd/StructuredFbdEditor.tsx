import { ArrowDown, ArrowUp, Plus, Redo2, RotateCcw, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useId, useMemo, useReducer, useRef, useState } from 'react'

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
import {
  FBD_PALETTE,
  FBD_PALETTE_CATEGORY_ORDER,
  defaultConstantLiteral,
  fbdPaletteEntry,
  isValidConstantLiteral,
  paletteEntriesCompatibleWith,
  type FbdPaletteEntry,
} from './palette'
import { userPouPaletteEntry, type UserPouInterface } from './userPou'

export interface StructuredFbdEditorProps {
  document: FbdDocument
  canEdit: boolean
  onChange: (document: FbdDocument) => void
  /** Interface typed đến từ Draft/API. Editor không parse source ST để đoán pin. */
  userPouInterfaces?: readonly UserPouInterface[]
}

const EMPTY_USER_POU_INTERFACES: readonly UserPouInterface[] = []

function newUuid(): string {
  return createUuid()
}

function newNetwork(index: number): FbdNetwork {
  return { id: newUuid(), name: `NETWORK_${index + 1}`, order: index, nodes: [], wires: [] }
}

/* WP-05 (FBD_EDITOR_DESIGN.md §1) — mọi block Logic/Compare/Math/Conversion/
 * Timer/Trigger/Control tạo qua đúng 1 factory chung, executionOrder do
 * reducer `ADD_NODE` gán lại (luôn nối cuối network) nên không cần tính ở đây. */
function buildPaletteNode(entry: FbdPaletteEntry): FbdNode {
  const ports = entry.buildPorts(entry.defaultType)
  return {
    id: newUuid(),
    kind: entry.kind,
    typeRef: entry.typeRef,
    executionOrder: 0,
    parameters: {},
    ports: ports.map((port, index) => ({
      id: newUuid(), name: port.name, direction: port.direction, dataType: port.dataType, unit: null, order: index,
    })),
  }
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

function NodeInspector({
  node, networkId, canEdit, dispatch, pick, paletteEntry,
}: {
  node: FbdNode
  networkId: string
  canEdit: boolean
  dispatch: (action: FbdEditorAction) => void
  pick: (vi: string, en: string) => string
  paletteEntry?: FbdPaletteEntry
}) {
  const entry = paletteEntry ?? fbdPaletteEntry(node.typeRef)
  const [variableDraft, setVariableDraft] = useState('')
  const [unitDraft, setUnitDraft] = useState('')
  const [typeDraft, setTypeDraft] = useState<FbdDataType>('BOOL')
  const [valueDraft, setValueDraft] = useState('')
  const [instanceDraft, setInstanceDraft] = useState('')
  const [retainedDraft, setRetainedDraft] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
    if (node.kind === 'INPUT' || node.kind === 'OUTPUT') {
      setVariableDraft(typeof node.parameters.variable === 'string' ? node.parameters.variable : '')
      setUnitDraft(node.ports[0]?.unit ?? '')
      setTypeDraft(node.typeRef as FbdDataType)
    } else if (node.kind === 'CONSTANT') {
      setTypeDraft(node.typeRef as FbdDataType)
      setValueDraft(String(node.parameters.value ?? ''))
    } else if (node.kind === 'FUNCTION_BLOCK') {
      setInstanceDraft(typeof node.parameters.instance === 'string' ? node.parameters.instance : '')
      setRetainedDraft(node.parameters.retained === true)
    } else if (entry?.polymorphic) {
      const typedPort = node.ports.find((port) => entry.typedPortNames.includes(port.name))
      setTypeDraft(typedPort?.dataType ?? entry.defaultType)
    }
  }, [node.id, node.kind, node.parameters, node.ports, node.typeRef, entry])

  if (node.kind === 'INPUT' || node.kind === 'OUTPUT') {
    return (
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!isFbdIdentifier(variableDraft)) { setError(pick('Tên biến không hợp lệ', 'Invalid variable name')); return }
          setError(null)
          if (typeDraft !== node.typeRef) dispatch({ type: 'SET_NODE_TYPE', networkId, nodeId: node.id, dataType: typeDraft })
          dispatch({
            type: 'SET_NODE_VARIABLE', networkId, nodeId: node.id,
            variable: variableDraft, unit: unitDraft.trim().length > 0 ? unitDraft.trim() : null,
          })
        }}
      >
        <label className="flex flex-col gap-1 text-xs">
          {pick('Tên biến', 'Variable name')}
          <input className={inputClass} value={variableDraft} disabled={!canEdit} onChange={(event) => setVariableDraft(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          {pick('Kiểu', 'Type')}
          <select className={inputClass} value={typeDraft} disabled={!canEdit} onChange={(event) => setTypeDraft(event.target.value as FbdDataType)}>
            {FBD_DATA_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          {pick('Đơn vị (tuỳ chọn)', 'Unit (optional)')}
          <input className={inputClass} value={unitDraft} disabled={!canEdit} onChange={(event) => setUnitDraft(event.target.value)} />
        </label>
        <Button size="sm" type="submit" disabled={!canEdit}>{pick('Lưu', 'Save')}</Button>
        {error && <span className="text-xs text-[var(--c-danger-fg)]">{error}</span>}
      </form>
    )
  }

  if (node.kind === 'CONSTANT') {
    return (
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          const parsed: FbdParameterValue = typeDraft === 'BOOL' ? valueDraft === 'true'
            : typeDraft === 'TIME' ? valueDraft
            : Number(valueDraft)
          if (!isValidConstantLiteral(typeDraft, parsed)) { setError(pick('Giá trị không hợp lệ với kiểu đã chọn', 'Value is not valid for the selected type')); return }
          setError(null)
          if (typeDraft !== node.typeRef) dispatch({ type: 'SET_NODE_TYPE', networkId, nodeId: node.id, dataType: typeDraft })
          dispatch({ type: 'SET_NODE_VALUE', networkId, nodeId: node.id, value: parsed })
        }}
      >
        <label className="flex flex-col gap-1 text-xs">
          {pick('Kiểu', 'Type')}
          <select
            className={inputClass}
            value={typeDraft}
            disabled={!canEdit}
            onChange={(event) => {
              const next = event.target.value as FbdDataType
              setTypeDraft(next)
              setValueDraft(String(defaultConstantLiteral(next)))
            }}
          >
            {FBD_DATA_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          {pick('Giá trị', 'Value')}
          {typeDraft === 'BOOL' ? (
            <select className={inputClass} value={valueDraft} disabled={!canEdit} onChange={(event) => setValueDraft(event.target.value)}>
              <option value="true">TRUE</option>
              <option value="false">FALSE</option>
            </select>
          ) : (
            <input className={inputClass} value={valueDraft} disabled={!canEdit} onChange={(event) => setValueDraft(event.target.value)}
              placeholder={typeDraft === 'TIME' ? 'T#30s' : undefined} />
          )}
        </label>
        <Button size="sm" type="submit" disabled={!canEdit}>{pick('Lưu', 'Save')}</Button>
        {error && <span className="text-xs text-[var(--c-danger-fg)]">{error}</span>}
      </form>
    )
  }

  if (node.kind === 'FUNCTION_BLOCK') {
    return (
      <div className="space-y-2">
        {entry?.warning && (
          <p className="rounded bg-[var(--c-warn-bg)] px-2 py-1 text-xs text-[var(--c-warn-fg)]">
            {pick(entry.warning.vi, entry.warning.en)}
          </p>
        )}
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            const trimmed = instanceDraft.trim()
            if (trimmed.length > 0 && !isFbdIdentifier(trimmed)) { setError(pick('Tên instance không hợp lệ', 'Invalid instance name')); return }
            setError(null)
            dispatch({
              type: 'SET_NODE_FB_PARAMS', networkId, nodeId: node.id,
              instance: trimmed.length > 0 ? trimmed : null, retained: retainedDraft,
            })
          }}
        >
          <label className="flex flex-col gap-1 text-xs">
            {pick('Tên instance (tuỳ chọn)', 'Instance name (optional)')}
            <input className={inputClass} value={instanceDraft} disabled={!canEdit} onChange={(event) => setInstanceDraft(event.target.value)}
              placeholder={pick('tự sinh nếu để trống', 'auto-generated if empty')} />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={retainedDraft} disabled={!canEdit} onChange={(event) => setRetainedDraft(event.target.checked)} />
            {pick('RETAIN (giữ trạng thái qua power-cycle)', 'RETAIN (persist across power-cycle)')}
          </label>
          <Button size="sm" type="submit" disabled={!canEdit}>{pick('Lưu', 'Save')}</Button>
          {error && <span className="text-xs text-[var(--c-danger-fg)]">{error}</span>}
        </form>
      </div>
    )
  }

  if (entry?.polymorphic) {
    return (
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          dispatch({ type: 'SET_NODE_TYPE', networkId, nodeId: node.id, dataType: typeDraft })
        }}
      >
        <label className="flex flex-col gap-1 text-xs">
          {pick('Kiểu toán hạng', 'Operand type')}
          <select className={inputClass} value={typeDraft} disabled={!canEdit} onChange={(event) => setTypeDraft(event.target.value as FbdDataType)}>
            {entry.allowedTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <Button size="sm" type="submit" disabled={!canEdit}>{pick('Lưu', 'Save')}</Button>
      </form>
    )
  }

  return (
    <p className="text-xs text-[var(--c-text-dim)]">
      {pick('Block cố định — không có tham số để sửa.', 'Fixed-shape block — no editable parameters.')}
    </p>
  )
}

export function StructuredFbdEditor({ document, canEdit, onChange, userPouInterfaces = EMPTY_USER_POU_INTERFACES }: StructuredFbdEditorProps) {
  const { pick } = useI18n()
  const [state, dispatch] = useReducer(fbdEditorReducer, createFbdEditorState(document, canEdit))
  const publishedDocument = useRef(canonicalFbdJson(state.document))
  const portButtons = useRef(new Map<string, HTMLButtonElement>())
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
    const current = canonicalFbdJson(state.document)
    if (publishedDocument.current !== current) {
      publishedDocument.current = current
      onChange(state.document)
    }
  }, [onChange, state.document])

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
            <ol className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
              {network.nodes.map((node) => (
                <li key={node.id} className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3">
                  <button
                    type="button"
                    data-fbd-canvas-control="true"
                    className="min-h-11 w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
                    aria-pressed={state.selection?.kind === 'node' && state.selection.nodeId === node.id}
                    onClick={() => dispatch({ type: 'SELECT', selection: { kind: 'node', networkId: network.id, nodeId: node.id } })}
                  >
                    <span className="block text-sm font-semibold">#{node.executionOrder} · {node.typeRef}</span>
                    <span className="block text-xs text-[var(--c-text-dim)]">{node.kind}</span>
                  </button>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {node.ports.map((port) => {
                      const selected = state.selection?.kind === 'port' && state.selection.portId === port.id
                      const isSource = state.connectionFromPortId === port.id
                      return (
                        <button
                          key={port.id}
                          ref={(element) => {
                            if (element) portButtons.current.set(port.id, element)
                            else portButtons.current.delete(port.id)
                          }}
                          type="button"
                          data-fbd-canvas-control="true"
                          className={`min-h-11 rounded border px-2 py-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)] ${selected || isSource ? 'border-[var(--c-accent)] bg-[var(--c-accent-bg)]' : 'border-[var(--c-border)]'}`}
                          aria-pressed={selected}
                          aria-label={`${node.typeRef} ${port.direction} ${port.name} ${port.dataType}${port.unit ? ` ${port.unit}` : ''}`}
                          onClick={() => dispatch({ type: 'SELECT', selection: { kind: 'port', networkId: network.id, nodeId: node.id, portId: port.id } })}
                        >
                          {port.direction === 'INPUT' ? '←' : '→'} {port.name} · {port.dataType}
                        </button>
                      )
                    })}
                  </div>
                  {state.selection?.kind === 'node' && state.selection.nodeId === node.id && (
                    <div className="mt-3 border-t border-[var(--c-border)] pt-3" role="group" aria-label={pick('Inspector node', 'Node inspector')}>
                      <NodeInspector
                        node={node}
                        networkId={network.id}
                        canEdit={canEdit}
                        dispatch={dispatch}
                        pick={pick}
                        paletteEntry={paletteEntries.find((entry) => entry.typeRef === node.typeRef)}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ol>
            {network.nodes.length === 0 && <p className="text-sm text-[var(--c-text-dim)]">{pick('Network trống — thêm block để bắt đầu.', 'Empty network — add a block to begin.')}</p>}
            {network.wires.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2" aria-label={pick('Danh sách wire', 'Wire list')}>
                {network.wires.map((wire) => (
                  <button
                    key={wire.id}
                    type="button"
                    data-fbd-canvas-control="true"
                    className="min-h-11 rounded border border-[var(--c-border)] px-2 py-1 font-mono text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
                    aria-pressed={state.selection?.kind === 'wire' && state.selection.wireId === wire.id}
                    onClick={() => dispatch({ type: 'SELECT', selection: { kind: 'wire', networkId: network.id, wireId: wire.id } })}
                  >
                    {wire.from.portId.slice(0, 8)} → {wire.to.portId.slice(0, 8)}
                  </button>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">{translateFbdAnnouncement(pick, state.announcement)}</p>
    </section>
  )
}
