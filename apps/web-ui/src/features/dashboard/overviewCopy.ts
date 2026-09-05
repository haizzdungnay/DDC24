import type { OverviewAttentionItem, OverviewDomainHealth } from '../../shared/types'
import { healthReasonLabel } from '../../shared/components/pa3/StateAtoms'

/**
 * `ISS-PGUI-02` — CÂU CHỮ của Dashboard dựng ở CLIENT, từ mã + tham số typed.
 *
 * ## Lỗi mà mô-đun này tồn tại để chặn
 *
 * `apps/web-api/internal/app/overview.go` từng nối sẵn câu tiếng Việt vào
 * `detail`/`title` ("Chưa cấu hình thiết bị Modbus RTU", "{n} điểm đang ghi",
 * "Thiết bị Modbus mất liên lạc"), và `DashboardPage` in thẳng chuỗi ấy ra —
 * `domain.detail || healthReasonLabel(...)` cho `detail` THẮNG cả nhãn đã dịch
 * sẵn ngay bên cạnh. Kết quả: mở giao diện English vẫn thấy tiếng Việt ở đúng
 * ô sức khoẻ phân hệ và ở panel Việc cần chú ý (`PM-006`, `pm-006`, `pm-014`).
 *
 * Máy chủ **không biết** người dùng đang xem bằng ngôn ngữ nào. Nó biết *cái
 * gì* đang xảy ra (`reasonCode`) và *bao nhiêu* (`detailCount`); chỉ client mới
 * biết *nói bằng tiếng gì*. Tách đúng theo ranh giới ấy.
 *
 * ## Ba loại nội dung, ba cách xử
 *
 * 1. **Mã đóng** (`reasonCode`, `titleCode`, `detailCode`) — dịch được, và mã
 *    lạ phải ra câu TRUNG TÍNH KÈM MÃ, không được nuốt.
 * 2. **Định danh** (tên điểm, tên thiết bị, IP, `Modbus RTU`, `PROGRAM`) —
 *    không dịch: đây là thứ người dùng tra trong tủ, trong cấu hình và trong
 *    tài liệu.
 * 3. **Văn bản đục** (thông điệp alarm của Core, lý do chất lượng do Core trả)
 *    — hiển thị nguyên văn. Mã hoá lại một câu mình không kiểm soát là bịa ra
 *    một phân loại không có thật.
 */

type Pick = (vi: string, en: string) => string

/**
 * Dòng chi tiết của một ô Health Strip.
 *
 * Thứ tự thắng có chủ ý: câu dựng từ `reasonCode` + `detailCount` ĐỨNG TRƯỚC
 * `detail`. Bản trước làm ngược lại (`detail || nhãn`), nên một chuỗi tiếng
 * Việt của máy chủ luôn che mất nhãn đã dịch. `detail` chỉ còn là chỗ dựa cuối
 * cho các giá trị không phụ thuộc ngôn ngữ (địa chỉ IP) và cho máy chủ đời cũ.
 */
export function healthDetailText(domain: OverviewDomainHealth, pick: Pick): string {
  const counted = healthCountText(domain, pick)
  if (counted) return counted
  const label = healthReasonText(domain.reasonCode, pick)
  /* Máy chủ đời cũ chưa có `detailCount` vẫn gửi câu tiếng Việt trong `detail`.
     Không in nó ra cạnh nhãn đã dịch: nhãn nói đúng cùng một điều, bằng đúng
     ngôn ngữ đang chọn. Chỉ khi KHÔNG có nhãn nào mới rơi về `detail` như một
     chuỗi chẩn đoán. */
  if (label) return label
  return domain.detail?.trim() || '—'
}

/**
 * `detail` chỉ được in nguyên văn khi nó là một GIÁ TRỊ, không phải một câu.
 *
 * Ô `network` mang địa chỉ IPv4 ở đây — một định danh, và dịch nó thì vô nghĩa.
 * Nhận diện theo `domain` + `reasonCode` thay vì đoán theo hình dạng chuỗi:
 * đoán theo hình dạng là cách một câu tiếng Việt nào đó lọt qua vào một ngày
 * nào đó.
 */
export function healthDetailIsIdentifier(domain: OverviewDomainHealth): boolean {
  return domain.domain === 'network' && domain.reasonCode === 'ok'
}

