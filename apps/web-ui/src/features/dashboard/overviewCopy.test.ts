import { describe, expect, it } from 'vitest'
import type { OverviewAttentionItem, OverviewDomainHealth } from '../../shared/types'
import {
  attentionDetailText,
  attentionTitleText,
  healthDetailIsIdentifier,
  healthDetailText,
  healthReasonText,
} from './overviewCopy'

/**
 * `ISS-PGUI-02` — Dashboard KHÔNG được in câu chữ do máy chủ nối sẵn.
 *
 * Trên production, `mkddc-lang=en` vẫn thấy "Chưa cấu hình thiết bị Modbus
 * RTU" và "{n} điểm đang ghi" ở Health Strip (`pm-014`), và "Thiết bị Modbus
 * mất liên lạc" ở Việc cần chú ý (`pm-006`). Cả hai đến từ `detail`/`title` mà
 * `apps/web-api/internal/app/overview.go` dựng bằng tiếng Việt.
 */

const VI_DIACRITICS = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i

const pickVi = (vi: string, _en: string) => vi
const pickEn = (_vi: string, en: string) => en

function health(overrides: Partial<OverviewDomainHealth> = {}): OverviewDomainHealth {
  return {
    domain: 'historian',
    state: 'good',
    reasonCode: 'ok',
    source: 'historian_policy',
    observedAt: '2026-09-05T00:00:00Z',
    ...overrides,
  }
}

function attention(overrides: Partial<OverviewAttentionItem> = {}): OverviewAttentionItem {
  return {
    id: 'x',
    severity: 'high',
    category: 'communication',
    title: 'fallback',
    targetType: 'point',
    targetId: 'p',
    ...overrides,
  }
}

describe('healthDetailText — câu dựng từ reasonCode + detailCount', () => {
  it.each([
    ['bad_quality_points', 3, '3 điểm chất lượng BAD', '3 points with BAD quality'],
    ['stale_points', 1, '1 điểm stale/offline', '1 stale/offline point'],
    ['bus_not_open', 2, '2 bus không mở được', '2 buses could not open'],
    ['slave_offline', 1, '1 thiết bị offline', '1 offline device'],
    ['policy_unhealthy', 4, '4 điểm ghi lịch sử lỗi', '4 unhealthy logged points'],
    ['ok', 12, '12 điểm đang ghi', '12 points being logged'],
  ])('%s có tham số đếm ⇒ pluralize theo locale', (reasonCode, count, vi, en) => {
    const domain = health({ reasonCode, detailCount: count })
    expect(healthDetailText(domain, pickVi)).toBe(vi)
    expect(healthDetailText(domain, pickEn)).toBe(en)
  })

  /* `pm-014` — hai chuỗi này là chính thứ đã hiện ra giữa giao diện English. */
  it('không đếm được thì dùng nhãn của reasonCode, KHÔNG dùng detail tiếng Việt của máy chủ', () => {
    const modbus = health({ domain: 'modbus', reasonCode: 'not_configured', detail: 'Chưa cấu hình thiết bị Modbus RTU' })
    expect(healthDetailText(modbus, pickEn)).toBe('Not configured')
    expect(healthDetailText(modbus, pickEn)).not.toMatch(VI_DIACRITICS)
    expect(healthDetailText(modbus, pickVi)).toBe('Chưa cấu hình')

    const historian = health({ reasonCode: 'no_logged_points', detail: 'Chưa bật ghi lịch sử cho điểm nào' })
    expect(healthDetailText(historian, pickEn)).toBe('History logging not enabled')
    expect(healthDetailText(historian, pickEn)).not.toMatch(VI_DIACRITICS)
  })

  /* Máy chủ đời cũ vẫn gửi câu tiếng Việt kèm `reasonCode` biết được. Nhãn đã
     dịch phải THẮNG — bản trước làm ngược lại và đó là toàn bộ cơ chế của lỗi. */
  it('máy chủ đời cũ gửi detail tiếng Việt cùng reasonCode biết được ⇒ vẫn ra tiếng Anh', () => {
    const legacy = health({ domain: 'local_io', reasonCode: 'stale_points', detail: '1 điểm stale/offline' })
    expect(healthDetailText(legacy, pickEn)).not.toMatch(VI_DIACRITICS)
  })

  it('mã lạ ra câu trung tính KÈM mã, không nuốt và không in mã trần', () => {
    const unknown = health({ reasonCode: 'brand_new_code' })
    expect(healthDetailText(unknown, pickEn)).toBe('Unrecognised state (code brand_new_code)')
    expect(healthDetailText(unknown, pickVi)).toBe('Trạng thái chưa rõ (mã brand_new_code)')
    expect(healthReasonText('brand_new_code', pickEn)).toContain('brand_new_code')
  })

  it('reasonCode rỗng và không có gì để nói ⇒ "—", không phải chuỗi rỗng im lặng', () => {
    expect(healthDetailText(health({ reasonCode: '' }), pickEn)).toBe('—')
  })

  /* Địa chỉ IPv4 là ĐỊNH DANH: dịch nó thì vô nghĩa, và nhận diện nó theo
     `domain`+`reasonCode` chứ không theo hình dạng chuỗi — đoán theo hình dạng
     là cách một câu tiếng Việt lọt qua vào một ngày nào đó. */
  it('ô network giữ nguyên địa chỉ IP', () => {
    const network = health({ domain: 'network', reasonCode: 'ok', detail: '10.0.0.9' })
    expect(healthDetailIsIdentifier(network)).toBe(true)
    expect(healthDetailIsIdentifier(health({ domain: 'network', reasonCode: 'no_ipv4_address' }))).toBe(false)
    expect(healthDetailIsIdentifier(health({ domain: 'historian', reasonCode: 'ok' }))).toBe(false)
  })
})

