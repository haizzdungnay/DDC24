import { BookOpen, ChevronRight, CircleHelp, ExternalLink, ShieldCheck, Wrench } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Panel } from '../../shared/components/Panel'
import { useI18n } from '../../shared/i18n'

/**
 * Mục trợ giúp theo NGỮ CẢNH — `T57-2.17`.
 *
 * Trợ giúp không theo ngữ cảnh gần như không được dùng trên thiết bị nhúng:
 * người đang kẹt ở một trang cụ thể sẽ không đọc hết ba thẻ tổng quát để tìm
 * đoạn liên quan. `?topic=` cho phép mọi trang mở thẳng tới mục của nó.
 *
 * Khoá `topic` cố ý trùng đường dẫn route để không phải bảo trì hai bảng tên.
 */
const CONTEXT_TOPICS: Record<string, { vi: string; en: string; bodyVi: string; bodyEn: string }> = {
  '/monitor': {
    vi: 'Giám sát điểm I/O', en: 'Monitoring I/O points',
    bodyVi: 'Bộ lọc nằm trong đường dẫn nên gửi được cho đồng nghiệp. Lệnh ép tay có thời hạn do bộ điều khiển cưỡng chế, không phải do trình duyệt — đóng tab không làm lệnh ở lại.',
    bodyEn: 'Filters live in the URL so they can be shared. Manual overrides carry a duration enforced by the controller, not the browser — closing the tab does not leave the override stuck.'
  },
  '/alarms': {
    vi: 'Xử lý cảnh báo', en: 'Handling alarms',
    bodyVi: 'Năm mức ưu tiên theo ISA-18.2. "Chưa xác nhận" khác "đang hoạt động": một cảnh báo đã hết vẫn có thể còn chờ xác nhận. Mỗi hàng có đường tới điểm nguồn và xu hướng quanh thời điểm bật.',
    bodyEn: 'Five ISA-18.2 priorities. "Unacknowledged" differs from "active": a cleared alarm may still await acknowledgement. Each row links to the source point and the trend around the trigger time.'
  },
  '/trends': {
    vi: 'Đọc biểu đồ xu hướng', en: 'Reading trends',
    bodyVi: 'Khoảng trống dữ liệu làm ĐỨT đường, không nối qua. Số đo từ tầng aggregate đã bị gộp nên đỉnh thật có thể cao hơn đỉnh nhìn thấy — tầng đang dùng ghi ngay dưới tiêu đề.',
    bodyEn: 'Data gaps break the line rather than bridging it. Aggregated tiers are summarised, so the real peak may exceed the visible one — the tier in use is shown under the title.'
  },
  '/eng/inputs': {
    vi: 'Cấu hình ngõ vào', en: 'Configuring inputs',
    bodyVi: 'Dùng "Xem trước quy đổi" để kiểm dải trước khi lưu. Loại tín hiệu không có dải thô tuyến tính cố định (nhiệt trở, biến trở, xung) không xem trước được — đó là giới hạn thật, không phải lỗi.',
    bodyEn: 'Use the conversion preview to verify scaling before saving. Signal types without a fixed linear raw range (thermistor, potentiometer, pulse) cannot be previewed — that is a real limit, not a defect.'
  },
  '/eng/outputs': {
    vi: 'Cấu hình ngõ ra', en: 'Configuring outputs',
    bodyVi: 'Giá trị an toàn quyết định hành vi vật lý khi mất liên lạc — đọc kỹ câu mô tả hậu quả bên cạnh mỗi lựa chọn. Bảng xem trước cho thấy chiều và biên của đường cong trước khi lưu.',
    bodyEn: 'The safe value determines physical behaviour on loss of communication — read the consequence note beside each choice. The preview table shows the curve direction and limits before saving.'
  },
  '/eng/modbus-rtu': {
    vi: 'Modbus RTU', en: 'Modbus RTU',
    bodyVi: '"Chưa từng được poll" KHÁC "mất liên lạc": cái đầu thường là lỗi cấu hình (profile không giải được, bus bật mà cổng vật lý không có), cái sau là lỗi dây hoặc thiết bị. Đọc cảnh báo trên trang Chẩn đoán trước khi đi dò dây.',
    bodyEn: '"Never polled" differs from "offline": the former is usually a configuration fault (unresolved profile, enabled bus without a physical port), the latter a wiring or device fault. Read the Diagnostics warning before chasing cables.'
  },
  '/settings/network': {
    vi: 'Đổi cấu hình mạng', en: 'Changing network settings',
    bodyVi: 'Thay đổi đi theo Kiểm tra → Chuẩn bị → Áp dụng → Giữ. Nếu không bấm "Giữ thay đổi" trước khi hết đếm ngược, bộ điều khiển tự hoàn tác — đó là lớp bảo vệ khi bạn tự khoá mình khỏi thiết bị.',
    bodyEn: 'Changes follow validate → stage → apply → confirm. If you do not confirm before the countdown ends, the controller rolls back automatically — that is the protection against locking yourself out.'
  }
}

