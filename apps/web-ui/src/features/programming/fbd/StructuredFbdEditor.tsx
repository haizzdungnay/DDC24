import { ArrowDown, ArrowUp, Plus, Redo2, RotateCcw, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useId, useReducer, useRef } from 'react'

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
import { canonicalFbdJson, findFbdPort, validateFbdDocument, type FbdDocument, type FbdNetwork, type FbdNode, type FbdWire } from './model'

export interface StructuredFbdEditorProps {
  document: FbdDocument
  canEdit: boolean
  onChange: (document: FbdDocument) => void
}

function newUuid(): string {
  return createUuid()
}

function newNetwork(index: number): FbdNetwork {
  return { id: newUuid(), name: `NETWORK_${index + 1}`, order: index, nodes: [], wires: [] }
}

function newAndNode(executionOrder: number): FbdNode {
  return {
    id: newUuid(),
    kind: 'FUNCTION',
    typeRef: 'AND',
    executionOrder,
    parameters: {},
    ports: [
      { id: newUuid(), name: 'IN1', direction: 'INPUT', dataType: 'BOOL', unit: null, order: 0 },
      { id: newUuid(), name: 'IN2', direction: 'INPUT', dataType: 'BOOL', unit: null, order: 1 },
      { id: newUuid(), name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL', unit: null, order: 2 },
    ],
  }
}

export function StructuredFbdEditor({ document, canEdit, onChange }: StructuredFbdEditorProps) {
  const { pick } = useI18n()
  const [state, dispatch] = useReducer(fbdEditorReducer, createFbdEditorState(document, canEdit))
  const publishedDocument = useRef(canonicalFbdJson(state.document))
  const portButtons = useRef(new Map<string, HTMLButtonElement>())
  const sectionRef = useRef<HTMLElement>(null)
  const keyboardHelpId = useId()

  useEffect(() => {
    dispatch({ type: 'SET_CAN_EDIT', canEdit })
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

  const selectedNetworkId = state.selection?.networkId ?? state.document.networks[0]?.id

  function dispatchCommand(command: FbdKeyboardCommand) {
    let action: FbdEditorAction | null = null
    if (command === 'ADD_NETWORK') {
      action = { type: 'ADD_NETWORK', network: newNetwork(state.document.networks.length) }
    } else if (command === 'ADD_BLOCK') {
      const network = state.document.networks.find((item) => item.id === selectedNetworkId)
      if (network) action = { type: 'ADD_NODE', networkId: network.id, node: newAndNode(network.nodes.length) }
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
        if (!command) return
        event.preventDefault()
        dispatchCommand(command)
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">FBD · {state.document.name}</h2>
          <p id={keyboardHelpId} className="text-xs text-[var(--c-text-dim)]">
            {pick(
              'Insert thêm block · ↑/↓ chọn port · Enter nối · Alt+↑/↓ đổi thứ tự · Delete xóa · Ctrl+Z/Y hoàn tác/làm lại.',
              'Insert block · arrows select port · Enter connects · Alt+arrows reorder · Delete removes · Ctrl+Z/Y undo/redo.',
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="toolbar" aria-label={pick('Lệnh FBD', 'FBD commands')}>
          <Button size="sm" icon={<Plus className="h-4 w-4" />} disabled={!canEdit} onClick={() => dispatchCommand('ADD_NETWORK')}>
            {pick('Network', 'Network')}
          </Button>
          <Button size="sm" icon={<Plus className="h-4 w-4" />} disabled={!canEdit || !selectedNetworkId} onClick={() => dispatchCommand('ADD_BLOCK')}>
            {pick('Block AND', 'AND block')}
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
              className="mb-3 text-left text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
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
                    className="w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
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
                          className={`rounded border px-2 py-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)] ${selected || isSource ? 'border-[var(--c-accent)] bg-[var(--c-accent-bg)]' : 'border-[var(--c-border)]'}`}
                          aria-pressed={selected}
                          aria-label={`${node.typeRef} ${port.direction} ${port.name} ${port.dataType}${port.unit ? ` ${port.unit}` : ''}`}
                          onClick={() => dispatch({ type: 'SELECT', selection: { kind: 'port', networkId: network.id, nodeId: node.id, portId: port.id } })}
                        >
                          {port.direction === 'INPUT' ? '←' : '→'} {port.name} · {port.dataType}
                        </button>
                      )
                    })}
                  </div>
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
                    className="rounded border border-[var(--c-border)] px-2 py-1 font-mono text-[11px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
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
