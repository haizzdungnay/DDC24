import { useMemo, useState, useEffect, useRef } from 'react'
import {
  Search,
  Eye,
  EyeOff,
  Copy,
  Check,
  Code2,
  X,
  Activity,
} from 'lucide-react'
import { useI18n } from '../../../shared/i18n'
import {
  presentStRuntimeValue,
  type StRuntimeOverlayItem,
  type StRuntimeOverlayState,
} from '../design/editor/StRuntimeValueOverlay'
import {
  tokenizeStSource,
  ST_TOKEN_CLASS,
  type StTokenKind,
} from '../design/editor/stEditorSupport'
import type {
  ProgrammingBinding,
  ProgrammingPointCatalogEntry,
} from '../model/types'
import type {
  SimulationInputDescriptor,
  SimulationSlice,
} from './simulationSession'

const IEC_STANDARD_FUNCTIONS: Record<string, string> = {
  SEL: 'SEL(G: BOOL, IN0: ANY, IN1: ANY) -> ANY (Lựa chọn nhị phân: IN0 khi G=FALSE, IN1 khi G=TRUE)',
  LIMIT: 'LIMIT(MN: ANY, IN: ANY, MX: ANY) -> ANY (Giới hạn giá trị giữa MN và MX)',
  MAX: 'MAX(IN1: ANY, IN2: ANY) -> ANY (Giá trị lớn nhất)',
  MIN: 'MIN(IN1: ANY, IN2: ANY) -> ANY (Giá trị nhỏ nhất)',
  MUX: 'MUX(K: INT, IN0..INn: ANY) -> ANY (Bộ dồn kênh theo K)',
  ABS: 'ABS(IN: ANY_NUM) -> ANY_NUM (Giá trị tuyệt đối)',
  SQRT: 'SQRT(IN: ANY_REAL) -> ANY_REAL (Căn bậc hai)',
  LN: 'LN(IN: ANY_REAL) -> ANY_REAL (Logarit tự nhiên)',
  LOG: 'LOG(IN: ANY_REAL) -> ANY_REAL (Logarit thập phân)',
  EXP: 'EXP(IN: ANY_REAL) -> ANY_REAL (Hàm mũ e^x)',
  SIN: 'SIN(IN: ANY_REAL) -> ANY_REAL (Sin)',
  COS: 'COS(IN: ANY_REAL) -> ANY_REAL (Cosin)',
  TAN: 'TAN(IN: ANY_REAL) -> ANY_REAL (Tang)',
  ASIN: 'ASIN(IN: ANY_REAL) -> ANY_REAL (Arc sin)',
  ACOS: 'ACOS(IN: ANY_REAL) -> ANY_REAL (Arc cos)',
  ATAN: 'ATAN(IN: ANY_REAL) -> ANY_REAL (Arc tang)',
  EXPT: 'EXPT(IN1: ANY_NUM, IN2: ANY_NUM) -> ANY_NUM (Lũy thừa)',
}

const IEC_STANDARD_FBS: Record<string, string> = {
  TON: 'TON(IN: BOOL, PT: TIME) -> (Q: BOOL, ET: TIME) [Rơ-le trễ bật On-delay]',
  TOF: 'TOF(IN: BOOL, PT: TIME) -> (Q: BOOL, ET: TIME) [Rơ-le trễ tắt Off-delay]',
  TP: 'TP(IN: BOOL, PT: TIME) -> (Q: BOOL, ET: TIME) [Bộ phát xung thời gian]',
  R_TRIG: 'R_TRIG(CLK: BOOL) -> (Q: BOOL) [Phát hiện sườn lên (Rising edge)]',
  F_TRIG: 'F_TRIG(CLK: BOOL) -> (Q: BOOL) [Phát hiện sườn xuống (Falling edge)]',
  CTU: 'CTU(CU: BOOL, RESET: BOOL, PV: INT) -> (Q: BOOL, CV: INT) [Bộ đếm lên]',
  CTD: 'CTD(CD: BOOL, LOAD: BOOL, PV: INT) -> (Q: BOOL, CV: INT) [Bộ đếm xuống]',
  CTUD: 'CTUD(...) [Bộ đếm lên xuống]',
  PID: 'PID(AUTO: BOOL, PV: REAL, SP: REAL, ...) -> (Y: REAL) [Vòng điều khiển PID]',
  HYSTERESIS: 'HYSTERESIS(IN: REAL, HIGH: REAL, LOW: REAL) -> (OUT: BOOL) [Bộ so lệch ngưỡng trễ]',
  SCALE: 'SCALE(IN: REAL, IN_MIN: REAL, IN_MAX: REAL, OUT_MIN: REAL, OUT_MAX: REAL) -> REAL [Chuyển tỉ lệ dải đo]',
  DEADBAND: 'DEADBAND(IN: REAL, BAND: REAL) -> REAL [Vùng chết tín hiệu]',
}

