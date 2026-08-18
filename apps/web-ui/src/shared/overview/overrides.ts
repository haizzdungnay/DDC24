import type { ActivityEvent, Point } from '../types'
import { pointDisplayTag } from '../utils'

/**
 * `BB-4` Override registry — nguồn dữ liệu chung "ai đang giữ quyền điều khiển".
 *
 * Task `T57-1.1` của Plan 57 (`docs/03_implementation/57_WEB_UIUX_UC_UPGRADE_PLAN.md`),
 * đặc tả trực quan ở `docs/04_uiux/KX-DDC24-UX-WEB-OPERATIONS-001_VI.md` §1.
 *
 * ## Vì sao là một module riêng chứ không phải một `useMemo` trong `DashboardPage`
 *
 * Bốn đề xuất khác nhau cần **đúng** danh sách này: khối trên Landing
 * (§6.1-P1a), cột TTL ở Monitor (§6.2-P1b), hộp thoại ép tay hàng loạt
 * (§6.2-P1a) và đếm ngược trên HMI (§6.19-P2). Viết ở trang thì tới lần thứ ba
 * sẽ có ba định nghĩa "đang bị ép tay" hơi khác nhau — và trên một màn hình bàn
 * giao ca, ba con số khác nhau cho cùng một câu hỏi là chuyện tệ hơn không có số nào.
 *
 * ## Ba luật không được vi phạm
 *
 * 1. **TTL do Core cấp, frontend KHÔNG tự tính.** `overrideExpiresInS` đi thẳng
 *    từ Core (PA3-107) vì chính Core cưỡng chế thời hạn trong `scan_loop`. Một
 *    bản trừ dần trong tab trình duyệt sẽ trôi khỏi đồng hồ thiết bị, và tệ hơn:
 *    nó vẫn "đếm" khi kết nối đã chết, tức là khẳng định một điều mình không biết.
 * 2. **`undefined` khác `0`.** Không có `overrideExpiresInS` nghĩa là lệnh
 *    **không có thời hạn tự nhả** (điểm ảo đi đường ghi cấu hình chẳng hạn),
 *    tuyệt đối không phải "vừa hết hạn". Hai thứ đó phải trông khác nhau.
 * 3. **Không tìm thấy người ra lệnh thì nói là không tìm thấy.** Activity là
 *    một vòng nhớ có giới hạn (`activityCapacity = 2000` ở
 *    `apps/web-api/internal/app/activity.go`), nên một lệnh ép tay đủ cũ sẽ bị
 *    đẩy ra khỏi vòng. Khi đó actor là `undefined` — **không** được điền
 *    "hệ thống", vì lệnh đó do một con người phát ra và ta chỉ mất vết.
 */

/** Ngưỡng "sắp hết hạn" mặc định: 5 phút.
 *
 *  Chọn 5 phút vì đó là khoảng đủ để người trực đi tới tủ và quyết định gia hạn
 *  hay để nhả, với thời hạn ép tay mặc định của giao diện là 10 phút. */
export const OVERRIDE_EXPIRING_SOON_S = 300

/** Các `action` trong Activity thật sự mang nghĩa "một người đã ra lệnh ép tay".
 *
 *  Danh sách ĐÓNG và khớp `activityActionLabels` của `DashboardPage` cùng các
 *  hằng ghi audit ở backend. Nhận bừa mọi action có `objectId` trùng sẽ gán
 *  nhầm người: `point_metadata` (đổi tên điểm) không phải người ra lệnh ép. */
const OVERRIDE_ACTIONS = new Set(['point_force', 'point_override'])

/** Outcome được coi là "lệnh đã được chấp nhận".
 *
 *  Một vết `rejected` nghĩa là lệnh KHÔNG tới thiết bị; gán nó làm người đang
 *  giữ quyền là quy trách nhiệm cho người có thao tác bị từ chối. */
const ACCEPTED_OUTCOMES = new Set(['accepted', 'ok'])

export interface OverrideOwner {
  pointId: string
  /** Nhãn hiển thị theo đúng quy ước `pointDisplayTag` của toàn ứng dụng. */
  displayTag: string
  name: string
  value: Point['value']
  unit?: string
  /** `undefined` = KHÔNG tìm thấy vết trong Activity, không phải "hệ thống". */
  actor?: string
  actorRole?: string
  /** Mốc ra lệnh lấy từ Activity; `undefined` khi không có vết. */
  commandedAt?: string
  /** Giây còn lại DO CORE CẤP. `undefined` = không có thời hạn tự nhả. */
  remainingS?: number
  /** Nguồn đang giữ quyền (`point.priority`). `undefined` khi producer không nói. */
  holder?: string
}

