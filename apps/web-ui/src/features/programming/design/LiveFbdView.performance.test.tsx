import '@testing-library/jest-dom/vitest'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import type { FbdDocument } from '../fbd/model'

const canvasRender = vi.hoisted(() => vi.fn())
vi.mock('../fbd/FbdCanvas', () => ({
  FbdCanvas: () => {
    canvasRender()
    return <div role="group" aria-label="canvas-test" />
  },
}))

import { LiveFbdView } from './LiveFbdView'

const document: FbdDocument = {
  $schema: '../../fbd_v1.schema.json',
  schemaVersion: 1,
  profileId: 'revA-1t-1-5-30',
  graphId: '10000000-0000-4000-8000-000000000001',
  name: 'Perf',
  networks: [{
    id: '20000000-0000-4000-8000-000000000001',
    name: 'Main',
    order: 0,
    nodes: [],
    wires: [],
  }],
}

describe('LiveFbdView — topology tách khỏi sample runtime T59-812', () => {
  it('cùng identity tài liệu không render lại canvas', () => {
    canvasRender.mockClear()
    const view = (runtimeSequence: number) => (
      <I18nProvider>
        <div data-runtime-sequence={runtimeSequence}>
          <LiveFbdView document={document} />
        </div>
      </I18nProvider>
    )
    const rendered = render(view(1))
    expect(canvasRender).toHaveBeenCalledTimes(1)

    /* Parent đổi theo sample, topology prop giữ nguyên: memo phải chặn canvas. */
    rendered.rerender(view(2))
    expect(canvasRender).toHaveBeenCalledTimes(1)
  })
})