const ST_KEYWORDS_SET = new Set([
  'PROGRAM', 'END_PROGRAM', 'FUNCTION', 'END_FUNCTION', 'FUNCTION_BLOCK', 'END_FUNCTION_BLOCK',
  'VAR', 'VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT', 'VAR_TEMP', 'VAR_GLOBAL', 'VAR_EXTERNAL', 'END_VAR', 'RETAIN', 'CONSTANT',
  'IF', 'THEN', 'ELSIF', 'ELSE', 'END_IF',
  'CASE', 'OF', 'END_CASE',
  'FOR', 'TO', 'BY', 'DO', 'END_FOR', 'WHILE', 'END_WHILE', 'REPEAT', 'UNTIL', 'END_REPEAT',
  'AND', 'OR', 'XOR', 'NOT', 'MOD', 'TRUE', 'FALSE', 'RETURN', 'EXIT',
  'BOOL', 'INT', 'DINT', 'UINT', 'SINT', 'USINT', 'REAL', 'LREAL', 'TIME', 'STRING', 'BYTE', 'WORD', 'DWORD',
])

export interface ResolvedVariableValue {
  variableName: string
  observationId: string
  displayValue: string
  state: 'live' | 'uncertain' | 'stale' | 'invalid'
  valid: boolean
  quality: string
  dataType?: string
  value: unknown
  pointId?: string
  pointName?: string
  isChanged?: boolean
}

export interface StSimulatedSourceViewerProps {
  source: string
  runtime: StRuntimeOverlayState
  slice?: SimulationSlice
  inputs?: readonly SimulationInputDescriptor[]
  bindings?: readonly ProgrammingBinding[]
  pointCatalogItems?: readonly ProgrammingPointCatalogEntry[]
  programName?: string
}

