import { useState } from 'react'
import { Modal } from '../../../shared/components/Modal'
import { useI18n } from '../../../shared/i18n'
import { createUuid } from '../../../shared/crypto'
import { PROGRAMMING_LIBRARY_CATEGORY_ORDER } from '../api/generated/library_registry'
import type { LibraryEntryDraft } from '../api/mutations'
import type { LibraryEntryGroup } from '../model/library'
import type { ProgrammingLibraryEntry } from '../model/types'

/** Cùng biểu thức mà store ép (`libraryIECNamePattern`) — không chặt hơn, không
 *  lỏng hơn: chặt hơn thì chặn tên server nhận, lỏng hơn thì đẩy lỗi xuống 400. */
const LIBRARY_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
const LIBRARY_SOURCE_MAX_BYTES = 65536
/* Trần khớp `ProgrammingLibraryEntryRequest` và cột store: đếm KÝ TỰ, không
   đếm byte. Đếm byte ở FE sẽ chặn một mô tả tiếng Việt mà máy chủ chấp nhận. */
const LIBRARY_CATEGORY_MAX_CHARS = 32
const LIBRARY_DESCRIPTION_MAX_CHARS = 512

export type LibraryEditorMode =
  | { kind: 'create' }
  | { kind: 'edit'; entry: ProgrammingLibraryEntry; savesNewVersion: boolean }

/**
 * `T61-401` — Create/Edit khối PROJECT, mở THEO YÊU CẦU.
 *
 * `AC-PGM04-03` đòi form không được thường trực trên màn hình, và lý do không
 * phải thẩm mỹ: bản trước giữ một Panel "Tạo khối PROJECT" luôn hiện với một
 * câu hướng dẫn thay cho nội dung, nên một phần ba chiều cao khung phải luôn
 * dành cho thứ người dùng không dùng tới — đúng phần chiều cao mà danh sách
 * khối và Inspector đang thiếu.
 *
 * Dùng `Modal` để thừa hưởng bẫy tiêu điểm, `Esc` đóng và trả tiêu điểm về nút
 * đã mở nó — ba thứ mà một `<div>` tự vẽ sẽ phải làm lại và sẽ làm thiếu.
 */
export function LibraryAuthoringDrawer({
  mode,
  disabled,
  projectEntries,
  onCancel,
  onSubmit,
}: {
  mode: LibraryEditorMode | null
  disabled: boolean
  projectEntries: LibraryEntryGroup[]
  onCancel: () => void
  onSubmit: (draft: LibraryEntryDraft) => void
}) {
  if (!mode) return null
  return (
    <AuthoringForm
      // `key` ép state form dựng lại khi đổi khối đang sửa: giữ lại state cũ sẽ
      // mang mã nguồn của khối trước sang khối sau.
      key={mode.kind === 'edit' ? mode.entry.entryId : 'create'}
      mode={mode}
      disabled={disabled}
      projectEntries={projectEntries}
      onCancel={onCancel}
      onSubmit={onSubmit}
    />
  )
}

