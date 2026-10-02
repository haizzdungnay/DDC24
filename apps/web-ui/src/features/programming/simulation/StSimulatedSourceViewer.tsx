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
  ChevronLeft,
  UnfoldHorizontal,
  FoldHorizontal,
  Play,
  Pause,
  SkipForward,
  RotateCcw,
  Gauge,
  Bug,
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

const PRIORITY_PORTS = ['q', 'out', 'pulse', 'stages', 'cv', 'y', 'mask', 'starts', 'waiting', 'cmd', 'enable']

function maskAllComments(source: string): string[] {
  const chars = Array.from(source)
  let inBlock = 0
  let inLine = false
  let inStr = false

  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    const next = i + 1 < chars.length ? chars[i + 1] : ''

    if (inLine) {
      if (c === '\n') {
        inLine = false
      } else {
        chars[i] = ' '
      }
      continue
    }

    if (inBlock > 0) {
      if (c === '*' && next === ')') {
        chars[i] = ' '
        chars[i + 1] = ' '
        i++
        inBlock--
      } else if (c === '(' && next === '*') {
        chars[i] = ' '
        chars[i + 1] = ' '
        i++
        inBlock++
      } else if (c !== '\n' && c !== '\r') {
        chars[i] = ' '
      }
      continue
    }

    if (inStr) {
      if (c === "'") inStr = false
      continue
    }

    if (c === "'") {
      inStr = true
      continue
    }

    if (c === '/' && next === '/') {
      chars[i] = ' '
      chars[i + 1] = ' '
      i++
      inLine = true
      continue
    }

    if (c === '(' && next === '*') {
      chars[i] = ' '
      chars[i + 1] = ' '
      i++
      inBlock = 1
      continue
    }
  }

  return chars.join('').split('\n')
}

export interface LineBadgeItem {
  label: string
  value: string
  isFunction?: boolean
  isTarget?: boolean
  pointName?: string
  dataType?: string
  quality?: string
  isChanged?: boolean
  isBoolTrue?: boolean
  isBoolFalse?: boolean
  isInvalid?: boolean
}

export interface ResolvedVariableValue {
  variableName: string
  fullName?: string
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

  const [expandAll, setExpandAll] = useState<boolean>(false)
  const [expandedLines, setExpandedLines] = useState<Set<number>>(new Set())

  // Chế độ xem: inspect (Giám sát tĩnh) | debug (Gỡ lỗi nhảy từng dòng) | raw (Mã thô)
  const [viewMode, setViewMode] = useState<'inspect' | 'debug' | 'raw'>('inspect')

