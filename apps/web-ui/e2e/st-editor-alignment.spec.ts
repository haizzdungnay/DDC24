import { expect, test, type Page, type Route } from '@playwright/test'
import { login } from './helpers/session'

/**
 * FE-ST-001..006/010 — báo cáo trực tiếp 2026-08-17 kèm ảnh chụp cho thấy
 * lưới kẻ dòng CẮT XUYÊN chữ, không phải lệch nhẹ. Gốc lỗi thật (xem
 * `ProgramsTab.tsx`, chỗ khai báo `EDITOR_TEXT_METRICS`): `styles.css` có
 * rule `button, input, select, textarea { font: inherit }` KHÔNG nằm trong
 * `@layer` nào — luôn thắng `text-sm`/`leading-5` (Tailwind, có layer) CHỈ
 * trên `<textarea>`, khiến textarea render chữ theo font-size/line-height
 * KẾ THỪA, không phải 14px/20px như gutter/overlay `<pre>`. jsdom (mọi test
 * component hiện có) KHÔNG tính cascade CSS/font metrics nên không bao giờ
 * bắt được lớp lỗi này — file này kiểm bằng Chrome thật, đọc
 * `getComputedStyle`/`getBoundingClientRect` thật.
 *
 * Không lặp lại toàn bộ mock 8-journey của `programming.spec.ts` — chỉ cần
 * đủ để mở PGM-02 tab Chương trình với một Program ST nhiều dòng.
 */

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const PROGRAM_ID = '44444444-4444-4444-8444-444444444444'

/** Khai báo VAR thật (không phải câu lệnh gán) để `collectStSymbols` nhận
 *  diện được — cần cho test FE-ST-007 click vào Symbols & types. Trả về
 *  ĐÚNG `lineCount` dòng nội dung (không tính dòng trống cuối cùng do `\n`
 *  kết thúc — xem `EXTRA_TRAILING_LINE` ở test scrollHeight). */
function stSourceWithLines(lineCount: number): string {
  const declCount = Math.max(1, lineCount - 4) // PROGRAM/VAR/END_VAR/END_PROGRAM chiếm 4 dòng
  const decls = Array.from({ length: declCount }, (_, index) => `  Counter${index} : INT; (* dòng ${index + 3} *)`)
  return ['PROGRAM P', 'VAR', ...decls, 'END_VAR', 'END_PROGRAM'].join('\n') + '\n'
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function installMocks(page: Page, source: string) {
  await page.routeWebSocket('**/api/v1/ws/monitor', (ws) => {
    ws.onMessage(() => undefined)
  })
  await page.route('**/api/v1/programming/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace(/^\/api\/v1\/programming/, '')
    const method = request.method()

    if (method === 'GET' && path === '/capabilities') {
      return json(route, {
        schemaVersion: '1.0', profile: 'MK-DDC-24-REV-A', targetState: 'READY',
        languages: ['ST', 'FBD'], types: ['BOOL', 'INT', 'DINT', 'UINT', 'REAL', 'TIME'], taskPeriodsMs: [1000, 5000, 30000],
        limits: { projectsPerController: 1, tasks: 1, stSourceBytes: 65536, variables: 512, statements: 4096, fbdBlocks: 256, fbdConnections: 512, artifactBytes: 1048576, bindings: 256 }
      })
    }
    if (method === 'GET' && path === '/runtime') {
      return json(route, {
        schemaVersion: '1.0', controllerId: 'foxlinx-lab', producerState: 'READY', activeRevisionId: null, lkgRevisionId: null,
        taskState: 'RUNNING', safeState: false, observedAt: new Date().toISOString()
      })
    }
    if (method === 'GET' && path === '/point-catalog') return json(route, { items: [] })
    if (method === 'GET' && path === '/projects') {
      return json(route, { items: [{ projectId: PROJECT_ID, name: 'AHU-01', etag: '"draft:1"', activeRevisionId: null, draftRevisionId: 'draft-1', updatedAt: new Date().toISOString() }] })
    }
    if (method === 'GET' && path === `/projects/${PROJECT_ID}`) {
      return json(route, {
        projectId: PROJECT_ID, name: 'AHU-01', etag: '"draft:1"', activeRevisionId: null, draftRevisionId: 'draft-1', updatedAt: new Date().toISOString(),
        draft: {
          schemaVersion: 1,
          project: { projectId: PROJECT_ID, name: 'AHU-01', functionalTags: [] },
          programs: [{ programId: PROGRAM_ID, name: 'Điều khiển AHU', kind: 'PROGRAM', language: 'ST', document: source, executionOrder: 0, functionalTags: [] }],
          variables: [], bindings: [],
          task: { taskId: 'task-1', periodMs: 1000, programOrder: [PROGRAM_ID] },
          library: { profile: 'CORE_REVA', version: '1' }
        }
      })
    }
    await json(route, { error: { code: 'PRG-ERR-UNAVAILABLE-001', messageKey: 'programming.error.unavailable', retryable: true, keepsRunningRevision: true, correlationId: 'e2e' } }, 503)
  })
}

