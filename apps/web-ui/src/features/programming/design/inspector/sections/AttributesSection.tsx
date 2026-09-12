import { useState } from 'react'
import { useI18n } from '../../../../../shared/i18n'

/**
 * Inspector Attributes section — IEC Attributes vs DDC Attributes.
 *
 * Tách rõ hai loại:
 * - IEC Attributes: thuộc tính chuẩn IEC 61131-3
 * - DDC Attributes: vendor-specific attributes của DDC
 *
 * Hiện tại cả hai đều hiện "không xác định được" vì Draft v2 chưa có schema.
 */

export interface AttributesSectionProps {
  iecAttributes?: readonly { key: string; value: string }[]
  ddcAttributes?: readonly { key: string; value: string }[]
}

type AttributeTab = 'IEC' | 'DDC'

export function AttributesSection({ iecAttributes, ddcAttributes }: AttributesSectionProps) {
  const { pick } = useI18n()
  const [activeTab, setActiveTab] = useState<AttributeTab>('IEC')

  return (
    <details className="mt-2 border-t border-[var(--c-border)] pt-2 text-xs" data-testid="inspector-attributes-section">
      <summary className="cursor-pointer text-[var(--c-text-dim)] hover:text-[var(--c-text)]">
        {pick('Thuộc tính', 'Attributes')}
      </summary>

      <div className="mt-2">
        {/* Tab switcher */}
        <div className="mb-2 flex gap-1 border-b border-[var(--c-border)]" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'IEC'}
            onClick={() => setActiveTab('IEC')}
            className={`px-2 py-1 text-xs ${
              activeTab === 'IEC'
                ? 'border-b-2 border-[var(--c-accent)] font-medium text-[var(--c-accent)]'
                : 'text-[var(--c-text-dim)] hover:text-[var(--c-text)]'
            }`}
          >
            {pick('IEC Attributes', 'IEC Attributes')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'DDC'}
            onClick={() => setActiveTab('DDC')}
            className={`px-2 py-1 text-xs ${
              activeTab === 'DDC'
                ? 'border-b-2 border-[var(--c-accent)] font-medium text-[var(--c-accent)]'
                : 'text-[var(--c-text-dim)] hover:text-[var(--c-text)]'
            }`}
          >
            {pick('DDC Attributes', 'DDC Attributes')}
          </button>
        </div>

        {/* Tab content */}
        <div role="tabpanel">
          {activeTab === 'IEC' ? (
            iecAttributes && iecAttributes.length > 0 ? (
              <dl className="flex flex-col gap-0.5">
                {iecAttributes.map((attr) => (
                  <div key={attr.key} className="flex justify-between gap-3">
                    <dt className="text-[var(--c-text-dim)]">{attr.key}</dt>
                    <dd className="min-w-0 truncate font-mono text-[var(--c-text)]">{attr.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="italic text-[var(--c-text-dim)]">
                {pick('không xác định được', 'not determinable')}
              </p>
            )
          ) : (
            ddcAttributes && ddcAttributes.length > 0 ? (
              <dl className="flex flex-col gap-0.5">
                {ddcAttributes.map((attr) => (
                  <div key={attr.key} className="flex justify-between gap-3">
                    <dt className="text-[var(--c-text-dim)]">{attr.key}</dt>
                    <dd className="min-w-0 truncate font-mono text-[var(--c-text)]">{attr.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="italic text-[var(--c-text-dim)]">
                {pick('không xác định được', 'not determinable')}
              </p>
            )
          )}
        </div>
      </div>
    </details>
  )
}
