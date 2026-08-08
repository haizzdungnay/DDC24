import type { AttentionTargetType } from '../types'

/**
 * Resolver drill-down — PA3-204 / quyết định PA3-D06.
 *
 * VÌ SAO KHÔNG NHẬN URL TỪ BACKEND
 *
 * Cách nhanh nhất để làm Attention bấm được là để backend trả kèm một `href`
 * rồi FE render `<Link to={item.href}>`. Nhưng khi đó bảng định tuyến của giao
 * diện bị điều khiển bởi dữ liệu: một chuỗi lọt vào payload (từ tên thiết bị
 * Modbus do người dùng đặt, từ một alarm id lạ) thành đường điều hướng, kể cả
 * `javascript:` hay một origin khác.
 *
 * Nên hợp đồng là cặp `(targetType, targetId)` đã đóng, và FE — nơi biết bảng
 * route thật — tự dựng đường đi. Loại không nhận ra thì trả `null` và UI hiện
 * dòng đó dưới dạng không bấm được, thay vì đoán.
 */
export function resolveDrilldown(targetType: AttentionTargetType | string, targetId: string): string | null {
  const id = targetId.trim()
  if (!id) return null
  switch (targetType) {
    case 'point':
      return `/monitor?point=${encodeURIComponent(id)}`
    case 'alarm':
      return `/alarms?alarm=${encodeURIComponent(id)}`
    // `q` là tham số lọc mà `DevicesPage` THẬT SỰ đọc. Dùng một tên khác cho
    // đẹp sẽ cho ra một liên kết mở đúng tab nhưng không lọc gì — kiểu hỏng im
    // lặng mà chỉ người dùng thật phát hiện ra.
    case 'modbus_device':
      return `/eng/modbus-rtu/devices?q=${encodeURIComponent(id)}`
    case 'bus':
      return '/eng/modbus-rtu/ports'
    case 'subsystem':
      return resolveSubsystem(id)
    default:
      return null
  }
}

/** Đường đi của các ô Health Strip. Danh sách đóng, khớp `domain` do backend
 *  phát ra trong `/overview.health[]`. */
const subsystemRoutes: Record<string, string> = {
  controller: '/diagnostics',
  local_io: '/monitor?group=local',
  modbus: '/eng/modbus-rtu',
  network: '/settings/network',
  historian: '/trends'
}

function resolveSubsystem(id: string): string | null {
  return subsystemRoutes[id] ?? null
}

/** Kiểm một `link` do backend gợi ý có nằm trong bảng route đã biết không.
 *  Dùng để giữ được gợi ý của backend mà không nhận URL tuỳ ý. */
export function safeInternalLink(link: string | undefined): string | null {
  if (!link) return null
  if (!link.startsWith('/')) return null
  if (link.startsWith('//')) return null
  const path = link.split('?')[0]
  return knownRoutePrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)) ? link : null
}

const knownRoutePrefixes = [
  '/',
  '/monitor',
  '/alarms',
  '/trends',
  '/diagnostics',
  '/eng/modbus-rtu',
  '/eng/scheduler',
  '/eng/commissioning',
  '/eng/inputs',
  '/eng/outputs',
  '/eng/virtual-points',
  '/eng/alarm-settings',
  '/settings/network',
  '/settings/device',
  '/settings/time',
  '/settings/users'
]