export function StSimulatedSourceViewer({
  source,
  runtime,
  slice,
  inputs,
  bindings,
  pointCatalogItems,
  programName,
}: StSimulatedSourceViewerProps) {
  const { pick } = useI18n()

  const [showInlineValues, setShowInlineValues] = useState<boolean>(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = window.localStorage.getItem('mkddc.programming.sim.showInlineValues')
        if (stored !== null) return stored === 'true'
      }
    } catch {
      // fallback
    }
    return true
  })

  const [viewMode, setViewMode] = useState<'debug' | 'raw'>('debug')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedVariable, setSelectedVariable] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [hoveredSymbol, setHoveredSymbol] = useState<{
    name: string
    displayValue?: string
    dataType?: string
    kind?: string
    quality?: string
    pointName?: string
    description?: string
    x: number
    y: number
  } | null>(null)

  const toggleInlineValues = () => {
    setShowInlineValues((prev) => {
      const next = !prev
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem('mkddc.programming.sim.showInlineValues', String(next))
        }
      } catch {
        // ignore
      }
      return next
    })
  }

  const prevValuesRef = useRef<Map<string, string>>(new Map())
  const [changedVars, setChangedVars] = useState<Set<string>>(new Set())

  const runtimeItems = useMemo(() => {
    return runtime.status === 'ready' ? runtime.items : []
  }, [runtime])

  const observations = useMemo(() => {
    return slice?.frame?.observations ?? []
  }, [slice?.frame?.observations])

  // Build indexed map of variables
  const variableValueMap = useMemo(() => {
    const map = new Map<string, ResolvedVariableValue>()

    // Index from runtime items
    for (const item of runtimeItems) {
      const cleanVarName = item.variableName.includes('.')
        ? item.variableName.slice(item.variableName.lastIndexOf('.') + 1)
        : item.variableName

      const presentation = presentStRuntimeValue(item)

      const binding = bindings?.find(
        (b) =>
          b.variableName?.toUpperCase() === cleanVarName.toUpperCase() ||
          b.variableName?.toUpperCase() === item.variableName.toUpperCase(),
      )
      const pointId = binding?.pointId
      const catalogEntry = pointId
        ? pointCatalogItems?.find((p) => p.pointId === pointId)
        : undefined
      const pointName = catalogEntry?.name || catalogEntry?.tag || pointId

      const obs = observations.find(
        (o) =>
          o.variable.toUpperCase() === cleanVarName.toUpperCase() ||
          o.observationId.toUpperCase() === item.variableId.toUpperCase(),
      )

      const resolved: ResolvedVariableValue = {
        variableName: cleanVarName,
        observationId: item.variableId,
        displayValue: presentation.displayValue,
        state: presentation.state,
        valid: item.valid,
        quality: item.quality,
        dataType: obs?.dataType,
        value: item.value,
        pointId,
        pointName,
      }

      map.set(cleanVarName.toLowerCase(), resolved)
      map.set(item.variableName.toLowerCase(), resolved)
      map.set(item.variableId.toLowerCase(), resolved)
    }

    // Direct observation indexing for variables not in runtimeItems
    for (const obs of observations) {
      const cleanVar = obs.variable || obs.observationId
      if (!map.has(cleanVar.toLowerCase())) {
        const item: StRuntimeOverlayItem = {
          variableId: obs.observationId,
          variableName: cleanVar,
          value: obs.value,
          valid: obs.value !== null && obs.value !== undefined && obs.quality !== 'UNAVAILABLE',
          quality: obs.quality,
          freshness: 'SIMULATION',
        }
        const presentation = presentStRuntimeValue(item)
        const binding = bindings?.find(
          (b) => b.variableName?.toUpperCase() === cleanVar.toUpperCase(),
        )
        const pointId = binding?.pointId
        const catalogEntry = pointId
          ? pointCatalogItems?.find((p) => p.pointId === pointId)
          : undefined
        const pointName = catalogEntry?.name || catalogEntry?.tag || pointId

        const resolved: ResolvedVariableValue = {
          variableName: cleanVar,
          observationId: obs.observationId,
          displayValue: presentation.displayValue,
          state: presentation.state,
          valid: item.valid,
          quality: obs.quality,
          dataType: obs.dataType,
          value: obs.value,
          pointId,
          pointName,
        }
        map.set(cleanVar.toLowerCase(), resolved)
        map.set(obs.observationId.toLowerCase(), resolved)
      }
    }

    return map
  }, [runtimeItems, observations, bindings, pointCatalogItems])

  // Track value changes between simulation ticks
  useEffect(() => {
    const newlyChanged = new Set<string>()
    const prev = prevValuesRef.current

    for (const [key, res] of variableValueMap.entries()) {
      if (prev.has(key)) {
        const oldVal = prev.get(key)
        if (oldVal !== res.displayValue && res.valid) {
          newlyChanged.add(res.variableName.toLowerCase())
        }
      }
      prev.set(key, res.displayValue)
    }

    if (newlyChanged.size > 0) {
      setChangedVars(newlyChanged)
      const timer = setTimeout(() => {
        setChangedVars(new Set())
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [variableValueMap, slice?.frame?.snapshotSequence])

  const lines = useMemo(() => {
    if (!source) return []
    return source.split('\n')
  }, [source])

  const analyzeLine = useMemo(() => {
    return (lineText: string): {
      lineValues: ResolvedVariableValue[]
      tokens: ReturnType<typeof tokenizeStSource>
    } => {
      const tokens = tokenizeStSource(lineText)

      const codeWithoutComments = lineText
        .replace(/\(\*.*?\*\)/g, ' ')
        .replace(/\/\/.*$/, ' ')

      const identifierMatches = codeWithoutComments.match(/\b[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)?\b/g) ?? []

      const foundVars: ResolvedVariableValue[] = []
      const seen = new Set<string>()

      for (const rawMatch of identifierMatches) {
        const upper = rawMatch.toUpperCase()
        if (ST_KEYWORDS_SET.has(upper)) continue

        const lookupKey = rawMatch.toLowerCase()
        const resolved = variableValueMap.get(lookupKey)

        if (resolved && !seen.has(resolved.variableName)) {
          seen.add(resolved.variableName)
          foundVars.push({
            ...resolved,
            isChanged: changedVars.has(resolved.variableName.toLowerCase()),
          })
        } else if (rawMatch.includes('.')) {
          const memberKey = rawMatch.toLowerCase()
          const memberResolved = variableValueMap.get(memberKey)
          if (memberResolved && !seen.has(memberResolved.variableName)) {
            seen.add(memberResolved.variableName)
            foundVars.push({
              ...memberResolved,
              isChanged: changedVars.has(memberResolved.variableName.toLowerCase()),
            })
          }
        }
      }

      return { lineValues: foundVars, tokens }
    }
  }, [variableValueMap, changedVars])

  const copyToClipboard = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(source)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const observedCount = useMemo(() => {
    const unique = new Set<string>()
    for (const item of runtimeItems) {
      unique.add(item.variableName)
    }
    return unique.size
  }, [runtimeItems])

  return (
    <section
      aria-label={pick('Khung mô phỏng ST', 'ST simulation viewer')}
      className="flex min-h-0 min-w-0 flex-1 flex-col space-y-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-2.5 shadow-xs"
    >
      {/* Toolbar Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--c-border)]/60 pb-2">
        <div className="flex items-center gap-2">
          <Code2 className="h-4 w-4 text-[var(--c-accent)]" aria-hidden="true" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--c-text)]">
            {pick('Mã nguồn đang mô phỏng', 'Simulated source')}
          </h3>
          {programName && (
            <span className="rounded bg-[var(--c-surface-2)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--c-text-dim)]">
              {programName}
            </span>
          )}
          {observedCount > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-[var(--c-accent)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--c-accent)]"
              title={pick(
                'Số lượng biến/tín hiệu có giá trị mô phỏng',
                'Number of variables with simulation values',
              )}
            >
              <Activity className="h-3 w-3 animate-pulse" />
              <span>
                {observedCount} {pick('giá trị mô phỏng', 'simulation values')}
              </span>
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* Quick Search */}
          <div className="relative flex items-center">
            <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-[var(--c-text-dim)]" aria-hidden="true" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={pick('Tìm biến/dòng…', 'Find variable/line…')}
              aria-label={pick('Tìm kiếm trong mã nguồn', 'Search in source')}
              className="h-6.5 w-28 rounded border border-[var(--c-border)] bg-[var(--c-surface)] pl-7 pr-6 text-xs text-[var(--c-text)] placeholder:text-[var(--c-text-dim)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--c-accent)] sm:w-36"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-1 text-[var(--c-text-dim)] hover:text-[var(--c-text)]"
                aria-label={pick('Xoá tìm kiếm', 'Clear search')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Toggle Inline Values */}
          <button
            type="button"
            onClick={toggleInlineValues}
            aria-pressed={showInlineValues}
            title={pick(
              showInlineValues ? 'Ẩn giá trị giả lập trên từng dòng' : 'Hiện giá trị giả lập trên từng dòng',
              showInlineValues ? 'Hide inline simulation values' : 'Show inline simulation values',
            )}
            className={`flex h-6.5 items-center gap-1.5 rounded border px-2 text-xs font-medium transition-colors ${
              showInlineValues
                ? 'border-[var(--c-accent)] bg-[var(--c-accent)] text-white shadow-xs'
                : 'border-[var(--c-border)] bg-[var(--c-surface-2)] text-[var(--c-text)] hover:bg-[var(--c-surface-3)]'
            }`}
          >
            {showInlineValues ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">
              {pick('Giá trị dòng', 'Inline values')}
            </span>
          </button>

          {/* Switch View Mode: Debug vs Raw */}
          <div className="flex items-center rounded border border-[var(--c-border)] bg-[var(--c-surface)] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setViewMode('debug')}
              className={`rounded px-2 py-0.5 font-medium transition-colors ${
                viewMode === 'debug'
                  ? 'bg-[var(--c-accent)] text-white shadow-xs'
                  : 'text-[var(--c-text-dim)] hover:text-[var(--c-text)]'
              }`}
            >
              {pick('Gỡ lỗi', 'Debug')}
            </button>
            <button
              type="button"
              onClick={() => setViewMode('raw')}
              className={`rounded px-2 py-0.5 font-medium transition-colors ${
                viewMode === 'raw'
                  ? 'bg-[var(--c-accent)] text-white shadow-xs'
                  : 'text-[var(--c-text-dim)] hover:text-[var(--c-text)]'
              }`}
            >
              {pick('Mã thô', 'Raw')}
            </button>
          </div>

          {/* Copy Button */}
          <button
            type="button"
            onClick={copyToClipboard}
            title={pick('Sao chép mã nguồn', 'Copy source')}
            className="flex h-6.5 items-center gap-1 rounded border border-[var(--c-border)] bg-[var(--c-surface-2)] px-2 text-xs text-[var(--c-text)] hover:bg-[var(--c-surface-3)]"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-[var(--c-good-fg)]" />
                <span className="text-[var(--c-good-fg)]">{pick('Đã chép', 'Copied')}</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{pick('Chép', 'Copy')}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Selected Variable Banner */}
      {selectedVariable && (
        <div className="flex items-center justify-between rounded bg-[var(--c-accent)]/10 px-2.5 py-1 text-xs text-[var(--c-accent)]">
          <div className="flex items-center gap-1.5 font-mono">
            <span className="text-[var(--c-text-dim)]">{pick('Đang chọn theo dõi:', 'Tracking variable:')}</span>
            <span className="font-bold">{selectedVariable}</span>
            {variableValueMap.get(selectedVariable.toLowerCase()) && (
              <span className="font-semibold text-[var(--c-text)]">
                ={' '}
                {variableValueMap.get(selectedVariable.toLowerCase())?.displayValue}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setSelectedVariable(null)}
            className="text-[var(--c-text-dim)] hover:text-[var(--c-text)]"
            aria-label={pick('Bỏ chọn', 'Clear selection')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Main Content Area */}
      {viewMode === 'raw' ? (
        <textarea
          readOnly
          aria-label={pick('Mã nguồn đang mô phỏng', 'Simulated source')}
          value={source}
          rows={16}
          className="w-full min-h-[340px] max-h-[460px] overflow-auto rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-2 font-mono text-xs text-[var(--c-text)] outline-none"
        />
      ) : (
        <>
          <textarea
            readOnly
            aria-label={pick('Mã nguồn đang mô phỏng', 'Simulated source')}
            value={source}
            tabIndex={-1}
            className="sr-only"
          />
          <div
            data-testid="st-simulated-source-debug-view"
          className="relative min-h-[340px] max-h-[460px] overflow-auto rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] font-mono text-xs [scrollbar-gutter:stable]"
        >
          <div className="min-w-fit">
            {lines.map((lineText, index) => {
              const lineNumber = index + 1
              const { lineValues, tokens } = analyzeLine(lineText)

              const isMatchSearch =
                searchQuery.trim().length > 0 &&
                lineText.toLowerCase().includes(searchQuery.trim().toLowerCase())

              const hasSelectedVariable =
                selectedVariable !== null &&
                lineText.toLowerCase().includes(selectedVariable.toLowerCase())

              return (
                <div
                  key={lineNumber}
                  className={`flex items-center justify-between min-h-[1.65rem] px-2 py-0.5 border-b border-[var(--c-border)]/20 transition-colors ${
                    hasSelectedVariable
                      ? 'bg-[var(--c-accent)]/15 border-l-3 border-l-[var(--c-accent)]'
                      : isMatchSearch
                      ? 'bg-[var(--c-warn-bg)]/30'
                      : 'hover:bg-[var(--c-surface-2)]/60'
                  }`}
                >
                  {/* Left: Line Number & Code */}
                  <div className="flex items-center min-w-0 pr-4">
                    <span className="w-10 shrink-0 text-right pr-3 select-none text-[var(--c-text-dim)]/50 text-[11px]">
                      {lineNumber}
                    </span>
                    <div className="whitespace-pre overflow-x-hidden text-[var(--c-text)]">
                      {tokens.map((token, tIdx) => {
                        const tokenText = token.text
                        const upper = tokenText.toUpperCase()
                        const cleanToken = tokenText.toLowerCase()
                        const resolved = variableValueMap.get(cleanToken)
                        const isIecFunc = IEC_STANDARD_FUNCTIONS[upper] !== undefined
                        const isIecFb = IEC_STANDARD_FBS[upper] !== undefined

                        const isHoverable =
                          resolved !== undefined || isIecFunc || isIecFb

                        return (
                          <span
                            key={tIdx}
                            className={`${ST_TOKEN_CLASS[token.kind as StTokenKind] ?? ''} ${isHoverable ? 'cursor-pointer hover:underline hover:font-bold' : ''} ${selectedVariable && cleanToken === selectedVariable.toLowerCase() ? 'bg-[var(--c-accent)]/20 rounded px-0.5 text-[var(--c-accent)] font-bold' : ''}`}
                            onMouseEnter={(e) => {
                              if (!isHoverable) return
                              const rect = e.currentTarget.getBoundingClientRect()
                              setHoveredSymbol({
                                name: tokenText,
                                displayValue: resolved?.displayValue,
                                dataType: resolved?.dataType || (isIecFunc ? 'FUNCTION' : isIecFb ? 'FUNCTION_BLOCK' : undefined),
                                kind: isIecFunc ? 'Hàm chuẩn IEC' : isIecFb ? 'Khối hàm chuẩn' : resolved?.pointName ? 'Biến gán điểm' : 'Biến chương trình',
                                quality: resolved?.quality,
                                pointName: resolved?.pointName,
                                description: isIecFunc ? IEC_STANDARD_FUNCTIONS[upper] : isIecFb ? IEC_STANDARD_FBS[upper] : undefined,
                                x: rect.left,
                                y: rect.bottom + 4,
                              })
                            }}
                            onMouseLeave={() => setHoveredSymbol(null)}
                            onClick={() => {
                              if (resolved) {
                                setSelectedVariable((curr) =>
                                  curr === resolved.variableName ? null : resolved.variableName,
                                )
                              }
                            }}
                          >
                            {tokenText}
                          </span>
                        )
                      })}
                    </div>
                  </div>

                  {/* Right: Inline Simulation Value Badges */}
                  {showInlineValues && lineValues.length > 0 && (
                    <div className="ml-auto pl-3 shrink-0 flex items-center gap-1.5 flex-wrap justify-end">
                      {lineValues.map((val) => {
                        const isBoolTrue =
                          val.value === true ||
                          val.displayValue.toUpperCase() === 'TRUE'
                        const isBoolFalse =
                          val.value === false ||
                          val.displayValue.toUpperCase() === 'FALSE'
                        const isInvalid = !val.valid || val.state === 'invalid'

                        let badgeClasses =
                          'border-[var(--c-accent)]/30 bg-[var(--c-accent)]/10 text-[var(--c-text)]'
                        let valueClasses = 'text-[var(--c-accent)] font-bold'

                        if (isBoolTrue) {
                          badgeClasses =
                            'border-[var(--c-good-fg)]/40 bg-[var(--c-good-bg)]/80 text-[var(--c-good-fg)]'
                          valueClasses = 'text-[var(--c-good-fg)] font-extrabold'
                        } else if (isBoolFalse) {
                          badgeClasses =
                            'border-[var(--c-border)] bg-[var(--c-surface-2)] text-[var(--c-text-dim)]'
                          valueClasses = 'text-[var(--c-text-dim)] font-semibold'
                        } else if (isInvalid) {
                          badgeClasses =
                            'border-dashed border-[var(--c-border)] bg-[var(--c-surface-2)]/60 text-[var(--c-text-dim)]'
                          valueClasses = 'text-[var(--c-text-dim)] font-normal'
                        }

                        if (val.isChanged) {
                          badgeClasses += ' ring-2 ring-[var(--c-accent)] animate-pulse'
                        }

                        return (
                          <button
                            key={val.variableName}
                            type="button"
                            onClick={() =>
                              setSelectedVariable((curr) =>
                                curr === val.variableName ? null : val.variableName,
                              )
                            }
                            title={`${val.variableName}: ${val.displayValue} (${val.dataType || 'VAR'} · ${val.quality})`}
                            className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-mono transition-all hover:brightness-110 ${badgeClasses} ${
                              selectedVariable === val.variableName
                                ? 'ring-2 ring-[var(--c-accent)] shadow-sm'
                                : ''
                            }`}
                          >
                            <span className="opacity-75">{val.variableName}:</span>
                            <span className={valueClasses}>{val.displayValue}</span>
                            {val.pointName && (
                              <span className="opacity-60 text-[10px] pl-1 border-l border-current/20">
                                {val.pointName}
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        </>
      )}

      {/* Floating Hover Card */}
      {hoveredSymbol && (
        <div
          role="tooltip"
          className="fixed z-50 max-w-sm rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-2 shadow-xl text-xs pointer-events-none"
          style={{
            top: `${Math.min(hoveredSymbol.y, typeof window !== 'undefined' ? window.innerHeight - 150 : 300)}px`,
            left: `${Math.min(hoveredSymbol.x, typeof window !== 'undefined' ? window.innerWidth - 280 : 300)}px`,
          }}
        >
          <div className="flex items-center justify-between gap-2 border-b border-[var(--c-border)]/50 pb-1">
            <span className="font-mono font-bold text-[var(--c-text)]">
              {hoveredSymbol.name}
            </span>
            {hoveredSymbol.dataType && (
              <span className="rounded bg-[var(--c-surface-2)] px-1 font-mono text-[10px] text-[var(--c-accent)] font-semibold">
                {hoveredSymbol.dataType}
              </span>
            )}
          </div>

          <div className="mt-1.5 space-y-1">
            {hoveredSymbol.displayValue !== undefined && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-[var(--c-text-dim)]">{pick('Giá trị chạy:', 'Runtime value:')}</span>
                <span className="font-mono font-bold text-[var(--c-good-fg)]">
                  {hoveredSymbol.displayValue}
                </span>
              </div>
            )}
            {hoveredSymbol.quality && (
              <div className="flex items-center justify-between gap-3 text-[11px]">
                <span className="text-[var(--c-text-dim)]">{pick('Chất lượng:', 'Quality:')}</span>
                <span className="font-mono text-[var(--c-text-dim)]">
                  {hoveredSymbol.quality}
                </span>
              </div>
            )}
            {hoveredSymbol.pointName && (
              <div className="flex items-center justify-between gap-3 text-[11px]">
                <span className="text-[var(--c-text-dim)]">{pick('Điểm liên kết:', 'Bound point:')}</span>
                <span className="font-mono font-medium text-[var(--c-text)]">
                  {hoveredSymbol.pointName}
                </span>
              </div>
            )}
            {hoveredSymbol.kind && (
              <div className="text-[10px] text-[var(--c-text-dim)] pt-0.5">
                {hoveredSymbol.kind}
              </div>
            )}
            {hoveredSymbol.description && (
              <div className="mt-1 rounded bg-[var(--c-surface-2)] p-1 font-mono text-[11px] text-[var(--c-text-dim)]">
                {hoveredSymbol.description}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
