import { useI18n } from '../../../../shared/i18n'
import { presentStRuntimeValue } from '../editor/StRuntimeValueOverlay'
import {
  inspectorContextFor,
  inspectorHasUsefulContext,
  type InspectorContext,
  type InspectorField,
  type InspectorInput,
  type InspectorRuntimeValue,
} from './inspectorContext'

/**
 * `T59-818` / `PGM02-V22-WP-14` — Inspector dùng chung cho ST và FBD.
 *
 * Trước lát này, khay "Thuộc tính" nằm trong `ProgramsTab.tsx` và có đúng hai
 * trường (`Tên`, `Loại`) — tức rơi trúng điều mà handoff §9 cấm thẳng:
 * *"Inspector SHALL NOT permanently consume 300 px for two fields; collapse
 * when no useful context."* Bốn ngữ cảnh còn lại chưa từng có.
 *
 * Hai luật của component này:
 *
 * 1. **Thu gọn khi không có gì đáng nói.** Quyết định đó nằm ở lớp thuần
 *    (`inspectorHasUsefulContext`) để test kiểm được mà không phải đo pixel.
 * 2. **"Không xác định được" là một giá trị hợp lệ và được hiển thị như vậy.**
 *    Không có ô trống, không có `0`, không có kiểu đoán. Người đọc phải phân
 *    biệt được "chưa biết" với "biết là không có".
 *
 * `UD-PROG-015` đang mở: `Access`, `Description` và TÊN Task không có nguồn
 * trong Draft v2 nên không xuất hiện ở đây — kể cả dưới dạng ô trống.
 */
export function ContextInspector({
  input,
  editableProgramSlot,
}: {
  input: InspectorInput
  /**
   * Phần sửa metadata Program (tên/loại) do `ProgramsTab` sở hữu vì nó gắn với
   * transaction Draft. Inspector chỉ dành chỗ, không nhân bản luồng lưu.
   */
  editableProgramSlot?: React.ReactNode
}) {
  const { pick } = useI18n()
  const context = inspectorContextFor(input)
  const useful = inspectorHasUsefulContext(context)

  return (
    <section
      className="rounded-[var(--radius)] border border-[var(--c-border)] p-3"
      aria-label={pick('Thuộc tính', 'Inspector')}
      data-testid="context-inspector"
      data-context={context.kind}
    >
      <h3 className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">
        {pick('Thuộc tính', 'Inspector')}
        <span className="ml-2 font-normal normal-case text-[var(--c-text-dim)]">
          {contextLabel(pick, context.kind)}
        </span>
      </h3>

      {!useful && editableProgramSlot === undefined ? (
        /* Thu gọn: một dòng, không chiếm chỗ. Đây là vế còn lại của luật §9 —
           khay chỉ nở ra khi có ngữ cảnh đáng đọc. */
        <p className="mt-1 text-xs text-[var(--c-text-dim)]" data-testid="inspector-collapsed">
          {pick('Chưa có ngữ cảnh nào để xem. Chọn một POU, một ký hiệu hoặc một khối.',
                'No context yet. Select a POU, a symbol, or a block.')}
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          {editableProgramSlot}
          {renderContext(pick, context)}
        </div>
      )}
    </section>
  )
}

function contextLabel(pick: (vi: string, en: string) => string, kind: InspectorContext['kind']): string {
  switch (kind) {
    case 'PROGRAM': return pick('Chương trình', 'Program')
    case 'VARIABLE': return pick('Biến', 'Variable')
    case 'ST_SYMBOL': return pick('Ký hiệu ST', 'ST symbol')
    case 'FBD_BLOCK': return pick('Khối FBD', 'FBD block')
    case 'FBD_CONNECTION': return pick('Kết nối', 'Connection')
    default: return pick('Trống', 'Empty')
  }
}

