import { useI18n } from '../../../../../shared/i18n'

/**
 * Inspector DDC Metadata section — engineering metadata vendor-specific.
 *
 * Hiển thị các thuộc tính kỹ thuật DDC:
 * - Unit: đơn vị đo (°C, %, kPa...)
 * - Range: min/max giá trị
 * - BACnet: object type/instance
 * - Modbus: register address
 * - Historian: có ghi lịch sử không
 * - Alarm: có cảnh báo không
 * - Writable: có ghi được không
 *
 * Hiện tại tất cả đều "không xác định được" vì Draft v2 chưa có schema.
 */

export interface DdcMetadataSectionProps {
  unit?: string
  minValue?: number
  maxValue?: number
  bacnetObject?: { type: string; instance: number }
  modbusRegister?: number
  historian?: boolean
  alarm?: boolean
  writable?: boolean
}

function Field({ label, value, pick }: { label: string; value: string | null; pick: (vi: string, en: string) => string }) {
  return (
    <>
      <dt className="text-[var(--c-text-dim)]">{label}</dt>
      <dd className={value ? 'text-[var(--c-text)]' : 'italic text-[var(--c-text-dim)]'}>
        {value ?? pick('không xác định được', 'not determinable')}
      </dd>
    </>
  )
}

export function DdcMetadataSection({
  unit,
  minValue,
  maxValue,
  bacnetObject,
  modbusRegister,
  historian,
  alarm,
  writable
}: DdcMetadataSectionProps) {
  const { pick } = useI18n()

  return (
    <details className="mt-2 border-t border-[var(--c-border)] pt-2 text-xs" data-testid="inspector-ddc-metadata-section">
      <summary className="cursor-pointer text-[var(--c-text-dim)] hover:text-[var(--c-text)]">
        {pick('DDC Metadata', 'DDC Metadata')}
      </summary>

      <div className="mt-2">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
          {/* Unit */}
          <Field label={pick('Đơn vị', 'Unit')} value={unit ?? null} pick={pick} />

          {/* Range */}
          <Field
            label={pick('Phạm vi', 'Range')}
            value={
              minValue !== undefined && maxValue !== undefined
                ? `${minValue}..${maxValue}`
                : null
            }
            pick={pick}
          />

          {/* BACnet */}
          <Field
            label={pick('BACnet object', 'BACnet object')}
            value={
              bacnetObject
                ? `${bacnetObject.type}:${bacnetObject.instance}`
                : null
            }
            pick={pick}
          />

          {/* Modbus */}
          <Field
            label={pick('Modbus register', 'Modbus register')}
            value={modbusRegister !== undefined ? String(modbusRegister) : null}
            pick={pick}
          />

          {/* Historian */}
          <Field
            label={pick('Historian', 'Historian')}
            value={
              historian !== undefined
                ? historian
                  ? pick('Có', 'Yes')
                  : pick('Không', 'No')
                : null
            }
            pick={pick}
          />

          {/* Alarm */}
          <Field
            label={pick('Cảnh báo', 'Alarm')}
            value={
              alarm !== undefined
                ? alarm
                  ? pick('Có', 'Yes')
                  : pick('Không', 'No')
                : null
            }
            pick={pick}
          />

          {/* Writable */}
          <Field
            label={pick('Có ghi được', 'Writable')}
            value={
              writable !== undefined
                ? writable
                  ? pick('Có', 'Yes')
                  : pick('Không', 'No')
                : null
            }
            pick={pick}
          />
        </dl>
      </div>
    </details>
  )
}