/**
 * Đọc khay Dòng/cột trên thanh trạng thái.
 *
 * Thanh trạng thái đã đổi từ câu chữ `Dòng N, cột M` sang một `<dl>` với nhãn
 * `Dòng:Cột` và giá trị `N:M`, nhưng bốn case của tệp này vẫn dò chuỗi cũ. Cả
 * bốn vì thế treo 60 s rồi đỏ — và chúng đỏ SẴN trên `main`, núp sau một lỗi
 * strict-mode xảy ra sớm hơn ở bước mở POU. Nay bám vào `data-testid` mà chính
 * `EditorStatusBar` phát ra, thay vì bám vào câu chữ hiển thị.
 */
async function readCursorLine(page: Page): Promise<number> {
  const text = await page.getByTestId('editor-status-position').innerText()
  const line = Number(text.match(/(\d+)\s*:\s*\d+/)?.[1])
  expect(Number.isFinite(line), `không đọc được số dòng từ "${text}"`).toBe(true)
  return line
}

async function navigate(page: Page, path: string) {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
  await page.waitForLoadState('networkidle').catch(() => undefined)
}

async function openEditor(page: Page, lineCount: number) {
  await installMocks(page, stSourceWithLines(lineCount))
  await page.addInitScript(() => window.localStorage.setItem('mkddc-lang', 'vi'))
  await login(page)
  await navigate(page, `/eng/programming/projects/${PROJECT_ID}/design`)
  /* Tên CHÍNH XÁC, không phải biểu thức chứa tên POU. `PouExplorer` đặt bốn nút
   * quanh mỗi POU — `Mở`, `Đổi tên`, `Nhân bản`, `Xóa` — nên một biểu thức
   * `/Điều khiển AHU/` khớp cả bốn và Playwright từ chối ở chế độ strict. Cả 13
   * case của tệp này vì thế đỏ ngay ở bước mở POU, và đã đỏ sẵn trên `main`:
   * một cổng luôn đỏ thì không ai đọc nó nữa, nên nó không còn là cổng. */
  await page.getByRole('button', { name: 'Mở Điều khiển AHU', exact: true }).click()
  const textarea = await page.waitForSelector('textarea[id^="programming-st-source-"]')
  return textarea
}

interface Metrics { fontSize: string; lineHeight: string; paddingTop: string; backgroundImage: string }

async function readMetrics(page: Page): Promise<{ textarea: Metrics; overlay: Metrics; gutter: Metrics }> {
  return page.evaluate(() => {
    const textarea = document.querySelector('textarea[id^="programming-st-source-"]') as HTMLTextAreaElement
    const editorBox = textarea.closest('.grid') as HTMLElement
    const gutter = editorBox.firstElementChild as HTMLElement
    const overlay = textarea.previousElementSibling as HTMLElement
    const read = (element: Element): Metrics => {
      const style = getComputedStyle(element)
      return { fontSize: style.fontSize, lineHeight: style.lineHeight, paddingTop: style.paddingTop, backgroundImage: style.backgroundImage }
    }
    return { textarea: read(textarea), overlay: read(overlay), gutter: read(gutter) }
  })
}

