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
import { AttributesSection } from './sections/AttributesSection'
import { DdcMetadataSection } from './sections/DdcMetadataSection'
import { ExecutionSection } from './sections/ExecutionSection'
import { InterfaceSection } from './sections/InterfaceSection'
import { ReferencesSection } from './sections/ReferencesSection'

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
  editableFbdSlot,
  executionTabHref,
  onOpenExecutionTab,
  headerAction,
}: {
  input: InspectorInput
  /**
   * Phần sửa metadata Program (tên/loại) do `ProgramsTab` sở hữu vì nó gắn với
   * transaction Draft. Inspector chỉ dành chỗ, không nhân bản luồng lưu.
   */
  editableProgramSlot?: React.ReactNode
  /**
   * Form sửa node FBD do `ProgramsTab` cung cấp khi có node FBD đang chọn.
   */
  editableFbdSlot?: React.ReactNode
  /** Đích cấu hình Task toàn Project; chỉ render ở ngữ cảnh POU. */
  executionTabHref?: string
  /** Lối vào `Cấu hình chạy` của mục Thực thi; `undefined` ⇒ không render. */
  onOpenExecutionTab?: () => void
  headerAction?: React.ReactNode
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
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-[var(--c-text-dim)]">
          {pick('Thuộc tính', 'Inspector')}
          <span className="ml-2 font-normal normal-case text-[var(--c-text-dim)]">
            {contextLabel(pick, context.kind)}
          </span>
        </h3>
        {headerAction}
      </div>

      {!useful && editableProgramSlot === undefined && editableFbdSlot === undefined ? (
        /* Thu gọn: một dòng, không chiếm chỗ. Đây là vế còn lại của luật §9 —
           khay chỉ nở ra khi có ngữ cảnh đáng đọc. */
        <p className="mt-1 text-xs text-[var(--c-text-dim)]" data-testid="inspector-collapsed">
          {pick('Chưa có ngữ cảnh nào để xem. Chọn một POU, một ký hiệu hoặc một khối.',
                'No context yet. Select a POU, a symbol, or a block.')}
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          {editableProgramSlot}
          {/* Ngữ cảnh khối FBD tự đặt khay sửa vào đúng mục `Tham số`; mọi ngữ
              cảnh khác vẫn nhận nó ở đầu khay như cũ. */}
          {context.kind !== 'FBD_BLOCK' && editableFbdSlot}
          {renderContext(pick, context, executionTabHref, onOpenExecutionTab, editableFbdSlot)}
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

function renderContext(
  pick: (vi: string, en: string) => string,
  context: InspectorContext,
  executionTabHref?: string,
  onOpenExecutionTab?: () => void,
  /* Khay sửa node FBD. Với ngữ cảnh `FBD_BLOCK` nó nằm TRONG mục `Tham số`, nên
     nó đi xuống đây thay vì render ở trên — hai chỗ cùng render sẽ cho hai bản
     form chồng nhau. */
  editableFbdSlot?: React.ReactNode,
) {
  switch (context.kind) {
    case 'PROGRAM':
      return (
        <>
          <details open className="text-xs" data-testid="inspector-general-section">
            <summary className="cursor-pointer font-medium text-[var(--c-text-dim)] hover:text-[var(--c-text)]">
              {pick('Thông tin chung', 'General')}
            </summary>
            <FieldList>
              <Field label={pick('Tên', 'Name')} field={context.name} pick={pick} />
              <Field label={pick('Loại POU', 'POU type')} field={context.pouKind} pick={pick} />
              <Field label={pick('Ngôn ngữ', 'Language')} field={context.language} pick={pick} />
              <Field label={pick('Namespace', 'Namespace')} field={{ known: false }} pick={pick} />
              <Field label={pick('Truy cập', 'Access')} field={context.access} pick={pick} />
              <Field
                label={pick('Bật', 'Enable')}
                field={mapField(context.enabled, (value) => value ? pick('Đã bật', 'Enabled') : pick('Đã tắt', 'Disabled'))}
                pick={pick}
              />
            </FieldList>
            <div className="mt-2 border-t border-[var(--c-border)]/60 pt-2">
              <p className="text-[var(--c-text-dim)]">{pick('Mô tả', 'Description')}</p>
              {context.description.known ? (
                <p className="mt-0.5 whitespace-pre-wrap text-[var(--c-text)]">{context.description.value}</p>
              ) : (
                <p className="mt-0.5 italic text-[var(--c-text-dim)]">{pick('chưa ghi mô tả', 'no description yet')}</p>
              )}
            </div>
          </details>
          <InterfaceSection parameters={context.parameters} pouKind={context.pouKind} returnType={context.returnType} />
          <ExecutionSection
            cycleMs={context.cycleMs}
            taskName={context.taskName}
            scheduled={context.scheduled}
            pouKind={context.pouKind}
            onOpenExecutionTab={onOpenExecutionTab}
          />
          <AttributesSection iecAttributes={[]} ddcAttributes={context.attributes} />
          <DdcMetadataSection />
          <ReferencesSection usedBy={context.usedBy} uses={context.uses} executionTabHref={executionTabHref} />
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
          {/* `ISS-STED-13` — nói RÕ vì sao mọi thứ suy ra từ chỉ mục vừa biến
              thành "không xác định được". Hạ cấp mà không nói lý do trông hệt
              như một lỗi phân tích ngẫu nhiên, và người dùng sẽ đi tìm sai
              chỗ. */}
          {context.indexDegradedReason && (
            <li
              role="alert"
              data-testid="inspector-index-degraded"
              className="col-span-2 rounded-[var(--radius)] border border-[var(--c-warn-fg)] bg-[var(--c-surface-2)] px-2 py-1 text-xs text-[var(--c-text)]"
            >
              {context.indexDegradedReason}
            </li>
          )}
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
      /* NĂM MỤC, theo đúng thứ tự của ảnh chuẩn `PGM-02B §9`:
         Chung → Tham số → Vào/Ra → Trạng thái → Thuộc tính.
         Bản trước là MỘT danh sách phẳng trộn lẫn cả năm nhóm, nên một khối PID
         có mười mấy dòng liền nhau mà người đọc phải tự phân loại bằng mắt. */
      return (
        <div className="space-y-2">
          <InspectorSection title={pick('Chung', 'General')} testId="inspector-fbd-general" defaultOpen>
            <FieldList>
              <Row label={pick('Loại khối', 'Block type')} value={context.typeRef} />
              <Row
                label={pick('Tên thực thể', 'Instance name')}
                value={context.instanceName ?? pick('chưa đặt', 'not set')}
                mono={context.instanceName !== null}
              />
              <Field label={pick('Chữ ký', 'Signature')} field={context.signature} pick={pick} />
            </FieldList>
          </InspectorSection>

          <InspectorSection title={pick('Tham số', 'Parameters')} testId="inspector-fbd-parameters" defaultOpen>
            {/* Khay SỬA nằm ngay trong mục này (`editableFbdSlot`), nên số đọc
                được và số sửa được là cùng một chỗ — không phải hai bảng ở hai
                nơi có thể nói khác nhau. */}
            {editableFbdSlot}
            {context.parameters.length === 0 ? (
              <p className="text-xs text-[var(--c-text-dim)]">{pick('Không có', 'None')}</p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {context.parameters.map((parameter) => (
                  <li key={parameter.name} className="flex justify-between gap-2 font-mono text-[11px]">
                    <span className="text-[var(--c-text-dim)]">{parameter.name}</span>
                    <span className="text-[var(--c-text)]">{parameter.value}</span>
                  </li>
                ))}
              </ul>
            )}
          </InspectorSection>

          <InspectorSection title={pick('Vào/Ra', 'I/O')} testId="inspector-fbd-io" defaultOpen>
            <ul className="space-y-0.5">
              {/* Thứ tự giữ NGUYÊN như đã khai; sắp lại sẽ làm Inspector không
                  còn khớp sơ đồ trên canvas. */}
              {context.ports.map((port) => {
                const reading = context.portRuntime[port.portId]
                return (
                  <li key={port.portId} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="min-w-0 truncate font-mono text-[var(--c-text)]">
                      {port.direction === 'INPUT' ? '→' : '←'} {port.name} : {port.dataType}
                      {port.unit ? ` (${port.unit})` : ''}
                    </span>
                    {reading && <RuntimePortValue runtime={reading} unit={port.unit} />}
                  </li>
                )
              })}
            </ul>
          </InspectorSection>

          <InspectorSection title={pick('Trạng thái', 'Status')} testId="inspector-fbd-status" defaultOpen>
            <FieldList>
              <RuntimeRow label={pick('Giá trị ra', 'Output value')} runtime={context.runtime} pick={pick} />
              <Row
                label={pick('Nguồn', 'Source')}
                value={context.runtime.status === 'ready'
                  ? pick('Thiết bị (trực tiếp)', 'Controller (live)')
                  : pick('không xác định được', 'not determinable')}
              />
            </FieldList>
          </InspectorSection>

          <InspectorSection title={pick('Thuộc tính', 'Attributes')} testId="inspector-fbd-attributes">
            <FieldList>
              {/* `nodeId` canonical hiện nguyên vẹn: nó là thứ diagnostic và
                  round-trip bám vào, không phải nhãn hiển thị. */}
              <Row label={pick('Định danh node', 'Node id')} value={context.instanceId} mono />
              <Field
                label={pick('Giữ trạng thái', 'Retained')}
                field={mapField(context.retained, (value) => value ? pick('Có', 'Yes') : pick('Không', 'No'))}
                pick={pick}
              />
            </FieldList>
          </InspectorSection>
        </div>
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

/**
 * Một mục gập được của Inspector.
 *
 * `<details>` native chứ không phải state React: hành vi đóng/mở, phím
 * Enter/Space và ngữ nghĩa cho trình đọc màn hình đã có sẵn và đúng; dựng tay
 * lại chỉ thêm một bản có thể lệch.
 */
function InspectorSection({ title, testId, defaultOpen, children }: {
  title: string
  testId: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  return (
    <details open={defaultOpen} data-testid={testId} className="rounded-[var(--radius)] border border-[var(--c-border)]">
      <summary className="cursor-pointer list-none px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--c-text-dim)] hover:text-[var(--c-text)]">
        {title}
      </summary>
      <div className="px-2 pb-2">{children}</div>
    </details>
  )
}

/** Giá trị runtime của MỘT CHÂN, hiện cạnh chân ấy trong mục Vào/Ra. */
function RuntimePortValue({ runtime, unit }: { runtime: InspectorRuntimeValue; unit: string | null }) {
  if (runtime.status !== 'ready' || !runtime.item) return null
  const presentation = presentStRuntimeValue(runtime.item)
  const tone = presentation.state === 'live'
    ? 'border-[var(--c-good-fg)] bg-[var(--c-good-bg)] text-[var(--c-good-fg)]'
    : presentation.state === 'invalid'
      ? 'border-[var(--c-border)] bg-[var(--c-surface-2)] text-[var(--c-text-dim)]'
      : 'border-[var(--c-warn-fg)] bg-[var(--c-warn-bg)] text-[var(--c-warn-fg)]'
  return (
    <span data-testid="inspector-port-runtime" className={`shrink-0 rounded-full border px-1.5 font-mono ${tone}`}>
      {/* Đơn vị chỉ đi kèm một giá trị THẬT — `— °C` đọc như một phép đo. */}
      {presentation.displayValue}{presentation.state !== 'invalid' && unit ? ` ${unit}` : ''}
    </span>
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
          <span className="ml-1 text-[11px] text-[var(--c-warn-fg)]">
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
