import { Activity, ChevronLeft, ChevronRight, Copy, Database, LayoutGrid, Pencil, Plus, RotateCcw, Save, SlidersHorizontal, Trash2, Wand2, Zap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { apiClient } from '../../shared/api/client'
import { displayPointName, focusPointField, normalizePointName, normalizePointTag, pointFieldFocusPath, pointFieldLocation, pointNameConflicts, pointTagFieldErrors, validatePointName, validatePointTag } from '../../shared/api/pointTags'
import { Button } from '../../shared/components/Button'
import { DirtyGuardModal } from '../../shared/components/DirtyGuardModal'
import { Modal } from '../../shared/components/Modal'
import { Panel } from '../../shared/components/Panel'
import { PointNameConflictNotice } from '../../shared/components/PointNameConflictNotice'
import { PointLoggingSection } from '../../shared/components/PointLoggingSection'
import { StateBlock } from '../../shared/components/StateBlock'
import { useToast } from '../../shared/components/Toast'
import { TrendChart } from '../../shared/components/TrendChart'
import { useApi } from '../../shared/hooks/useApi'
import { useDirtyGuard } from '../../shared/hooks/useDirtyGuard'
import { useI18n } from '../../shared/i18n'
import { VirtualPointUsageNotice } from './VirtualPointUsageNotice'
import type { Point, TrendSample, VirtualPoint, VirtualPointRestartPolicy, VirtualPointSignalType, VirtualPointSource, VirtualPointState } from '../../shared/types'
import { cn, formatPointValue, formatTime, pointNumber } from '../../shared/utils'

type ViewMode = 'summary' | 'wizard' | 'advanced'
type WizardStep = 'signal' | 'min' | 'max' | 'range' | 'unit' | 'filter' | 'cal' | 'math'
type Translate = ReturnType<typeof useI18n>['t']

const signalTypes: VirtualPointSignalType[] = ['boolean', 'integer', 'float', 'string', 'datetime', 'multistate']
const unitOptions = [0, 1, 2, 3, 4]
const rangeMultiplierOptions = [0, 1, 2, 3, 4, 5]
const mathFunctionOptions = [0, 1, 2, 3]
const wizardSteps: WizardStep[] = ['signal', 'min', 'max', 'range', 'unit', 'filter', 'cal', 'math']
const logOptions = [
  { value: 0, label: 'Off', capacity: 256 },
  { value: 1000, label: '1s diagnostic', capacity: 128 },
  { value: 100, label: '100ms diagnostic', capacity: 64 },
  { value: 10, label: '10ms diagnostic', capacity: 16 }
] as const

export function VirtualPointsPage() {
  const { t, pick } = useI18n()
  const toast = useToast()
  const pointsState = useApi(apiClient.getPoints, [], { refreshMs: 1000 })
  const [items, setItems] = useState<VirtualPoint[]>([])
  const [serverItems, setServerItems] = useState<VirtualPoint[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [mode, setMode] = useState<ViewMode>('summary')
  const [wizardIndex, setWizardIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  /* FE-DATA-02 (review FE 2026-08-05): lỗi tải trước đây chỉ đi ra toast rồi
   * biến mất, còn trang thì hiện "chưa có VP" — trong khi VP có thể đang tồn
   * tại đầy đủ mà chỉ là không đọc được. */
  const [loadError, setLoadError] = useState<Error | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [saving, setSaving] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [duplicateSeed, setDuplicateSeed] = useState<VirtualPoint | null>(null)
  const [overviewOpen, setOverviewOpen] = useState(false)
  const [overviewDeleteId, setOverviewDeleteId] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [tagErrors, setTagErrors] = useState<Record<string, string>>({})
  const [errorFocusPath, setErrorFocusPath] = useState<string>()
  const persistedNameConflicts = useMemo(() => pointNameConflicts([
    ...(pointsState.data ?? []).map((point) => ({ id: point.id, name: point.name, kind: point.kind })),
    ...serverItems.map((item) => ({ id: item.id, name: item.label, kind: 'virtual' }))
  ]), [pointsState.data, serverItems])
  const nameConflicts = useMemo(() => pointNameConflicts([
    ...(pointsState.data ?? []).map((point) => ({ id: point.id, name: point.name, kind: point.kind })),
    ...items.map((item) => ({ id: item.id, name: item.label, kind: 'virtual' }))
  ]), [items, pointsState.data])

  useEffect(() => {
    let active = true
    setLoading(true)
    apiClient.getVirtualPoints()
      .then((next) => {
        if (!active) return
        const normalized = next.map(normalizeVirtualPoint)
        setServerItems(normalized)
        setItems(normalized)
        setSelectedId((current) => current || normalized[0]?.id || '')
        setLoadError(null)
      })
      .catch((error) => {
        if (!active) return
        setLoadError(error instanceof Error ? error : new Error(String(error)))
        toast.push('error', error instanceof Error ? error.message : String(error))
      })
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [reloadToken, toast])

  useEffect(() => {
    const first = errorFocusPath ?? Object.keys(tagErrors)[0]
    if (!first) return
    const location = pointFieldLocation(first)
    if (location?.collection === 'items' && items[location.index]) setSelectedId(items[location.index].id)
    const frame = window.requestAnimationFrame(() => focusPointField(Object.keys(tagErrors)))
    return () => window.cancelAnimationFrame(frame)
  }, [errorFocusPath, items, tagErrors])

  const selected = items.find((item) => item.id === selectedId) ?? items[0]
  const overviewDeleteTarget = overviewDeleteId ? items.find((item) => item.id === overviewDeleteId) : undefined
  const livePoint = selected ? findLivePoint(pointsState.data ?? [], selected.id) : undefined
  const quotas = useMemo(() => quotaUsage(items), [items])
  const currentStep = wizardSteps[Math.min(wizardIndex, wizardSteps.length - 1)]
  /* F-UX-12: `items` là bản đang soạn, `serverItems` là bản backend đang giữ.
   * So sánh nguyên khối để không phải liệt kê tay từng field — liệt kê tay là
   * chỗ dirty-guard hay bỏ sót nhất. */
  const dirtyItems = useMemo(() => {
    const byId = new Map(serverItems.map((item) => [item.id, JSON.stringify(item)]))
    return items.filter((item) => byId.get(item.id) !== JSON.stringify(item))
  }, [items, serverItems])
  const dirtyGuard = useDirtyGuard(dirtyItems.length > 0)

  function updateSelected(patch: Partial<VirtualPoint>) {
    if (!selected) return
    // Keep the raw draft intact; canonicalization happens only after a successful save.
    setItems((current) => current.map((item) => item.id === selected.id ? { ...item, ...patch } : item))
  }

  /* Trả `true` chỉ khi backend đã nhận — `DirtyGuardModal` dùng giá trị này để
   * quyết định có rời trang hay không (F-UX-12). */
  async function saveSelected(closeConfirm = false): Promise<boolean> {
    if (!selected) return false
    const index = items.findIndex((item) => item.id === selected.id)
    const errors: Record<string, string> = {}
    const recoveringName = persistedNameConflicts.has(selected.id)
    const localTagError = recoveringName ? undefined : validatePointTag(selected.tag)
    const localNameError = validatePointName(selected.label)
    if (localTagError) errors[`items[${index}].tag`] = localTagError
    if (localNameError) errors[`items[${index}].name`] = localNameError
    if (Object.keys(errors).length) {
      setTagErrors(errors)
      setErrorFocusPath(Object.keys(errors)[0])
      return false
    }
    setSaving(true)
    try {
      if (recoveringName) {
        const name = normalizePointName(selected.label)
        await apiClient.updatePointName(selected.id, name)
        const applyName = (item: VirtualPoint) => item.id === selected.id ? { ...item, name, label: name } : item
        setItems((current) => current.map(applyName))
        setServerItems((current) => current.map(applyName))
        void pointsState.refetch()
      } else {
        const saved = normalizeVirtualPoint(await apiClient.updateVirtualPoint(normalizeVirtualPoint({ ...selected, tag: normalizePointTag(selected.tag), label: displayPointName(normalizePointName(selected.label), selected.id) })))
        setItems((current) => current.map((item) => item.id === saved.id ? saved : item))
        setServerItems((current) => current.map((item) => item.id === saved.id ? saved : item))
      }
      setTagErrors({})
      setErrorFocusPath(undefined)
      toast.push('success', pick('Đã lưu Virtual Point', 'Virtual Point saved'))
      if (closeConfirm) {
        setConfirmOpen(false)
        setMode('advanced')
      }
      return true
    } catch (error) {
      const fieldErrors = pointTagFieldErrors(error)
      setTagErrors(fieldErrors)
      setErrorFocusPath(pointFieldFocusPath(error, selected.id, ['items']) ?? Object.keys(fieldErrors)[0])
      toast.push('error', error instanceof Error ? error.message : String(error))
      return false
    } finally {
      setSaving(false)
    }
  }

  /* F-UX-12: nút Lưu của trang chỉ ghi VP ĐANG CHỌN, nhưng bản nháp chưa lưu có
   * thể nằm ở nhiều VP (người dùng sửa VP1, bấm sang VP2 rồi mới rời trang).
   * Nếu hộp thoại rời trang chỉ lưu VP đang chọn thì nó nói dối: người dùng bấm
   * "Lưu rồi rời đi" và vẫn mất các VP kia. Hàm này lưu **mọi** VP đang lệch so
   * với bản backend, và dừng ngay ở VP đầu tiên hỏng (không rời trang) thay vì
   * ghi tiếp nửa vời. */
  async function saveDirtyPoints(): Promise<boolean> {
    if (!dirtyItems.length) return true
    const errors: Record<string, string> = {}
    for (const item of dirtyItems) {
      const index = items.findIndex((entry) => entry.id === item.id)
      const tagError = persistedNameConflicts.has(item.id) ? undefined : validatePointTag(item.tag)
      const nameError = validatePointName(item.label)
      if (tagError) errors[`items[${index}].tag`] = tagError
      if (nameError) errors[`items[${index}].name`] = nameError
    }
    if (Object.keys(errors).length) {
      setTagErrors(errors)
      setErrorFocusPath(Object.keys(errors)[0])
      return false
    }
    setSaving(true)
    try {
      for (const item of dirtyItems) {
        if (persistedNameConflicts.has(item.id)) {
          const name = normalizePointName(item.label)
          await apiClient.updatePointName(item.id, name)
          const applyName = (entry: VirtualPoint) => entry.id === item.id ? { ...entry, name, label: name } : entry
          setItems((current) => current.map(applyName))
          setServerItems((current) => current.map(applyName))
        } else {
          const saved = normalizeVirtualPoint(await apiClient.updateVirtualPoint(normalizeVirtualPoint({ ...item, tag: normalizePointTag(item.tag), label: displayPointName(normalizePointName(item.label), item.id) })))
          setItems((current) => current.map((entry) => entry.id === saved.id ? saved : entry))
          setServerItems((current) => current.map((entry) => entry.id === saved.id ? saved : entry))
        }
      }
      setTagErrors({})
      setErrorFocusPath(undefined)
      void pointsState.refetch()
      toast.push('success', pick('Đã lưu Virtual Point', 'Virtual Point saved'))
      return true
    } catch (error) {
      const fieldErrors = pointTagFieldErrors(error)
      setTagErrors(fieldErrors)
      setErrorFocusPath(Object.keys(fieldErrors)[0])
      toast.push('error', error instanceof Error ? error.message : String(error))
      return false
    } finally {
      setSaving(false)
    }
  }

  async function createItem(input: Partial<VirtualPoint>) {
    const errors: Record<string, string> = {}
    const localTagError = input.tag?.trim() ? validatePointTag(input.tag) : undefined
    const localNameError = validatePointName(input.label ?? input.name ?? '')
    if (localTagError) errors[`items[${items.length}].tag`] = localTagError
    if (localNameError) errors[`items[${items.length}].name`] = localNameError
    if (Object.keys(errors).length) {
      setTagErrors(errors)
      setErrorFocusPath(Object.keys(errors)[0])
      return
    }
    setSaving(true)
    try {
      const canonicalName = normalizePointName(input.label ?? input.name ?? '')
      const created = normalizeVirtualPoint(await apiClient.createVirtualPoint({
        ...defaultVirtualPoint(),
        ...input,
        tag: normalizePointTag(input.tag ?? ''),
        label: canonicalName
      }))
      setItems((current) => [...current, created])
      setServerItems((current) => [...current, created])
      setSelectedId(created.id)
      setWizardIndex(0)
      setAddOpen(false)
      setTagErrors({})
      setErrorFocusPath(undefined)
      toast.push('success', pick('Đã tạo VP', 'Virtual Point created'))
    } catch (error) {
      const fieldErrors = pointTagFieldErrors(error)
      setTagErrors(fieldErrors)
      setErrorFocusPath(pointFieldFocusPath(error, undefined, ['items']) ?? Object.keys(fieldErrors)[0])
      toast.push('error', error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function deleteSelected() {
    if (!selected) return
    setSaving(true)
    try {
      await apiClient.deleteVirtualPoint(selected.id)
      const next = items.filter((item) => item.id !== selected.id)
      setItems(next)
      setServerItems((current) => current.filter((item) => item.id !== selected.id))
      setSelectedId(next[0]?.id ?? '')
      setWizardIndex(0)
      setDeleteOpen(false)
      toast.push('success', pick('Đã xoá VP', 'Virtual Point deleted'))
    } catch (error) {
      toast.push('error', error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function deleteById(id: string) {
    setSaving(true)
    try {
      await apiClient.deleteVirtualPoint(id)
      const next = items.filter((item) => item.id !== id)
      setItems(next)
      setServerItems((current) => current.filter((item) => item.id !== id))
      setSelectedId((current) => (current === id ? (next[0]?.id ?? '') : current))
      setWizardIndex(0)
      toast.push('success', pick('Đã xoá VP', 'Virtual Point deleted'))
    } catch (error) {
      toast.push('error', error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function writeValue(raw: string) {
    if (!selected) return
    setSaving(true)
    try {
      const value = parseValue(selected.signalType, raw)
      await apiClient.forcePoint(selected.id, value)
      updateSelected({ value, updatedAt: new Date().toISOString() })
      toast.push('success', pick(`Da ghi ${selected.tag}`, `Wrote ${selected.tag}`))
      await pointsState.refetch()
    } catch (error) {
      toast.push('error', error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  // FE-DATA-02: chỉ chặn khi KHÔNG có gì trong tay; hỏng giữa chừng vẫn giữ bảng.
  if (loadError && serverItems.length === 0) {
    return (
      <StateBlock
        state="error"
        title={pick('Không tải được danh sách Virtual Point', 'Could not load virtual points')}
        detail={loadError.message}
        onRetry={() => setReloadToken((token) => token + 1)}
      />
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--c-text)]">{pick('Virtual Points', 'Virtual Points')}</h1>
          <p className="text-sm text-[var(--c-text-dim)]">{pick('VP backend-only, chỉ hiện khi đã tạo.', 'Backend-only Virtual Points, visible only after creation.')}</p>
        </div>
        <div className="flex gap-2">
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => { setDuplicateSeed(null); setAddOpen(true) }}>{pick('Tạo VP', 'Add VP')}</Button>
          {/* `T57-2.20` — nhân bản VP đang chọn. */}
          <Button icon={<Copy className="h-4 w-4" />} disabled={!selected} onClick={() => { setDuplicateSeed(selected ?? null); setAddOpen(true) }}>{pick('Nhân bản', 'Duplicate')}</Button>
          <Button icon={<LayoutGrid className="h-4 w-4" />} disabled={!items.length} onClick={() => setOverviewOpen(true)}>{pick('Tổng quan', 'Overview')}</Button>
          <Button variant="primary" icon={<Save className="h-4 w-4" />} loading={saving} disabled={!selected || loading} onClick={() => setConfirmOpen(true)}>{t('save')}</Button>
        </div>
      </div>

      <QuotaStrip quotas={quotas} />

      <div className="grid gap-5 lg:grid-cols-[276px_minmax(0,1fr)]">
        <Panel title={pick('VP đã tạo', 'Created VP')}>
          <div className="space-y-2">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSelectedId(item.id)
                  setWizardIndex(0)
                }}
                className={cn('flex min-h-12 w-full items-center gap-3 rounded-[var(--radius)] border px-3 py-2 text-left text-sm transition', selected?.id === item.id ? 'border-[var(--c-accent)] bg-[var(--c-surface-2)] text-[var(--c-text)]' : 'border-transparent text-[var(--c-text-dim)] hover:border-[var(--c-border)] hover:bg-[var(--c-surface-2)] hover:text-[var(--c-text)]')}
              >
                <Database className="h-4 w-4 shrink-0 text-[var(--c-accent)]" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{item.tag}</span>
                  <span className="block truncate text-xs">{item.label}</span>
                </span>
                <span className="text-xs font-mono uppercase text-[var(--c-text-dim)]">{item.signalType}</span>
              </button>
            ))}
            {!items.length && <div className="rounded-[var(--radius)] border border-dashed border-[var(--c-border)] p-4 text-sm text-[var(--c-text-dim)]">{loading ? t('loading') : pick('Chưa có VP nào.', 'No VP created.')}</div>}
          </div>
        </Panel>

        <Panel
          title={selected ? `${selected.tag} - ${selected.label}` : t('empty')}
           subtitle={selected ? `${selected.signalType.toUpperCase()} | ${selected.logEnabled ? `${selected.logIntervalMs}ms diagnostic log` : 'no diagnostic log'}` : undefined}
          action={selected && (
            <div className="flex items-center gap-2">
              <div className="flex rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-1">
                <ModeButton active={mode === 'summary'} icon={<Activity className="h-4 w-4" />} label={t('summary')} onClick={() => setMode('summary')} />
                <ModeButton active={mode === 'wizard'} icon={<Wand2 className="h-4 w-4" />} label={t('wizard')} onClick={() => setMode('wizard')} />
                <ModeButton active={mode === 'advanced'} icon={<SlidersHorizontal className="h-4 w-4" />} label={t('advanced')} onClick={() => setMode('advanced')} />
              </div>
              <Button icon={<Trash2 className="h-4 w-4" />} onClick={() => setDeleteOpen(true)}>{pick('Xoá', 'Delete')}</Button>
            </div>
          )}
        >
          {selected ? (
            <div className="space-y-5">
              <Basics
                item={selected}
                tagError={tagErrors[`items[${items.findIndex((item) => item.id === selected.id)}].tag`]}
                nameError={tagErrors[`items[${items.findIndex((item) => item.id === selected.id)}].name`]}
                fieldIndex={items.findIndex((item) => item.id === selected.id)}
                onChange={updateSelected}
              />
              <PointNameConflictNotice pointId={selected.id} conflictIds={nameConflicts.get(selected.id)} />
              <PointLoggingSection pointId={selected.id} label={selected.label} kind="VP" />
              {mode === 'summary' && <Summary item={selected} livePoint={livePoint} saving={saving} onWrite={(raw) => void writeValue(raw)} />}
              {mode === 'wizard' && (
                <WizardPanel
                  item={selected}
                  step={currentStep}
                  stepIndex={Math.min(wizardIndex, wizardSteps.length - 1)}
                  stepCount={wizardSteps.length}
                  onChange={updateSelected}
                  onStepSelect={setWizardIndex}
                  onPrevious={() => setWizardIndex((index) => Math.max(index - 1, 0))}
                  onNext={() => setWizardIndex((index) => Math.min(index + 1, wizardSteps.length - 1))}
                  onFinish={() => setConfirmOpen(true)}
                />
              )}
              {mode === 'advanced' && <Advanced item={selected} onChange={updateSelected} />}
            </div>
          ) : (
            <div className="rounded-[var(--radius)] border border-dashed border-[var(--c-border)] p-6 text-sm text-[var(--c-text-dim)]">
              {pick('Bấm Tạo VP để tạo biến ảo.', 'Use Add VP to create a virtual point.')}
            </div>
          )}
        </Panel>
      </div>

      <AddVirtualPointModal open={addOpen} saving={saving} tagError={tagErrors[`items[${items.length}].tag`]} nameError={tagErrors[`items[${items.length}].name`]} fieldIndex={items.length} seed={duplicateSeed} onCreate={createItem} onClose={() => { setAddOpen(false); setDuplicateSeed(null) }} />
      <VirtualPointOverviewModal
        open={overviewOpen}
        items={items}
        livePoints={pointsState.data ?? []}
        onEdit={(id) => {
          setSelectedId(id)
          setWizardIndex(0)
          setMode('advanced')
          setOverviewOpen(false)
        }}
        onDelete={(id) => setOverviewDeleteId(id)}
        onClose={() => setOverviewOpen(false)}
      />
      <Modal open={overviewDeleteId !== null} danger title={pick('Xoá VP?', 'Delete Virtual Point?')} confirmLabel="OK" cancelLabel="Cancel" onConfirm={() => { if (overviewDeleteId) void deleteById(overviewDeleteId); setOverviewDeleteId(null) }} onClose={() => setOverviewDeleteId(null)}>
        {overviewDeleteTarget?.tag ?? ''}
        {/* `T57-3.12`: nói ra hậu quả TRƯỚC khi bấm, không sau. */}
        <VirtualPointUsageNotice pointId={overviewDeleteId} />
      </Modal>
      <Modal
        open={confirmOpen}
        title={pick('Lưu Virtual Point?', 'Save Virtual Point?')}
        confirmLabel="OK"
        cancelLabel="Cancel"
        onConfirm={() => { void saveSelected(true) }}
        onClose={() => setConfirmOpen(false)}
      >
        {pick('Bạn có muốn lưu thay đổi không?', 'Do you want to save the changes?')}
      </Modal>
      <Modal open={deleteOpen} danger title={pick('Xoá VP?', 'Delete Virtual Point?')} confirmLabel="OK" cancelLabel="Cancel" onConfirm={() => void deleteSelected()} onClose={() => setDeleteOpen(false)}>
        {selected?.tag ?? ''}
        <VirtualPointUsageNotice pointId={deleteOpen ? selected?.id ?? null : null} />
      </Modal>
      <DirtyGuardModal
        guard={dirtyGuard}
        saving={saving}
        title={pick('Virtual Point chưa lưu', 'Unsaved virtual points')}
        message={pick(
          `Có ${dirtyItems.length} Virtual Point đang sửa mà chưa lưu. Rời trang sẽ mất các thay đổi này trừ khi lưu trước.`,
          `${dirtyItems.length} virtual point(s) have unsaved edits. Leaving this page will discard them unless you save first.`
        )}
        onSave={saveDirtyPoints}
        onDiscard={() => {
          setItems(serverItems)
          setTagErrors({})
          setErrorFocusPath(undefined)
        }}
      />
    </div>
  )
}

export const VirtualIoPage = VirtualPointsPage

function QuotaStrip({ quotas }: { quotas: ReturnType<typeof quotaUsage> }) {
  return (
    <div className="grid gap-3 md:grid-cols-4">
      {logOptions.map((option) => (
        <div key={option.value} className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3">
           <div className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{option.label}</div>
          <div className="mono mt-2 text-2xl font-bold text-[var(--c-text)]">{quotas[option.value]}/{option.capacity}</div>
        </div>
      ))}
    </div>
  )
}

function Basics({ item, tagError, nameError, fieldIndex, onChange }: { item: VirtualPoint; tagError?: string; nameError?: string; fieldIndex: number; onChange: (patch: Partial<VirtualPoint>) => void }) {
  const { t, pick } = useI18n()
  return (
    /* Lưới TỰ CO theo bề rộng khung, không cột px cố định: bản cũ khai 7 cột
     * (5 cột cố định cộng 680 px + 72 px khoảng cách) trong khung soạn chỉ rộng
     * 676 px ở màn hình 1280 px, nên hai cột `minmax(0,1fr)` là Tag và Label co
     * về 0 px — tên và lỗi xung đột tên của Virtual Point không đọc được (e2e
     * `point-names` đỏ từ 2026-09-04). Một class, không breakpoint: tránh bẫy
     * cascade breakpoint của Tailwind v4. */
    <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]">
      <TextInput fieldPath={`items[${fieldIndex}].tag`} label="Tag" value={item.tag} error={tagError} onChange={(tag) => onChange({ tag })} />
      <TextInput label={t('channelLabel')} value={String(item.channel || globalVirtualPointChannel(item.id))} disabled onChange={() => {}} />
      {/* `ISS-PIO-03`: slot Core do backend cấp — chỉ đọc, vì đổi nó bằng tay là
        * đổi đích của một binding đang chạy. Kiểu `string`/`datetime` không có
        * slot ở Core, và ô này NÓI RA điều đó thay vì để trống, bằng không người
        * dùng chỉ thấy điểm của mình không xuất hiện ở tab Ánh xạ mà không hiểu
        * vì sao. */}
      <TextInput
        label={pick('Slot Core', 'Core slot')}
        value={item.boundPointId ?? pick('không có (kiểu này không map được)', 'none (type cannot be mapped)')}
        disabled
        onChange={() => {}}
      />
      <TextInput fieldPath={`items[${fieldIndex}].name`} label="Label" value={item.label} error={nameError} onChange={(label) => onChange({ label, name: label })} />
      <SignalTypeSelect value={item.signalType} label onChange={(signalType) => onChange(signalTypePatch(item, signalType))} />
      <CheckField label="Enabled" checked={item.enabled} onChange={(enabled) => onChange({ enabled })} />
      {/* U-05 — `writable` là quyền của NGƯỜI VẬN HÀNH. Với VP do chương trình sở
          hữu, người vận hành không bao giờ ghi được, nên ô này khoá lại và nói
          rõ, thay vì để người dùng tưởng nó quyết định chương trình có ghi được
          hay không. */}
      <CheckField
        label="Writable"
        checked={item.writable}
        disabled={virtualPointOwner(item) === 'PROGRAM'}
        hint={virtualPointOwner(item) === 'PROGRAM' ? t('writableNotApplicableProgram') : undefined}
        onChange={(writable) => onChange({ writable })}
      />
      <RestartPolicyField item={item} onChange={onChange} />
    </div>
  )
}

/* `ISS-PIO-14` — giá trị điểm sau khi bộ điều khiển khởi động lại (đề bài §13).
 *
 * Trước bản vá, `value` gánh HAI nghĩa: giá trị khởi tạo do người dùng đặt, và
 * giá trị hiện hành do lệnh ghi cập nhật. Người dùng đặt 20 làm mặc định, một
 * kỹ thuật viên ép 35 để thử, và số 20 biến mất khỏi cấu hình vĩnh viễn.
 *
 * Ô "Giá trị khởi tạo" chỉ hiện khi chọn `initial`: khi chọn `retain` thì không
 * có giá trị khởi tạo nào được dùng, và một ô nhập không ai đọc là một lời hứa
 * suông — đúng lớp lỗi mà `ISS-PIO-25` vừa dọn khỏi AoConfig/DoConfig.
 */
export function RestartPolicyField({ item, onChange }: { item: VirtualPoint; onChange: (patch: Partial<VirtualPoint>) => void }) {
  const { pick } = useI18n()
  const policy = item.restartPolicy ?? 'retain'
  return (
    <>
      <label className="block text-xs text-[var(--c-text-dim)]">
        {pick('Sau khi khởi động lại', 'After restart')}
        <select
          className="mt-1 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
          aria-label={pick(`Chính sách khởi động lại cho ${item.id}`, `Restart policy for ${item.id}`)}
          value={policy}
          onChange={(event) => onChange({ restartPolicy: event.target.value as VirtualPointRestartPolicy })}
        >
          <option value="retain">{pick('Giữ giá trị cuối', 'Retain last value')}</option>
          <option value="initial">{pick('Về giá trị khởi tạo', 'Return to initial value')}</option>
        </select>
      </label>
      {policy === 'initial' && (
        <label className="block text-xs text-[var(--c-text-dim)]">
          {pick('Giá trị khởi tạo', 'Initial value')}
          <input
            className="mt-1 h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
            aria-label={pick(`Giá trị khởi tạo cho ${item.id}`, `Initial value for ${item.id}`)}
            value={String(item.initialValue ?? '')}
            placeholder={String(defaultValue(item.signalType))}
            onChange={(event) => onChange({ initialValue: parseValue(item.signalType, event.target.value) })}
          />
        </label>
      )}
    </>
  )
}

type VpTrendSample = TrendSample & { raw: number }

function useVpTrend(pointId: string, point?: Point): { data: VpTrendSample[]; reset: () => void } {
  const [buffers, setBuffers] = useState<Record<string, VpTrendSample[]>>({})

  useEffect(() => {
    if (!point) return
    const value = pointNumber(point)
    // Chưa có số đo thì bỏ qua mẫu thay vì ghi 0 (REV-FE-04).
    if (value === null) return
    // PA3-F04: không có mốc thời gian của producer thì KHÔNG đặt mẫu này
    // lên trục thời gian bằng giờ máy trạm — biểu đồ sẽ nói dối về độ tươi.
    if (!point.updatedAt) return
    const time = formatTime(point.updatedAt)
    setBuffers((current) => {
      const existing = current[pointId] ?? []
      const last = existing[existing.length - 1]
      if (last && last.time === time && last.raw === value) return current
      return { ...current, [pointId]: [...existing, { time, raw: value, [pointId]: value }].slice(-60) }
    })
  }, [pointId, point])

  function reset() {
    const value = point ? pointNumber(point) : null
    if (!point || value === null) {
      setBuffers((current) => ({ ...current, [pointId]: [] }))
      return
    }
    const time = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setBuffers((current) => ({ ...current, [pointId]: [{ time, raw: value, [pointId]: value }] }))
  }

  return { data: buffers[pointId] ?? [], reset }
}

function formatStat(value: number, unit?: string): string {
  const fixed = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1)
  return `${fixed}${unit ? ` ${unit}` : ''}`
}

function Summary({ item, livePoint, saving, onWrite }: { item: VirtualPoint; livePoint?: Point; saving: boolean; onWrite: (raw: string) => void }) {
  const { t, pick } = useI18n()
  const [draft, setDraft] = useState(String(livePoint?.value ?? item.value ?? defaultValue(item.signalType)))
  useEffect(() => {
    setDraft(String(livePoint?.value ?? item.value ?? defaultValue(item.signalType)))
  }, [item.id, item.signalType, item.value, livePoint?.value])
  const { data, reset } = useVpTrend(item.id, livePoint)
  const values = data.map((sample) => sample.raw)
  const stats = values.length ? {
    min: Math.min(...values),
    max: Math.max(...values),
    avg: values.reduce((sum, value) => sum + value, 0) / values.length
  } : null
  const unit = item.unit ? unitLabel(unitFromString(item.unit), t) : undefined
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-[var(--c-text)]">Live Data</h3>
            <Button size="sm" icon={<RotateCcw className="h-4 w-4" />} onClick={reset}>{pick('Đặt lại', 'Reset')}</Button>
          </div>
          <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <LiveDataItem label="Value" value={formatPointValue({ value: livePoint?.value ?? item.value ?? defaultValue(item.signalType), unit: item.unit, signalType: item.signalType, stateLabel: livePoint?.stateLabel })} />
            <LiveDataItem label="Quality" value={livePoint?.quality ?? 'good'} />
            <LiveDataItem label={pick('Nhỏ nhất', 'Minimum')} value={stats ? formatStat(stats.min, unit) : '--'} />
            <LiveDataItem label={pick('Lớn nhất', 'Maximum')} value={stats ? formatStat(stats.max, unit) : '--'} />
            <LiveDataItem label={pick('Trung bình', 'Average')} value={stats ? formatStat(stats.avg, unit) : '--'} />
            <LiveDataItem label={t('unitsLabel')} value={unitLabel(unitFromString(item.unit), t)} />
             <LiveDataItem label="Diagnostic log" value={item.logEnabled ? `${item.logIntervalMs}ms` : 'Off'} />
          </dl>
        </section>
        <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-[var(--c-text)]">{pick('Biểu đồ trực tiếp', 'Live Chart')}</h3>
            <span className="text-xs font-semibold text-[var(--c-text-dim)]">{item.id}</span>
          </div>
          <TrendChart
            data={data}
            height={250}
            series={[{ key: item.id, label: item.tag, color: 'var(--c-accent)', unit }]}
          />
          {data.length === 0 && <div className="mt-2 text-xs text-[var(--c-text-dim)]">{pick('Chưa có dữ liệu trực tiếp cho VP này.', 'No live data for this VP yet.')}</div>}
        </section>
      </div>
      <section className="space-y-4 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4">
        <h3 className="text-sm font-semibold text-[var(--c-text)]">Write Value</h3>
        {virtualPointWritable(item) ? (
          <>
            <ValueInput signalType={item.signalType} value={draft} onChange={setDraft} />
            <Button variant="primary" icon={<Zap className="h-4 w-4" />} loading={saving} onClick={() => onWrite(draft)}>Write</Button>
          </>
        ) : (
          /* `ISS-PIO-16` — nói VÌ SAO, không chỉ nói "Read only".
           *
           * Hai lý do khác nhau cần hai câu khác nhau và hai cách gỡ khác nhau:
           * chưa bật `writable` thì sửa cấu hình điểm; do chương trình sở hữu
           * thì phải đổi chủ sở hữu hoặc sửa chương trình. Một nhãn "Read only"
           * chung cho cả hai trả lời đúng câu hỏi sai. */
          <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 text-sm text-[var(--c-text-dim)]">
            {virtualPointOwner(item) === 'PROGRAM' ? t('readOnlyBecauseProgram') : t('readOnlyBecauseNotWritable')}
          </div>
        )}
      </section>
    </div>
  )
}

function WizardPanel({ item, step, stepIndex, stepCount, onChange, onStepSelect, onPrevious, onNext, onFinish }: {
  item: VirtualPoint
  step: WizardStep
  stepIndex: number
  stepCount: number
  onChange: (patch: Partial<VirtualPoint>) => void
  onStepSelect: (index: number) => void
  onPrevious: () => void
  onNext: () => void
  onFinish: () => void
}) {
  const { t } = useI18n()
  const atEnd = stepIndex === stepCount - 1
  return (
    <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{stepIndex + 1} / {stepCount}</div>
        <div className="h-2 flex-1 rounded-full bg-[var(--c-surface-2)]">
          <div className="h-2 rounded-full bg-[var(--c-accent)]" style={{ width: `${((stepIndex + 1) / stepCount) * 100}%` }} />
        </div>
      </div>

      <div className="mb-4 overflow-x-auto border-b border-[var(--c-border)]">
        <div className="flex min-w-max gap-1">
          {wizardSteps.map((candidate, index) => (
            <button
              key={candidate}
              type="button"
              title={`${wizardStepLabel(candidate, t)}: ${wizardStepValue(candidate, item, t)}`}
              onClick={() => onStepSelect(index)}
              className={cn(
                'min-w-20 border-b-2 px-3 py-2 text-left text-xs font-semibold transition',
                index === stepIndex
                  ? 'border-[var(--c-accent)] bg-[var(--c-surface-2)] text-[var(--c-text)]'
                  : 'border-transparent text-[var(--c-text-dim)] hover:bg-[var(--c-surface-2)] hover:text-[var(--c-text)]'
              )}
            >
              <span className="block font-mono">{wizardStepRegister(candidate)}</span>
              <span className="block max-w-28 truncate">{wizardStepLabel(candidate, t)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-44">{renderWizardField(item, step, onChange, t)}</div>

      <div className="mt-5 flex justify-between gap-2">
        <Button icon={<ChevronLeft className="h-4 w-4" />} onClick={onPrevious} disabled={stepIndex === 0}>{t('previous')}</Button>
        <Button variant="primary" icon={!atEnd ? <ChevronRight className="h-4 w-4" /> : undefined} onClick={atEnd ? onFinish : onNext}>{atEnd ? t('finish') : t('next')}</Button>
      </div>
    </div>
  )
}

function Advanced({ item, onChange }: { item: VirtualPoint; onChange: (patch: Partial<VirtualPoint>) => void }) {
  const { t } = useI18n()
  const logValue = item.logEnabled ? item.logIntervalMs ?? 1000 : 0
  const [displayLow, displayHigh] = displayRangeLimits(item.unit)
  const rows = [
    { register: 'u0', label: t('signalTypeLabel'), control: <SignalTypeSelect value={item.signalType} onChange={(signalType) => onChange(signalTypePatch(item, signalType))} /> },
    { register: 'u1', label: t('displayMinLabel'), control: <SmallNumberInput value={numberOr(item.displayMin, 0)} min={displayLow} max={displayHigh} onChange={(displayMin) => onChange({ displayMin })} /> },
    { register: 'u2', label: t('displayMaxLabel'), control: <SmallNumberInput value={numberOr(item.displayMax, 100)} min={displayLow} max={displayHigh} onChange={(displayMax) => onChange({ displayMax })} /> },
    { register: 'EL-', label: t('minValueLabel'), control: <OptionalNumberInput value={item.minValue} disabled={!numericSignalType(item.signalType)} label={t('minValueLabel')} onChange={(minValue) => onChange({ minValue })} /> },
    { register: 'EL+', label: t('maxValueLabel'), control: <OptionalNumberInput value={item.maxValue} disabled={!numericSignalType(item.signalType)} label={t('maxValueLabel')} onChange={(maxValue) => onChange({ maxValue })} /> },
    { register: 'OWN', label: t('ownerLabel'), control: <OwnerField item={item} onChange={onChange} /> },
    { register: 'u3', label: t('rangeMultiplierLabel'), control: <RangeMultiplierSelect value={numberOr(item.rangeMultiplier, 0)} onChange={(rangeMultiplier) => onChange({ rangeMultiplier })} /> },
    { register: 'u4', label: t('unitsLabel'), control: <UnitSelect value={unitFromString(item.unit)} onChange={(unit) => onChange({ unit: unitToString(unit) })} /> },
    { register: 'u5', label: t('filterSamplesLabel'), control: <SmallNumberInput value={numberOr(item.filterSamples, 3)} min={0} max={100} onChange={(filterSamples) => onChange({ filterSamples })} /> },
    { register: 'u6', label: t('sensorCalibrationLabel'), control: <SmallNumberInput value={numberOr(item.sensorCal, 0)} min={-12.7} max={12.8} step={0.1} onChange={(sensorCal) => onChange({ sensorCal })} /> },
    { register: 'u7', label: t('mathFunctionLabel'), control: <MathFunctionSelect value={numberOr(item.mathFunction, 0)} onChange={(mathFunction) => onChange({ mathFunction })} /> },
    { register: 'LOG', label: 'Diagnostic log mode', control: <SelectField value={String(logValue)} options={logOptions.map((option) => [String(option.value), option.label])} onChange={(raw) => {
      const value = Number(raw)
      onChange({ logEnabled: value !== 0, logIntervalMs: value === 0 ? undefined : value, retentionS: value === 0 ? undefined : defaultRetention(value) })
    }} /> },
    { register: 'RET', label: 'Diagnostic log retention (s)', control: <SmallNumberInput value={item.retentionS ?? 0} min={0} max={defaultRetention(logValue)} disabled={!item.logEnabled} onChange={(retentionS) => onChange({ retentionS })} /> },
    { register: 'VAL', label: 'Initial value', control: <ValueInput signalType={item.signalType} value={String(item.value ?? defaultValue(item.signalType))} onChange={(raw) => onChange({ value: parseValue(item.signalType, raw) })} compact /> },
    /* `ISS-PIO-17` — danh sách state. Chỉ hiện với `multistate`: ở kiểu khác nó
     * không cưỡng chế gì, và web-api coi việc khai nó là lỗi cấu hình. */
    ...(item.signalType === 'multistate'
      ? [{ register: 'MSV', label: 'Multistate states', control: <StateListEditor states={item.states ?? defaultStates()} onChange={(states) => onChange({ states })} /> }]
      : [])
  ]
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)]">
        <div className="grid grid-cols-[96px_minmax(0,1fr)_minmax(190px,280px)_82px] bg-[var(--c-surface-2)] px-3 py-2 text-xs font-semibold uppercase text-[var(--c-text-dim)]">
          <span>{t('register')}</span>
          <span>{t('channelLabel')}</span>
          <span>{t('value')}</span>
          <span>Mode</span>
        </div>
        {rows.map((row) => (
          <div key={row.register} className="grid grid-cols-[96px_minmax(0,1fr)_minmax(190px,280px)_82px] items-center gap-3 border-t border-[var(--c-border)] px-3 py-3 text-sm">
            <span className="font-mono text-[var(--c-text-dim)]">{row.register}</span>
            <span className="font-medium text-[var(--c-text)]">{row.label}</span>
            {row.control}
            <ModeBadge wired />
          </div>
        ))}
      </div>
      <label className="block space-y-2">
        <span className="text-sm font-semibold text-[var(--c-text)]">Note</span>
        <textarea className="min-h-24 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-3 text-sm outline-none focus:border-[var(--c-accent)]" value={item.note ?? ''} onChange={(event) => onChange({ note: event.target.value })} />
      </label>
    </div>
  )
}

function renderWizardField(item: VirtualPoint, step: WizardStep, onChange: (patch: Partial<VirtualPoint>) => void, t: Translate): React.ReactNode {
  if (step === 'signal') return <WizardField label={t('signalTypeLabel')}><SignalTypeSelect value={item.signalType} onChange={(signalType) => onChange(signalTypePatch(item, signalType))} /></WizardField>
  if (step === 'min') return <WizardField label={t('displayMinLabel')}><SmallNumberInput value={numberOr(item.displayMin, 0)} min={displayRangeLimits(item.unit)[0]} max={displayRangeLimits(item.unit)[1]} onChange={(displayMin) => onChange({ displayMin })} /></WizardField>
  if (step === 'max') return <WizardField label={t('displayMaxLabel')}><SmallNumberInput value={numberOr(item.displayMax, 100)} min={displayRangeLimits(item.unit)[0]} max={displayRangeLimits(item.unit)[1]} onChange={(displayMax) => onChange({ displayMax })} /></WizardField>
  if (step === 'range') return <WizardField label={t('rangeMultiplierLabel')}><RangeMultiplierSelect value={numberOr(item.rangeMultiplier, 0)} onChange={(rangeMultiplier) => onChange({ rangeMultiplier })} /></WizardField>
  if (step === 'unit') return <WizardField label={t('unitsLabel')}><UnitSelect value={unitFromString(item.unit)} onChange={(unit) => onChange({ unit: unitToString(unit) })} /></WizardField>
  if (step === 'filter') return <WizardField label={t('filterSamplesLabel')}><SmallNumberInput value={numberOr(item.filterSamples, 3)} min={0} max={100} onChange={(filterSamples) => onChange({ filterSamples })} /></WizardField>
  if (step === 'cal') return <WizardField label={t('sensorCalibrationLabel')}><SmallNumberInput value={numberOr(item.sensorCal, 0)} min={-12.7} max={12.8} step={0.1} onChange={(sensorCal) => onChange({ sensorCal })} /></WizardField>
  return <WizardField label={t('mathFunctionLabel')}><MathFunctionSelect value={numberOr(item.mathFunction, 0)} onChange={(mathFunction) => onChange({ mathFunction })} /></WizardField>
}

function WizardField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <FieldHeader label={label} wired />
      {children}
    </div>
  )
}

/**
 * `seed` = nhân bản một VP đã có (`T57-2.20`).
 *
 * Điền sẵn MỌI trường trừ `tag`: tag là danh tính, và điền sẵn một tag đã tồn
 * tại chỉ để người dùng phải xoá đi là thêm một bước thừa cộng một cơ hội tạo
 * trùng. Tạo hàng loạt biến cùng kiểu trước đây phải nhập lại từ đầu mỗi lần.
 */
function AddVirtualPointModal({ open, saving, tagError, nameError, fieldIndex, seed, onCreate, onClose }: { open: boolean; saving: boolean; tagError?: string; nameError?: string; fieldIndex: number; seed?: VirtualPoint | null; onCreate: (input: Partial<VirtualPoint>) => void; onClose: () => void }) {
  const [tag, setTag] = useState('')
  const [label, setLabel] = useState('')
  const [signalType, setSignalType] = useState<VirtualPointSignalType>('float')
  const [unit, setUnit] = useState(0)
  const [writable, setWritable] = useState(true)
  const [logMode, setLogMode] = useState(0)
  const [value, setValue] = useState('0')

  useEffect(() => {
    if (!open) return
    // Tag để TRỐNG kể cả khi nhân bản — xem chú thích ở đầu component.
    setTag('')
    setLabel(seed ? `${seed.name ?? seed.label ?? ''}` : '')
    setSignalType(seed?.signalType ?? 'float')
    setUnit(seed ? unitFromString(seed.unit) : 0)
    setWritable(seed?.writable ?? true)
    setLogMode(seed?.logEnabled ? (seed.logIntervalMs ?? 0) : 0)
    setValue(seed?.value === undefined || seed.value === null ? '0' : String(seed.value))
  }, [open, seed])

  return (
    <Modal open={open} title={seed ? `Nhân bản ${seed.tag}` : "Add Virtual Point"} confirmLabel="Create" cancelLabel="Cancel" onConfirm={() => onCreate({ tag, label, signalType, unit: unitToString(unit), writable, logEnabled: logMode !== 0, logIntervalMs: logMode || undefined, retentionS: logMode ? defaultRetention(logMode) : undefined, value: parseValue(signalType, value), enabled: true })} onClose={onClose}>
      <div className="space-y-4">
        <TextInput fieldPath={`items[${fieldIndex}].tag`} label="Tag" value={tag} error={tagError} onChange={setTag} />
        <TextInput fieldPath={`items[${fieldIndex}].name`} label="Label" value={label} error={nameError} onChange={setLabel} />
        <SignalTypeSelect value={signalType} label onChange={(type) => { setSignalType(type); setValue(String(defaultValue(type))) }} />
        <UnitSelect value={unit} label onChange={setUnit} />
        <ValueInput signalType={signalType} value={value} onChange={setValue} />
         <SelectField label="Diagnostic log mode" value={String(logMode)} options={logOptions.map((option) => [String(option.value), option.label])} onChange={(raw) => setLogMode(Number(raw))} />
        <CheckField label="Writable" checked={writable} onChange={setWritable} />
        {saving && <div className="text-xs text-[var(--c-text-dim)]">Saving...</div>}
      </div>
    </Modal>
  )
}

function SignalTypeSelect({ value, label, onChange }: { value: VirtualPointSignalType; label?: boolean; onChange: (value: VirtualPointSignalType) => void }) {
  return <SelectField label={label ? 'Signal Type' : undefined} value={value} options={signalTypes.map((type) => [type, virtualSignalLabel(type)])} onChange={(raw) => onChange(raw as VirtualPointSignalType)} />
}

function VirtualPointOverviewModal({ open, items, livePoints, onEdit, onDelete, onClose }: { open: boolean; items: VirtualPoint[]; livePoints: Point[]; onEdit: (id: string) => void; onDelete: (id: string) => void; onClose: () => void }) {
  const { t, pick } = useI18n()
  const logLabel = (item: VirtualPoint) => {
    if (!item.logEnabled) return 'Off'
    const match = logOptions.find((option) => option.value === item.logIntervalMs)
    return match?.label ?? `${item.logIntervalMs}ms`
  }
  return (
    <Modal open={open} size="xl" title={t('overview')} onClose={onClose}>
      <div className="max-h-[70vh] overflow-auto rounded-[var(--radius)] border border-[var(--c-border)]">
        <table className="w-full min-w-[800px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--c-surface-2)] text-xs uppercase text-[var(--c-text-dim)]">
            <tr>
              <th className="border-b border-[var(--c-border)] px-3 py-2 text-left">Ch</th>
              <th className="border-b border-[var(--c-border)] px-3 py-2 text-left">Tag / Name</th>
              <th className="border-b border-[var(--c-border)] px-3 py-2 text-left">Signal</th>
              <th className="border-b border-[var(--c-border)] px-3 py-2 text-left">Value</th>
              <th className="border-b border-[var(--c-border)] px-3 py-2 text-left">Unit</th>
              <th className="border-b border-[var(--c-border)] px-3 py-2 text-left">Range</th>
              <th className="border-b border-[var(--c-border)] px-3 py-2 text-left">En/Wr</th>
              <th className="border-b border-[var(--c-border)] px-3 py-2 text-left">Log</th>
              <th className="border-b border-[var(--c-border)] px-3 py-2 text-right" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const live = findLivePoint(livePoints, item.id)
              const unit = item.unit ? unitLabel(unitFromString(item.unit), t) : '--'
              return (
                <tr key={item.id} className="border-t border-[var(--c-border)] hover:bg-[var(--c-surface-2)]">
                  <td className="px-3 py-2 font-mono text-xs">{item.channel || globalVirtualPointChannel(item.id)}</td>
                  <td className="px-3 py-2">
                    <span className="block font-semibold text-[var(--c-text)]">{item.tag}</span>
                    <span className="block text-xs text-[var(--c-text-dim)]">{item.label}</span>
                  </td>
                  <td className="px-3 py-2 font-mono uppercase text-xs">{item.signalType}</td>
                  <td className="px-3 py-2">
                    <span className="font-mono font-semibold">{formatPointValue({ value: live?.value ?? item.value ?? defaultValue(item.signalType), unit: item.unit, signalType: item.signalType, stateLabel: live?.stateLabel })}</span>
                    <span className="ml-2 text-xs text-[var(--c-text-dim)]">{live?.quality ?? 'good'}</span>
                  </td>
                  <td className="px-3 py-2 text-xs">{unit}</td>
                  <td className="px-3 py-2 font-mono text-xs">{numberOr(item.displayMin, 0)}–{numberOr(item.displayMax, 100)}</td>
                  <td className="px-3 py-2 text-xs">
                    <span className={item.enabled ? 'text-[var(--c-good-fg)]' : 'text-[var(--c-text-dim)]'}>{item.enabled ? 'EN' : 'OFF'}</span>
                    <span className="mx-1 text-[var(--c-text-dim)]">/</span>
                    <span className={virtualPointWritable(item) ? 'text-[var(--c-good-fg)]' : 'text-[var(--c-text-dim)]'}>{virtualPointWritable(item) ? 'WR' : 'RO'}</span>
                    {virtualPointOwner(item) === 'PROGRAM' && <span className="ml-1 rounded bg-[var(--c-surface-2)] px-1 text-[10px] font-semibold text-[var(--c-text-dim)]" title={t('ownerProgram')}>PGM</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">{logLabel(item)}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => onEdit(item.id)}>{pick('Sửa', 'Edit')}</Button>
                      <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => onDelete(item.id)}>{pick('Xoá', 'Delete')}</Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}

function UnitSelect({ value, label, onChange }: { value: number; label?: boolean; onChange: (value: number) => void }) {
  const { t } = useI18n()
  return <SelectField label={label ? t('unitsLabel') : undefined} value={String(value)} options={unitOptions.map((option) => [String(option), unitLabel(option, t)])} onChange={(raw) => onChange(Number(raw))} />
}

function RangeMultiplierSelect({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { t } = useI18n()
  return <SelectField value={String(value)} options={rangeMultiplierOptions.map((option) => [String(option), rangeLabel(option, t)])} onChange={(raw) => onChange(Number(raw))} />
}

function MathFunctionSelect({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { t } = useI18n()
  return <SelectField value={String(value)} options={mathFunctionOptions.map((option) => [String(option), mathFunctionLabel(option, t)])} onChange={(raw) => onChange(Number(raw))} />
}

function ValueInput({ signalType, value, compact, onChange }: { signalType: VirtualPointSignalType; value: string; compact?: boolean; onChange: (value: string) => void }) {
  if (signalType === 'boolean') {
    return <SelectField label={compact ? undefined : 'Value'} value={value === 'true' ? 'true' : 'false'} options={[['false', 'False'], ['true', 'True']]} onChange={onChange} />
  }
  const type = signalType === 'integer' || signalType === 'float' ? 'number' : 'text'
  return <TextInput label={compact ? '' : 'Value'} value={value} type={type} onChange={onChange} />
}

function TextInput({ label, value, type = 'text', disabled, error, fieldPath, onChange }: { label: string; value: string; type?: string; disabled?: boolean; error?: string; fieldPath?: string; onChange: (value: string) => void }) {
  const errorId = error ? `${label.toLowerCase().replace(/\s+/g, '-')}-error` : undefined
  return (
    <label className="block space-y-2">
      {label && <span className="text-sm font-semibold text-[var(--c-text)]">{label}</span>}
      <input type={type} disabled={disabled} data-point-field={fieldPath} aria-invalid={Boolean(error)} aria-describedby={errorId} className={controlClass()} value={value} onChange={(event) => onChange(event.target.value)} />
      {error && <span id={errorId} role="alert" className="block text-xs text-[var(--c-fault-fg)]">{error}</span>}
    </label>
  )
}

/* `ISS-PIO-15` — dải hợp lệ của THANG HIỂN THỊ phụ thuộc `unit`.
 *
 * Bản cũ ghi cứng [-50, 205] cho MỌI unit, khớp dải cảm biến nhiệt độ. Nhưng
 * web-api cho phép `Pa` tới 2000 và `ppm` tới 5000, nên một setpoint áp suất
 * tĩnh 250 Pa hợp lệ ở backend lại bị `clampNumber` ở đây KẸP xuống 205 —
 * người dùng gõ 250, ô nhập hiện 205, và không có thông báo nào. Đúng lớp lỗi
 * mà `ISS-PIO-15` sinh ra để dẹp, chỉ khác là nó nằm ở frontend.
 *
 * Giữ đồng bộ với `virtualPointDisplayRangeLimits` (web-api/internal/app/virtualpoint.go). */
export function displayRangeLimits(unit?: string): [number, number] {
  if (unit === 'Pa') return [-50, 2000]
  if (unit === 'ppm') return [0, 5000]
  return [-50, 205]
}

/* Ô nhập biên KỸ THUẬT: cho phép để TRỐNG.
 *
 * Trống là một trạng thái có nghĩa — "không khai biên" — chứ không phải số 0.
 * Dùng `SmallNumberInput` ở đây sẽ ép mọi điểm phải có biên và biến ô trống
 * thành 0, tức lặng lẽ cấm mọi giá trị âm trên mọi điểm chưa cấu hình gì. */
export function OptionalNumberInput({ value, disabled, label, onChange }: { value?: number; disabled?: boolean; label: string; onChange: (value: number | undefined) => void }) {
  return (
    <input
      className={controlClass()}
      type="number"
      step="any"
      aria-label={label}
      disabled={disabled}
      placeholder="—"
      value={value === undefined || value === null || Number.isNaN(value) ? '' : String(value)}
      onChange={(event) => {
        const raw = event.currentTarget.value.trim()
        if (raw === '') { onChange(undefined); return }
        const next = Number(raw)
        onChange(Number.isFinite(next) ? next : undefined)
      }}
    />
  )
}

/* `ISS-PIO-16` — ô chọn CHỦ SỞ HỮU giá trị của điểm ảo (F-PIO-017, đề bài §16).
 *
 * Backend tách đúng hai trục từ lâu — `writable` ("operator có được phép sửa
 * không") và `source` ("AI GHI slot") — nhưng trục thứ hai chưa từng có mặt ở
 * giao diện. Hậu quả: người kỹ sư thấy một VP chỉ đọc và không có bất kỳ manh
 * mối nào vì sao, đúng khiếu nại của F-PIO-017.
 *
 * `PROGRAM` bị KHOÁ khi điểm chưa gắn slot Core: quyền sở hữu chỉ có nghĩa khi
 * có một slot để sở hữu, và backend cũng từ chối đúng như vậy. Khoá kèm lời
 * giải thích tốt hơn là để người dùng chọn rồi nhận 400 mà không hiểu. */
export function OwnerField({ item, onChange }: { item: VirtualPoint; onChange: (patch: Partial<VirtualPoint>) => void }) {
  const { t } = useI18n()
  const owner = virtualPointOwner(item)
  const canProgram = Boolean(item.boundPointId) || owner === 'PROGRAM'
  return (
    <div className="space-y-2">
      <select
        aria-label={t('ownerLabel')}
        className={controlClass()}
        value={owner}
        onChange={(event) => onChange({ source: event.target.value as VirtualPointSource })}
      >
        <option value="WEB">{t('ownerWeb')}</option>
        <option value="PROGRAM" disabled={!canProgram}>{t('ownerProgram')}</option>
      </select>
      <p className="text-xs text-[var(--c-text-dim)]">{t('ownerHint')}</p>
      {!canProgram && <p className="text-xs text-[var(--c-warn-fg)]">{t('ownerNeedsBound')}</p>}
    </div>
  )
}

/** `ISS-PIO-16` — chủ sở hữu hiệu lực. Vắng mặt = `WEB`, khớp cách backend
 *  chuẩn hoá; giao diện không được tự nghĩ ra nghĩa thứ ba cho chuỗi rỗng. */
export function virtualPointOwner(item: Pick<VirtualPoint, 'source'>): VirtualPointSource {
  return item.source === 'PROGRAM' ? 'PROGRAM' : 'WEB'
}

/** `ISS-PIO-16` — operator có THẬT SỰ ghi được điểm này không.
 *
 *  `writable` một mình không trả lời được: một VP `writable: true` do chương
 *  trình sở hữu vẫn bị backend từ chối mọi lệnh ghi. Dựng nút Write theo cờ thô
 *  là dựng một nút bấm vào không có gì xảy ra. */
export function virtualPointWritable(item: Pick<VirtualPoint, 'source' | 'writable'>): boolean {
  return Boolean(item.writable) && virtualPointOwner(item) !== 'PROGRAM'
}

function SmallNumberInput({ value, min, max, step = 1, disabled, onChange }: { value: number; min: number; max: number; step?: number; disabled?: boolean; onChange: (value: number) => void }) {
  return (
    <input
      className={controlClass()}
      type="number"
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      value={clampNumber(value, min, max)}
      onChange={(event) => onChange(clampNumber(event.currentTarget.valueAsNumber, min, max))}
    />
  )
}

function SelectField({ label, value, options, onChange }: { label?: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
  return (
    <label className={label ? 'block space-y-2' : 'block'}>
      {label && <span className="text-sm font-semibold text-[var(--c-text)]">{label}</span>}
      <select aria-label={label ?? 'value'} className={controlClass()} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
    </label>
  )
}

function CheckField({ label, checked, disabled, hint, onChange }: { label: string; checked: boolean; disabled?: boolean; hint?: string; onChange: (value: boolean) => void }) {
  return (
    <div>
      <label className="flex min-h-10 items-center gap-2 text-sm font-medium text-[var(--c-text)]">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
        {label}
      </label>
      {hint && <p className="text-xs text-[var(--c-text-dim)]">{hint}</p>}
    </div>
  )
}

function LiveDataItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3">
      <dt className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{label}</dt>
      <dd className="mt-1 min-h-8 break-words font-mono text-xl font-semibold text-[var(--c-text)]">{value}</dd>
    </div>
  )
}

function ModeButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return <button type="button" className={cn('inline-flex h-8 items-center gap-2 rounded-[calc(var(--radius)-4px)] px-3 text-xs font-semibold transition', active ? 'bg-[var(--c-surface-2)] text-[var(--c-text)]' : 'text-[var(--c-text-dim)] hover:text-[var(--c-text)]')} onClick={onClick}>{icon}{label}</button>
}

function FieldHeader({ label, wired }: { label: string; wired?: boolean }) {
  return (
    <span className="flex items-center gap-2 text-sm font-semibold text-[var(--c-text)]">
      {label}
      <ModeBadge wired={wired} />
    </span>
  )
}

function ModeBadge({ wired }: { wired?: boolean }) {
  return (
    <span className={cn('rounded-[var(--radius)] border px-2 py-0.5 text-center text-[10px] font-bold uppercase', wired ? 'border-[var(--c-good)] bg-[var(--c-good-bg)] text-[var(--c-good-fg)]' : 'border-[var(--c-border)] bg-[var(--c-surface-2)] text-[var(--c-text-dim)]')}>
      {wired ? 'wired' : 'demo'}
    </span>
  )
}

function quotaUsage(items: VirtualPoint[]): Record<(typeof logOptions)[number]['value'], number> {
  return {
    0: items.filter((item) => !item.logEnabled).length,
    1000: items.filter((item) => item.logEnabled && item.logIntervalMs === 1000).length,
    100: items.filter((item) => item.logEnabled && item.logIntervalMs === 100).length,
    10: items.filter((item) => item.logEnabled && item.logIntervalMs === 10).length
  }
}

export function normalizeVirtualPoint(item: VirtualPoint): VirtualPoint {
  const signalType = signalTypes.includes(item.signalType) ? item.signalType : 'float'
  const logEnabled = canLog(signalType) && item.logEnabled
  const logIntervalMs = logEnabled ? item.logIntervalMs ?? 1000 : undefined
  const unit = unitToString(unitFromString(item.unit))
  const [displayLow, displayHigh] = displayRangeLimits(unit)
  const id = canonicalVirtualPointId(item.id)
  const name = displayPointName(item.label ?? item.name, id || item.tag || 'VP')
  return {
    ...item,
    id,
    channel: item.channel || globalVirtualPointChannel(item.id),
    tag: normalizePointTag(item.tag ?? canonicalVirtualPointId(item.id)),
    name,
    label: name,
    signalType,
    unit,
    displayMin: clampNumber(numberOr(item.displayMin, 0), displayLow, displayHigh),
    displayMax: clampNumber(numberOr(item.displayMax, 100), displayLow, displayHigh),
    ...engineeringLimits(signalType, item.minValue, item.maxValue),
    states: signalType === 'multistate' ? sanitizeStates(item.states) : undefined,
    /* `ISS-PIO-16` — `PROGRAM` chỉ có nghĩa khi còn gắn slot Core; backend từ
     * chối đúng như vậy. Rơi về `WEB` ở đây để form không gửi lên một tổ hợp
     * chắc chắn bị 400. */
    source: item.source === 'PROGRAM' && item.boundPointId ? 'PROGRAM' : 'WEB',
    rangeMultiplier: clampOption(numberOr(item.rangeMultiplier, 0), 0, 5),
    filterSamples: clampOption(numberOr(item.filterSamples, 3), 0, 100),
    sensorCal: clampNumber(numberOr(item.sensorCal, 0), -12.7, 12.8),
    mathFunction: clampOption(numberOr(item.mathFunction, 0), 0, 3),
    logEnabled,
    logIntervalMs,
    retentionS: logEnabled ? item.retentionS ?? defaultRetention(logIntervalMs ?? 1000) : undefined,
    value: parseValue(signalType, String(item.value ?? defaultValue(signalType)))
  }
}

/* `ISS-PIO-17` — biên tập danh sách state (đề bài §15: `0 = Off`, `1 = Auto`,
 * `2 = Manual`, `3 = Emergency`).
 *
 * Sửa tại chỗ, không sắp lại trong lúc gõ: sắp mỗi lần đổi một ký tự sẽ làm
 * hàng nhảy chỗ dưới con trỏ. `sanitizeStates` sắp một lần lúc lưu. */
function StateListEditor({ states, onChange }: { states: VirtualPointState[]; onChange: (states: VirtualPointState[]) => void }) {
  const { pick } = useI18n()
  const duplicateValue = (value: number, index: number) => states.some((state, i) => i !== index && state.value === value)
  const duplicateLabel = (label: string, index: number) =>
    label.trim() !== '' && states.some((state, i) => i !== index && state.label.trim().toLowerCase() === label.trim().toLowerCase())

  function update(index: number, patch: Partial<VirtualPointState>) {
    onChange(states.map((state, i) => (i === index ? { ...state, ...patch } : state)))
  }

  return (
    <div className="space-y-1.5">
      {states.map((state, index) => {
        const badValue = duplicateValue(state.value, index) || !Number.isInteger(state.value) || state.value < 0
        const badLabel = state.label.trim() === '' || duplicateLabel(state.label, index)
        return (
          <div key={index} className="flex items-center gap-1.5">
            <input
              type="number"
              min={0}
              aria-label={pick(`Giá trị state ${index + 1}`, `State ${index + 1} value`)}
              className={cn('h-8 w-16 rounded border bg-[var(--c-bg)] px-2 text-xs text-[var(--c-text)] outline-none', badValue ? 'border-[var(--c-fault)]' : 'border-[var(--c-border)]')}
              value={state.value}
              onChange={(event) => update(index, { value: Math.trunc(Number(event.target.value)) })}
            />
            <input
              aria-label={pick(`Nhãn state ${index + 1}`, `State ${index + 1} label`)}
              className={cn('h-8 min-w-0 flex-1 rounded border bg-[var(--c-bg)] px-2 text-xs text-[var(--c-text)] outline-none', badLabel ? 'border-[var(--c-fault)]' : 'border-[var(--c-border)]')}
              value={state.label}
              onChange={(event) => update(index, { label: event.target.value })}
            />
            <button
              type="button"
              aria-label={pick(`Xoá state ${index + 1}`, `Remove state ${index + 1}`)}
              className="h-8 rounded border border-[var(--c-border)] px-2 text-xs text-[var(--c-text-dim)] disabled:opacity-40"
              disabled={states.length <= 2}
              onClick={() => onChange(states.filter((_, i) => i !== index))}
            >
              ×
            </button>
          </div>
        )
      })}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="h-8 rounded border border-[var(--c-border)] px-2 text-xs text-[var(--c-text)]"
          onClick={() => onChange([...states, { value: nextStateValue(states), label: '' }])}
        >
          + {pick('Thêm state', 'Add state')}
        </button>
        <span className="text-[11px] text-[var(--c-text-dim)]">
          {pick(
            'Ghi vào state không có trong danh sách sẽ bị thiết bị từ chối.',
            'Writing a state outside this list is rejected by the device.'
          )}
        </span>
      </div>
    </div>
  )
}

/** Giá trị đề xuất cho state mới: lớn nhất + 1. Không lấp lỗ trống ở giữa —
 *  `value` là danh tính, và tái dùng một số vừa bị xoá sẽ khiến mọi binding cũ
 *  trỏ tới state mới mà không ai thấy. */
function nextStateValue(states: VirtualPointState[]): number {
  return states.reduce((max, state) => Math.max(max, state.value), -1) + 1
}

function defaultVirtualPoint(): VirtualPoint {
  return { id: '', channel: 0, tag: '', name: '', label: '', signalType: 'float', enabled: true, writable: true, logEnabled: false, value: 0, unit: '', displayMin: 0, displayMax: 100, rangeMultiplier: 0, filterSamples: 3, sensorCal: 0, mathFunction: 0, note: '' }
}

function globalVirtualPointChannel(id: string): number {
  const match = canonicalVirtualPointId(id).match(/^VP(\d+)$/)
  return match ? 24 + Number(match[1]) : 0
}

function signalTypePatch(item: VirtualPoint, signalType: VirtualPointSignalType): Partial<VirtualPoint> {
  return {
    signalType,
    value: defaultValue(signalType),
    logEnabled: canLog(signalType) ? item.logEnabled : false,
    logIntervalMs: canLog(signalType) ? item.logIntervalMs : undefined,
    retentionS: canLog(signalType) ? item.retentionS : undefined,
    /* `ISS-PIO-15` — kiểu tín hiệu không phải số thì biên kỹ thuật không cưỡng
     * chế được gì, và web-api từ chối cấu hình như vậy. Bỏ chúng ở ĐÂY, tại
     * đúng thao tác người dùng vừa làm, thay vì để form gửi lên rồi nhận 400
     * cho một trường họ không hề chạm vào ở lần sửa này. */
    minValue: numericSignalType(signalType) ? item.minValue : undefined,
    maxValue: numericSignalType(signalType) ? item.maxValue : undefined,
    /* `ISS-PIO-17` — cùng lý do với hai dòng trên: `states` chỉ có nghĩa với
     * `multistate`, và web-api coi việc khai nó ở kiểu khác là LỖI cấu hình chứ
     * không phải dữ liệu thừa bị bỏ qua. Đổi SANG multistate thì gieo sẵn ví dụ
     * §15 để form không khởi tạo ở một trạng thái chắc chắn bị từ chối. */
    states: signalType === 'multistate' ? (item.states?.length ? item.states : defaultStates()) : undefined
  }
}

/** `ISS-PIO-17` — dọn danh sách state trước khi gửi: cắt khoảng trắng nhãn, bỏ
 *  state không có nhãn, và sắp theo `value` giống hệt `normalizeVirtualPointStates`
 *  phía web-api. KHÔNG đánh số lại — `value` là danh tính của state.
 *
 *  Danh sách rỗng sau khi dọn thì trả ví dụ §15 chứ không trả `[]`: web-api từ
 *  chối multistate dưới hai state, và gửi `[]` chỉ đổi một form dở dang thành
 *  một lỗi 400. */
export function sanitizeStates(states?: VirtualPointState[]): VirtualPointState[] {
  const cleaned = (states ?? [])
    .map((state) => ({ value: Math.trunc(Number(state.value)), label: state.label.trim() }))
    .filter((state) => Number.isInteger(state.value) && state.value >= 0 && state.label !== '')
    .sort((a, b) => a.value - b.value)
  return cleaned.length > 0 ? cleaned : defaultStates()
}

/** `ISS-PIO-15` — biên kỹ thuật chỉ có nghĩa với kiểu số; khớp
 *  `virtualPointNumericSignalType` phía web-api. */
export function numericSignalType(signalType?: string): boolean {
  return signalType === 'integer' || signalType === 'float'
}

/* engineeringLimits chuẩn hoá cặp biên trước khi gửi lên API.
 *
 * KHÔNG tự đảo min/max khi người dùng gõ ngược: đảo hộ là đoán ý, và một dải bị
 * đảo âm thầm sẽ cưỡng chế đúng cái người dùng không định. Gửi nguyên trạng để
 * web-api từ chối và nói rõ trường nào sai. */
export function engineeringLimits(signalType: string | undefined, minValue?: number, maxValue?: number): { minValue?: number; maxValue?: number } {
  if (!numericSignalType(signalType)) return { minValue: undefined, maxValue: undefined }
  return {
    minValue: Number.isFinite(minValue) ? minValue : undefined,
    maxValue: Number.isFinite(maxValue) ? maxValue : undefined
  }
}

function canonicalVirtualPointId(id: string): string {
  const match = id.trim().toUpperCase().match(/^(?:VP|AV)[-_]?0*(\d+)$/)
  return match ? `VP${Number(match[1])}` : id.trim().toUpperCase()
}

function findLivePoint(points: Point[], id: string): Point | undefined {
  const target = canonicalVirtualPointId(id)
  return points.find((point) => point.kind === 'virtual' && canonicalVirtualPointId(point.id) === target)
}

function canLog(signalType: VirtualPointSignalType): boolean {
  /* `ISS-PIO-17` — `multistate` ghi log được: dưới lớp nhãn nó là số nguyên rời
   * rạc, và lịch sử chuyển chế độ là thứ cần nhất khi truy nguyên sự cố. Khớp
   * `virtualPointLoggableSignalType` phía web-api. */
  return signalType === 'boolean' || signalType === 'integer' || signalType === 'float' || signalType === 'multistate'
}

/** `ISS-PIO-17` — danh sách state MẶC ĐỊNH khi người dùng chuyển sang
 *  `multistate`. Lấy đúng ví dụ của đề bài §15 để form khởi tạo ở một trạng thái
 *  HỢP LỆ: web-api từ chối multistate có dưới hai state, nên một danh sách rỗng
 *  sẽ bắt người dùng nhận 400 trước khi kịp làm gì. */
function defaultStates(): VirtualPointState[] {
  return [
    { value: 0, label: 'Off' },
    { value: 1, label: 'Auto' },
    { value: 2, label: 'Manual' },
    { value: 3, label: 'Emergency' }
  ]
}

function defaultValue(signalType: VirtualPointSignalType): number | boolean | string {
  if (signalType === 'boolean') return false
  if (signalType === 'integer' || signalType === 'float' || signalType === 'multistate') return 0
  if (signalType === 'datetime') return new Date().toISOString()
  return ''
}

export function parseValue(signalType: VirtualPointSignalType, raw: string): number | boolean | string {
  if (signalType === 'boolean') return raw === 'true' || raw === '1' || raw.toUpperCase() === 'ON'
  if (signalType === 'integer') {
    const value = Number(raw)
    if (!Number.isFinite(value)) throw new Error('Value must be an integer')
    return Math.trunc(value)
  }
  if (signalType === 'multistate') {
    /* KHÔNG cắt phần thập phân: `Math.trunc(2.5)` cho 2 — một state có thật —
     * nên cắt ở đây sẽ âm thầm biến `2.5` thành `Manual`. Web-api từ chối đúng
     * như vậy; FE phải nói cùng một điều thay vì gửi lên một giá trị đã bị đổi. */
    const value = Number(raw)
    if (!Number.isInteger(value) || value < 0) throw new Error('State must be a non-negative integer')
    return value
  }
  if (signalType === 'float') {
    const value = Number(raw)
    if (!Number.isFinite(value)) throw new Error('Value must be a number')
    return value
  }
  if (signalType === 'datetime') {
    const value = raw.trim()
    if (Number.isNaN(new Date(value).getTime())) throw new Error('Value must be RFC3339 datetime')
    return new Date(value).toISOString()
  }
  return raw
}

function defaultRetention(intervalMs: number): number {
  if (intervalMs === 10) return 60 * 60
  if (intervalMs === 100) return 7 * 24 * 60 * 60
  return 30 * 24 * 60 * 60
}

function wizardStepLabel(step: WizardStep, t: Translate): string {
  if (step === 'signal') return t('signalTypeLabel')
  if (step === 'min') return t('displayMinLabel')
  if (step === 'max') return t('displayMaxLabel')
  if (step === 'range') return t('rangeMultiplierLabel')
  if (step === 'unit') return t('unitsLabel')
  if (step === 'filter') return t('filterSamplesLabel')
  if (step === 'cal') return t('sensorCalibrationLabel')
  return t('mathFunctionLabel')
}

function wizardStepRegister(step: WizardStep): string {
  if (step === 'signal') return 'u0'
  if (step === 'min') return 'u1'
  if (step === 'max') return 'u2'
  if (step === 'range') return 'u3'
  if (step === 'unit') return 'u4'
  if (step === 'filter') return 'u5'
  if (step === 'cal') return 'u6'
  return 'u7'
}

function wizardStepValue(step: WizardStep, item: VirtualPoint, t: Translate): string {
  if (step === 'signal') return virtualSignalLabel(item.signalType)
  if (step === 'min') return String(numberOr(item.displayMin, 0))
  if (step === 'max') return String(numberOr(item.displayMax, 100))
  if (step === 'range') return rangeLabel(numberOr(item.rangeMultiplier, 0), t)
  if (step === 'unit') return unitLabel(unitFromString(item.unit), t)
  if (step === 'filter') return String(numberOr(item.filterSamples, 3))
  if (step === 'cal') return String(numberOr(item.sensorCal, 0))
  return mathFunctionLabel(numberOr(item.mathFunction, 0), t)
}

function virtualSignalLabel(value: VirtualPointSignalType): string {
  if (value === 'boolean') return 'Boolean'
  if (value === 'integer') return 'Integer'
  if (value === 'float') return 'Float'
  if (value === 'datetime') return 'DateTime'
  if (value === 'multistate') return 'Multistate'
  return 'String'
}

function unitLabel(value: number, t: Translate): string {
  if (value === 1) return t('unit1')
  if (value === 2) return t('unit2')
  if (value === 3) return t('unit3')
  if (value === 4) return t('unit4')
  return t('unit0')
}

function rangeLabel(value: number, t: Translate): string {
  if (value === 1) return t('rangeMultiplier1')
  if (value === 2) return t('rangeMultiplier2')
  if (value === 3) return t('rangeMultiplier3')
  if (value === 4) return t('rangeMultiplier4')
  if (value === 5) return t('rangeMultiplier5')
  return t('rangeMultiplier0')
}

function mathFunctionLabel(value: number, t: Translate): string {
  if (value === 1) return t('mathFunction1')
  if (value === 2) return t('mathFunction2')
  if (value === 3) return t('mathFunction3')
  return t('mathFunction0')
}

function unitFromString(unit?: string): number {
  const text = String(unit ?? '').toLowerCase()
  if (text === 'percent' || text === '%' || text === '%rh') return 1
  if (text === 'degc' || text === 'degf' || text === 'c' || text === 'f') return 2
  if (text === 'pa' || text === 'pascal') return 3
  if (text === 'ppm') return 4
  return 0
}

function unitToString(unit: number): string {
  if (unit === 1) return 'percent'
  if (unit === 2) return 'degC'
  if (unit === 3) return 'Pa'
  if (unit === 4) return 'ppm'
  return ''
}

function numberOr(value: unknown, fallback: number): number {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

function clampOption(value: number, min: number, max: number): number {
  return Math.round(clampNumber(value, min, max))
}

function clampNumber(value: number, min: number, max: number): number {
  const finite = Number.isFinite(value) ? value : min
  return Math.min(max, Math.max(min, finite))
}

function controlClass(): string {
  return 'h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)] disabled:cursor-not-allowed disabled:opacity-60'
}