test.describe('ST Editor — căn chỉnh pixel gutter/overlay/textarea (FE-ST-001..006/010)', () => {
  test('FE-ST-006: font-size/line-height/padding-top của textarea/overlay/gutter BẰNG NHAU và đúng 14px/20px — rule `font: inherit` không còn thắng được', async ({ page }) => {
    await openEditor(page, 12)
    const metrics = await readMetrics(page)

    expect(metrics.textarea.fontSize).toBe('14px')
    expect(metrics.textarea.lineHeight).toBe('20px')
    expect(metrics.textarea.paddingTop).toBe('12px')
    expect(metrics.overlay).toEqual(metrics.textarea)
    expect(metrics.gutter.fontSize).toBe(metrics.textarea.fontSize)
    expect(metrics.gutter.lineHeight).toBe(metrics.textarea.lineHeight)
    expect(metrics.gutter.paddingTop).toBe(metrics.textarea.paddingTop)
  })

  test('FE-ST-001: KHÔNG còn lưới kẻ từng dòng (backgroundImage = none) trên cả overlay và gutter', async ({ page }) => {
    await openEditor(page, 12)
    const metrics = await readMetrics(page)
    expect(metrics.overlay.backgroundImage).toBe('none')
    expect(metrics.gutter.backgroundImage).toBe('none')
  })

  test('FE-ST-004: scrollHeight của textarea khớp công thức 20px/dòng + 24px đệm — xác nhận line-height RENDER thật, không chỉ computed style', async ({ page }) => {
    const lineCount = 40
    const textarea = await openEditor(page, lineCount)
    const scrollHeight = await textarea.evaluate((element: HTMLTextAreaElement) => element.scrollHeight)
    // `stSourceWithLines` kết thúc bằng `\n` (đúng quy ước `stProgramTemplate`
    // sản phẩm thật) — một dòng trống cuối tính thêm 1 hàng cho mục đích
    // cuộn/scrollHeight trong mọi trình duyệt.
    const expected = (lineCount + 1) * 20 + 2 * 12
    expect(Math.abs(scrollHeight - expected)).toBeLessThanOrEqual(2)
  })

  test('FE-ST-004: hàng gutter N thẳng hàng theo công thức pixel (đệm 12px + (N-1)×20px) ở nhiều dòng khác nhau', async ({ page }) => {
    await openEditor(page, 60)
    for (const lineNumber of [1, 10, 59]) {
      const rowBox = await page.evaluate((n) => {
        const textarea = document.querySelector('textarea[id^="programming-st-source-"]') as HTMLTextAreaElement
        const editorBox = textarea.closest('.grid') as HTMLElement
        const gutter = editorBox.firstElementChild as HTMLElement
        const containerTop = gutter.getBoundingClientRect().top
        const row = [...gutter.children].find((child) => child.textContent === String(n)) as HTMLElement
        return { rowTop: row.getBoundingClientRect().top - containerTop, containerTop }
      }, lineNumber)
      const expectedTop = 12 + (lineNumber - 1) * 20
      expect(Math.abs(rowBox.rowTop - expectedTop)).toBeLessThanOrEqual(1)
    }
  })

  test('FE-ST-007: dòng hiện hành được highlight ở CẢ gutter (nền khác) lẫn overlay (dải nền đúng vị trí)', async ({ page }) => {
    const textarea = await openEditor(page, 20)
    /* Đưa con trỏ xuống một dòng giữa tệp bằng chính đường "Tới dòng" của sản
       phẩm (`DEV-PROG-012`). Trước đây case này bấm một mục trong khay `Ký hiệu
       & kiểu`; khay đó đã đổi chỗ nên nút `Counter5:` không còn, và test treo
       60 s. Đường mới vừa ổn định hơn vừa đi qua một luồng người dùng thật. */
    await textarea.click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Control+g')
    await page.getByRole('textbox', { name: /^Tới dòng|^Go to line/ }).fill('8')
    await page.getByRole('button', { name: /^Tới$|^Go$/ }).click()
    expect(await readCursorLine(page)).toBe(8)

    const state = await page.evaluate(() => {
      const textarea = document.querySelector('textarea[id^="programming-st-source-"]') as HTMLTextAreaElement
      const editorBox = textarea.closest('.grid') as HTMLElement
      const gutter = editorBox.firstElementChild as HTMLElement
      const activeRow = [...gutter.children].find((child) => (child as HTMLElement).className.includes('bg-'))
      const overlayBand = (textarea.previousElementSibling as HTMLElement).firstElementChild as HTMLElement
      return {
        activeRowText: activeRow?.textContent ?? null,
        bandTop: overlayBand.style.top,
      }
    })
    expect(state.activeRowText).not.toBeNull()
    const activeLine = Number(state.activeRowText)
    expect(state.bandTop).toBe(`${12 + (activeLine - 1) * 20}px`)
    void textarea
  })

  test('FE-ST-005: cuộn dọc tài liệu 1200 dòng vẫn giữ scrollTop đồng bộ tuyệt đối giữa textarea/overlay/gutter', async ({ page }) => {
    const textarea = await openEditor(page, 1200)
    await textarea.evaluate((element: HTMLTextAreaElement) => { element.scrollTop = 8000 })
    await textarea.dispatchEvent('scroll')
    await page.waitForTimeout(50)
    const scrollState = await page.evaluate(() => {
      const textarea = document.querySelector('textarea[id^="programming-st-source-"]') as HTMLTextAreaElement
      const editorBox = textarea.closest('.grid') as HTMLElement
      const gutter = editorBox.firstElementChild as HTMLElement
      const overlay = textarea.previousElementSibling as HTMLElement
      return { textareaTop: textarea.scrollTop, gutterTop: gutter.scrollTop, overlayTop: overlay.scrollTop }
    })
    expect(scrollState.gutterTop).toBe(scrollState.textareaTop)
    expect(scrollState.overlayTop).toBe(scrollState.textareaTop)
    expect(scrollState.textareaTop).toBeGreaterThan(0)
  })

  test('FE-ST-005: cuộn ngang (dòng dài, wrap=off) đồng bộ overlay.scrollLeft với textarea.scrollLeft', async ({ page }) => {
    await installMocks(page, `PROGRAM P\n  VeryLongVariableNameThatForcesHorizontalScrolling := AnotherVeryLongVariableNameHere + YetAnotherLongOne * 2 - SomeMoreCharactersToExceedTheEditorWidthForSure;\nEND_PROGRAM\n`)
    await page.addInitScript(() => window.localStorage.setItem('mkddc-lang', 'vi'))
    await login(page)
    await navigate(page, `/eng/programming/projects/${PROJECT_ID}/design`)
    await page.getByRole('button', { name: 'Mở Điều khiển AHU', exact: true }).click()
    const textarea = await page.waitForSelector('textarea[id^="programming-st-source-"]')

    await textarea.evaluate((element: HTMLTextAreaElement) => { element.scrollLeft = 200 })
    await textarea.dispatchEvent('scroll')
    await page.waitForTimeout(50)
    const scrollState = await page.evaluate(() => {
      const textarea = document.querySelector('textarea[id^="programming-st-source-"]') as HTMLTextAreaElement
      const overlay = textarea.previousElementSibling as HTMLElement
      return { textareaLeft: textarea.scrollLeft, overlayLeft: overlay.scrollLeft }
    })
    expect(scrollState.overlayLeft).toBe(scrollState.textareaLeft)
    expect(scrollState.textareaLeft).toBeGreaterThan(0)
  })

  test('FE-ST-006: metrics không đổi khi thu phóng trình duyệt 125%/150% — cả ba lớp vẫn khớp nhau', async ({ page }) => {
    await openEditor(page, 12)
    for (const zoom of [1.25, 1.5]) {
      await page.evaluate((factor) => { (document.documentElement.style as unknown as { zoom: string }).zoom = String(factor) }, zoom)
      await page.waitForTimeout(50)
      const metrics = await readMetrics(page)
      expect(metrics.overlay.lineHeight).toBe(metrics.textarea.lineHeight)
      expect(metrics.gutter.lineHeight).toBe(metrics.textarea.lineHeight)
      expect(metrics.overlay.fontSize).toBe(metrics.textarea.fontSize)
      expect(metrics.gutter.fontSize).toBe(metrics.textarea.fontSize)
    }
  })

  test('FE-ST-010: mở/đóng Ctrl+F rồi Ctrl+P không làm hỏng metrics editor (vẫn 14px/20px, không lưới)', async ({ page }) => {
    const textarea = await openEditor(page, 12)
    await textarea.click()
    await textarea.press('Control+f')
    await expect(page.getByRole('search')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('search')).not.toBeVisible()

    await textarea.press('Control+p')
    await expect(page.getByRole('dialog', { name: 'Bảng lệnh nhanh' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Bảng lệnh nhanh' })).not.toBeVisible()

    const metrics = await readMetrics(page)
    expect(metrics.textarea.fontSize).toBe('14px')
    expect(metrics.textarea.lineHeight).toBe('20px')
    expect(metrics.overlay).toEqual(metrics.textarea)
    expect(metrics.overlay.backgroundImage).toBe('none')
  })

  test('FE-ST-010: resize trình duyệt (thu hẹp rồi mở rộng) không đổi font-size/line-height của editor', async ({ page }) => {
    await openEditor(page, 12)
    const before = await readMetrics(page)

    await page.setViewportSize({ width: 900, height: 650 })
    await page.waitForTimeout(50)
    const narrow = await readMetrics(page)
    expect(narrow.textarea.fontSize).toBe(before.textarea.fontSize)
    expect(narrow.textarea.lineHeight).toBe(before.textarea.lineHeight)
    expect(narrow.overlay).toEqual(narrow.textarea)
    expect(narrow.gutter.fontSize).toBe(narrow.textarea.fontSize)

    await page.setViewportSize({ width: 1600, height: 900 })
    await page.waitForTimeout(50)
    const wide = await readMetrics(page)
    expect(wide.textarea.fontSize).toBe(before.textarea.fontSize)
    expect(wide.textarea.lineHeight).toBe(before.textarea.lineHeight)
    expect(wide.overlay).toEqual(wide.textarea)
  })
})

/**
 * Báo lỗi trực tiếp 2026-08-17: "chọn dòng A thì nó lại hiện dòng B" — bấm
 * "Định dạng"/"Thay tất cả" gọi thẳng `onChange(next)` không qua
 * `applyEditRange`/`pendingCursorRef`, nên khay Dòng/cột đứng yên ở vị trí
 * CŨ trong khi con trỏ DOM thật của textarea bị React đặt lại (quan sát
 * được: về offset 0) khi `.value` đổi toàn bộ mà không ai ghi đè selection.
 * Sửa bằng `mapOffsetByNonWhitespaceCount`/`mapOffsetAcrossReplaceAll`
 * (`ProgramsTab.tsx`) đi qua `applyEditRange` như mọi đường sửa nội dung
 * khác. Test bằng Chrome thật vì đây là hành vi tương tác con trỏ DOM thật,
 * không phải điều jsdom mô phỏng chính xác được.
 */
test.describe('ST Editor — khay Dòng/cột không đứng yên sai lệch sau Định dạng/Thay tất cả', () => {
  test('bấm "Định dạng" xong, khay Dòng/cột phải khớp con trỏ thật (không đứng yên ở dòng cũ)', async ({ page }) => {
    const source = ['PROGRAM t', 'VAR RETAIN', '  StartCount : INT;', 'END_VAR', 'END_PROGRAM'].join('\n') + '\n'
    await installMocks(page, source)
    await page.addInitScript(() => window.localStorage.setItem('mkddc-lang', 'vi'))
    await login(page)
    await navigate(page, `/eng/programming/projects/${PROJECT_ID}/design`)
    await page.getByRole('button', { name: 'Mở Điều khiển AHU', exact: true }).click()
    const textarea = await page.waitForSelector('textarea[id^="programming-st-source-"]')

    // Đặt con trỏ ở cuối tài liệu (Ctrl+End) — một thao tác click/điều hướng
    // thật của người dùng, không phải setSelectionRange giả lập.
    await textarea.click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Control+End')
    await page.waitForTimeout(50)

    const beforeLine = await readCursorLine(page)
    // Nguồn kết thúc bằng `\n` (quy ước `stProgramTemplate` thật) — Ctrl+End
    // đưa con trỏ tới dòng trống SAU dấu `\n` cuối, tức dòng 6 (5 dòng nội
    // dung + 1 dòng trống cuối), khớp cách đếm dòng nhất quán toàn bộ file.
    expect(beforeLine).toBe(6)

    await page.getByRole('button', { name: /Định dạng|Format/ }).click()
    await page.waitForTimeout(100)

    const reportedLine = await readCursorLine(page)

    const real = await page.evaluate(() => {
      const ta = document.querySelector('textarea[id^="programming-st-source-"]') as HTMLTextAreaElement
      const before = ta.value.slice(0, ta.selectionStart)
      return { line: before.split('\n').length, value: ta.value, selectionStart: ta.selectionStart }
    })

    // Format thêm thụt lề (source gốc chưa thụt lề) nên số dòng/độ dài đổi —
    // đúng kịch bản gây lệch trong báo lỗi gốc. Khay Dòng/cột PHẢI khớp con
    // trỏ DOM thật sau khi Format chạy xong, không được đứng yên ở vị trí cũ.
    expect(reportedLine).toBe(real.line)
  })

  test('bấm "Định dạng" khi source cần thêm dòng (VAR/RETAIN tách rời) — khay Dòng/cột đi theo đúng con trỏ thật, không đứng yên ở vị trí cũ', async ({ page }) => {
    // Nguồn CHƯA đúng định dạng — Format sẽ chèn thêm dòng, đúng kịch bản
    // gây lệch trong báo lỗi gốc (Format thay đổi tổng số dòng phía trước
    // con trỏ).
    const source = [
      'PROGRAM t', 'VAR', '  A : BOOL;', 'END_VAR',
      'VAR RETAIN', '  StartCount : INT;', 'END_VAR',
      'A := TRUE;', 'END_PROGRAM'
    ].join('\n') + '\n'
    await installMocks(page, source)
    await page.addInitScript(() => window.localStorage.setItem('mkddc-lang', 'vi'))
    await login(page)
    await navigate(page, `/eng/programming/projects/${PROJECT_ID}/design`)
    await page.getByRole('button', { name: 'Mở Điều khiển AHU', exact: true }).click()
    const textarea = await page.waitForSelector('textarea[id^="programming-st-source-"]')

    await textarea.click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Control+End')
    await page.waitForTimeout(50)

    await page.getByRole('button', { name: /Định dạng|Format/ }).click()
    await page.waitForTimeout(100)

    const reportedLine = await readCursorLine(page)

    const real = await page.evaluate(() => {
      const ta = document.querySelector('textarea[id^="programming-st-source-"]') as HTMLTextAreaElement
      const before = ta.value.slice(0, ta.selectionStart)
      return { line: before.split('\n').length, lastLine: ta.value.split('\n').filter(Boolean).slice(-1)[0] }
    })

    expect(reportedLine).toBe(real.line)
    // Con trỏ phải rơi vào cuối tài liệu (END_PROGRAM), không bị đẩy về đầu.
    expect(real.lastLine).toBe('END_PROGRAM')
  })

  test('bấm "Thay tất cả" xong, khay Dòng/cột phải khớp con trỏ thật', async ({ page }) => {
    const source = ['PROGRAM t', 'VAR', '  Old1 : BOOL;', '  Old2 : BOOL;', 'END_VAR', 'END_PROGRAM'].join('\n') + '\n'
    await installMocks(page, source)
    await page.addInitScript(() => window.localStorage.setItem('mkddc-lang', 'vi'))
    await login(page)
    await navigate(page, `/eng/programming/projects/${PROJECT_ID}/design`)
    await page.getByRole('button', { name: 'Mở Điều khiển AHU', exact: true }).click()
    const textarea = await page.waitForSelector('textarea[id^="programming-st-source-"]')

    await textarea.click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Control+End')
    await page.waitForTimeout(50)

    await page.getByRole('button', { name: /^Tìm$|^Find$/ }).click()
    await page.getByLabel(/Tìm trong mã nguồn|Find in source/i).fill('Old')
    await page.getByPlaceholder(/Thay bằng|Replace with/i).fill('Renamed')
    await page.getByRole('button', { name: /Thay tất cả|Replace all/i }).click()
    await page.waitForTimeout(100)

    const reportedLine = await readCursorLine(page)

    const real = await page.evaluate(() => {
      const ta = document.querySelector('textarea[id^="programming-st-source-"]') as HTMLTextAreaElement
      const before = ta.value.slice(0, ta.selectionStart)
      return { line: before.split('\n').length, value: ta.value }
    })

    expect(real.value).toContain('Renamed1')
    expect(real.value).toContain('Renamed2')
    expect(reportedLine).toBe(real.line)
  })
})
