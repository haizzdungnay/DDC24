import { LayoutDashboard, Languages, Rows3 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../shared/components/Button'
import { Panel } from '../../shared/components/Panel'
import { useToast } from '../../shared/components/Toast'
import { useI18n } from '../../shared/i18n'
import type { Language } from '../../shared/types'

export function DisplaySettingsPage() {
  const { lang, setLang, pick } = useI18n()
  const [draftLang, setDraftLang] = useState<Language>(lang)
  const [density, setDensity] = useState('comfortable')
  const toast = useToast()

  const densityOptions = [
    { id: 'comfortable', label: pick('Thoải mái', 'Comfortable'), detail: pick('Khoảng cách rộng cho vận hành tại bàn trực.', 'Wider spacing for operator console use.') },
    { id: 'compact', label: pick('Gọn', 'Compact'), detail: pick('Mật độ cao hơn cho màn hình giám sát.', 'Higher density for monitoring screens.') }
  ]

  function save() {
    setLang(draftLang)
    toast.push('success', pick('Đã lưu cấu hình hiển thị (demo)', 'Display settings saved (demo)'))
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{pick('Hiển thị', 'Display')}</h1>
          <p className="text-sm text-[var(--c-text-dim)]">{pick('Ngôn ngữ, mật độ hiển thị và ghi chú theme ISA-101', 'Language, display density, and ISA-101 theme notes')}</p>
        </div>
        <Button variant="primary" onClick={save}>{pick('Lưu', 'Save')}</Button>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title={pick('Ngôn ngữ', 'Language')} subtitle={pick('Áp dụng cho nhãn giao diện demo.', 'Applies to demo UI labels.')}>
          <div className="grid grid-cols-2 gap-3">
            {(['vi', 'en'] as const).map((item) => (
              <button key={item} type="button" onClick={() => setDraftLang(item)} className={`rounded-[var(--radius)] border p-4 text-left transition ${draftLang === item ? 'border-[var(--c-line-strong)] bg-[var(--c-surface-2)]' : 'border-[var(--c-border)] bg-[var(--c-surface)] hover:bg-[var(--c-surface-2)]'}`}>
                <Languages className="h-5 w-5 text-[var(--c-accent)]" />
                <div className="mt-3 font-semibold">{item === 'vi' ? 'Tiếng Việt' : 'English'}</div>
                <div className="mt-1 text-xs text-[var(--c-text-dim)]">{item === 'vi' ? 'Nhãn tiếng Việt cho phòng máy' : 'English labels for demo review'}</div>
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="Theme" subtitle={pick('Level B hybrid cố định theo ADR-009.', 'Fixed Level B hybrid per ADR-009.')}>
          <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-4">
            <LayoutDashboard className="h-5 w-5 text-[var(--c-accent)]" />
            <div className="mt-3 font-semibold">ISA-101 Level B hybrid</div>
            <p className="mt-1 text-sm text-[var(--c-text-dim)]">{pick('Nền xám sáng trung tính, chữ tối. Màu trạng thái theo quy ước SCADA: xanh = ON/normal, xám = OFF, vàng = cảnh báo, đỏ = lỗi.', 'Neutral light-gray background with dark text. Status colors follow SCADA convention: green = ON/normal, gray = OFF, yellow = warning, red = fault.')}</p>
          </div>
        </Panel>
      </div>

      <Panel title={pick('Mật độ hiển thị', 'Display density')} subtitle={pick('Demo local, chưa ghi xuống thiết bị.', 'Local demo only, not written to device.')}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {densityOptions.map((option) => (
            <button key={option.id} type="button" onClick={() => setDensity(option.id)} className={`rounded-[var(--radius)] border p-4 text-left transition ${density === option.id ? 'border-[var(--c-line-strong)] bg-[var(--c-surface-2)]' : 'border-[var(--c-border)] bg-[var(--c-surface)] hover:bg-[var(--c-surface-2)]'}`}>
              <Rows3 className="h-5 w-5 text-[var(--c-accent)]" />
              <div className="mt-3 font-semibold">{option.label}</div>
              <div className="mt-1 text-sm text-[var(--c-text-dim)]">{option.detail}</div>
            </button>
          ))}
        </div>
      </Panel>
    </div>
  )
}