describe('attentionTitleText / attentionDetailText', () => {
  it('thiết bị Modbus mất liên lạc: có tên thì chèn tên, không có thì câu chung', () => {
    const named = attention({ titleCode: 'modbus_device_offline', subject: 'CK508-04', title: 'CK508-04 — mất liên lạc' })
    expect(attentionTitleText(named, pickEn)).toBe('CK508-04 — lost contact')
    expect(attentionTitleText(named, pickVi)).toBe('CK508-04 — mất liên lạc')

    const unnamed = attention({ titleCode: 'modbus_device_offline', subject: '', title: 'Thiết bị Modbus mất liên lạc' })
    expect(attentionTitleText(unnamed, pickEn)).toBe('A Modbus device lost contact')
    expect(attentionTitleText(unnamed, pickEn)).not.toMatch(VI_DIACRITICS)
  })

  it.each([
    ['point_quality_bad', 'UI-03 — BAD quality'],
    ['point_offline', 'UI-03 — OFFLINE'],
    ['point_stale', 'UI-03 — STALE'],
    ['point_forced', 'UI-03 — manually forced'],
  ])('%s dựng câu EN từ mã + subject', (code, expected) => {
    const item = attention({ titleCode: code, subject: 'UI-03', title: 'UI-03 — chất lượng BAD' })
    expect(attentionTitleText(item, pickEn)).toBe(expected)
    expect(attentionTitleText(item, pickEn)).not.toMatch(VI_DIACRITICS)
  })

  /* Thông điệp alarm do Core dựng — FE không sở hữu bảng mã của nó. Mã hoá lại
     một câu mình không kiểm soát là bịa ra một phân loại không có thật. */
  it('không có titleCode ⇒ title là văn bản đục, in nguyên văn', () => {
    const alarm = attention({ category: 'alarm', title: 'Pump-02 communication failure' })
    expect(attentionTitleText(alarm, pickEn)).toBe('Pump-02 communication failure')
    expect(attentionTitleText(alarm, pickVi)).toBe('Pump-02 communication failure')
  })

  it('mã LẠ rơi về title của chính bản tin, không bịa câu mới', () => {
    const odd = attention({ titleCode: 'brand_new_code', subject: 'X', title: 'diễn giải của máy chủ' })
    expect(attentionTitleText(odd, pickEn)).toBe('diễn giải của máy chủ')
  })

  it('Bus/Slave là thuật ngữ giao thức: giữ nguyên, chỉ con số là dữ liệu', () => {
    const item = attention({ detailCode: 'modbus_bus_slave', detailParams: { busId: 1, slaveAddr: 12 } })
    expect(attentionDetailText(item, pickEn)).toBe('Bus 1 · Slave 12')
    expect(attentionDetailText(item, pickVi)).toBe('Bus 1 · Slave 12')
  })

  /* `busId: 0` là một giá trị THẬT. Kiểm bằng `=== undefined` chứ không bằng
     falsy, nếu không bus 0 sẽ im lặng rơi về `detail`. */
  it('bus 0 vẫn dựng được câu', () => {
    const item = attention({ detailCode: 'modbus_bus_slave', detailParams: { busId: 0, slaveAddr: 0 } })
    expect(attentionDetailText(item, pickEn)).toBe('Bus 0 · Slave 0')
  })

  it('ép tay: còn hạn và không có hạn là HAI câu khác nhau', () => {
    const expiring = attention({ detailCode: 'forced_expires_in', detailParams: { expiresInS: 272 } })
    expect(attentionDetailText(expiring, pickEn)).toBe('272s remaining')
    expect(attentionDetailText(expiring, pickVi)).toBe('Còn 272s')

    const forever = attention({ detailCode: 'forced_no_expiry' })
    expect(attentionDetailText(forever, pickEn)).toBe('No automatic release deadline')
    expect(attentionDetailText(forever, pickEn)).not.toMatch(VI_DIACRITICS)
  })

  it('thiếu tham số thì rơi về detail đục thay vì in "undefined"', () => {
    const broken = attention({ detailCode: 'modbus_bus_slave', detail: 'UI-03' })
    expect(attentionDetailText(broken, pickEn)).toBe('UI-03')
    const empty = attention({ detailCode: 'forced_expires_in' })
    expect(attentionDetailText(empty, pickEn)).toBeNull()
  })

  it('không có mã và không có detail ⇒ null, để chỗ gọi vẽ "chưa có dữ liệu"', () => {
    expect(attentionDetailText(attention({ detail: '   ' }), pickEn)).toBeNull()
  })
})