  // Trạng thái gỡ lỗi từng dòng
  const [activeStepIndex, setActiveStepIndex] = useState<number>(0)
  const [isAutoPlaying, setIsAutoPlaying] = useState<boolean>(true)
  const [stepSpeedMs, setStepSpeedMs] = useState<number>(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = window.localStorage.getItem('mkddc.programming.sim.stepSpeedMs')
        if (stored) {
          const num = parseInt(stored, 10)
          if (!isNaN(num) && num >= 100 && num <= 5000) return num
        }
      }
    } catch {
      // fallback
    }
    return 1000 // Mặc định 1 giây / dòng đủ chậm để quan sát
  })
  const [isLooping, setIsLooping] = useState<boolean>(true)

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

  const containerRef = useRef<HTMLDivElement | null>(null)

  const toggleLineExpand = (lineNumber: number) => {
    setExpandedLines((prev) => {
      const next = new Set(prev)
      if (next.has(lineNumber)) {
        next.delete(lineNumber)
      } else {
        next.add(lineNumber)
      }
      return next
    })
  }

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

  const variableValueMap = useMemo(() => {
    const map = new Map<string, ResolvedVariableValue>()

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
          o.observationId.toUpperCase() === item.variableId.toUpperCase() ||
          o.variable.toUpperCase() === item.variableName.toUpperCase(),
      )

      const resolved: ResolvedVariableValue = {
        variableName: cleanVarName,
        fullName: item.variableName,
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

    for (const obs of observations) {
      const cleanVar = obs.variable || obs.observationId
      const key = cleanVar.toLowerCase()
      if (!map.has(key)) {
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
          fullName: obs.variable || obs.observationId,
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
        map.set(key, resolved)
        map.set(obs.observationId.toLowerCase(), resolved)
      }
    }

    return map
  }, [runtimeItems, observations, bindings, pointCatalogItems])

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

  const rawLines = useMemo(() => {
    if (!source) return []
    return source.split('\n')
  }, [source])

  const maskedLines = useMemo(() => {
    if (!source) return []
    return maskAllComments(source)
  }, [source])

  // Lọc danh sách các dòng có mã thực thi (bỏ qua dòng trắng và chú thích thuần)
  const executableLineIndices = useMemo(() => {
    const indices: number[] = []
    for (let i = 0; i < rawLines.length; i++) {
      if ((maskedLines[i]?.trim().length ?? 0) > 0) {
        indices.push(i)
      }
    }
    return indices
  }, [rawLines, maskedLines])

  // Dòng thực thi hiện tại trong chế độ Gỡ lỗi
  const currentExecutingLineIndex = executableLineIndices[activeStepIndex] ?? -1

  // Tự động nhảy dòng code theo timer trong chế độ Gỡ lỗi
  useEffect(() => {
    if (viewMode !== 'debug' || !isAutoPlaying || executableLineIndices.length === 0) return

    const timer = setInterval(() => {
      setActiveStepIndex((curr) => {
        if (curr + 1 < executableLineIndices.length) {
          return curr + 1
        }
        if (isLooping) {
          return 0
        }
        setIsAutoPlaying(false)
        return curr
      })
    }, stepSpeedMs)

    return () => clearInterval(timer)
  }, [viewMode, isAutoPlaying, executableLineIndices, stepSpeedMs, isLooping])

  // Tự động cuộn theo dòng đang chạy trong chế độ Gỡ lỗi
  useEffect(() => {
    if (viewMode !== 'debug' || currentExecutingLineIndex === -1) return
    const targetLineNumber = currentExecutingLineIndex + 1
    const el = containerRef.current?.querySelector(`[data-line-number="${targetLineNumber}"]`)
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [viewMode, currentExecutingLineIndex])

  const handleLineClick = (lineIndex: number) => {
    if (viewMode !== 'debug') return
    const stepIdx = executableLineIndices.indexOf(lineIndex)
    if (stepIdx !== -1) {
      setActiveStepIndex(stepIdx)
    } else {
      const closest = executableLineIndices.findIndex((idx) => idx >= lineIndex)
      if (closest !== -1) {
        setActiveStepIndex(closest)
      }
    }
  }

  const analyzeLine = useMemo(() => {
    return (lineIndex: number): {
      badges: LineBadgeItem[]
      tokens: ReturnType<typeof tokenizeStSource>
    } => {
      const rawText = rawLines[lineIndex] ?? ''
      const maskedText = maskedLines[lineIndex] ?? ''
      const tokens = tokenizeStSource(rawText)

      if (!maskedText.trim()) {
        return { badges: [], tokens }
      }

      const badges: LineBadgeItem[] = []
      const seen = new Set<string>()

      const assignMatch = maskedText.match(/^\s*(?:\d+\s*:\s*)?([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)?)\s*:=/)
      let targetVar: string | null = null
      if (assignMatch) {
        targetVar = assignMatch[1]
      }

      const declMatch = maskedText.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:;|:=)/)
      let declVar: string | null = null
      if (declMatch && !ST_KEYWORDS_SET.has(declMatch[1].toUpperCase())) {
        declVar = declMatch[1]
      }

      const funcCalls: string[] = []
      const funcRegex = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g
      let fm: RegExpExecArray | null
      while ((fm = funcRegex.exec(maskedText)) !== null) {
        const name = fm[1]
        if (!ST_KEYWORDS_SET.has(name.toUpperCase())) {
          funcCalls.push(name)
        }
      }

      if (targetVar) {
        const resolved = variableValueMap.get(targetVar.toLowerCase())
        if (resolved) {
          seen.add(targetVar.toLowerCase())
          badges.push({
            label: targetVar,
            value: resolved.displayValue,
            isTarget: true,
            pointName: resolved.pointName,
            dataType: resolved.dataType,
            quality: resolved.quality,
            isChanged: changedVars.has(resolved.variableName.toLowerCase()),
            isBoolTrue: resolved.value === true || resolved.displayValue.toUpperCase() === 'TRUE',
            isBoolFalse: resolved.value === false || resolved.displayValue.toUpperCase() === 'FALSE',
            isInvalid: !resolved.valid || resolved.state === 'invalid',
          })
        } else {
          const directLiteralMatch = maskedText.match(/\:=\s*(TRUE|FALSE|\d+(?:\.\d+)?|T#[0-9a-zA-Z_]+)\s*;/i)
          if (directLiteralMatch) {
            const litVal = directLiteralMatch[1].toUpperCase()
            seen.add(targetVar.toLowerCase())
            badges.push({
              label: targetVar,
              value: litVal,
              isTarget: true,
              isBoolTrue: litVal === 'TRUE',
              isBoolFalse: litVal === 'FALSE',
            })
          }
        }
      }

      for (const fn of funcCalls) {
        let fnVal: string | undefined
        if (targetVar && badges.length > 0 && badges[0].label === targetVar) {
          fnVal = badges[0].value
        } else if (fn.toUpperCase() === 'SEL') {
          const selArgsMatch = maskedText.match(/SEL\s*\(\s*([A-Za-z0-9_.]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)/i)
          if (selArgsMatch) {
            const gName = selArgsMatch[1]
            const in0 = selArgsMatch[2].trim()
            const in1 = selArgsMatch[3].trim()
            const gRes = variableValueMap.get(gName.toLowerCase())
            if (gRes && gRes.valid) {
              const isGTrue = gRes.value === true || gRes.displayValue.toUpperCase() === 'TRUE'
              fnVal = isGTrue ? in1 : in0
            }
          }
        }

        if (fnVal && !seen.has(fn.toLowerCase())) {
          seen.add(fn.toLowerCase())
          badges.push({
            label: fn,
            value: fnVal,
            isFunction: true,
            isBoolTrue: fnVal.toUpperCase() === 'TRUE',
            isBoolFalse: fnVal.toUpperCase() === 'FALSE',
          })
        }
      }

      if (declVar && !seen.has(declVar.toLowerCase())) {
        const resolved = variableValueMap.get(declVar.toLowerCase())
        if (resolved) {
          seen.add(declVar.toLowerCase())
          badges.push({
            label: declVar,
            value: resolved.displayValue,
            isTarget: true,
            pointName: resolved.pointName,
            dataType: resolved.dataType,
            quality: resolved.quality,
            isChanged: changedVars.has(resolved.variableName.toLowerCase()),
            isBoolTrue: resolved.value === true || resolved.displayValue.toUpperCase() === 'TRUE',
            isBoolFalse: resolved.value === false || resolved.displayValue.toUpperCase() === 'FALSE',
            isInvalid: !resolved.valid || resolved.state === 'invalid',
          })
        } else {
          const prefix = `${declVar.toLowerCase()}.`
          const fbMembers: ResolvedVariableValue[] = []
          for (const [key, res] of variableValueMap.entries()) {
            if (key.startsWith(prefix)) {
              const sub = key.slice(prefix.length)
              if (!sub.includes('.')) {
                fbMembers.push(res)
              }
            }
          }

          if (fbMembers.length > 0) {
            fbMembers.sort((a, b) => {
              const portA = a.variableName.slice(prefix.length).toLowerCase()
              const portB = b.variableName.slice(prefix.length).toLowerCase()
              const idxA = PRIORITY_PORTS.indexOf(portA)
              const idxB = PRIORITY_PORTS.indexOf(portB)
              const rankA = idxA === -1 ? 999 : idxA
              const rankB = idxB === -1 ? 999 : idxB
              return rankA - rankB
            })

            for (const mem of fbMembers) {
              const fullPortName = mem.fullName || mem.variableName
              seen.add(mem.variableName.toLowerCase())
              seen.add(fullPortName.toLowerCase())
              badges.push({
                label: fullPortName,
                value: mem.displayValue,
                isTarget: true,
                pointName: mem.pointName,
                dataType: mem.dataType,
                quality: mem.quality,
                isChanged: changedVars.has(mem.variableName.toLowerCase()),
                isBoolTrue: mem.value === true || mem.displayValue.toUpperCase() === 'TRUE',
                isBoolFalse: mem.value === false || mem.displayValue.toUpperCase() === 'FALSE',
                isInvalid: !mem.valid || mem.state === 'invalid',
              })
            }
          }
        }
      }

      const idMatches = maskedText.match(/\b[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)?\b/g) ?? []
      for (const rawMatch of idMatches) {
        const lower = rawMatch.toLowerCase()
        if (seen.has(lower)) continue
        if (ST_KEYWORDS_SET.has(rawMatch.toUpperCase())) continue

        const resolved = variableValueMap.get(lower)
        if (resolved) {
          seen.add(lower)
          badges.push({
            label: resolved.variableName,
            value: resolved.displayValue,
            pointName: resolved.pointName,
            dataType: resolved.dataType,
            quality: resolved.quality,
            isChanged: changedVars.has(resolved.variableName.toLowerCase()),
            isBoolTrue: resolved.value === true || resolved.displayValue.toUpperCase() === 'TRUE',
            isBoolFalse: resolved.value === false || resolved.displayValue.toUpperCase() === 'FALSE',
            isInvalid: !resolved.valid || resolved.state === 'invalid',
          })
        }
      }

      return { badges, tokens }
    }
  }, [rawLines, maskedLines, variableValueMap, changedVars])

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
      data-testid="st-simulated-source-section"
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
              className="inline-flex items-center gap-1 rounded-full border border-[var(--c-border)] bg-[var(--c-surface-2)] px-2 py-0.5 text-[11px] font-semibold text-[var(--c-text)]"
              title={pick(
                'Số lượng biến/tín hiệu có giá trị mô phỏng',
                'Number of variables with simulation values',
              )}
            >
              <Activity className="h-3 w-3 animate-pulse text-[var(--c-accent)]" />
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

          {/* Toggle All Badges Expand / Collapse (1 per line vs All) */}
          <button
            type="button"
            onClick={() => setExpandAll((v) => !v)}
            aria-pressed={expandAll}
            title={pick(
              expandAll ? 'Thu gọn về 1 biến mỗi dòng (kèm nút +N)' : 'Mở rộng hiển thị tất cả các biến trên mỗi dòng',
              expandAll ? 'Collapse to 1 variable per line (with +N button)' : 'Expand to show all variables on each line',
            )}
            className={`flex h-6.5 items-center gap-1 rounded border px-2 text-xs font-medium transition-colors ${
              expandAll
                ? 'border-[var(--c-accent)] bg-[var(--c-accent)] text-white shadow-xs'
                : 'border-[var(--c-border)] bg-[var(--c-surface-2)] text-[var(--c-text)] hover:bg-[var(--c-surface-3)]'
            }`}
          >
            {expandAll ? <FoldHorizontal className="h-3.5 w-3.5" /> : <UnfoldHorizontal className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">
              {expandAll ? pick('1 biến/dòng', '1/line') : pick('Hiện tất cả', 'Show all')}
            </span>
          </button>

          {/* Toggle Inline Values ON/OFF */}
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

          {/* Switch View Mode: Giám sát (Inspect) vs Gỡ lỗi (Debug) vs Mã thô (Raw) */}
          <div className="flex items-center rounded border border-[var(--c-border)] bg-[var(--c-surface)] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setViewMode('inspect')}
              className={`rounded px-2 py-0.5 font-medium transition-colors ${
                viewMode === 'inspect'
                  ? 'bg-[var(--c-accent)] text-white shadow-xs'
                  : 'text-[var(--c-text-dim)] hover:text-[var(--c-text)]'
              }`}
            >
              {pick('Giám sát', 'Inspect')}
            </button>
            <button
              type="button"
              onClick={() => {
                setViewMode('debug')
                setIsAutoPlaying(true)
              }}
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
                <span className="text-[var(--c-good-fg)] font-medium">{pick('Đã chép', 'Copied')}</span>
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

      {/* Thanh điều khiển chuyên dụng cho CHẾ ĐỘ GỠ LỖI (Debug Mode Control Bar) */}
      {viewMode === 'debug' && (
        <div
          data-testid="st-debug-control-bar"
          className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--c-accent)]/30 bg-[var(--c-surface-2)] px-2.5 py-1.5 text-xs animate-in fade-in duration-200"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex items-center gap-1 text-[var(--c-accent)] font-bold uppercase tracking-wider text-[11px] mr-1">
              <Bug className="h-3.5 w-3.5" />
              <span>{pick('Gỡ lỗi từng dòng', 'Line Debug')}</span>
            </div>

            {/* Nút Play / Pause */}
            <button
              type="button"
              onClick={() => setIsAutoPlaying((p) => !p)}
              title={isAutoPlaying ? pick('Tạm dừng chạy mô phỏng từng dòng', 'Pause line debug') : pick('Bắt đầu chạy mô phỏng từng dòng', 'Start line debug')}
              className={`flex h-6.5 items-center gap-1 rounded border px-2.5 text-xs font-semibold shadow-2xs transition-all ${
                isAutoPlaying
                  ? 'border-[var(--c-warn-fg)] bg-[var(--c-warn-bg)] text-[var(--c-warn-fg)] hover:brightness-105'
                  : 'border-[var(--c-good-fg)] bg-[var(--c-good-bg)] text-[var(--c-good-fg)] hover:brightness-105'
              }`}
            >
              {isAutoPlaying ? <Pause className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5 fill-current" />}
              <span>{isAutoPlaying ? pick('Tạm dừng', 'Pause') : pick('Chạy tiếp', 'Run')}</span>
            </button>

            {/* Nút Từng bước (Step Next) */}
            <button
              type="button"
              onClick={() => {
                setIsAutoPlaying(false)
                setActiveStepIndex((curr) => Math.min(executableLineIndices.length - 1, curr + 1))
              }}
              title={pick('Nhảy tới dòng thực thi tiếp theo', 'Step to next line')}
              className="flex h-6.5 items-center gap-1 rounded border border-[var(--c-border)] bg-[var(--c-surface)] px-2 text-xs font-medium text-[var(--c-text)] hover:bg-[var(--c-surface-3)] transition-colors"
            >
              <SkipForward className="h-3.5 w-3.5 text-[var(--c-accent)]" />
              <span>{pick('Từng bước', 'Step')}</span>
            </button>

            {/* Nút Về đầu (Reset) */}
            <button
              type="button"
              onClick={() => {
                setActiveStepIndex(0)
              }}
              title={pick('Quay lại dòng đầu tiên của chương trình', 'Reset to top of program')}
              className="flex h-6.5 items-center gap-1 rounded border border-[var(--c-border)] bg-[var(--c-surface)] px-2 text-xs font-medium text-[var(--c-text)] hover:bg-[var(--c-surface-3)] transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5 text-[var(--c-text-dim)]" />
              <span>{pick('Về đầu', 'Reset')}</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Bộ chỉnh tốc độ mô phỏng */}
            <div className="flex items-center gap-1 text-[11px] text-[var(--c-text-dim)]">
              <Gauge className="h-3.5 w-3.5 text-[var(--c-accent)]" />
              <span className="hidden sm:inline font-medium">{pick('Tốc độ:', 'Speed:')}</span>
              <select
                aria-label={pick('Tốc độ mô phỏng từng dòng', 'Line step simulation speed')}
                value={stepSpeedMs}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10)
                  setStepSpeedMs(val)
                  try {
                    if (typeof window !== 'undefined' && window.localStorage) {
                      window.localStorage.setItem('mkddc.programming.sim.stepSpeedMs', String(val))
                    }
                  } catch { /* ignore */ }
                }}
                className="h-6.5 rounded border border-[var(--c-border)] bg-[var(--c-surface)] px-1.5 text-xs font-mono text-[var(--c-text)] focus-visible:ring-1 focus-visible:ring-[var(--c-accent)]"
              >
                <option value="2000">{pick('2.0 s (Rất chậm)', '2.0s (Very slow)')}</option>
                <option value="1500">{pick('1.5 s (Chậm)', '1.5s (Slow)')}</option>
                <option value="1000">{pick('1.0 s (Chuẩn)', '1.0s (Normal)')}</option>
                <option value="600">{pick('0.6 s (Vừa)', '0.6s (Medium)')}</option>
                <option value="300">{pick('0.3 s (Nhanh)', '0.3s (Fast)')}</option>
                <option value="100">{pick('0.1 s (Rất nhanh)', '0.1s (Very fast)')}</option>
              </select>
            </div>

            {/* Nút Lặp chu kỳ */}
            <button
              type="button"
              onClick={() => setIsLooping((l) => !l)}
              aria-pressed={isLooping}
              title={pick(
                isLooping ? 'Đang bật lặp lại chu kỳ khi chạy hết dòng cuối' : 'Chỉ chạy 1 lượt từ trên xuống rồi dừng',
                isLooping ? 'Loop scan cycle is active' : 'Run once to the end and stop',
              )}
              className={`flex h-6.5 items-center gap-1 rounded border px-2 text-[11px] font-medium transition-colors ${
                isLooping
                  ? 'border-[var(--c-accent)] bg-[var(--c-accent)]/15 text-[var(--c-accent)] font-semibold'
                  : 'border-[var(--c-border)] bg-[var(--c-surface)] text-[var(--c-text-dim)]'
              }`}
            >
              <span>{pick('Lặp chu kỳ', 'Loop')}</span>
            </button>

            {/* Chỉ báo dòng đang chạy */}
            <div className="flex items-center gap-1 font-mono text-[11px] text-[var(--c-text-dim)] pl-1 border-l border-[var(--c-border)]">
              <span className="text-[var(--c-accent)] font-bold">
                {pick('Dòng', 'Line')} {currentExecutingLineIndex !== -1 ? currentExecutingLineIndex + 1 : 1}
              </span>
              <span>/</span>
              <span>{rawLines.length}</span>
              <span className="rounded bg-[var(--c-surface)] border border-[var(--c-border)]/60 px-1 text-[10px] font-semibold text-[var(--c-text)]">
                {Math.round(((activeStepIndex + 1) / Math.max(1, executableLineIndices.length)) * 100)}%
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Selected Variable Banner */}
      {selectedVariable && (
        <div className="flex items-center justify-between rounded bg-[var(--c-accent)]/10 px-2.5 py-1 text-xs text-[var(--c-accent)]">
          <div className="flex items-center gap-1.5 font-mono">
            <span className="text-[var(--c-text-dim)]">{pick('Đang chọn theo dõi:', 'Tracking variable:')}</span>
            <span className="font-bold">{selectedVariable}</span>
            {variableValueMap.get(selectedVariable.toLowerCase()) && (
              <span className="font-semibold text-[var(--c-text)]">
                = {variableValueMap.get(selectedVariable.toLowerCase())?.displayValue}
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
            ref={containerRef}
            data-testid="st-simulated-source-debug-view"
            className="relative min-h-[340px] max-h-[460px] overflow-auto rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] font-mono text-xs [scrollbar-gutter:stable]"
          >
            <div className="min-w-fit">
              {rawLines.map((lineText, index) => {
                const lineNumber = index + 1
                const { badges, tokens } = analyzeLine(index)

                const isMatchSearch =
                  searchQuery.trim().length > 0 &&
                  lineText.toLowerCase().includes(searchQuery.trim().toLowerCase())

                const hasSelectedVariable =
                  selectedVariable !== null &&
                  lineText.toLowerCase().includes(selectedVariable.toLowerCase())

                // Trạng thái trong chế độ Gỡ lỗi (Debug Mode):
                const isCurrentExecuting = viewMode === 'debug' && index === currentExecutingLineIndex
                // Trong chế độ Debug: code chạy đến đâu thì hiện giá trị tới đó (dòng đã hoặc đang chạy)
                const hasExecutedInDebug = viewMode === 'debug' ? index <= currentExecutingLineIndex : true

                const isLineExpanded = expandAll || expandedLines.has(lineNumber)
                const visibleBadges = isLineExpanded || badges.length <= 1 ? badges : [badges[0]]
                const hiddenCount = badges.length - visibleBadges.length

                return (
                  <div
                    key={lineNumber}
                    data-line-number={lineNumber}
                    data-active-line={isCurrentExecuting ? 'true' : undefined}
                    onClick={() => handleLineClick(index)}
                    className={`flex items-center justify-between min-h-[1.65rem] px-2 py-0.5 border-b border-[var(--c-border)]/20 transition-all ${
                      isCurrentExecuting
                        ? 'bg-[var(--c-accent)]/20 border-l-4 border-l-[var(--c-accent)] ring-1 ring-[var(--c-accent)]/40 shadow-xs font-semibold'
                        : hasSelectedVariable
                        ? 'bg-[var(--c-accent)]/15 border-l-3 border-l-[var(--c-accent)]'
                        : isMatchSearch
                        ? 'bg-[var(--c-warn-bg)]/30'
                        : viewMode === 'debug' && !hasExecutedInDebug
                        ? 'opacity-65 hover:bg-[var(--c-surface-2)]/30 cursor-pointer'
                        : 'hover:bg-[var(--c-surface-2)]/60 cursor-pointer'
                    }`}
                  >
                    {/* Left: Line Number & Code */}
                    <div className="flex items-center min-w-0 pr-4">
                      <span className={`w-10 shrink-0 text-right pr-3 select-none text-[11px] font-mono flex items-center justify-end ${
                        isCurrentExecuting
                          ? 'text-[var(--c-accent)] font-bold'
                          : 'text-[var(--c-text-dim)]/50'
                      }`}>
                        {isCurrentExecuting && <span className="text-[var(--c-accent)] mr-1 font-bold animate-pulse">▶</span>}
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
                              onClick={(e) => {
                                if (resolved) {
                                  e.stopPropagation()
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

                    {/* Right: Inline Simulation Value Badges (Code chạy đến đâu thì hiện giá trị tới đó) */}
                    {showInlineValues && hasExecutedInDebug && badges.length > 0 && (
                      <div className="ml-auto pl-3 shrink-0 flex items-center gap-1.5 flex-wrap justify-end">
                        {visibleBadges.map((bItem, bIdx) => {
                          let badgeClasses =
                            'border-[var(--c-border)] bg-[var(--c-surface-2)] text-[var(--c-text)]'
                          let valueClasses = 'text-[var(--c-accent)] font-bold'

                          if (bItem.isBoolTrue) {
                            badgeClasses =
                              'border-[var(--c-good-fg)]/40 bg-[var(--c-good-bg)]/80 text-[var(--c-good-fg)]'
                            valueClasses = 'text-[var(--c-good-fg)] font-extrabold'
                          } else if (bItem.isBoolFalse) {
                            badgeClasses =
                              'border-[var(--c-border)] bg-[var(--c-surface-2)] text-[var(--c-text-dim)]'
                            valueClasses = 'text-[var(--c-text-dim)] font-semibold'
                          } else if (bItem.isInvalid) {
                            badgeClasses =
                              'border-dashed border-[var(--c-border)] bg-[var(--c-surface-2)]/60 text-[var(--c-text-dim)]'
                            valueClasses = 'text-[var(--c-text-dim)] font-normal'
                          } else if (bItem.isTarget) {
                            badgeClasses =
                              'border-[var(--c-accent)]/40 bg-[var(--c-accent)]/10 text-[var(--c-text)]'
                            valueClasses = 'text-[var(--c-accent)] font-bold'
                          } else if (bItem.isFunction) {
                            badgeClasses =
                              'border-[var(--c-accent)]/30 bg-[var(--c-surface-2)] text-[var(--c-text)]'
                            valueClasses = 'text-[var(--c-accent)] font-semibold'
                          }

                          if (isCurrentExecuting) {
                            badgeClasses += ' ring-2 ring-[var(--c-accent)] animate-pulse'
                          } else if (bItem.isChanged) {
                            badgeClasses += ' ring-2 ring-[var(--c-accent)] animate-pulse'
                          }

                          return (
                            <button
                              key={`${bItem.label}-${bIdx}`}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setSelectedVariable((curr) =>
                                  curr === bItem.label ? null : bItem.label,
                                )
                              }}
                              title={`${bItem.label} = ${bItem.value}${bItem.pointName ? ` (${bItem.pointName})` : ''}`}
                              className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-mono transition-all hover:brightness-110 ${badgeClasses} ${
                                selectedVariable === bItem.label
                                  ? 'ring-2 ring-[var(--c-accent)] shadow-sm'
                                  : ''
                              }`}
                            >
                              <span className="opacity-75">{bItem.label} =</span>
                              <span className={valueClasses}>{bItem.value}</span>
                              {bItem.pointName && (
                                <span className="opacity-60 text-[10px] pl-1 border-l border-current/20">
                                  {bItem.pointName}
                                </span>
                              )}
                            </button>
                          )
                        })}

                        {hiddenCount > 0 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleLineExpand(lineNumber)
                            }}
                            title={pick(
                              `Xem thêm ${hiddenCount} biến trên dòng ${lineNumber}`,
                              `Show ${hiddenCount} more variables on line ${lineNumber}`,
                            )}
                            className="inline-flex items-center gap-0.5 rounded-full border border-[var(--c-border)] bg-[var(--c-surface-3)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--c-accent)] hover:bg-[var(--c-accent)] hover:text-white transition-all shadow-2xs"
                          >
                            +{hiddenCount}
                          </button>
                        )}

                        {!expandAll && isLineExpanded && badges.length > 1 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleLineExpand(lineNumber)
                            }}
                            title={pick(
                              `Thu gọn còn 1 biến trên dòng ${lineNumber}`,
                              `Collapse to 1 variable on line ${lineNumber}`,
                            )}
                            className="inline-flex items-center gap-0.5 rounded-full border border-[var(--c-border)] bg-[var(--c-surface-2)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--c-text-dim)] hover:text-[var(--c-text)] hover:border-[var(--c-accent)] transition-all"
                          >
                            <ChevronLeft className="h-3 w-3" />
                            <span className="text-[10px]">{pick('Gọn', 'Less')}</span>
                          </button>
                        )}
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
