import type { FbdDataType, FbdNode, FbdParameterValue } from './model'

export const inputClass = 'rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1 text-xs'

export interface FbdNodeEditorTarget {
  networkId: string
  node: FbdNode
  canEdit: boolean
  apply: (change: FbdNodeEditorChange) => void
}

export type FbdNodeEditorChange =
  | { kind: 'variable'; variable: string; unit: string | null }
  | { kind: 'value'; value: FbdParameterValue }
  | { kind: 'dataType'; dataType: FbdDataType }
  | { kind: 'fbParams'; instance: string | null; retained: boolean }
