import { BellRing, LayoutDashboard, Languages, Rows3, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth'
import {
  AlarmTone,
  alarmSoundKey,
  readAlarmSoundPreference,
  resolveAlarmSoundState,
  writeAlarmSoundPreference,
  type AlarmSoundState
} from '../../shared/alarms/annunciation'
import { apiClient } from '../../shared/api/client'
import { Button } from '../../shared/components/Button'
import { Panel } from '../../shared/components/Panel'
import { useToast } from '../../shared/components/Toast'
import { useApi } from '../../shared/hooks/useApi'
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

      <AlarmSoundPanel />

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

/**
 * Âm báo cảnh báo — `T57-1.5`, thi hành `ADR-034`.
 *
 * Ba điều của ADR được thi hành ở đây, không điều nào là tuỳ chọn:
 *
 *  - **Điều 2**: bật âm chỉ qua MỘT nút, và nút đó vừa lưu tuỳ chọn vừa
 *    `resume()` `AudioContext` vừa phát tông thử trong cùng một tick. Không có
 *    đường nào bật âm mà không phát thử — một tuỳ chọn "đã bật" chưa từng kêu
 *    là một tuỳ chọn không ai biết là hỏng.
 *  - **Điều 3**: hiện đủ **ba** trạng thái. `BỊ TRÌNH DUYỆT CHẶN` là trạng thái
 *    thật và thường gặp: sau khi tải lại trang, `AudioContext` quay về
 *    `suspended` và không có cử chỉ nào để mở khoá. Hiện "đã bật" lúc đó là
 *    khẳng định hệ thống sẽ kêu trong khi nó không thể kêu.
 *  - **Điều 6**: lưu ở `localStorage` theo cặp (thiết bị, tài khoản) vì chưa có
 *    endpoint tuỳ chọn người dùng (`T57-3.2`, Wave 3).
 */
function AlarmSoundPanel() {
  const { pick } = useI18n()
  const { session } = useAuth()
  const toast = useToast()
  const health = useApi(apiClient.getHealth, [])
  const soundKey = alarmSoundKey(health.data?.deviceName ?? '', session?.username ?? '')

  const toneRef = useRef<AlarmTone | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [contextState, setContextState] = useState<AudioContextState | undefined>(undefined)

  useEffect(() => { setEnabled(readAlarmSoundPreference(soundKey)) }, [soundKey])
  useEffect(() => () => { toneRef.current?.close() }, [])

  const state: AlarmSoundState = resolveAlarmSoundState(enabled, contextState)

  async function armAndTest() {
    if (!toneRef.current) toneRef.current = new AlarmTone()
    const next = await toneRef.current.arm()
    setContextState(next)
    if (next === 'running') {
      toneRef.current.play()
      setEnabled(true)
      writeAlarmSoundPreference(soundKey, true)
      toast.push('success', pick('Đã bật âm báo và phát tông thử', 'Alarm sound enabled and a test tone was played'))
      return
    }
    /* Bật tuỳ chọn NHƯNG không khẳng định là nó sẽ kêu: `state` sẽ ra
       `BỊ TRÌNH DUYỆT CHẶN` và giao diện nói đúng như vậy. */
    setEnabled(true)
    writeAlarmSoundPreference(soundKey, true)
    toast.push('warn', pick(
      'Trình duyệt chưa cho phát âm. Tuỳ chọn đã lưu nhưng âm báo hiện KHÔNG kêu được.',
      'The browser is still blocking audio. The preference was saved but the alarm sound cannot play.'
    ))
  }

  function disable() {
    setEnabled(false)
    setContextState(undefined)
    toneRef.current?.close()
    toneRef.current = null
    writeAlarmSoundPreference(soundKey, false)
    toast.push('success', pick('Đã tắt âm báo cảnh báo', 'Alarm sound disabled'))
  }

  const badge = {
    off: { label: pick('TẮT', 'OFF'), fg: 'var(--c-text-dim)', bg: 'var(--c-off-bg)', border: 'var(--c-border)', Icon: VolumeX },
    armed: { label: pick('ĐANG BẬT', 'ARMED'), fg: 'var(--c-good-fg)', bg: 'var(--c-good-bg)', border: 'var(--c-good)', Icon: Volume2 },
    blocked: { label: pick('BỊ TRÌNH DUYỆT CHẶN', 'BLOCKED BY BROWSER'), fg: 'var(--c-warn-fg)', bg: 'var(--c-warn-bg)', border: 'var(--c-warn)', Icon: BellRing }
  }[state]
  const BadgeIcon = badge.Icon

  return (
    <Panel
      title={pick('Âm báo cảnh báo', 'Alarm sound')}
      subtitle={pick(
        'Lớp nhấp nháy luôn bật và không tắt được; âm thanh là lớp tăng cường, mặc định TẮT.',
        'The visual flash is always on and cannot be disabled; sound is an additional layer, off by default.'
      )}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold">{pick('Trạng thái kênh âm thanh', 'Audio channel state')}</span>
          <span
            role="status"
            className="inline-flex items-center gap-1.5 rounded-[var(--radius)] border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide"
            style={{ color: badge.fg, backgroundColor: badge.bg, borderColor: badge.border }}
          >
            <BadgeIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {badge.label}
          </span>
        </div>

        {state === 'blocked' && (
          <p role="alert" className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] px-3 py-2 text-sm text-[var(--c-warn-fg)]">
            {pick(
              'Trình duyệt chặn phát âm khi chưa có thao tác của người dùng trên trang. Tuỳ chọn đã bật nhưng âm báo hiện KHÔNG kêu được — bấm "Bật và kiểm tra âm" để mở khoá lại. Trạng thái này xuất hiện sau mỗi lần tải lại trang, kể cả khi bo tự khởi động lại.',
              'The browser blocks audio until the user interacts with the page. The preference is on but the sound cannot play — press "Enable and test sound" to unlock it again. This state appears after every page reload, including automatic restarts.'
            )}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => { void armAndTest() }}>
            {pick('Bật và kiểm tra âm', 'Enable and test sound')}
          </Button>
          <Button variant="secondary" disabled={!enabled} onClick={disable}>
            {pick('Tắt âm báo', 'Disable sound')}
          </Button>
        </div>

        <p className="text-xs text-[var(--c-text-dim)]">
          {pick(
            'Tuỳ chọn lưu trên trình duyệt này, theo từng thiết bị và từng tài khoản — chưa đồng bộ xuống bo. Trên màn hình treo tường, kênh âm thanh sẽ ở trạng thái "bị trình duyệt chặn" cho tới khi có người chạm vào màn hình; đó là giới hạn của nền tảng, không phải lỗi cấu hình.',
            'The preference lives in this browser, per device and per account — it is not synced to the controller. On a wall-mounted display the audio channel stays "blocked by browser" until somebody touches the screen; that is a platform limit, not a configuration fault.'
          )}
        </p>
      </div>
    </Panel>
  )
}