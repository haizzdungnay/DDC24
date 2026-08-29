import { useRef } from 'react'
import { AlertTriangle, ArchiveX, ArrowRightToLine, ExternalLink, History, Pencil, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '../../../shared/components/Button'
import { useI18n } from '../../../shared/i18n'
import {
  blockSignatureLine,
  categoryLabel,
  insertBlockReason,
  metadataValue,
  scopeLabel,
  usageDisplay,
} from './libraryPresentation'
import type { LibraryEntryGroup, LibraryUsage } from '../model/library'
import type { libraryEntryPermissions } from '../model/library'
import type { ProgrammingLibraryEntry, ProgrammingLibraryUsage } from '../model/types'

/**
 * `T61-204`/`T61-304` — bốn khay của Inspector theo handoff §3.
 *
 * Tab nằm trong URL cùng `entry`, nên gửi một đường dẫn là gửi đúng thứ mình
 * đang nhìn: khối nào, và đang xem mặt nào của nó.
 */
export const INSPECTOR_TABS = [
  { id: 'details', labelVi: 'Chi tiết', labelEn: 'Details' },
  { id: 'parameters', labelVi: 'Tham số', labelEn: 'Parameters' },
  { id: 'used-in', labelVi: 'Nơi sử dụng', labelEn: 'Used In' },
  { id: 'versions', labelVi: 'Phiên bản', labelEn: 'Versions' },
] as const
export type InspectorTab = (typeof INSPECTOR_TABS)[number]['id']

export function isInspectorTab(value: string | null): value is InspectorTab {
  return INSPECTOR_TABS.some((item) => item.id === value)
}

export function LibraryInspector({
  group,
  usages,
  usageSource,
  sealedUsage,
  sealedUsageLoading,
  tab,
  onTab,
  dependents,
  permissions,
  pending,
  canDeprecate,
  canInsert,
  usedInHref,
  onEdit,
  onDelete,
  onDeprecate,
  onInsert,
}: {
  group: LibraryEntryGroup | null
  usages: LibraryUsage[]
  usageSource: 'loading' | 'ready' | 'error'
  sealedUsage: ProgrammingLibraryUsage | null
  sealedUsageLoading: boolean
  tab: InspectorTab
  onTab: (value: InspectorTab) => void
  dependents: string[]
  permissions: ReturnType<typeof libraryEntryPermissions> | null
  pending: boolean
  canDeprecate: boolean
  /** Khổ màn/vai có cho phép mở đường Chèn không. Lý do bị chặn thuộc về khối. */
  canInsert: boolean
  /** Đường tới đúng POU trong PGM-02, hoặc `null` khi POU không nằm trong Project đang mở. */
  usedInHref: (objectId: string, projectId?: string) => string | null
  onEdit: (group: LibraryEntryGroup) => void
  onDelete: (group: LibraryEntryGroup) => void
  onDeprecate: (revision: ProgrammingLibraryEntry) => void
  onInsert: (group: LibraryEntryGroup) => void
}) {
  const { pick } = useI18n()
  const tabRefs = useRef(new Map<InspectorTab, HTMLButtonElement>())
  if (!group || !permissions) {
    return <p className="text-sm text-[var(--c-text-dim)]">{pick('Chọn một khối để xem chi tiết.', 'Select a block to see its details.')}</p>
  }
  const entry = group.current
  const signature = blockSignatureLine(entry)
  const reviewRequired = entry.featureState === 'REVIEW_REQUIRED'
  const insertBlock = insertBlockReason(entry, canInsert)

  /* `role="tablist"` là hợp đồng với người dùng bàn phím: mũi tên đi giữa tab,
     `Tab` rời khỏi cả dải. Thiếu nó thì mỗi tab là một điểm dừng riêng và một
     dải bốn tab ăn bốn nhịp `Tab` trước khi tới nội dung. */
  function moveTab(delta: number) {
    const index = INSPECTOR_TABS.findIndex((item) => item.id === tab)
    const next = INSPECTOR_TABS[(index + delta + INSPECTOR_TABS.length) % INSPECTOR_TABS.length]
    onTab(next.id)
    tabRefs.current.get(next.id)?.focus()
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        role="tablist"
        aria-label={pick('Khay chi tiết khối', 'Block detail panels')}
        className="flex flex-wrap gap-1 border-b border-[var(--c-border)] pb-1"
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') {
            event.preventDefault()
            moveTab(1)
          } else if (event.key === 'ArrowLeft') {
            event.preventDefault()
            moveTab(-1)
          }
        }}
      >
        {INSPECTOR_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`library-inspector-tab-${item.id}`}
            ref={(element) => {
              if (element) tabRefs.current.set(item.id, element)
              else tabRefs.current.delete(item.id)
            }}
            aria-selected={tab === item.id}
            /* `aria-controls` chỉ trỏ tới khay ĐANG hiện.
               Trước lát này cả bốn tab đều trỏ tới `panel-<id>` của riêng
               chúng, trong khi trong cây chỉ có MỘT khay mang `id` của tab đang
               mở — nên ba trong bốn tab trỏ vào một `id` không tồn tại, và trình
               đọc màn hình không đi tới được nội dung mà tab hứa sẽ mở. */
            aria-controls={tab === item.id ? 'library-inspector-panel' : undefined}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => onTab(item.id)}
            className={`min-h-7 rounded px-2 py-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)] ${
              tab === item.id ? 'bg-[var(--c-accent-bg)] text-[var(--c-accent)]' : 'text-[var(--c-text-dim)]'
            }`}
          >
            {pick(item.labelVi, item.labelEn)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="library-inspector-panel"
        aria-labelledby={`library-inspector-tab-${tab}`} className="flex flex-col gap-3">
        <dl className={`flex-col gap-2 text-sm ${tab === 'details' ? 'flex' : 'hidden'}`}>
          <Row label={pick('Tên', 'Name')} value={entry.name} />
          <Row label={pick('Loại', 'Kind')} value={entry.kind} />
          <Row label={pick('Phạm vi', 'Scope')} value={scopeLabel(entry.scope, false)} />
          {/* `metadataValue` trả `null` cho field VẮNG, và ở đây `null` phải
              thành `—` KÈM lý do: một ô trống đọc như "đã điền rồi và nội dung
              rỗng", nên người dùng sẽ không đi tìm chỗ để điền. */}
          <Row
            label={pick('Phân loại', 'Category')}
            value={metadataValue(entry.category)
              ? categoryLabel(entry.category as string, pick)
              : pick('— chưa phân loại', '— not categorised')}
          />
          <Row
            label={pick('Mô tả', 'Description')}
            value={metadataValue(entry.description) ?? pick('— chưa có mô tả', '— no description yet')}
          />
          <Row
            label={pick('Chữ ký', 'Signature')}
            value={signature.kind === 'ready'
              ? signature.text
              : pick('Chưa đọc được chữ ký', 'Signature could not be read')}
          />
          <Row label={pick('Ngôn ngữ', 'Language')} value={entry.language ?? '—'} />
          <Row label={pick('Phiên bản thư viện', 'Library version')} value={`${entry.libraryVersion} · ${entry.libraryState}`} />
          <Row label={pick('Hash nội dung', 'Content hash')} value={entry.contentSha256.slice(0, 16) + '…'} />
          <Row
            label={pick('Kích thước state', 'State size')}
            value={
              entry.stateLayoutKnown
                ? `${entry.stateSizeBytes} B`
                : pick('Chưa biết — chờ biên dịch', 'Unknown — pending compile')
            }
          />
          <Row
            label={pick('Phụ thuộc', 'Dependencies')}
            value={
              entry.dependencies.length === 0
                ? pick('Không có', 'None')
                : entry.dependencies.map((item) => `${item.entryId.slice(0, 8)}@${item.version}`).join(', ')
            }
          />
          <Row
            label={pick('Khối phụ thuộc vào nó', 'Depended on by')}
            value={dependents.length === 0 ? pick('Không có', 'None') : dependents.join(', ')}
          />
        </dl>

        {/* `hidden` chứ không phải tháo khỏi cây: khay Used-In tự đọc dữ liệu,
            và tháo nó ra sẽ huỷ rồi phát lại request mỗi lần đổi tab. */}
        <div className={tab === 'used-in' ? 'contents' : 'hidden'}>
          <LibraryUsageList
            usages={usages}
            source={usageSource}
            sealed={sealedUsage}
            sealedLoading={sealedUsageLoading}
            usedInHref={usedInHref}
          />
        </div>
        <div className={tab === 'versions' ? 'contents' : 'hidden'}>
          <LibraryVersionHistory
            group={group}
            canDeprecate={canDeprecate}
            pending={pending}
            onDeprecate={onDeprecate}
          />
        </div>
        {tab === 'parameters' && <LibraryParameters entry={entry} />}
      </div>

      {reviewRequired && (
        <p role="note" className="flex items-start gap-1.5 text-sm text-[var(--c-warn-fg)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {pick(
            'Khối này chưa qua review Controls/Safety nên Kiểm tra sẽ từ chối mọi Program dùng nó.',
            'This block has not passed Controls/Safety review, so Check rejects any program that uses it.'
          )}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {/* `AC-PGM04-06` — Chèn LUÔN hiện, và khi bị khoá thì hiện kèm lý do.
            Ẩn nút làm người dùng tưởng thiết bị không có khả năng đó rồi đi hỏi
            sai người; nút bị khoá kèm lý do thì họ đọc được ngay tại chỗ. */}
        <Button
          size="sm"
          icon={<ArrowRightToLine className="h-4 w-4" aria-hidden="true" />}
          disabled={insertBlock === 'REVIEW_REQUIRED' || insertBlock === 'DEPRECATED' || !canInsert}
          aria-describedby={insertBlock || !canInsert ? 'library-insert-reason' : undefined}
          onClick={() => onInsert(group)}
        >
          {pick('Chèn vào POU…', 'Insert into a POU…')}
        </Button>
        {(insertBlock || !canInsert) && (
          <span id="library-insert-reason" className="text-xs text-[var(--c-text-dim)]">
            {insertBlock === 'REVIEW_REQUIRED'
              ? pick('Chưa chèn được: khối đang chờ review Controls/Safety.',
                     'Cannot insert: the block is awaiting Controls/Safety review.')
              : insertBlock === 'DEPRECATED'
                ? pick('Chưa chèn được: phiên bản này đã ngừng sử dụng.',
                       'Cannot insert: this version is deprecated.')
                : pick('Chưa chèn được: màn hình này đang ở chế độ chỉ đọc.',
                       'Cannot insert: this screen is read-only right now.')}
          </span>
        )}
      </div>

      {entry.scope === 'SYSTEM' ? (
        <p className="text-sm text-[var(--c-text-dim)]">
          {pick(
            'Khối SYSTEM là registry chỉ đọc: không sửa, không xoá, không tạo phiên bản.',
            'SYSTEM blocks come from the read-only registry: no edit, no delete, no new version.'
          )}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            icon={<Pencil className="h-4 w-4" aria-hidden="true" />}
            disabled={pending || !permissions.canSave}
            onClick={() => onEdit(group)}
          >
            {permissions.savesNewVersion ? pick('Sửa — tạo phiên bản mới', 'Edit — create a new version') : pick('Sửa khối', 'Edit block')}
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
            disabled={pending || !permissions.canDelete}
            onClick={() => onDelete(group)}
          >
            {pick('Xoá khối', 'Delete block')}
          </Button>
        </div>
      )}
      {permissions.savesNewVersion && entry.scope === 'PROJECT' && (
        <p className="text-xs text-[var(--c-text-dim)]">
          {pick(
            'Phiên bản hiện tại đã phát hành. Lưu thay đổi sẽ mở một phiên bản nháp mới; nó chỉ được phát hành khi bạn niêm phong Revision ở trang Kiểm tra.',
            'The current version is published. Saving opens a new draft version; it is published only when you seal a revision on the Check page.'
          )}
        </p>
      )}
    </div>
  )
}

