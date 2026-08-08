import { ChevronRight } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useI18n } from '../../i18n'

/**
 * Breadcrumb — PA3-204.
 *
 * VÌ SAO CẦN
 *
 * PA3 là workspace drill-down: người dùng đi Landing → Attention → Point →
 * Modbus device → Bus. Sau ba bước, thanh bên chỉ nói "đang ở nhóm Kỹ thuật",
 * không nói "đến đây bằng đường nào" và không có đường quay lại một bậc.
 *
 * LUẬT
 *
 * Nhãn lấy từ một bảng ĐÓNG trong file này, tra theo đường dẫn. Không sinh nhãn
 * bằng cách viết hoa segment của URL: `/eng/modbus-rtu/devices` sẽ ra "Eng /
 * Modbus Rtu / Devices" — vừa xấu vừa lộ cấu trúc route thay vì nói ngôn ngữ
 * của người vận hành. Đường dẫn không có trong bảng thì KHÔNG hiện breadcrumb,
 * chứ không đoán.
 */

interface Crumb {
  to?: string
  vi: string
  en: string
}

const home: Crumb = { to: '/', vi: 'Tổng quan', en: 'Overview' }

/** Bảng đường dẫn → chuỗi breadcrumb. Chỉ liệt kê trang có chiều sâu; trang
 *  cấp một (Monitor, Alarms…) không cần breadcrumb vì thanh bên đã đủ. */
const trails: Record<string, Crumb[]> = {
  '/diagnostics': [home, { vi: 'Chẩn đoán', en: 'Diagnostics' }],
  '/alarms/history': [home, { to: '/alarms', vi: 'Cảnh báo', en: 'Alarms' }, { vi: 'Lịch sử', en: 'History' }],
  '/eng/scheduler': [home, { vi: 'Lịch vận hành', en: 'Scheduler' }],
  '/eng/scheduler/runtime': [home, { to: '/eng/scheduler', vi: 'Lịch vận hành', en: 'Scheduler' }, { vi: 'Trạng thái chạy', en: 'Runtime' }],
  '/eng/commissioning': [home, { vi: 'Chạy thử', en: 'Commissioning' }],
  '/eng/inputs': [home, { vi: 'Cấu hình I/O', en: 'I/O configuration' }, { vi: 'Inputs', en: 'Inputs' }],
  '/eng/outputs': [home, { vi: 'Cấu hình I/O', en: 'I/O configuration' }, { vi: 'Outputs', en: 'Outputs' }],
  '/eng/virtual-points': [home, { vi: 'Cấu hình I/O', en: 'I/O configuration' }, { vi: 'Điểm ảo', en: 'Virtual points' }],
  '/eng/alarm-settings': [home, { to: '/alarms', vi: 'Cảnh báo', en: 'Alarms' }, { vi: 'Cấu hình', en: 'Configuration' }],
  '/eng/modbus-rtu': [home, { vi: 'Modbus RTU', en: 'Modbus RTU' }],
  '/eng/modbus-rtu/overview': [home, { to: '/eng/modbus-rtu', vi: 'Modbus RTU', en: 'Modbus RTU' }, { vi: 'Tổng quan', en: 'Overview' }],
  '/eng/modbus-rtu/ports': [home, { to: '/eng/modbus-rtu', vi: 'Modbus RTU', en: 'Modbus RTU' }, { vi: 'Bus / Cổng', en: 'Buses / Ports' }],
  '/eng/modbus-rtu/devices': [home, { to: '/eng/modbus-rtu', vi: 'Modbus RTU', en: 'Modbus RTU' }, { vi: 'Thiết bị', en: 'Devices' }],
  '/eng/modbus-rtu/points': [home, { to: '/eng/modbus-rtu', vi: 'Modbus RTU', en: 'Modbus RTU' }, { vi: 'Điểm', en: 'Points' }],
  '/eng/modbus-rtu/mapping': [home, { to: '/eng/modbus-rtu', vi: 'Modbus RTU', en: 'Modbus RTU' }, { vi: 'Ánh xạ', en: 'Mapping' }],
  '/eng/modbus-rtu/diagnostics': [home, { to: '/eng/modbus-rtu', vi: 'Modbus RTU', en: 'Modbus RTU' }, { vi: 'Chẩn đoán', en: 'Diagnostics' }],
  '/settings/network': [home, { vi: 'Hệ thống', en: 'System' }, { vi: 'Mạng', en: 'Network' }],
  '/settings/device': [home, { vi: 'Hệ thống', en: 'System' }, { vi: 'Thiết bị', en: 'Device' }],
  '/settings/time': [home, { vi: 'Hệ thống', en: 'System' }, { vi: 'Thời gian', en: 'Time' }],
  '/settings/users': [home, { vi: 'Hệ thống', en: 'System' }, { vi: 'Người dùng', en: 'Users' }],
  '/settings/display': [home, { vi: 'Hệ thống', en: 'System' }, { vi: 'Hiển thị', en: 'Display' }]
}

export function trailFor(pathname: string): Crumb[] | null {
  const clean = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  return trails[clean] ?? null
}

export function Breadcrumb() {
  const location = useLocation()
  const { lang, pick } = useI18n()
  const trail = trailFor(location.pathname)
  if (!trail) return null
  const label = (crumb: Crumb) => (lang === 'vi' ? crumb.vi : crumb.en)
  return (
    <nav aria-label={pick('Đường dẫn', 'Breadcrumb')} className="mb-3 flex flex-wrap items-center gap-1 text-xs text-[var(--c-text-dim)]">
      {trail.map((crumb, index) => {
        const last = index === trail.length - 1
        return (
          <span key={`${crumb.vi}-${index}`} className="inline-flex items-center gap-1">
            {index > 0 && <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
            {crumb.to && !last
              ? <Link to={crumb.to} className="hover:text-[var(--c-accent)]">{label(crumb)}</Link>
              : <span aria-current={last ? 'page' : undefined} className={last ? 'font-semibold text-[var(--c-text)]' : undefined}>{label(crumb)}</span>}
          </span>
        )
      })}
    </nav>
  )
}
