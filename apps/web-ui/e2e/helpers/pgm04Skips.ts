import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * `T61-503` / `ISS-PGM04-16` — SỔ KẾ TOÁN các lần `test.skip` của PGM-04.
 *
 * Issue từ chối đóng với câu "có test skip nhưng summary gọi toàn suite PASS".
 * Đó không phải một lời phàn nàn về cách in báo cáo: một `test.skip` có điều
 * kiện **không hề sai** — dải desktop và dải hẹp là hai lane, và mỗi phép đo
 * chỉ có nghĩa ở một trong hai. Cái sai là khi một lần bỏ qua **không có lane
 * nào chạy nó**: lúc ấy tổng kết in "20 passed, 1 skipped" và không ai đọc được
 * rằng phép kiểm ấy chưa từng chạy ở đâu cả.
 *
 * Sổ này bắt mỗi lần bỏ qua phải khai **lane nào gánh nó**. Một `test.skip` mới
 * thêm vào mà không khai sẽ làm ĐỎ, nên "bỏ qua rồi quên" không còn là một trạng
 * thái im lặng được nữa.
 *
 * Đọc từ CHÍNH TỆP SPEC chứ không từ một danh sách chép tay: một danh sách chép
 * tay là bản sao thứ hai của sự thật, và bản sao thì lệch.
 */
export interface Pgm04SkipLedgerEntry {
  /** Chuỗi lý do, đúng như nó nằm trong `test.skip(...)`. */
  reason: string
  /** Lane THẬT SỰ chạy phép kiểm này. `null` = chưa có lane nào — phải có owner. */
  coveredBy: 'desktop-chrome' | 'mobile-chrome' | 'both'
  /** Vì sao lane kia không chạy được nó. */
  why: string
}

export const PGM04_SKIP_LEDGER: readonly Pgm04SkipLedgerEntry[] = [
  {
    reason: 'khổ hẹp là read-only, có case riêng',
    coveredBy: 'desktop-chrome',
    why: 'Dưới 768 px PGM-04 là chỉ-đọc theo SPEC-PGM04-VISUAL-001 §1; lane hẹp có case "không một đường ghi nào bật được".',
  },
  {
    reason: 'case này thuộc khổ hẹp',
    coveredBy: 'mobile-chrome',
    why: 'Đây CHÍNH LÀ case chỉ-đọc khổ hẹp; chạy nó ở desktop là đo một luật không áp dụng ở đó.',
  },
  {
    reason: 'phép đo này tự đặt khung nhìn',
    coveredBy: 'desktop-chrome',
    why: 'Case tự gọi setViewportSize cho sáu khổ (1440→390), nên nó đã phủ cả dải mobile; chạy lại ở project mobile là đo hai lần cùng một thứ.',
  },
  {
    reason: 'khổ hẹp khoá mọi vai thành chỉ-đọc; ma trận vai đo ở lane desktop',
    coveredBy: 'desktop-chrome',
    why: 'Ở khổ hẹp mọi vai đều bị khoá ghi, nên bốn vai cho cùng một kết quả và ma trận không phân biệt được gì.',
  },
  {
    reason: 'khổ hẹp khoá sẵn mọi đường ghi; case chỉ-đọc khổ hẹp đã có riêng',
    coveredBy: 'desktop-chrome',
    why: 'Zero-mutation ở khổ hẹp là hệ quả tầm thường của việc mọi nút ghi đã khoá; phép đo chỉ có nghĩa khi các nút ĐANG bật.',
  },
]

/** Mọi lần `test.skip` nằm trong khối `describe` của PGM-04, đọc từ tệp spec. */
export function readPgm04SkipReasons(): string[] {
  const specPath = fileURLToPath(new URL('../programming.spec.ts', import.meta.url))
  const source = readFileSync(specPath, 'utf8')
  const start = source.indexOf("test.describe('PGM-04")
  if (start < 0) throw new Error('không tìm thấy khối describe của PGM-04 trong spec')
  const block = source.slice(start)
  const reasons: string[] = []
  /* Bắt chuỗi lý do — đối số CUỐI của `test.skip`. Một `test.skip` không kèm lý
     do là thứ bị cấm ở đây: nó không nói được vì sao, nên cũng không đối chiếu
     được với sổ. */
  for (const match of block.matchAll(/test\.skip\(([\s\S]{0,400}?)\)\s*\n/g)) {
    const quoted = [...match[1].matchAll(/'([^']*)'/g)].map((item) => item[1])
    const reason = quoted[quoted.length - 1]
    if (!reason || reason === 'desktop-chrome') {
      throw new Error(`test.skip không kèm lý do: ${match[1].trim().slice(0, 120)}`)
    }
    reasons.push(reason)
  }
  return reasons
}
