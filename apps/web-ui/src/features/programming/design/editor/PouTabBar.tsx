import { FileCode2, Network, X } from 'lucide-react'

import { useI18n } from '../../../../shared/i18n'
import type { PouTab, PouTabsState } from './pouTabs'

/**
 * `T59-821` / `PGM02-V22-WP-15` — thanh tab đa POU (`UD-PROG-014` phương án B).
 *
 * Tab bắc qua cả ST lẫn FBD, đúng như hai ảnh render 2026-08-27. Ngôn ngữ được
 * ghi bằng **chữ và icon**, không bằng màu: màu không bao giờ là tín hiệu duy
 * nhất.
 *
 * Tab trỏ tới POU đã bị xoá ở phiên khác **ở lại** và tự khai điều đó. Tự đóng
 * nó sẽ che đi chính sự kiện người dùng cần biết.
 */
export function PouTabBar({
  state,
  missingKeys,
  dirtyKeys,
  onActivate,
  onClose,
  onOpenPicker,
  limitNotice,
}: {
  state: PouTabsState
  missingKeys: ReadonlySet<string>
  dirtyKeys: ReadonlySet<string>
  onActivate: (key: string) => void
  onClose: (key: string) => void
  onOpenPicker?: () => void
  /** Lý do đọc được khi không mở thêm được tab. Cấm nút chết không giải thích. */
  limitNotice?: string | null
}) {
  const { pick } = useI18n()
  if (state.tabs.length === 0) return null

  return (
    <div>
      {/* KHÔNG dùng `role="tablist"`/`role="tab"`.
        *
        * Hai role đó là một hợp đồng: mỗi `tab` phải `aria-controls` một
        * `tabpanel`, và bàn phím phải đi bằng phím mũi tên với đúng một tab nằm
        * trong thứ tự Tab. Ở đây không có `tabpanel` nào — trình soạn thảo bên
        * dưới không được gắn nhãn theo tab, và mỗi tab còn mang thêm một nút
        * Đóng, tức một phần tử tương tác lồng trong `tab`. Khai `tablist` mà
        * không giữ hợp đồng đó chính là lỗi `aria-required-children` mà axe bắt
        * được trên canvas FBD.
        *
        * Danh sách + `aria-current` mô tả ĐÚNG thứ đang có: một dãy nút điều
        * hướng, một cái đang được chọn. */}
      <ul
        aria-label={pick('POU đang mở', 'Open POUs')}
        data-testid="pou-tab-bar"
        className="flex flex-wrap items-center gap-1 border-b border-[var(--c-border)] pb-1"
      >
        {state.tabs.map((tab) => (
          <TabButton
            key={tab.key}
            tab={tab}
            active={state.activeKey === tab.key}
            missing={missingKeys.has(tab.key)}
            dirty={dirtyKeys.has(tab.key)}
            onActivate={() => onActivate(tab.key)}
            onClose={() => onClose(tab.key)}
          />
        ))}
        {onOpenPicker && (
          <li>
          <button
            type="button"
            data-testid="pou-tab-add"
            className="rounded-[var(--radius)] px-2 py-1 text-sm text-[var(--c-text-dim)] hover:bg-[var(--c-surface-2)] disabled:opacity-60"
            disabled={Boolean(limitNotice)}
            title={limitNotice ?? pick('Mở thêm POU', 'Open another POU')}
            onClick={onOpenPicker}
          >
            +<span className="sr-only">{pick('Mở thêm POU', 'Open another POU')}</span>
          </button>
          </li>
        )}
      </ul>
      {limitNotice && (
        <p role="status" data-testid="pou-tab-limit" className="mt-1 text-xs text-[var(--c-warn-fg)]">
          {limitNotice}
        </p>
      )}
    </div>
  )
}

function TabButton({
  tab, active, missing, dirty, onActivate, onClose,
}: {
  tab: PouTab
  active: boolean
  missing: boolean
  dirty: boolean
  onActivate: () => void
  onClose: () => void
}) {
  const { pick } = useI18n()
  const Icon = tab.language === 'FBD' ? Network : FileCode2
  return (
    <li
      data-testid="pou-tab"
      data-tab-key={tab.key}
      data-active={active}
      data-missing={missing}
      className={`inline-flex items-center gap-1 rounded-t-[var(--radius)] border-b-2 px-2 py-1 text-sm ${
        active ? 'border-[var(--c-accent)] bg-[var(--c-surface-2)]' : 'border-transparent'
      }`}
    >
      <button
        type="button"
        aria-current={active ? 'true' : undefined}
        className="inline-flex items-center gap-1 text-left"
        onClick={onActivate}
      >
        <Icon className="h-3.5 w-3.5 text-[var(--c-text-dim)]" aria-hidden="true" />
        <span className={missing ? 'line-through text-[var(--c-text-dim)]' : 'text-[var(--c-text)]'}>
          {tab.lastKnownName}
        </span>
        {/* Ngôn ngữ bằng CHỮ, không chỉ bằng icon hay màu. */}
        <span className="text-[10px] uppercase text-[var(--c-text-dim)]">{tab.language}</span>
        {dirty && (
          <span className="text-[var(--c-warn-fg)]" title={pick('Có thay đổi chưa lưu', 'Unsaved changes')}>
            •<span className="sr-only">{pick('Có thay đổi chưa lưu', 'Unsaved changes')}</span>
          </span>
        )}
        {missing && (
          <span className="text-[10px] text-[var(--c-fault-fg)]">
            {pick('(đã bị xoá)', '(deleted)')}
          </span>
        )}
      </button>
      <button
        type="button"
        data-testid="pou-tab-close"
        aria-label={pick(`Đóng ${tab.lastKnownName}`, `Close ${tab.lastKnownName}`)}
        className="rounded p-0.5 text-[var(--c-text-dim)] hover:bg-[var(--c-surface)] hover:text-[var(--c-text)]"
        onClick={onClose}
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </li>
  )
}