function healthCountText(domain: OverviewDomainHealth, pick: Pick): string | null {
  const count = domain.detailCount
  if (typeof count !== 'number' || !Number.isFinite(count)) return null
  switch (domain.reasonCode) {
    case 'bad_quality_points':
      return pick(`${count} điểm chất lượng BAD`, `${count} ${plural(count, 'point', 'points')} with BAD quality`)
    case 'stale_points':
      return pick(`${count} điểm stale/offline`, `${count} stale/offline ${plural(count, 'point', 'points')}`)
    case 'bus_not_open':
      return pick(`${count} bus không mở được`, `${count} ${plural(count, 'bus', 'buses')} could not open`)
    case 'slave_offline':
      return pick(`${count} thiết bị offline`, `${count} offline ${plural(count, 'device', 'devices')}`)
    case 'policy_unhealthy':
      return pick(`${count} điểm ghi lịch sử lỗi`, `${count} unhealthy logged ${plural(count, 'point', 'points')}`)
    case 'ok':
      /* `ok` + `detailCount` chỉ xuất hiện ở historian ("n điểm đang ghi"). Ô
         `ok` nào khác không có `detailCount`, nên nhánh này không chạm tới. */
      return pick(`${count} điểm đang ghi`, `${count} ${plural(count, 'point', 'points')} being logged`)
    default:
      return null
  }
}

/** Số nhiều tiếng Anh cho các danh từ đếm được ở đây. Tiếng Việt không biến đổi. */
function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

/**
 * Nhãn của `reasonCode`.
 *
 * Mã lạ KHÔNG được nuốt thành ô trống, và cũng không được in trần: nó ra một
 * câu trung tính KÈM chính mã đó, để người trực ca đọc được rằng "có chuyện gì
 * đó chưa biết" và kỹ thuật vẫn tra ngược được mã.
 */
export function healthReasonText(reasonCode: string, pick: Pick): string {
  if (!reasonCode) return ''
  const vi = healthReasonLabel(reasonCode, 'vi')
  const en = healthReasonLabel(reasonCode, 'en')
  if (vi === reasonCode || en === reasonCode) {
    return pick(`Trạng thái chưa rõ (mã ${reasonCode})`, `Unrecognised state (code ${reasonCode})`)
  }
  return pick(vi, en)
}

/**
 * Tiêu đề một mục Attention.
 *
 * `titleCode` rỗng ⇒ `title` là văn bản ĐỤC của authority thượng nguồn (thông
 * điệp alarm do Core dựng). In nguyên văn: dịch nó cần một bảng mã mà tầng này
 * không sở hữu, và đoán bừa sẽ đổi ý nghĩa của một cảnh báo.
 */
export function attentionTitleText(item: OverviewAttentionItem, pick: Pick): string {
  const subject = item.subject?.trim() ?? ''
  switch (item.titleCode) {
    case 'modbus_device_offline':
      return subject
        ? pick(`${subject} — mất liên lạc`, `${subject} — lost contact`)
        : pick('Thiết bị Modbus mất liên lạc', 'A Modbus device lost contact')
    case 'point_quality_bad':
      return pick(`${subject} — chất lượng BAD`, `${subject} — BAD quality`)
    case 'point_offline':
      return `${subject} — OFFLINE`
    case 'point_stale':
      return `${subject} — STALE`
    case 'point_forced':
      return pick(`${subject} — đang ép tay`, `${subject} — manually forced`)
    default:
      /* Không có mã: `title` là văn bản đục, giữ nguyên. Một mã LẠ cũng rơi vào
         đây — và `title` của cùng bản tin là bản diễn giải tốt nhất đang có,
         tốt hơn một câu do FE bịa. */
      return item.title
  }
}

/**
 * Dòng chi tiết một mục Attention.
 *
 * `detailCode` rỗng ⇒ `detail` đục (lý do chất lượng do Core trả, hoặc
 * `pointId`). Giữ nguyên văn theo đúng `ISS-PIO-32`.
 */
export function attentionDetailText(item: OverviewAttentionItem, pick: Pick): string | null {
  const params = item.detailParams
  switch (item.detailCode) {
    case 'modbus_bus_slave':
      /* `Bus`/`Slave` là thuật ngữ giao thức Modbus, giữ nguyên ở cả hai ngôn
         ngữ; chỉ có con số là dữ liệu. */
      if (params?.busId === undefined || params.slaveAddr === undefined) break
      return `Bus ${params.busId} · Slave ${params.slaveAddr}`
    case 'forced_expires_in':
      if (params?.expiresInS === undefined) break
      return pick(`Còn ${params.expiresInS}s`, `${params.expiresInS}s remaining`)
    case 'forced_no_expiry':
      return pick('Không có thời hạn tự nhả', 'No automatic release deadline')
    default:
      break
  }
  const raw = item.detail?.trim()
  return raw ? raw : null
}
