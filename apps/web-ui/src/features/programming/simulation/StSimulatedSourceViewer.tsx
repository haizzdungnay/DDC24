import {
  computeExecutedLineSequence,
  findFirstUsageLine,
  extractLineCalls,
  extractLineAssignments,
  extractLineExpressions,
  evaluateStExpression,
  parseStProgram,
  type StStatement,
} from './stControlFlow'
import { useMemo, useState, useEffect, useRef, useCallback } from 'react'
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
  SkipBack,
  RotateCcw,
  Gauge,
  Bug,
  Pin,
  PinOff,
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
  prevDisplayValue?: string
  state: 'live' | 'uncertain' | 'stale' | 'invalid'
  valid: boolean
  quality: string
  dataType?: string
  value: unknown
  pointId?: string
  pointName?: string
  unit?: string
  connectionPoint?: string
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
  lastCommittedInput?: {
    variable: string
    observationId: string
    timestamp: number
  } | null
}

export function StSimulatedSourceViewer({
  source,
  runtime,
  slice,
  inputs,
  bindings,
  pointCatalogItems,
  programName,
  lastCommittedInput,
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

  // Breakpoints: tập hợp số dòng có điểm dừng
  const [breakpoints, setBreakpoints] = useState<Set<number>>(new Set())

  // Bảng Watch / Inspector: danh sách tên biến được ghim lưu theo programName / ID
  const watchStorageKey = `mkddc.programming.sim.watch.${programName || 'default'}`
  const [pinnedVariables, setPinnedVariables] = useState<string[]>(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = window.localStorage.getItem(watchStorageKey)
        if (stored) {
          const parsed = JSON.parse(stored)
          if (Array.isArray(parsed)) return parsed
        }
      }
    } catch {
      // fallback
    }
    return []
  })
  const [isWatchExpanded, setIsWatchExpanded] = useState<boolean>(true)

  const togglePinVariable = useCallback(
    (varName: string) => {
      setPinnedVariables((prev) => {
        const next = prev.includes(varName)
          ? prev.filter((v) => v !== varName)
          : [...prev, varName]
        try {
          if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.setItem(watchStorageKey, JSON.stringify(next))
          }
        } catch {
          // ignore
        }
        return next
      })
    },
    [watchStorageKey],
  )

  const toggleBreakpoint = useCallback((lineNumber: number) => {
    setBreakpoints((prev) => {
      const next = new Set(prev)
      if (next.has(lineNumber)) {
        next.delete(lineNumber)
      } else {
        next.add(lineNumber)
      }
      return next
    })
  }, [])

  const [hoveredSymbol, setHoveredSymbol] = useState<{
    name: string
    displayValue?: string
    prevDisplayValue?: string
    dataType?: string
    kind?: string
    quality?: string
    pointName?: string
    unit?: string
    connectionPoint?: string
    description?: string
    isPinned?: boolean
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
          b.variableId?.toUpperCase() === cleanVarName.toUpperCase() ||
          b.variableId?.toUpperCase() === item.variableName.toUpperCase(),
      )
      const pointId = binding?.point.pointId
      const catalogEntry = pointId
        ? pointCatalogItems?.find((p) => p.pointId === pointId)
        : undefined
      const pointName = catalogEntry?.name || pointId
      const unit =
        catalogEntry?.unit ||
        inputs?.find(
          (i) => i.variable === cleanVarName || i.observationId === item.variableId,
        )?.unit ||
        undefined
      const connectionPoint = binding?.point
        ? `${binding.point.category ? binding.point.category + ': ' : ''}${binding.point.pointId}`
        : undefined

      const obs = observations.find(
        (o) =>
          o.variable.toUpperCase() === cleanVarName.toUpperCase() ||
          o.observationId.toUpperCase() === item.variableId.toUpperCase() ||
          o.variable.toUpperCase() === item.variableName.toUpperCase(),
      )

      const prevDisplayValue =
        prevValuesRef.current.get(cleanVarName.toLowerCase()) ||
        prevValuesRef.current.get(item.variableId.toLowerCase())

      const resolved: ResolvedVariableValue = {
        variableName: cleanVarName,
        fullName: item.variableName,
        observationId: item.variableId,
        displayValue: presentation.displayValue,
        prevDisplayValue,
        state: presentation.state,
        valid: item.valid,
        quality: item.quality,
        dataType: obs?.dataType,
        value: item.value,
        pointId,
        pointName,
        unit,
        connectionPoint,
      }

      map.set(cleanVarName.toLowerCase(), resolved)
      map.set(item.variableName.toLowerCase(), resolved)
      map.set(item.variableId.toLowerCase(), resolved)
    }

    for (const obs of observations) {
      const cleanVar = obs.variable || obs.observationId
      const key = cleanVar.toLowerCase()
      const binding = bindings?.find(
        (b) => b.variableId?.toUpperCase() === cleanVar.toUpperCase(),
      )
      const pointId = binding?.point.pointId
      const catalogEntry = pointId
        ? pointCatalogItems?.find((p) => p.pointId === pointId)
        : undefined
      const pointName = catalogEntry?.name || pointId
      const unit =
        catalogEntry?.unit ||
        inputs?.find(
          (i) => i.variable === cleanVar || i.observationId === obs.observationId,
        )?.unit ||
        undefined
      const connectionPoint = binding?.point
        ? `${binding.point.category ? binding.point.category + ': ' : ''}${binding.point.pointId}`
        : undefined

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
        const prevDisplayValue =
          prevValuesRef.current.get(key) ||
          prevValuesRef.current.get(obs.observationId.toLowerCase())

        const resolved: ResolvedVariableValue = {
          variableName: cleanVar,
          fullName: obs.variable || obs.observationId,
          observationId: obs.observationId,
          displayValue: presentation.displayValue,
          prevDisplayValue,
          state: presentation.state,
          valid: item.valid,
          quality: obs.quality,
          dataType: obs.dataType,
          value: obs.value,
          pointId,
          pointName,
          unit,
          connectionPoint,
        }
        map.set(key, resolved)
        map.set(obs.observationId.toLowerCase(), resolved)
      }

      // Trích xuất struct / FB members từ obs.value dạng Object nếu có (AutoTmr.Q, Ch01.Waiting, ...)
      if (typeof obs.value === 'object' && obs.value !== null && !Array.isArray(obs.value)) {
        for (const [propKey, propVal] of Object.entries(obs.value as Record<string, unknown>)) {
          const propVarName = `${cleanVar}.${propKey}`
          const propKeyLower = propVarName.toLowerCase()
          const propDisplay =
            typeof propVal === 'boolean'
              ? propVal
                ? 'TRUE'
                : 'FALSE'
              : propVal !== null && propVal !== undefined
              ? String(propVal)
              : '—'

          const nestedResolved: ResolvedVariableValue = {
            variableName: propVarName,
            fullName: `${obs.variable || obs.observationId}.${propKey}`,
            observationId: `${obs.observationId}.${propKey}`,
            displayValue: propDisplay,
            prevDisplayValue: prevValuesRef.current.get(propKeyLower),
            state: 'live',
            valid: propVal !== null && propVal !== undefined,
            quality: obs.quality,
            dataType:
              typeof propVal === 'boolean'
                ? 'BOOL'
                : typeof propVal === 'number'
                ? 'NUMBER'
                : undefined,
            value: propVal,
            pointId,
            pointName,
            unit,
            connectionPoint,
          }
          map.set(propKeyLower, nestedResolved)
          map.set(`${obs.observationId.toLowerCase()}.${propKey.toLowerCase()}`, nestedResolved)
        }
      }
    }

    return map
  }, [runtimeItems, observations, bindings, pointCatalogItems, inputs])

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

  const lookupVarForControlFlow = useCallback(
    (name: string) => {
      const res = variableValueMap.get(name.toLowerCase())
      return res?.value !== undefined ? res.value : res?.displayValue
    },
    [variableValueMap],
  )

  // Danh sách các dòng thực thi theo đúng luồng logic (bỏ qua các nhánh IF/CASE không thỏa mãn)
  const executableLineIndices = useMemo(() => {
    if (!source) return []
    const lines = computeExecutedLineSequence(rawLines, maskedLines, lookupVarForControlFlow)
    return lines.length > 0 ? lines : [0]
  }, [source, rawLines, maskedLines, lookupVarForControlFlow])

  // Tự động nhảy con trỏ về dòng biến vừa được gán để chạy lại
  useEffect(() => {
    if (!lastCommittedInput) return
    const varName = lastCommittedInput.variable.includes('.')
      ? lastCommittedInput.variable.slice(lastCommittedInput.variable.lastIndexOf('.') + 1)
      : lastCommittedInput.variable

    const targetLine = findFirstUsageLine(rawLines, maskedLines, varName)
    if (targetLine !== -1) {
      let stepIdx = executableLineIndices.indexOf(targetLine)
      if (stepIdx === -1) {
        stepIdx = executableLineIndices.findIndex((idx) => idx >= targetLine)
      }
      if (stepIdx !== -1) {
        setActiveStepIndex(stepIdx)
        setViewMode('debug')
        setIsAutoPlaying(true)
      }
    }
  }, [lastCommittedInput, rawLines, maskedLines, executableLineIndices])

  // Giới hạn activeStepIndex trong phạm vi dòng thực thi hợp lệ
  useEffect(() => {
    if (executableLineIndices.length > 0 && activeStepIndex >= executableLineIndices.length) {
      setActiveStepIndex(Math.max(0, executableLineIndices.length - 1))
    }
  }, [executableLineIndices, activeStepIndex])

  // Dòng thực thi hiện tại trong chế độ Gỡ lỗi
  const currentExecutingLineIndex = executableLineIndices[activeStepIndex] ?? -1

  // Tự động nhảy dòng code theo timer trong chế độ Gỡ lỗi (tự dừng khi gặp breakpoint)
  useEffect(() => {
    if (viewMode !== 'debug' || !isAutoPlaying || executableLineIndices.length === 0) return

    const timer = setInterval(() => {
      setActiveStepIndex((curr) => {
        let nextIndex = curr
        if (curr + 1 < executableLineIndices.length) {
          nextIndex = curr + 1
        } else if (isLooping) {
          nextIndex = 0
        } else {
          setIsAutoPlaying(false)
          return curr
        }

        const nextLineNumber = executableLineIndices[nextIndex] + 1
        if (breakpoints.has(nextLineNumber)) {
          setIsAutoPlaying(false)
        }

        return nextIndex
      })
    }, stepSpeedMs)

    return () => clearInterval(timer)
  }, [viewMode, isAutoPlaying, executableLineIndices, stepSpeedMs, isLooping, breakpoints])

  // Lắng nghe phím tắt: F10 (Step Over), F5 (Play/Pause), Shift+F5 (Reset)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }

      if (e.key === 'F10') {
        e.preventDefault()
        if (viewMode !== 'debug') setViewMode('debug')
        setIsAutoPlaying(false)
        setActiveStepIndex((curr) => Math.min(executableLineIndices.length - 1, curr + 1))
      } else if (e.key === 'F5' && e.shiftKey) {
        e.preventDefault()
        if (viewMode !== 'debug') setViewMode('debug')
        setActiveStepIndex(0)
      } else if (e.key === 'F5' && !e.shiftKey) {
        e.preventDefault()
        if (viewMode !== 'debug') setViewMode('debug')
        setIsAutoPlaying((p) => !p)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [viewMode, executableLineIndices.length])

  // Tự động cuộn theo dòng đang chạy trong chế độ Gỡ lỗi
  useEffect(() => {
    if (viewMode !== 'debug' || currentExecutingLineIndex === -1) return
    const targetLineNumber = currentExecutingLineIndex + 1
    const el = containerRef.current?.querySelector(`[data-line-number="${targetLineNumber}"]`)
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [viewMode, currentExecutingLineIndex])

  const executedSet = useMemo(() => {
    return new Set(executableLineIndices.slice(0, activeStepIndex + 1))
  }, [executableLineIndices, activeStepIndex])

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

  const astStatements = useMemo(() => {
    if (!source) return []
    try {
      return parseStProgram(source)
    } catch {
      return []
    }
  }, [source])

  const flattenedStatements = useMemo(() => {
    const list: StStatement[] = []
    const walk = (stmts: StStatement[]) => {
      for (const s of stmts) {
        list.push(s)
        if (s.kind === 'if') {
          walk(s.thenStatements)
          for (const eb of s.elsifBranches) walk(eb.statements)
          if (s.elseBranch) walk(s.elseBranch.statements)
        } else if (s.kind === 'case') {
          for (const b of s.branches) walk(b.statements)
          if (s.elseBranch) walk(s.elseBranch.statements)
        }
      }
    }
    walk(astStatements)
    return list
  }, [astStatements])

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

      // 1. Phân tích biểu thức dòng với extractLineExpressions từ stControlFlow
      const lineExprs = extractLineExpressions(maskedText, lineIndex)

      // 2. Tìm gán trên dòng hoặc gán đa dòng kết thúc tại lineIndex
      let targetVar: string | null = null
      const assignMatch = maskedText.match(/^\s*(?:\d+\s*:\s*)?([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)?)\s*:=/)
      if (assignMatch) {
        targetVar = assignMatch[1]
      } else if (lineExprs.assignments.length > 0) {
        targetVar = lineExprs.assignments[0].target
      } else {
        // Kiểm tra câu lệnh gán đa dòng kết thúc ở dòng này
        const multilineAssign = flattenedStatements.find(
          (s) => s.kind === 'assignment' && s.endLine === lineIndex,
        )
        if (multilineAssign && multilineAssign.kind === 'assignment') {
          targetVar = multilineAssign.target
        }
      }

      const declMatch = maskedText.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:;|:=)/)
      let declVar: string | null = null
      if (declMatch && !ST_KEYWORDS_SET.has(declMatch[1].toUpperCase())) {
        declVar = declMatch[1]
      }

      // Xử lý biến đích (target variable)
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
          // Tính toán giá trị trực tiếp nếu chưa có trong observation
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

      // 3. Xử lý Lời gọi Hàm & Function Block (Calls)
      for (const call of lineExprs.calls) {
        const callNameLower = call.name.toLowerCase()
        const callNameUpper = call.name.toUpperCase()

        if (ST_KEYWORDS_SET.has(callNameUpper) && !['SEL', 'LIMIT', 'MIN', 'MAX', 'ABS', 'SQRT'].includes(callNameUpper)) {
          continue
        }

        if (call.isFb) {
          // Lời gọi Function Block: AutoTmr(...), StepClk(...)
          const fbQ = variableValueMap.get(`${callNameLower}.q`)
          const fbEt = variableValueMap.get(`${callNameLower}.et`)
          const fbCv = variableValueMap.get(`${callNameLower}.cv`)

          if (!seen.has(`${callNameLower}()`)) {
            seen.add(`${callNameLower}()`)
            badges.push({
              label: `${call.name}()`,
              value: fbQ ? (fbQ.value === true || fbQ.displayValue.toUpperCase() === 'TRUE' ? 'ACTIVE' : 'IDLE') : 'CALL',
              isFunction: true,
              isBoolTrue: fbQ ? (fbQ.value === true || fbQ.displayValue.toUpperCase() === 'TRUE') : true,
              isBoolFalse: fbQ ? (fbQ.value === false || fbQ.displayValue.toUpperCase() === 'FALSE') : false,
            })
          }

          if (fbQ && !seen.has(`${callNameLower}.q`)) {
            seen.add(`${callNameLower}.q`)
            badges.push({
              label: `${call.name}.Q`,
              value: fbQ.displayValue,
              isTarget: true,
              isBoolTrue: fbQ.value === true || fbQ.displayValue.toUpperCase() === 'TRUE',
              isBoolFalse: fbQ.value === false || fbQ.displayValue.toUpperCase() === 'FALSE',
              quality: fbQ.quality,
            })
          }

          if (fbEt && !seen.has(`${callNameLower}.et`)) {
            seen.add(`${callNameLower}.et`)
            badges.push({
              label: `${call.name}.ET`,
              value: fbEt.displayValue,
              isTarget: true,
              quality: fbEt.quality,
            })
          }

          if (fbCv && !seen.has(`${callNameLower}.cv`)) {
            seen.add(`${callNameLower}.cv`)
            badges.push({
              label: `${call.name}.CV`,
              value: fbCv.displayValue,
              isTarget: true,
              quality: fbCv.quality,
            })
          }

          if (!seen.has(callNameLower)) {
            seen.add(callNameLower)
            const fbVal = fbQ ? fbQ.displayValue : 'CALLED'
            badges.push({
              label: call.name,
              value: fbVal,
              isFunction: true,
              isBoolTrue: fbVal.toUpperCase() === 'TRUE',
              isBoolFalse: fbVal.toUpperCase() === 'FALSE',
            })
          }
        } else {
          // Lời gọi hàm: FN_SEC_TO_TIME, FN_MASK_FROM_REAL, FN_FIRST_N, FN_NEXT_STEP, SEL, LIMIT, DEADBAND...
          let fnVal: string | undefined
          if (targetVar && badges.length > 0 && badges[0].label === targetVar) {
            fnVal = badges[0].value
          } else {
            const callExpr = `${call.name}(${call.args.map((a) => (a.name ? `${a.name} := ${a.value}` : a.value)).join(', ')})`
            const evaluated = evaluateStExpression(callExpr, lookupVarForControlFlow)
            if (evaluated !== null && evaluated !== undefined) {
              fnVal =
                typeof evaluated === 'boolean'
                  ? evaluated
                    ? 'TRUE'
                    : 'FALSE'
                  : String(evaluated)
            }
          }

          if (!fnVal && callNameUpper === 'SEL') {
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

          if (fnVal && !seen.has(callNameLower)) {
            seen.add(callNameLower)
            badges.push({
              label: call.name,
              value: fnVal,
              isFunction: true,
              isBoolTrue: fnVal.toUpperCase() === 'TRUE',
              isBoolFalse: fnVal.toUpperCase() === 'FALSE',
            })
          }
        }
      }

      // 4. Xử lý Truy cập thuộc tính FB / Struct (AutoTmr.Q, AutoTmr.ET, TestStep.CV, Ch01.Waiting)
      for (const ma of lineExprs.memberAccesses) {
        const maKey = ma.full.toLowerCase()
        if (seen.has(maKey)) continue
        const resolved = variableValueMap.get(maKey)
        if (resolved) {
          seen.add(maKey)
          badges.push({
            label: ma.full,
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

      // 5. Khai báo FB trong khối VAR ... END_VAR
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

      // 6. Các biến/định danh còn lại trên dòng (Identifiers)
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
  }, [rawLines, maskedLines, flattenedStatements, variableValueMap, changedVars, lookupVarForControlFlow])

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
              title={
                isAutoPlaying
                  ? pick('Tạm dừng chạy mô phỏng từng dòng (F5)', 'Pause line debug (F5)')
                  : pick('Bắt đầu chạy mô phỏng từng dòng (F5)', 'Start line debug (F5)')
              }
              className={`flex h-6.5 items-center gap-1 rounded border px-2.5 text-xs font-semibold shadow-2xs transition-all ${
                isAutoPlaying
                  ? 'border-[var(--c-warn-fg)] bg-[var(--c-warn-bg)] text-[var(--c-warn-fg)] hover:brightness-105'
                  : 'border-[var(--c-good-fg)] bg-[var(--c-good-bg)] text-[var(--c-good-fg)] hover:brightness-105'
              }`}
            >
              {isAutoPlaying ? <Pause className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5 fill-current" />}
              <span>{isAutoPlaying ? pick('Tạm dừng', 'Pause') : pick('Chạy tiếp', 'Run')}</span>
            </button>

            {/* Nút Từng bước (Step Next / Step Over) */}
            <button
              type="button"
              onClick={() => {
                setIsAutoPlaying(false)
                setActiveStepIndex((curr) => Math.min(executableLineIndices.length - 1, curr + 1))
              }}
              title={pick('Nhảy tới dòng thực thi tiếp theo (F10)', 'Step to next line (F10)')}
              aria-label={pick('Từng bước', 'Step')}
              className="flex h-6.5 items-center gap-1 rounded border border-[var(--c-border)] bg-[var(--c-surface)] px-2 text-xs font-medium text-[var(--c-text)] hover:bg-[var(--c-surface-3)] transition-colors"
            >
              <SkipForward className="h-3.5 w-3.5 text-[var(--c-accent)]" />
              <span>{pick('Từng bước', 'Step')}</span>
            </button>

            {/* Nút Bước lùi (Step Back) */}
            <button
              type="button"
              onClick={() => {
                setIsAutoPlaying(false)
                setActiveStepIndex((curr) => Math.max(0, curr - 1))
              }}
              title={pick('Bước lùi lại dòng thực thi trước đó', 'Step back to previous line')}
              aria-label={pick('Bước lùi', 'Step back')}
              className="flex h-6.5 items-center gap-1 rounded border border-[var(--c-border)] bg-[var(--c-surface)] px-2 text-xs font-medium text-[var(--c-text)] hover:bg-[var(--c-surface-3)] transition-colors"
            >
              <SkipBack className="h-3.5 w-3.5 text-[var(--c-accent)]" />
              <span>{pick('Bước lùi', 'Step back')}</span>
            </button>

            {/* Nút Về đầu (Reset) */}
            <button
              type="button"
              onClick={() => {
                setActiveStepIndex(0)
              }}
              title={pick('Quay lại dòng đầu tiên của chương trình (Shift+F5)', 'Reset to top of program (Shift+F5)')}
              className="flex h-6.5 items-center gap-1 rounded border border-[var(--c-border)] bg-[var(--c-surface)] px-2 text-xs font-medium text-[var(--c-text)] hover:bg-[var(--c-surface-3)] transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5 text-[var(--c-text-dim)]" />
              <span>{pick('Về đầu', 'Reset')}</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Bộ chỉnh tốc độ mô phỏng (Slider + Select) */}
            <div className="flex items-center gap-1 text-[11px] text-[var(--c-text-dim)]">
              <Gauge className="h-3.5 w-3.5 text-[var(--c-accent)]" />
              <span className="hidden sm:inline font-medium">{pick('Tốc độ:', 'Speed:')}</span>
              <span className="font-mono text-[10px] text-[var(--c-text)] font-semibold w-10 text-right">
                {stepSpeedMs}ms
              </span>
              <input
                type="range"
                min="50"
                max="2000"
                step="50"
                value={stepSpeedMs}
                aria-label={pick('Thanh trượt tốc độ mô phỏng', 'Simulation speed slider')}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10)
                  setStepSpeedMs(val)
                  try {
                    if (typeof window !== 'undefined' && window.localStorage) {
                      window.localStorage.setItem('mkddc.programming.sim.stepSpeedMs', String(val))
                    }
                  } catch {
                    // ignore
                  }
                }}
                className="h-1.5 w-14 sm:w-20 accent-[var(--c-accent)] cursor-pointer"
              />
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
                  } catch {
                    // ignore
                  }
                }}
                className="h-6.5 rounded border border-[var(--c-border)] bg-[var(--c-surface)] px-1.5 text-xs font-mono text-[var(--c-text)] focus-visible:ring-1 focus-visible:ring-[var(--c-accent)]"
              >
                <option value="2000">{pick('2.0 s (Rất chậm)', '2.0s (Very slow)')}</option>
                <option value="1500">{pick('1.5 s (Chậm)', '1.5s (Slow)')}</option>
                <option value="1000">{pick('1.0 s (Chuẩn)', '1.0s (Normal)')}</option>
                <option value="600">{pick('0.6 s (Vừa)', '0.6s (Medium)')}</option>
                <option value="300">{pick('0.3 s (Nhanh)', '0.3s (Fast)')}</option>
                <option value="100">{pick('0.1 s (Rất nhanh)', '0.1s (Very fast)')}</option>
                <option value="50">{pick('0.05 s (Tối đa)', '0.05s (Fastest)')}</option>
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
              {
              /* executedSet đã được tính toán */
              rawLines.map((lineText, index) => {
                const lineNumber = index + 1
                const { badges, tokens } = analyzeLine(index)

                const isMatchSearch =
                  searchQuery.trim().length > 0 &&
                  lineText.toLowerCase().includes(searchQuery.trim().toLowerCase())

                const hasSelectedVariable =
                  selectedVariable !== null &&
                  lineText.toLowerCase().includes(selectedVariable.toLowerCase())

                // Trạng thái trong chế độ Gỡ lỗi (Debug Mode):
                const isExecutable = executableLineIndices.includes(index)
                const isCurrentExecuting = viewMode === 'debug' && index === currentExecutingLineIndex
                // Trong chế độ Debug: code chạy đến đâu thì hiện giá trị tới đó (chỉ dòng nằm trên luồng thực thi đã chạy)
                const hasExecutedInDebug = viewMode === 'debug' ? executedSet.has(index) : true
                const isSkippedInDebug = viewMode === 'debug' && !isExecutable

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
                        : isSkippedInDebug
                        ? 'opacity-35 italic bg-[var(--c-surface-2)]/10 cursor-pointer'
                        : viewMode === 'debug' && !hasExecutedInDebug
                        ? 'opacity-65 hover:bg-[var(--c-surface-2)]/30 cursor-pointer'
                        : 'hover:bg-[var(--c-surface-2)]/60 cursor-pointer'
                    }`}
                  >
                    {/* Left: Line Number & Code */}
                    <div className="flex items-center min-w-0 pr-4">
                      {/* Line Number Gutter with Breakpoint Indicator */}
                      <div
                        data-testid={`gutter-${lineNumber}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleBreakpoint(lineNumber)
                        }}
                        title={pick(
                          breakpoints.has(lineNumber)
                            ? `Xoá điểm dừng dòng ${lineNumber}`
                            : `Đặt điểm dừng tại dòng ${lineNumber}`,
                          breakpoints.has(lineNumber)
                            ? `Remove breakpoint on line ${lineNumber}`
                            : `Set breakpoint on line ${lineNumber}`,
                        )}
                        className="relative flex items-center justify-end w-12 shrink-0 pr-2.5 select-none text-[11px] font-mono cursor-pointer group/gutter"
                      >
                        {/* Red dot breakpoint indicator */}
                        {breakpoints.has(lineNumber) ? (
                          <span
                            data-testid={`breakpoint-${lineNumber}`}
                            className="absolute left-1.5 h-2.5 w-2.5 rounded-full bg-red-600 ring-2 ring-red-400 shadow-xs"
                          />
                        ) : (
                          <span className="absolute left-1.5 h-2.5 w-2.5 rounded-full bg-red-500/0 group-hover/gutter:bg-red-500/40 transition-colors" />
                        )}
                        {isCurrentExecuting && (
                          <span className="text-[var(--c-accent)] mr-1 font-bold animate-pulse">▶</span>
                        )}
                        <span
                          className={
                            isCurrentExecuting
                              ? 'text-[var(--c-accent)] font-bold'
                              : 'text-[var(--c-text-dim)]/50'
                          }
                        >
                          {lineNumber}
                        </span>
                      </div>

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
                                const isPinned =
                                  pinnedVariables.includes(tokenText) ||
                                  pinnedVariables.includes(resolved?.variableName ?? '')
                                setHoveredSymbol({
                                  name: tokenText,
                                  displayValue: resolved?.displayValue,
                                  prevDisplayValue: resolved?.prevDisplayValue,
                                  dataType:
                                    resolved?.dataType ||
                                    (isIecFunc ? 'FUNCTION' : isIecFb ? 'FUNCTION_BLOCK' : undefined),
                                  kind: isIecFunc
                                    ? 'Hàm chuẩn IEC'
                                    : isIecFb
                                    ? 'Khối hàm chuẩn'
                                    : resolved?.pointName
                                    ? 'Biến gán điểm'
                                    : 'Biến chương trình',
                                  quality: resolved?.quality,
                                  pointName: resolved?.pointName,
                                  unit: resolved?.unit,
                                  connectionPoint: resolved?.connectionPoint,
                                  description: isIecFunc
                                    ? IEC_STANDARD_FUNCTIONS[upper]
                                    : isIecFb
                                    ? IEC_STANDARD_FBS[upper]
                                    : undefined,
                                  isPinned,
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
                              onMouseEnter={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect()
                                const cleanLabel = bItem.label.toLowerCase()
                                const resolved = variableValueMap.get(cleanLabel)
                                const isPinned =
                                  pinnedVariables.includes(bItem.label) ||
                                  pinnedVariables.includes(resolved?.variableName ?? '')
                                setHoveredSymbol({
                                  name: bItem.label,
                                  displayValue: bItem.value || resolved?.displayValue,
                                  prevDisplayValue: resolved?.prevDisplayValue,
                                  dataType: resolved?.dataType || (bItem.isFunction ? 'FUNCTION' : undefined),
                                  kind: bItem.isFunction ? 'Hàm ST' : resolved?.pointName ? 'Biến gán điểm' : 'Biến chương trình',
                                  quality: resolved?.quality,
                                  pointName: bItem.pointName || resolved?.pointName,
                                  unit: resolved?.unit,
                                  connectionPoint: resolved?.connectionPoint,
                                  isPinned,
                                  x: rect.left,
                                  y: rect.bottom + 4,
                                })
                              }}
                              onMouseLeave={() => setHoveredSymbol(null)}
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

      {/* Bảng Watch / Inspector (Bảng theo dõi biến ghim) */}
      <div
        data-testid="st-watch-inspector-panel"
        className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-2 shadow-2xs"
      >
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setIsWatchExpanded((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[var(--c-text)] hover:text-[var(--c-accent)] transition-colors"
          >
            <Pin className="h-3.5 w-3.5 text-[var(--c-accent)]" />
            <span>{pick('Bảng theo dõi biến (Watch)', 'Variable Watch')}</span>
            <span className="font-mono text-[10px] text-[var(--c-text-dim)] font-normal">
              ({pinnedVariables.length})
            </span>
          </button>
          <button
            type="button"
            onClick={() => setIsWatchExpanded((v) => !v)}
            className="text-xs text-[var(--c-text-dim)] hover:text-[var(--c-text)]"
          >
            {isWatchExpanded ? pick('Thu gọn', 'Collapse') : pick('Mở rộng', 'Expand')}
          </button>
        </div>

        {isWatchExpanded && (
          <div className="mt-2">
            {pinnedVariables.length === 0 ? (
              <p className="text-[11px] text-[var(--c-text-dim)] italic">
                {pick(
                  'Chưa có biến nào được ghim. Rê chuột vào biến và bấm "Ghim theo dõi (Pin to Watch)".',
                  'No variables pinned. Hover over a variable and click "Pin to Watch".',
                )}
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {pinnedVariables.map((vName) => {
                  const resolved = variableValueMap.get(vName.toLowerCase())
                  return (
                    <div
                      key={vName}
                      className="flex items-center justify-between rounded border border-[var(--c-border)]/60 bg-[var(--c-surface-2)] px-2 py-1 text-xs font-mono"
                    >
                      <div className="min-w-0 pr-1">
                        <div className="flex items-center gap-1">
                          <span className="font-bold text-[var(--c-text)] truncate" title={vName}>
                            {vName}
                          </span>
                          {resolved?.dataType && (
                            <span className="rounded bg-[var(--c-surface-3)] px-1 text-[9px] text-[var(--c-accent)] font-semibold shrink-0">
                              {resolved.dataType}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] font-semibold text-[var(--c-good-fg)] truncate">
                          {resolved?.displayValue ?? '—'}
                          {resolved?.unit && (
                            <span className="text-[10px] text-[var(--c-text-dim)] ml-1 font-normal">
                              {resolved.unit}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => togglePinVariable(vName)}
                        title={pick(`Bỏ ghim ${vName}`, `Unpin ${vName}`)}
                        className="text-[var(--c-text-dim)] hover:text-[var(--c-danger-fg)] shrink-0 ml-1 p-0.5 rounded transition-colors"
                      >
                        <PinOff className="h-3 w-3" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Floating Hover Card */}
      {hoveredSymbol && (
        <div
          role="tooltip"
          data-testid="st-hover-card"
          className="fixed z-50 max-w-sm rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-2.5 shadow-xl text-xs pointer-events-auto"
          style={{
            top: `${Math.min(hoveredSymbol.y, typeof window !== 'undefined' ? window.innerHeight - 200 : 300)}px`,
            left: `${Math.min(hoveredSymbol.x, typeof window !== 'undefined' ? window.innerWidth - 280 : 300)}px`,
          }}
          onMouseLeave={() => setHoveredSymbol(null)}
        >
          <div className="flex items-center justify-between gap-2 border-b border-[var(--c-border)]/50 pb-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-mono font-bold text-[var(--c-text)] truncate">
                {hoveredSymbol.name}
              </span>
              {hoveredSymbol.dataType && (
                <span className="rounded bg-[var(--c-surface-2)] px-1 font-mono text-[10px] text-[var(--c-accent)] font-semibold shrink-0">
                  {hoveredSymbol.dataType}
                </span>
              )}
            </div>
            {/* Nút Ghim vào Watch */}
            {hoveredSymbol.name && (
              <button
                type="button"
                onClick={() => {
                  togglePinVariable(hoveredSymbol.name)
                  setHoveredSymbol((curr) =>
                    curr ? { ...curr, isPinned: !curr.isPinned } : null,
                  )
                }}
                className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium border transition-colors shrink-0 ${
                  hoveredSymbol.isPinned
                    ? 'border-[var(--c-accent)] bg-[var(--c-accent)]/15 text-[var(--c-accent)] font-semibold'
                    : 'border-[var(--c-border)] bg-[var(--c-surface-2)] text-[var(--c-text-dim)] hover:text-[var(--c-text)]'
                }`}
                title={
                  hoveredSymbol.isPinned
                    ? pick('Bỏ ghim khỏi Watch', 'Unpin from Watch')
                    : pick('Ghim vào bảng Watch', 'Pin to Watch')
                }
              >
                {hoveredSymbol.isPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                <span>
                  {hoveredSymbol.isPinned ? pick('Đã ghim', 'Pinned') : pick('Ghim', 'Pin')}
                </span>
              </button>
            )}
          </div>

          <div className="mt-2 space-y-1 font-mono text-[11px]">
            {hoveredSymbol.displayValue !== undefined && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-[var(--c-text-dim)]">{pick('Giá trị hiện tại:', 'Current Value:')}</span>
                <span className="font-bold text-[var(--c-good-fg)]">
                  {hoveredSymbol.displayValue}
                  {hoveredSymbol.unit && (
                    <span className="ml-1 text-[10px] text-[var(--c-text-dim)] font-normal">
                      {hoveredSymbol.unit}
                    </span>
                  )}
                </span>
              </div>
            )}
            {hoveredSymbol.prevDisplayValue !== undefined &&
              hoveredSymbol.prevDisplayValue !== hoveredSymbol.displayValue && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[var(--c-text-dim)]">{pick('Giá trị chu kỳ trước:', 'Previous Value:')}</span>
                  <span className="font-semibold text-[var(--c-text-dim)]">
                    {hoveredSymbol.prevDisplayValue}
                    {hoveredSymbol.unit && (
                      <span className="ml-1 text-[10px] font-normal">{hoveredSymbol.unit}</span>
                    )}
                  </span>
                </div>
              )}
            {hoveredSymbol.unit && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-[var(--c-text-dim)]">{pick('Đơn vị đo:', 'Unit:')}</span>
                <span className="font-medium text-[var(--c-text)]">{hoveredSymbol.unit}</span>
              </div>
            )}
            {hoveredSymbol.connectionPoint && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-[var(--c-text-dim)]">{pick('Điểm kết nối:', 'Connection Point:')}</span>
                <span className="font-medium text-[var(--c-accent)]">
                  {hoveredSymbol.connectionPoint}
                </span>
              </div>
            )}
            {hoveredSymbol.pointName && hoveredSymbol.pointName !== hoveredSymbol.name && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-[var(--c-text-dim)]">{pick('Tên điểm:', 'Point Name:')}</span>
                <span className="font-medium text-[var(--c-text)]">
                  {hoveredSymbol.pointName}
                </span>
              </div>
            )}
            {hoveredSymbol.quality && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-[var(--c-text-dim)]">{pick('Chất lượng:', 'Quality:')}</span>
                <span className="text-[var(--c-text-dim)]">{hoveredSymbol.quality}</span>
              </div>
            )}
            {hoveredSymbol.kind && (
              <div className="text-[10px] text-[var(--c-text-dim)] pt-0.5">
                {hoveredSymbol.kind}
              </div>
            )}
            {hoveredSymbol.description && (
              <div className="mt-1 rounded bg-[var(--c-surface-2)] p-1.5 text-[10px] text-[var(--c-text-dim)] whitespace-pre-wrap">
                {hoveredSymbol.description}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