function AuthoringForm({
  mode,
  disabled,
  projectEntries,
  onCancel,
  onSubmit,
}: {
  mode: LibraryEditorMode
  disabled: boolean
  projectEntries: LibraryEntryGroup[]
  onCancel: () => void
  onSubmit: (draft: LibraryEntryDraft) => void
}) {
  const { pick } = useI18n()
  const existing = mode.kind === 'edit' ? mode.entry : null
  const [name, setName] = useState(existing?.name ?? '')
  const [kind, setKind] = useState<'FUNCTION' | 'FUNCTION_BLOCK'>(
    existing?.kind === 'FUNCTION_BLOCK' ? 'FUNCTION_BLOCK' : 'FUNCTION'
  )
  const [language, setLanguage] = useState<'ST' | 'FBD'>(existing?.language === 'FBD' ? 'FBD' : 'ST')
  const [category, setCategory] = useState(existing?.category ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [source, setSource] = useState('')
  const [dependencies, setDependencies] = useState<string[]>(
    existing ? existing.dependencies.map((item) => item.entryId) : []
  )
  const [touched, setTouched] = useState(false)

  const sourceBytes = new TextEncoder().encode(source).length
  const nameError = !LIBRARY_NAME_PATTERN.test(name.trim())
  const sourceError = sourceBytes < 1 || sourceBytes > LIBRARY_SOURCE_MAX_BYTES
  const descriptionError = [...description].length > LIBRARY_DESCRIPTION_MAX_CHARS
  const invalid = nameError || sourceError || descriptionError
  const selectableDependencies = projectEntries.filter((group) => group.entryId !== existing?.entryId)

  function submit() {
    setTouched(true)
    if (invalid) return
    const trimmedCategory = category.trim()
    const trimmedDescription = description.trim()
    onSubmit({
      entryId: existing?.entryId ?? createUuid(),
      kind,
      name: name.trim(),
      language,
      source,
      // SearchLibraryEntries trả lại interface đã canonical hoá. Khi sửa một
      // entry, giữ nguyên contract đó thay vì âm thầm thay bằng một interface
      // rỗng (interface là một phần của content hash/provenance phía server).
      // Entry mới chưa có contract nên bắt đầu bằng object rỗng tương thích.
      interface: existing?.interface ?? { inputs: [] },
      /* Field VẮNG khi người dùng để trống: upsert ghi đè toàn phần, và một
         chuỗi rỗng gửi lên sẽ được lưu thành "đã điền, nội dung rỗng" — khối
         sẽ hiện như đã phân loại vào một nhóm không tên thay vì hiện `—`. */
      ...(trimmedCategory ? { category: trimmedCategory } : {}),
      ...(trimmedDescription ? { description: trimmedDescription } : {}),
      dependencies: dependencies.map((entryId) => ({
        entryId,
        version: projectEntries.find((group) => group.entryId === entryId)?.current.libraryVersion ?? '1.0.0'
      }))
    })
  }

  return (
    <Modal
      open
      size="lg"
      mobileFullscreen
      title={mode.kind === 'edit' ? pick('Sửa khối PROJECT', 'Edit PROJECT block') : pick('Tạo khối PROJECT', 'New PROJECT block')}
      confirmLabel={pick('Lưu vào bản nháp thư viện', 'Save to library draft')}
      cancelLabel={pick('Huỷ', 'Cancel')}
      confirmDisabled={disabled}
      confirmLoading={disabled}
      onConfirm={submit}
      onClose={onCancel}
    >
      <form
        className="flex flex-col gap-3 text-[var(--c-text)]"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        {existing && (
          <p className="text-xs text-[var(--c-text-dim)]">
            {pick('Đang sửa', 'Editing')} <strong>{existing.name}</strong> · {existing.libraryVersion} · {existing.libraryState}
          </p>
        )}
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[var(--c-text-dim)]">{pick('Tên khối', 'Block name')}</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={64}
            aria-invalid={touched && nameError ? 'true' : undefined}
            className="rounded border border-[var(--c-border)] bg-transparent px-2 py-1.5"
          />
          {touched && nameError && (
            <span role="alert" className="text-xs text-[var(--c-fault-fg)]">
              {pick(
                'Tên phải bắt đầu bằng chữ cái và chỉ gồm chữ, số hoặc gạch dưới, tối đa 64 ký tự.',
                'The name must start with a letter and contain only letters, digits or underscores, up to 64 characters.'
              )}
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[var(--c-text-dim)]">{pick('Loại', 'Kind')}</span>
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as 'FUNCTION' | 'FUNCTION_BLOCK')}
            className="rounded border border-[var(--c-border)] bg-transparent px-2 py-1.5"
          >
            <option value="FUNCTION">FUNCTION</option>
            <option value="FUNCTION_BLOCK">FUNCTION_BLOCK</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[var(--c-text-dim)]">{pick('Ngôn ngữ', 'Language')}</span>
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value as 'ST' | 'FBD')}
            className="rounded border border-[var(--c-border)] bg-transparent px-2 py-1.5"
          >
            <option value="ST">ST</option>
            <option value="FBD">FBD</option>
          </select>
        </label>
        {/* `T61-401` — hai trường metadata trình bày.
            Trước lát này cột `category`/`description` đã có trong store và đã
            được đọc lên màn hình, nhưng KHÔNG có đường ghi nào: mọi khối PROJECT
            hiện "— chưa phân loại" vĩnh viễn và bộ lọc Phân loại không bao giờ
            khớp một khối do người dùng tạo. */}
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[var(--c-text-dim)]">{pick('Phân loại', 'Category')}</span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="rounded border border-[var(--c-border)] bg-transparent px-2 py-1.5"
          >
            {/* Danh sách nhóm lấy từ registry, không viết tay ở FE: registry là
                nơi `category` được định nghĩa nên nó cũng là nơi định nghĩa tập
                giá trị hợp lệ. Một nhóm thêm vào registry mà FE không biết sẽ
                tạo ra khối không lọc được, và người dùng không nhận ra. */}
            <option value="">{pick('— chưa phân loại', '— not categorised')}</option>
            {PROGRAMMING_LIBRARY_CATEGORY_ORDER.filter((item) => item.id.length <= LIBRARY_CATEGORY_MAX_CHARS).map((item) => (
              <option key={item.id} value={item.id}>{pick(item.labelVi, item.labelEn)}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[var(--c-text-dim)]">{pick('Mô tả ngắn', 'Short description')}</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            aria-invalid={touched && descriptionError ? 'true' : undefined}
            className="rounded border border-[var(--c-border)] bg-transparent px-2 py-1.5"
          />
          <span className="text-xs text-[var(--c-text-dim)]">
            {pick('%n/512 ký tự', '%n/512 characters').replace('%n', String([...description].length))}
          </span>
          {touched && descriptionError && (
            <span role="alert" className="text-xs text-[var(--c-fault-fg)]">
              {pick('Mô tả tối đa 512 ký tự.', 'The description is at most 512 characters.')}
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[var(--c-text-dim)]">
            {language === 'FBD' ? pick('Nội dung FBD (JSON)', 'FBD content (JSON)') : pick('Mã nguồn ST', 'ST source')}
          </span>
          <textarea
            value={source}
            onChange={(event) => setSource(event.target.value)}
            required
            rows={5}
            aria-invalid={touched && sourceError ? 'true' : undefined}
            className="rounded border border-[var(--c-border)] bg-transparent px-2 py-1.5 font-mono text-xs"
          />
          {existing && (
            <span className="text-xs text-[var(--c-text-dim)]">
              {pick(
                'Máy chủ không trả lại mã nguồn của khối đã lưu, nên ô này luôn bắt đầu trống: hãy dán lại toàn bộ mã của phiên bản mới.',
                'The server does not return the stored source, so this field always starts empty: paste the full source of the new version.'
              )}
            </span>
          )}
          {touched && sourceError && (
            <span role="alert" className="text-xs text-[var(--c-fault-fg)]">
              {pick('Mã nguồn phải dài 1..65536 byte.', 'The source must be 1..65536 bytes long.')}
            </span>
          )}
        </label>
        {selectableDependencies.length > 0 && (
          <fieldset className="flex flex-col gap-1 text-sm">
            <legend className="text-[var(--c-text-dim)]">{pick('Phụ thuộc khối PROJECT', 'PROJECT block dependencies')}</legend>
            {selectableDependencies.map((group) => (
              <label key={group.entryId} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={dependencies.includes(group.entryId)}
                  onChange={(event) =>
                    setDependencies((current) =>
                      event.target.checked ? [...current, group.entryId] : current.filter((id) => id !== group.entryId)
                    )
                  }
                />
                <span>
                  {group.name} · {group.current.libraryVersion}
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {/* Nút gửi thật nằm ở chân `Modal`; nút này để `Enter` trong ô nhập vẫn
            gửi được form, và nó bị ẩn khỏi trình đọc màn hình để không thành hai
            nút Lưu. */}
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true">
          {pick('Lưu vào bản nháp thư viện', 'Save to library draft')}
        </button>
      </form>
    </Modal>
  )
}