/**
 * `T61-204`/`T61-403` — Used-In với HAI NGUỒN được gắn nhãn tách bạch.
 *
 * Không gộp thành một con số, và lý do không phải trình bày:
 *
 *  - Phần **đã niêm phong** đến từ server (`library_usages`), phủ mọi Project,
 *    và là thứ nói được "khối này đang chạy ở đâu".
 *  - Phần **bản nháp** tính ở FE từ chính Draft đang mở, nên nó CHỈ phủ Project
 *    hiện tại. Gọi nó là "bản nháp" nói chung sẽ hứa rộng hơn sự thật.
 *
 * Gộp hai con số lại là cách một khối bị deprecate trong khi nó đang điều khiển
 * tủ: người dùng thấy "0 nơi dùng" của bản nháp và tưởng đó là toàn bộ.
 */
function LibraryUsageList({
  usages,
  source,
  sealed,
  sealedLoading,
  usedInHref,
}: {
  usages: LibraryUsage[]
  source: 'loading' | 'ready' | 'error'
  sealed: ProgrammingLibraryUsage | null
  sealedLoading: boolean
  usedInHref: (objectId: string, projectId?: string) => string | null
}) {
  const { pick } = useI18n()
  const sealedView = usageDisplay(sealed, sealedLoading)
  return (
    <section aria-label={pick('Nơi sử dụng', 'Usage')} className="border-t border-[var(--c-border)] pt-2">
      <h3 className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Nơi sử dụng', 'Usage')}</h3>

      {/* Phạm vi 1: gói ĐÃ NIÊM PHONG, đọc từ server, phủ mọi Project. */}
      <div className="mt-1 rounded border border-[var(--c-border)] p-2">
        <p className="text-xs font-medium text-[var(--c-text)]">
          {pick('Trong Revision đã niêm phong', 'In sealed revisions')}
        </p>
        {sealedView.kind === 'loading' ? (
          /* Đang đọc — KHÔNG được mượn câu lý do của `UNAVAILABLE`. */
          <p className="text-sm text-[var(--c-text-dim)]">{pick('Đang đọc nơi sử dụng…', 'Reading usage…')}</p>
        ) : sealedView.kind === 'unavailable' ? (
          /* `UNAVAILABLE` KHÔNG được hiện thành 0. `0` nghĩa là "không ai dùng"
             — một câu mời người ta xoá khối; đây là "chưa đo được". */
          <p className="text-sm text-[var(--c-warn-fg)]">
            {pick('Chưa đo được — khối SYSTEM phân giải nơi dùng từ registry, không qua bảng usage.',
                  'Not measured — SYSTEM blocks resolve usage from the registry, not the usage table.')}
          </p>
        ) : (
          <>
            <p className="text-sm text-[var(--c-text)]">
              {pick('%n nơi dùng', '%n usages').replace('%n', String(sealedView.sealed))}
              {sealedView.truncated ? pick(' (còn nữa)', ' (more not listed)') : ''}
            </p>
            {sealed !== null && sealed.sealed.items.length > 0 && (
              /* `gap-1` + hàng cao tối thiểu 24 px: WCAG 2.2 `target-size`
                 đòi vùng chạm >= 24×24 px HOẶC đủ khoảng cách, và từ khi các
                 mục này thành link thì chúng là vùng chạm thật. Một hàng cao
                 16 px cách nhau 12,8 px là chỗ ngón tay bấm nhầm sang POU bên
                 cạnh — và POU bên cạnh là một chương trình khác. */
              <ul className="mt-1 flex flex-col gap-1 text-xs text-[var(--c-text-dim)]">
                {sealed.sealed.items.slice(0, 10).map((item) => {
                  const href = usedInHref(item.objectId, item.projectId)
                  const label = `${item.projectName} › ${item.objectName || item.objectId.slice(0, 8)}`
                  return (
                    <li key={`${item.revisionId}:${item.objectId}:${item.usageKind}`}
                      className="flex min-h-6 items-center justify-between gap-2">
                      {/* `AC-PGM04-02` — Used-In phải đi tới được. Một danh sách
                          tên POU không bấm được bắt người dùng tự tìm lại POU đó
                          bằng mắt trong PGM-02, và đó đúng là lúc họ mở nhầm
                          POU trùng tên ở Project khác. */}
                      {href ? (
                        <Link to={href} className="flex min-h-6 min-w-0 items-center gap-1 text-[var(--c-accent)] underline">
                          <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span className="truncate">{label}</span>
                        </Link>
                      ) : (
                        <span className="truncate" title={pick('POU này thuộc Project khác', 'This POU belongs to another project')}>
                          {label}
                        </span>
                      )}
                      <span className="shrink-0">
                        {item.usageKind}
                        {item.isActive ? pick(' · đang chạy', ' · running') : ''}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </div>

      <p className="mt-2 text-xs font-medium text-[var(--c-text)]">
        {pick('Trong bản nháp của Project này', "In this project's draft")}
      </p>
      {source === 'loading' && <p className="text-sm text-[var(--c-text-dim)]">{pick('Đang đọc bản nháp…', 'Reading the draft…')}</p>}
      {source === 'error' && (
        <p className="text-sm text-[var(--c-warn-fg)]">
          {pick('Chưa đọc được bản nháp nên chưa biết nơi sử dụng.', 'The draft could not be read, so usage is unknown.')}
        </p>
      )}
      {source === 'ready' &&
        (usages.length === 0 ? (
          <p className="text-sm text-[var(--c-text-dim)]">
            {pick('Chưa POU nào trong bản nháp khai khối này là phụ thuộc.', 'No POU in the draft declares this block as a dependency.')}
          </p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {usages.map((usage) => {
              const href = usedInHref(usage.objectId)
              return (
                <li key={usage.objectId} className="flex min-h-6 items-center justify-between gap-3">
                  {href ? (
                    <Link to={href} className="flex min-h-6 min-w-0 items-center gap-1 text-[var(--c-accent)] underline">
                      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span className="truncate">{usage.name}</span>
                    </Link>
                  ) : (
                    <span className="truncate">{usage.name}</span>
                  )}
                  <span className="shrink-0 text-xs text-[var(--c-text-dim)]">{usage.kind}</span>
                </li>
              )
            })}
          </ul>
        ))}
    </section>
  )
}

function LibraryVersionHistory({
  group,
  canDeprecate,
  pending,
  onDeprecate
}: {
  group: LibraryEntryGroup
  canDeprecate: boolean
  pending: boolean
  onDeprecate: (revision: ProgrammingLibraryEntry) => void
}) {
  const { pick } = useI18n()
  return (
    <section aria-label={pick('Lịch sử phiên bản', 'Version history')} className="border-t border-[var(--c-border)] pt-2">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase text-[var(--c-text-dim)]">
        <History className="h-3.5 w-3.5" aria-hidden="true" />
        {pick('Lịch sử phiên bản', 'Version history')}
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs uppercase text-[var(--c-text-dim)]">
              <th className="py-1 pr-3">{pick('Phiên bản', 'Version')}</th>
              <th className="py-1 pr-3">{pick('Trạng thái', 'State')}</th>
              <th className="py-1 pr-3">{pick('Hash', 'Hash')}</th>
              {canDeprecate && <th className="py-1 text-right">{pick('Thao tác', 'Action')}</th>}
            </tr>
          </thead>
          <tbody>
            {group.versions.map((version) => (
              <tr key={version.libraryRevisionId} className="border-t border-[var(--c-border)]">
                <td className="py-1 pr-3 font-medium">{version.libraryVersion}</td>
                <td className="py-1 pr-3">{version.libraryState}</td>
                <td className="py-1 pr-3 font-mono text-xs">{version.contentSha256.slice(0, 12)}…</td>
                {canDeprecate && (
                  <td className="py-1 text-right">
                    {version.scope === 'PROJECT' && version.libraryState === 'PUBLISHED' ? (
                      <Button
                        size="sm"
                        variant="danger"
                        icon={<ArchiveX className="h-4 w-4" aria-hidden="true" />}
                        disabled={pending}
                        aria-label={pick(
                          `Ngừng sử dụng phiên bản ${version.libraryVersion}`,
                          `Deprecate version ${version.libraryVersion}`
                        )}
                        onClick={() => onDeprecate(version)}
                      >
                        {pick('Ngừng sử dụng', 'Deprecate')}
                      </Button>
                    ) : (
                      <span aria-label={pick('Không có thao tác', 'No action')} className="text-[var(--c-text-dim)]">—</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[var(--c-text-dim)]">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{value}</dd>
    </div>
  )
}

/**
 * Khay Tham số. Đọc `signature` ĐÃ PHÂN GIẢI do backend công bố. Vắng field
 * nghĩa là backend không đọc được chữ ký thô — nói ra điều đó, đừng tự parse
 * `interface` để đoán hộ: hai nơi cùng đoán là hai nơi kết luận khác nhau về
 * cùng một khối, và người dùng không có cách nào biết bên nào đúng.
 */
function LibraryParameters({ entry }: { entry: ProgrammingLibraryEntry }) {
  const { pick } = useI18n()
  const ports = entry.signature?.ports ?? []
  if (!entry.signature) {
    return (
      <p className="text-sm text-[var(--c-warn-fg)]">
        {pick('Thiết bị chưa đọc được chữ ký của khối này, nên chưa liệt kê được tham số.',
              'The controller could not read this block signature, so parameters are unavailable.')}
      </p>
    )
  }
  if (ports.length === 0) {
    return (
      <p className="text-sm text-[var(--c-text-dim)]">
        {pick('Khối này không khai tham số nào.', 'This block declares no parameters.')}
      </p>
    )
  }
  return (
    <table className="w-full text-left text-sm">
      <caption className="sr-only">{pick('Tham số của khối', 'Block parameters')}</caption>
      <thead className="text-xs uppercase text-[var(--c-text-dim)]">
        <tr>
          <th scope="col" className="py-1">{pick('Tên', 'Name')}</th>
          <th scope="col" className="py-1">{pick('Hướng', 'Direction')}</th>
          <th scope="col" className="py-1">{pick('Kiểu', 'Type')}</th>
        </tr>
      </thead>
      <tbody>
        {ports.map((port) => (
          <tr key={`${port.direction}:${port.name}`} className="border-t border-[var(--c-border)]">
            <td className="py-1 font-mono">{port.name}</td>
            <td className="py-1">{port.direction}</td>
            <td className="py-1 font-mono">{port.dataType}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