function renderContext(pick: (vi: string, en: string) => string, context: InspectorContext) {
  switch (context.kind) {
    case 'PROGRAM':
      return (
        <>
        <FieldList>
          <Field label={pick('Tên', 'Name')} field={context.name} pick={pick} />
          <Field label={pick('Ngôn ngữ', 'Language')} field={context.language} pick={pick} />
          <Field label={pick('Loại', 'Kind')} field={context.pouKind} pick={pick} />
          <Field label={pick('Truy cập', 'Access')} field={context.access} pick={pick} />
          {/* `DEV-PROG-004` — "Chu kỳ (trong Task)": chu kỳ mà KHÔNG kèm tên
              Task là một con số không nói được nó thuộc lịch chạy nào, và
              Project nhiều Task thì hai Program cùng 1 s vẫn có thể nằm ở hai
              Task khác nhau. Task chưa đặt tên ⇒ chỉ hiện chu kỳ, không tự bịa
              một cái tên như "Control_Main". */}
          <Field
            label={pick('Chu kỳ (trong Task)', 'Cycle (in Task)')}
            field={mapField(context.cycleMs, (value) => {
              const cycle = value >= 1000 && value % 1000 === 0 ? `${value / 1000} s` : `${value} ms`
              return context.taskName.known ? `${context.taskName.value} (${cycle})` : cycle
            })}
            pick={pick}
          />
          <Field
            label={pick('Bật', 'Enable')}
            field={mapField(context.enabled, (value) => value ? pick('Đã bật', 'Enabled') : pick('Đã tắt', 'Disabled'))}
            pick={pick}
          />
          {/* `DEV-PROG-011` — chuyển từ khay "Thuộc tính POU" của thanh bên.
              POU dùng chung (FUNCTION/FUNCTION_BLOCK) không có lịch chạy, nên
              với chúng câu trả lời là "chỉ chạy khi được gọi", không phải một ô
              xám gợi ý rằng có thể bật ở đâu đó. */}
          <Field
            label={pick('Trạng thái mong muốn', 'Desired state')}
            field={mapField(context.scheduled, (value) => value
              ? pick('Đã xếp lịch chạy', 'Scheduled to run')
              : context.pouKind.known && context.pouKind.value !== 'PROGRAM'
                ? pick('Chạy khi được gọi', 'Runs when called')
                : pick('Chưa xếp lịch chạy', 'Not scheduled to run'))}
            pick={pick}
          />
        </FieldList>
        {/* Mô tả nhiều dòng KHÔNG nằm trong `<dl>` một hàng: xuống dòng trong ô
            giá trị căn phải làm câu chữ vỡ thành bậc thang. */}
        <div className="mt-2 border-t border-[var(--c-border)] pt-2 text-xs">
          <p className="text-[var(--c-text-dim)]">{pick('Mô tả', 'Description')}</p>
          {context.description.known ? (
            <p className="mt-0.5 whitespace-pre-wrap text-[var(--c-text)]">{context.description.value}</p>
          ) : (
            <p className="mt-0.5 italic text-[var(--c-text-dim)]">{pick('chưa ghi mô tả', 'no description yet')}</p>
          )}
        </div>
        <CollapsibleSection
          title={pick('Tham số', 'Parameters')}
          count={context.parameters.known ? context.parameters.value.length : null}
        >
          {!context.parameters.known ? (
            <p className="text-[var(--c-text-dim)]">{pick('không xác định được', 'not determinable')}</p>
          ) : context.parameters.value.length === 0 ? (
            <p className="text-[var(--c-text-dim)]">{pick('POU không khai cổng vào/ra nào.', 'This POU declares no I/O ports.')}</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {context.parameters.value.map((parameter) => (
                <li key={`${parameter.direction}-${parameter.name}`} className="flex justify-between gap-3">
                  <span className="font-mono text-[var(--c-text)]">{parameter.name}</span>
                  <span className="text-[var(--c-text-dim)]">{parameter.direction} · {parameter.dataType}</span>
                </li>
              ))}
            </ul>
          )}
        </CollapsibleSection>
        <CollapsibleSection title={pick('Thuộc tính khác', 'Attributes')} count={context.attributes.length}>
          {context.attributes.length === 0 ? (
            <p className="text-[var(--c-text-dim)]">{pick('Không có.', 'None.')}</p>
          ) : (
            <dl className="flex flex-col gap-0.5">
              {context.attributes.map((attribute) => (
                <div key={attribute.key} className="flex justify-between gap-3">
                  <dt className="text-[var(--c-text-dim)]">{attribute.key}</dt>
                  <dd className="min-w-0 truncate font-mono text-[var(--c-text)]">{attribute.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </CollapsibleSection>
        </>
      )
    case 'VARIABLE':
      return (
        <FieldList>
          <Row label={pick('Tên', 'Name')} value={context.name} />
          <Field label={pick('Kiểu', 'Type')} field={context.dataType} pick={pick} />
          <Field label={pick('Phạm vi', 'Scope')} field={context.scope} pick={pick} />
          <Field label={pick('Ánh xạ', 'Mapping')} field={context.mapping} pick={pick} />
          <RuntimeRow label={pick('Giá trị', 'Value')} runtime={context.runtime} pick={pick} />
          <Field
            label={pick('Tham chiếu', 'References')}
            field={mapField(context.referenceCount, (value) => String(value))}
            pick={pick}
          />
        </FieldList>
      )
    case 'ST_SYMBOL':
      return (
        <FieldList>
          <Row label={pick('Ký hiệu', 'Symbol')} value={context.identifier} />
          <Field
            label={pick('Khai báo', 'Definition')}
            field={mapField(context.definitionOffset, (value) => pick(`vị trí ${value}`, `offset ${value}`))}
            pick={pick}
          />
          <Field label={pick('Kiểu', 'Type')} field={context.dataType} pick={pick} />
          {/* `ISS-STED-12` — Scope đứng ngay dưới Kiểu vì hai thứ này luôn được
              đọc cùng nhau: `REAL` trong `VAR_INPUT` và `REAL` trong
              `VAR RETAIN` là hai thứ khác hẳn nhau về vòng đời. */}
          <Field label={pick('Phạm vi', 'Scope')} field={context.scope} pick={pick} />
          <Field
            label={pick('Khởi tạo', 'Initial')}
            /* Nói rõ giá trị đến từ đâu. Subset ST không cho khai giá trị khởi
               tạo trong `VAR`, nên hầu hết trường hợp đây là mặc định của kiểu
               — và người đọc phải phân biệt được điều đó với một giá trị ai đó
               cố ý đặt. */
            field={mapField(context.initialValue, (value) => value.typeDefault
              ? pick(`${value.text} (mặc định của kiểu)`, `${value.text} (type default)`)
              : value.text)}
            pick={pick}
          />
          <Field label={pick('Điểm ánh xạ', 'Mapped point')} field={context.mappedPoint} pick={pick} />
          <Field label={pick('Đơn vị', 'Unit')} field={context.unit} pick={pick} />
          <Field label={pick('Chữ ký', 'Signature')} field={context.signature} pick={pick} />
          <Field
            label={pick('Tham chiếu', 'References')}
            field={mapField(context.referenceCount, (value) => String(value))}
            pick={pick}
          />
          {/* Tách đọc/ghi chứ không chỉ tổng: "biến này có ai ghi vào không"
              là câu hỏi khác hẳn "biến này được nhắc mấy lần", và nó là câu
              hỏi người ta hỏi khi đi tìm vì sao một giá trị không đổi. */}
          <Field
            label={pick('Đọc / Ghi', 'Reads / Writes')}
            field={mapField(context.readWrite, (value) => `${value.reads} / ${value.writes}`)}
            pick={pick}
          />
          <RuntimeRow label={pick('Giá trị', 'Value')} runtime={context.runtime} pick={pick} />
        </FieldList>
      )
    case 'FBD_BLOCK':
      return (
        <FieldList>
          {/* `nodeId` canonical hiện nguyên vẹn: nó là thứ diagnostic và
              round-trip bám vào, không phải nhãn hiển thị. */}
          <Row label={pick('Thực thể', 'Instance')} value={context.instanceId} mono />
          <Row label={pick('Kiểu', 'Type')} value={context.typeRef} />
          <Field label={pick('Chữ ký', 'Signature')} field={context.signature} pick={pick} />
          <Field
            label={pick('Giữ trạng thái', 'Retained')}
            field={mapField(context.retained, (value) => value ? pick('Có', 'Yes') : pick('Không', 'No'))}
            pick={pick}
          />
          <RuntimeRow label={pick('Giá trị', 'Value')} runtime={context.runtime} pick={pick} />
          <div className="col-span-2">
            <p className="text-xs text-[var(--c-text-dim)]">{pick('Tham số', 'Parameters')}</p>
            {context.parameters.length === 0 ? (
              <p className="text-xs text-[var(--c-text-dim)]">{pick('Không có', 'None')}</p>
            ) : (
              <ul className="mt-0.5 space-y-0.5">
                {context.parameters.map((parameter) => (
                  <li key={parameter.name} className="font-mono text-[11px] text-[var(--c-text)]">
                    {parameter.name} = {parameter.value}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="col-span-2">
            <p className="text-xs text-[var(--c-text-dim)]">{pick('Cổng vào/ra', 'I/O')}</p>
            <ul className="mt-0.5 space-y-0.5">
              {/* Thứ tự giữ NGUYÊN như đã khai; sắp lại sẽ làm Inspector không
                  còn khớp sơ đồ trên canvas. */}
              {context.ports.map((port) => (
                <li key={port.portId} className="font-mono text-[11px] text-[var(--c-text)]">
                  {port.direction === 'INPUT' ? '→' : '←'} {port.name} : {port.dataType}
                  {port.unit ? ` (${port.unit})` : ''}
                </li>
              ))}
            </ul>
          </div>
        </FieldList>
      )
    case 'FBD_CONNECTION':
      return (
        <FieldList>
          <Row label={pick('Kết nối', 'Wire')} value={context.wireId} mono />
          <Field
            label={pick('Nguồn', 'Source')}
            field={mapField(context.source, (value) => `${value.nodeId} · ${value.portName}`)}
            pick={pick}
          />
          <Field
            label={pick('Đích', 'Destination')}
            field={mapField(context.destination, (value) => `${value.nodeId} · ${value.portName}`)}
            pick={pick}
          />
          <Field label={pick('Kiểu', 'Type')} field={context.dataType} pick={pick} />
          <RuntimeRow label={pick('Chất lượng/giá trị', 'Quality/value')} runtime={context.runtime} pick={pick} />
        </FieldList>
      )
    default:
      return null
  }
}

function FieldList({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">{children}</dl>
}

/**
 * `DEV-PROG-004` — mục gập được của Inspector.
 *
 * Dùng `<details>` của trình duyệt chứ không dựng state riêng: nó đã có sẵn
 * ngữ nghĩa mở/đóng cho trình đọc màn hình, đi được bằng bàn phím, và giữ
 * trạng thái khi React render lại — ba thứ mà một `useState` + `aria-expanded`
 * viết tay phải làm lại từ đầu và thường làm thiếu.
 */
function CollapsibleSection({
  title, count, children,
}: { title: string; count: number | null; children: React.ReactNode }) {
  return (
    <details className="mt-2 border-t border-[var(--c-border)] pt-2 text-xs">
      <summary className="cursor-pointer text-[var(--c-text-dim)] hover:text-[var(--c-text)]">
        {title}{count === null ? '' : ` (${count})`}
      </summary>
      <div className="mt-1">{children}</div>
    </details>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-[var(--c-text-dim)]">{label}</dt>
      <dd className={mono ? 'font-mono text-[11px] text-[var(--c-text)]' : 'text-[var(--c-text)]'}>{value}</dd>
    </>
  )
}

function Field({
  label, field, pick,
}: { label: string; field: InspectorField<string>; pick: (vi: string, en: string) => string }) {
  return (
    <>
      <dt className="text-[var(--c-text-dim)]">{label}</dt>
      <dd className={field.known ? 'text-[var(--c-text)]' : 'italic text-[var(--c-text-dim)]'}>
        {/* Câu này là một kết quả, không phải một chỗ trống: analyzer đã trả lời
            và câu trả lời là "không chắc". */}
        {field.known ? field.value : pick('không xác định được', 'not determinable')}
      </dd>
    </>
  )
}

function RuntimeRow({
  label, runtime, pick,
}: { label: string; runtime: InspectorRuntimeValue; pick: (vi: string, en: string) => string }) {
  if (runtime.status !== 'ready' || !runtime.item) {
    return (
      <>
        <dt className="text-[var(--c-text-dim)]">{label}</dt>
        <dd className="text-[var(--c-text-dim)]" data-testid="inspector-runtime-value">—</dd>
      </>
    )
  }
  // Dùng ĐÚNG bộ trình bày của lớp overlay: mở đường đọc thứ hai là mở khả năng
  // hai chỗ nói khác nhau về cùng một mẫu.
  const presentation = presentStRuntimeValue(runtime.item)
  return (
    <>
      <dt className="text-[var(--c-text-dim)]">{label}</dt>
      <dd className="text-[var(--c-text)]" data-testid="inspector-runtime-value">
        <span className="font-mono">{presentation.displayValue}</span>
        {presentation.state !== 'live' && (
          <span className="ml-1 text-[11px] uppercase text-[var(--c-warn-fg)]">
            {presentation.state === 'stale'
              ? pick('cũ', 'stale')
              : presentation.state === 'uncertain' ? pick('chưa chắc', 'uncertain') : pick('không đọc được', 'invalid')}
          </span>
        )}
      </dd>
    </>
  )
}

function mapField<T>(field: InspectorField<T>, format: (value: T) => string): InspectorField<string> {
  return field.known ? { known: true, value: format(field.value) } : { known: false }
}