const topics = [
  { icon: BookOpen, titleVi: 'Bắt đầu vận hành', titleEn: 'Getting started', bodyVi: 'Kiểm tra trạng thái hệ thống và các dịch vụ trước khi thực hiện thay đổi cấu hình.', bodyEn: 'Check system status and service health before changing configuration.' },
  { icon: Wrench, titleVi: 'Cấu hình điểm', titleEn: 'Point configuration', bodyVi: 'UI, AO và DO giữ tag kỹ thuật cố định; chỉnh tên hiển thị qua trường Label. Virtual Point có thể chỉnh cả tag và Label.', bodyEn: 'UI, AO, and DO keep fixed technical tags; edit their display names through Label. Virtual Points allow both tag and Label changes.' },
  { icon: ShieldCheck, titleVi: 'Quyền và an toàn', titleEn: 'Access and safety', bodyVi: 'Các thao tác ghi, force và thay đổi cấu hình yêu cầu quyền phù hợp; luôn kiểm tra trạng thái an toàn trước khi ghi.', bodyEn: 'Writes, force actions, and configuration changes require the appropriate role; check safe state before writing.' }
]

export function HelpPage() {
  const { pick } = useI18n()
  const [searchParams] = useSearchParams()
  const topicKey = searchParams.get('topic') ?? ''
  const contextTopic = CONTEXT_TOPICS[topicKey]
  const contextRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (contextTopic) contextRef.current?.scrollIntoView({ block: 'start' })
  }, [contextTopic])

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-[var(--radius)] bg-[var(--c-accent)] text-[var(--c-on-accent)]"><CircleHelp className="h-6 w-6" aria-hidden="true" /></div>
        <div>
          <h1 className="text-2xl font-semibold">{pick('Trợ giúp', 'Help')}</h1>
          <p className="text-sm text-[var(--c-text-dim)]">{pick('Hướng dẫn nhanh và câu hỏi thường gặp', 'Quick guides and frequently asked questions')}</p>
        </div>
      </div>

      {contextTopic && (
        <div ref={contextRef}>
          <Panel title={pick('Cho trang bạn vừa rời', 'For the page you came from')} className="border-[var(--c-accent)]">
            <h2 className="font-semibold">{pick(contextTopic.vi, contextTopic.en)}</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--c-text)]">{pick(contextTopic.bodyVi, contextTopic.bodyEn)}</p>
            <p className="mono mt-2 text-xs text-[var(--c-text-dim)]">{topicKey}</p>
          </Panel>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        {topics.map(({ icon: Icon, titleVi, titleEn, bodyVi, bodyEn }) => (
          <Panel key={titleEn} className="p-4">
            <Icon className="h-5 w-5 text-[var(--c-accent)]" aria-hidden="true" />
            <h2 className="mt-3 font-semibold">{pick(titleVi, titleEn)}</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--c-text-dim)]">{pick(bodyVi, bodyEn)}</p>
          </Panel>
        ))}
      </div>

      <Panel title={pick('Câu hỏi thường gặp', 'Frequently asked questions')}>
        <div className="divide-y divide-[var(--c-border)]">
          {[
            [pick('Làm sao xem toàn bộ cảnh báo?', 'How do I view all alarms?'), pick('Chọn Alarm ở thanh bên hoặc biểu tượng chuông trên header để mở trang Alarm.', 'Select Alarm in the sidebar or the bell icon in the header to open the Alarm page.')],
            [pick('Vì sao dữ liệu chưa cập nhật?', 'Why is data not updating?'), pick('Kiểm tra badge SYSTEM và trạng thái các dịch vụ; khi WebSocket kết nối lại, dữ liệu sẽ tự đồng bộ.', 'Check the SYSTEM badge and service status; data syncs automatically when the WebSocket reconnects.')],
            [pick('Tôi có thể tìm tài liệu chi tiết ở đâu?', 'Where can I find detailed documentation?'), pick('Mở phần tài liệu dự án hoặc liên hệ quản trị viên để được cấp hướng dẫn phù hợp với vai trò.', 'Open the project documentation or contact an administrator for role-specific guidance.')]
          ].map(([question, answer]) => (
            <div key={question} className="flex gap-4 py-4 first:pt-0 last:pb-0">
              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-[var(--c-accent)]" aria-hidden="true" />
              <div><h3 className="font-semibold">{question}</h3><p className="mt-1 text-sm leading-6 text-[var(--c-text-dim)]">{answer}</p></div>
            </div>
          ))}
        </div>
        <div className="mt-5 flex items-center gap-2 border-t border-[var(--c-border)] pt-4 text-sm text-[var(--c-text-dim)]"><ExternalLink className="h-4 w-4" aria-hidden="true" />{pick('Cần hỗ trợ thêm? Liên hệ quản trị viên hệ thống.', 'Need more help? Contact your system administrator.')}</div>
      </Panel>
    </div>
  )
}