export interface OverrideSummary {
  /** Tổng số điểm đang bị ép tay. */
  total: number
  /** Số điểm có TTL và sắp hết hạn. */
  expiringSoon: number
  /** Số điểm KHÔNG có thời hạn tự nhả — đây là nhóm đáng lo nhất khi bàn giao ca. */
  withoutTtl: number
}

/** `true` khi lệnh có thời hạn VÀ thời hạn đó sắp hết.
 *
 *  `undefined` trả `false` một cách cố ý: "không có thời hạn" không phải "sắp
 *  hết hạn" — nó là một tình trạng khác, được đếm riêng ở `withoutTtl`. */
export function isOverrideExpiringSoon(remainingS: number | undefined, thresholdS = OVERRIDE_EXPIRING_SOON_S): boolean {
  if (typeof remainingS !== 'number' || !Number.isFinite(remainingS)) return false
  return remainingS > 0 && remainingS <= thresholdS
}

/**
 * Tìm vết Activity MỚI NHẤT ứng với một điểm.
 *
 * Vì sao phải là mới nhất: một điểm có thể bị ép, nhả, rồi ép lại. Lấy vết đầu
 * tiên tìm thấy sẽ gán tên người của lần ép TRƯỚC cho lệnh đang giữ hiện tại.
 */
function latestOverrideEvent(pointId: string, activity: ActivityEvent[]): ActivityEvent | undefined {
  let best: ActivityEvent | undefined
  for (const event of activity) {
    if (event.objectId !== pointId) continue
    if (!OVERRIDE_ACTIONS.has(event.action)) continue
    if (!ACCEPTED_OUTCOMES.has(event.outcome)) continue
    if (best === undefined || event.id > best.id) best = event
  }
  return best
}

/**
 * Dựng danh sách "ai đang giữ quyền điều khiển" từ bảng điểm + nhật ký hoạt động.
 *
 * Thứ tự trả về là thứ tự KHẨN CẤP, không phải thứ tự bảng chữ cái:
 *   1. Điểm có TTL, còn ít nhất ⇒ lên trước (sắp tự nhả, cần quyết định sớm).
 *   2. Điểm KHÔNG có TTL ⇒ nhóm sau, vì chúng không tự biến mất và phải được
 *      nhả bằng tay — nhưng chúng không có deadline nên không chen lên đầu.
 *   3. Trong cùng nhóm, sắp theo id để thứ tự ổn định giữa hai lần render.
 */
export function collectOverrideOwners(points: Point[], activity: ActivityEvent[] = []): OverrideOwner[] {
  const owners: OverrideOwner[] = []
  for (const point of points) {
    if (point.forced !== true) continue
    const event = latestOverrideEvent(point.id, activity)
    const remaining = typeof point.overrideExpiresInS === 'number' && Number.isFinite(point.overrideExpiresInS)
      ? point.overrideExpiresInS
      : undefined
    owners.push({
      pointId: point.id,
      displayTag: pointDisplayTag(point),
      name: point.name,
      value: point.value,
      unit: point.unit,
      actor: event?.actor,
      actorRole: event?.role,
      commandedAt: event?.time,
      remainingS: remaining,
      holder: point.priority
    })
  }
  return owners.sort((left, right) => {
    const leftHasTtl = left.remainingS !== undefined
    const rightHasTtl = right.remainingS !== undefined
    if (leftHasTtl !== rightHasTtl) return leftHasTtl ? -1 : 1
    if (leftHasTtl && rightHasTtl && left.remainingS !== right.remainingS) {
      return (left.remainingS as number) - (right.remainingS as number)
    }
    return left.pointId.localeCompare(right.pointId, undefined, { numeric: true })
  })
}

export function summarizeOverrides(owners: OverrideOwner[], thresholdS = OVERRIDE_EXPIRING_SOON_S): OverrideSummary {
  let expiringSoon = 0
  let withoutTtl = 0
  for (const owner of owners) {
    if (owner.remainingS === undefined) withoutTtl += 1
    else if (isOverrideExpiringSoon(owner.remainingS, thresholdS)) expiringSoon += 1
  }
  return { total: owners.length, expiringSoon, withoutTtl }
}
