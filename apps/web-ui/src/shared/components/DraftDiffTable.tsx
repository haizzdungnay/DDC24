import { useI18n } from '../i18n'

/**
 * Bảng khác biệt "bản đang lưu ↔ bản nháp" — khối `BB-8` của Plan 57.
 *
 * VÌ SAO TÁCH RA DÙNG CHUNG
 *
 * Mẫu này đã có ở trang Mạng (`NetworkCandidateDiff`, PA3-506) và nó đúng: nêu
 * từng trường, giá trị cũ, giá trị mới, và **không hiện gì khi không có khác
 * biệt** — một bảng toàn dấu "=" chỉ làm loãng màn hình. Nhưng nó nằm cục bộ
 * trong `NetworkPage`, nên trang thứ hai cần cùng thứ đó (`T57-2.10` cho Ngõ
 * vào) chỉ có hai lựa chọn: chép tay hoặc bỏ qua. Chép tay là cơ chế sinh lỗi
 * số 3 của review §7.3 — hai bản sao lệch nhau ngay lần đầu ai đó sửa một bên.
 *
 * LUẬT
 *
 *  1. Chỉ nhận **hàng đã khác biệt**. Component không tự so sánh: mỗi trang có
 *     ngữ nghĩa "bằng nhau" riêng (prefix length ↔ subnet mask ở trang Mạng,
 *     số thực ↔ nhãn đơn vị ở trang Ngõ vào), ép về một hàm so sánh chung sẽ
 *     đẻ ra một lớp generic phức tạp hơn chính chỗ nó phục vụ.
 *  2. `group` gom hàng theo đối tượng (kênh `UI-03`, thiết bị…). Không có
 *     `group` thì bảng phẳng như trang Mạng.
 *  3. Rỗng ⇒ trả `emptyText` chứ không trả `null`: người dùng vừa bấm "Lưu"
 *     cần biết **vì sao không có gì để lưu**, im lặng là một lỗi khác.
 */
export interface DraftDiffRow {
  /** Nhóm hàng — ví dụ kênh `UI-03`. Bỏ trống nếu chỉ có một đối tượng. */
  group?: string
  label: string
  from: string
  to: string
}

export interface DraftDiffTableProps {
  rows: DraftDiffRow[]
  /** Nhãn cột giá trị cũ. Mặc định "Đang lưu" — trang Mạng dùng "Đang chạy". */
  fromHeader?: string
  toHeader?: string
  /** Câu hiện khi không có khác biệt nào. */
  emptyText?: string
  /** Dòng tiêu đề đếm số thay đổi. Bỏ trống ⇒ dùng câu mặc định. */
  title?: string
}

export function DraftDiffTable({ rows, fromHeader, toHeader, emptyText, title }: DraftDiffTableProps) {
  const { pick } = useI18n()

  if (rows.length === 0) {
    return (
      <p className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 py-2 text-xs text-[var(--c-text-dim)]">
        {emptyText ?? pick('Bản nháp trùng với bản đang lưu — không có gì để lưu.', 'The draft matches the saved configuration — nothing to save.')}
      </p>
    )
  }

  return (
    <div className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-3">
      <div className="mb-2 text-xs font-bold uppercase text-[var(--c-warn-fg)]">
        {title ?? pick(`${rows.length} thay đổi chưa lưu`, `${rows.length} unsaved change(s)`)}
      </div>
      <div className="max-h-[42vh] overflow-y-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase text-[var(--c-text-dim)]">
              <th className="py-1 pr-3">{pick('Trường', 'Field')}</th>
              <th className="py-1 pr-3">{fromHeader ?? pick('Đang lưu', 'Saved')}</th>
              <th className="py-1">{toHeader ?? pick('Sẽ đổi thành', 'Will become')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              /* Tiêu đề nhóm chỉ hiện khi ĐỔI nhóm: lặp lại "UI-03" trên từng
                 hàng của cùng một kênh làm mắt phải lọc lại thứ mình đã biết. */
              const groupChanged = Boolean(row.group) && row.group !== rows[index - 1]?.group
              return (
                <tr key={`${row.group ?? ''}:${row.label}`} className="border-t border-[var(--c-warn)]">
                  <td className="py-1 pr-3 font-semibold">
                    {groupChanged && <span className="mono mr-2 text-[var(--c-warn-fg)]">{row.group}</span>}
                    {row.label}
                  </td>
                  <td className="mono py-1 pr-3 text-[var(--c-text-dim)]">{row.from}</td>
                  <td className="mono py-1 font-semibold text-[var(--c-warn-fg)]">{row.to}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
