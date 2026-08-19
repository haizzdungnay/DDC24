import type { DraftDiffRow } from '../../shared/components/DraftDiffTable'
import type { AiInputConfig } from '../../shared/types'
import { uiNode } from '../../shared/utils'

type PickText = (vi: string, en: string) => string

/**
 * Khác biệt "đang lưu ↔ bản nháp" cho cấu hình ngõ vào — `T57-2.10` (khối `BB-8`).
 *
 * VÌ SAO CẦN
 *
 * Hộp thoại lưu của trang Ngõ vào trước đây chỉ hỏi "Bạn có muốn lưu thay đổi
 * không?". Với 16 kênh, một phiên chỉnh sửa dài, và `T57-2.11` (sao chép cấu
 * hình sang nhiều kênh) có thể ghi đè hàng chục trường trong một cú bấm, câu
 * hỏi đó không trả lời được câu duy nhất người vận hành cần trả lời trước khi
 * cấu hình đi xuống thiết bị: **cái gì sắp đổi?**
 *
 * Đây cũng là lớp chặn cuối cho đúng lớp lỗi mà `T57-2.11` tạo ra: chọn nhầm
 * kênh đích thì thấy ngay ở đây, trước khi ghi.
 *
 * LUẬT
 *
 *  1. Chỉ liệt kê trường **thật sự khác**. So sánh trên chuỗi ĐÃ hiển thị, nên
 *     hai cách viết của cùng một giá trị (`23` với `23.0`) không bị báo là đổi.
 *  2. Bốn trường danh tính (`channel`, `tag`) không nằm trong danh sách so
 *     sánh — chúng được chuẩn hoá lại lúc lưu, báo "đổi" ở đây là báo nhiễu.
 *  3. Kênh có trong bản nháp mà không có trong bản đã lưu ⇒ một hàng "Kênh
 *     mới", không im lặng bỏ qua.
 */
export function aiInputDraftDiff(saved: AiInputConfig[], draft: AiInputConfig[], pick: PickText): DraftDiffRow[] {
  const savedByChannel = new Map(saved.map((config) => [config.channel, config]))
  const rows: DraftDiffRow[] = []

  for (const next of [...draft].sort((left, right) => left.channel - right.channel)) {
    const group = uiNode(next.channel)
    const previous = savedByChannel.get(next.channel)
    if (!previous) {
      rows.push({ group, label: pick('Kênh mới', 'New channel'), from: '—', to: next.label || group })
      continue
    }
    for (const field of comparedFields) {
      const from = field.format(previous, pick)
      const to = field.format(next, pick)
      if (from !== to) rows.push({ group, label: field.label(pick), from, to })
    }
  }

  for (const previous of saved) {
    if (draft.some((config) => config.channel === previous.channel)) continue
    rows.push({
      group: uiNode(previous.channel),
      label: pick('Kênh bị gỡ', 'Channel removed'),
      from: previous.label || uiNode(previous.channel),
      to: '—'
    })
  }

  return rows
}

interface ComparedField {
  label: (pick: PickText) => string
  format: (config: AiInputConfig, pick: PickText) => string
}

/* Giá trị hiển thị, không phải giá trị thô: người đọc phải nhận ra "Trung bình
   (Avg) → Lớn nhất (Max)", không phải "1 → 3". Số mã hoá chỉ có nghĩa với người
   viết firmware. */
const comparedFields: ComparedField[] = [
  { label: (pick) => pick('Tên', 'Name'), format: (config) => config.label || '—' },
  { label: (pick) => pick('Trạng thái', 'State'), format: (config, pick) => config.enabled ? pick('Bật', 'Enabled') : pick('Tắt', 'Disabled') },
  { label: (pick) => pick('Loại tín hiệu', 'Signal type'), format: (config, pick) => signalTypeText(config, pick) },
  { label: (pick) => pick('Giá trị hiển thị đầu thấp', 'Display low end'), format: (config) => String(config.displayMin) },
  { label: (pick) => pick('Giá trị hiển thị đầu cao', 'Display high end'), format: (config) => String(config.displayMax) },
  { label: (pick) => pick('Đơn vị kỹ thuật', 'Engineering unit'), format: (config, pick) => unitText(config.unit, pick) },
  { label: (pick) => pick('Hệ số dải đo', 'Range multiplier'), format: (config, pick) => multiplierText(config.rangeMultiplier, pick) },
  { label: (pick) => pick('Số mẫu lọc', 'Filter samples'), format: (config) => String(config.filterSamples) },
  { label: (pick) => pick('Bù cảm biến', 'Sensor calibration'), format: (config) => String(config.sensorCal) },
  { label: (pick) => pick('Hàm toán', 'Math function'), format: (config, pick) => mathText(config.mathFunction, pick) },
  { label: (pick) => pick('Ghi chú', 'Note'), format: (config) => config.note || '—' }
]

function signalTypeText(config: AiInputConfig, pick: PickText): string {
  const names: Record<number, string> = {
    0: pick('Chưa cấu hình', 'Not configured'),
    1: pick('Điện áp 0-10 V', 'Voltage 0-10 V'),
    2: config.analogCurrent ? pick('Dòng 4-20 mA', 'Current 4-20 mA') : pick('Điện áp 2-10 V', 'Voltage 2-10 V'),
    3: pick('Điện trở / nhiệt điện trở', 'Resistance / thermistor'),
    4: pick('Tiếp điểm khô NO', 'Dry contact NO'),
    5: pick('Tiếp điểm khô NC', 'Dry contact NC'),
    6: pick('Chiết áp', 'Potentiometer'),
    7: pick('Cảm biến ánh sáng', 'Light sensor'),
    8: pick('Xung', 'Pulse')
  }
  const base = names[config.signalType] ?? `#${config.signalType}`
  /* `ioType` là biến thể cảm biến (`NTC20k`, `PT1000`) mà FE giữ nguyên khi
     round-trip. Nó đổi thì hành vi đo đổi, nên phải nằm trong diff. */
  return config.ioType ? `${base} · ${config.ioType}` : base
}

function unitText(value: number, pick: PickText): string {
  if (value === 1) return '%'
  if (value === 2) return '°C / °F'
  if (value === 3) return 'Pa'
  if (value === 4) return 'ppm'
  return pick('Không hiển thị', 'Not shown')
}

function multiplierText(value: number, pick: PickText): string {
  if (value === 1) return 'x10 (-500..2050)'
  if (value === 2) return 'x100 (-5000..20500)'
  if (value === 3) return pick('Căn bậc hai (-50..205)', 'Square root (-50..205)')
  if (value === 4) return pick('Căn bậc hai x10 (-500..2050)', 'Square root x10 (-500..2050)')
  if (value === 5) return pick('Căn bậc hai x100 (-5000..20500)', 'Square root x100 (-5000..20500)')
  return 'x1 (-50..205)'
}

function mathText(value: number, pick: PickText): string {
  if (value === 1) return pick('Trung bình (Avg)', 'Average (Avg)')
  if (value === 2) return pick('Nhỏ nhất (Min)', 'Minimum (Min)')
  if (value === 3) return pick('Lớn nhất (Max)', 'Maximum (Max)')
  return pick('Không hoạt động', 'Not active')
}
