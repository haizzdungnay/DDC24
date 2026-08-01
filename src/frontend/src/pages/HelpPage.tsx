import { BookOpen, ChevronRight, CircleHelp, ExternalLink, ShieldCheck, Wrench } from 'lucide-react'
import { Panel } from '../components/Panel'
import { useI18n } from '../i18n'

const topics = [
  { icon: BookOpen, titleVi: 'Bắt đầu vận hành', titleEn: 'Getting started', bodyVi: 'Kiểm tra trạng thái hệ thống và các dịch vụ trước khi thực hiện thay đổi cấu hình.', bodyEn: 'Check system status and service health before changing configuration.' },
  { icon: Wrench, titleVi: 'Cấu hình điểm', titleEn: 'Point configuration', bodyVi: 'UI, AO và DO giữ tag kỹ thuật cố định; chỉnh tên hiển thị qua trường Label. Virtual Point có thể chỉnh cả tag và Label.', bodyEn: 'UI, AO, and DO keep fixed technical tags; edit their display names through Label. Virtual Points allow both tag and Label changes.' },
  { icon: ShieldCheck, titleVi: 'Quyền và an toàn', titleEn: 'Access and safety', bodyVi: 'Các thao tác ghi, force và thay đổi cấu hình yêu cầu quyền phù hợp; luôn kiểm tra trạng thái an toàn trước khi ghi.', bodyEn: 'Writes, force actions, and configuration changes require the appropriate role; check safe state before writing.' }
]

export function HelpPage() {
  const { pick } = useI18n()
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-[var(--radius)] bg-[var(--c-accent)] text-[var(--c-on-accent)]"><CircleHelp className="h-6 w-6" aria-hidden="true" /></div>
        <div>
          <h1 className="text-2xl font-semibold">{pick('Trợ giúp', 'Help')}</h1>
          <p className="text-sm text-[var(--c-text-dim)]">{pick('Hướng dẫn nhanh và câu hỏi thường gặp', 'Quick guides and frequently asked questions')}</p>
        </div>
      </div>

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
