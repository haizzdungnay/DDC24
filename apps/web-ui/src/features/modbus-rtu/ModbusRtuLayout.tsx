import { Link, Outlet, useLocation } from 'react-router-dom'
import { useAuth, roleAtLeast } from '../auth'
import { ConfigStateBanner } from './components/ConfigStateBanner'
import { ModbusConfigProvider } from './useModbusConfig'
import { READ_ONLY_HINT } from './shared'

const OVERVIEW_PATH = '/eng/modbus-rtu'

const tabs = [
  { label: 'Tổng quan', path: OVERVIEW_PATH },
  { label: 'Thiết bị', path: '/eng/modbus-rtu/devices' },
  { label: 'Points', path: '/eng/modbus-rtu/points' },
  { label: 'Mapping', path: '/eng/modbus-rtu/mapping' },
  { label: 'Diagnostics', path: '/eng/modbus-rtu/diagnostics' }
]

/**
 * Khung chung của feature Modbus RTU — MBR-B301.
 *
 * Ba điểm sau là bản sửa FE-MB-02/03 ngày 2026-08-05, không được vô tình đảo lại:
 *
 * 1. `<h1>` chỉ tồn tại ở ĐÂY. Trước đây `ModbusRtuPage` render thêm một `<h1>`
 *    nữa nên ba tab con hiện hai tiêu đề chồng nhau — dấu hiệu trực quan rõ nhất
 *    của "trang bị lỗi". Các page con chỉ được dùng `<h2>` trở xuống.
 * 2. KHÔNG thêm padding ở đây. `AppShell` đã bọc `<main className="p-5">`; layout
 *    thêm `p-4 md:p-6` và page con thêm lần thứ ba làm nội dung thụt vào sâu bất
 *    thường so với tab Tổng quan.
 * 3. KHÔNG mở `<main>` ở đây. `AppShell` đã có một `<main>`; `<main>` lồng
 *    `<main>` phá landmark navigation của screen reader.
 */
export function ModbusRtuLayout() {
  const location = useLocation()
  const { session } = useAuth()
  const canEdit = roleAtLeast(session?.role, 'admin')

  const currentPath = location.pathname.replace(/\/$/, '') || location.pathname

  return (
    /* MBR-B302: provider bọc CẢ banner lẫn các page con, nên "bản nháp đang
     * soạn" là một trạng thái duy nhất cho toàn feature. Nếu mỗi page tự giữ
     * bản nháp riêng, chuyển tab sẽ mất thay đổi chưa lưu mà không báo gì. */
    <ModbusConfigProvider>
    <div className="space-y-5">
      <header className="space-y-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--c-text)]">Modbus RTU Management</h1>
          <p className="mt-1 text-sm text-[var(--c-text-dim)]">
            Cấu hình, theo dõi thiết bị trường và giám sát telemetry giao tiếp RS485-1 / RS485-2.
          </p>
        </div>

        <nav className="flex space-x-1 border-b border-[var(--c-border)]" aria-label="Modbus RTU Sections">
          {tabs.map((tab) => {
            /* `/eng/modbus-rtu` và `/eng/modbus-rtu/overview` cùng render
             * `OverviewPage`, nên cả hai phải làm sáng tab Tổng quan. Bản trước
             * chỉ so bằng đúng `/eng/modbus-rtu` nên mở `/overview` là không tab
             * nào active. */
            const isActive =
              tab.path === OVERVIEW_PATH
                ? currentPath === OVERVIEW_PATH || currentPath === `${OVERVIEW_PATH}/overview`
                : currentPath === tab.path || currentPath.startsWith(`${tab.path}/`)
            return (
              <Link
                key={tab.path}
                to={tab.path}
                aria-current={isActive ? 'page' : undefined}
                className={`border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
                  isActive
                    ? 'border-[var(--c-primary,#2563eb)] text-[var(--c-primary,#2563eb)]'
                    : 'border-transparent text-[var(--c-text-dim)] hover:border-[var(--c-border)] hover:text-[var(--c-text)]'
                }`}
              >
                {tab.label}
              </Link>
            )
          })}
        </nav>
      </header>

      {/* Đ-04: Viewer/Operator xem được toàn feature; chỉ Admin đổi cấu hình.
          Cảnh báo chỉ-đọc đặt một lần ở layout để bốn page con không lặp lại. */}
      {!canEdit && (
        <div role="note" className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 text-sm text-[var(--c-text-dim)]">
          Chế độ chỉ xem. {READ_ONLY_HINT}
        </div>
      )}

      <ConfigStateBanner />

      <div className="mt-4">
        <Outlet />
      </div>
    </div>
    </ModbusConfigProvider>
  )
}
