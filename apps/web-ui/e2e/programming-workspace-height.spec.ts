import { expect, test, type Page, type Route } from '@playwright/test'
import { login } from './helpers/session'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const PROGRAM_ID = '44444444-4444-4444-8444-444444444444'

function stSourceWithLines(lineCount: number): string {
  const declCount = Math.max(1, lineCount - 4)
  const decls = Array.from({ length: declCount }, (_, index) => `  Counter${index} : INT; (* dòng ${index + 3} *)`)
  return ['PROGRAM P', 'VAR', ...decls, 'END_VAR', 'END_PROGRAM'].join('\n') + '\n'
}
async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}
async function installMocks(page: Page, source: string) {
  await page.routeWebSocket('**/api/v1/ws/monitor', (ws) => { ws.onMessage(() => undefined) })
  await page.route('**/api/v1/programming/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace(/^\/api\/v1\/programming/, '')
    const method = request.method()
    if (method === 'GET' && path === '/capabilities') {
      return json(route, { schemaVersion: '1.0', profile: 'MK-DDC-24-REV-A', targetState: 'READY',
        languages: ['ST', 'FBD'], types: ['BOOL', 'INT', 'REAL'], taskPeriodsMs: [1000],
        limits: { projectsPerController: 1, tasks: 1, stSourceBytes: 65536, variables: 512, statements: 4096, fbdBlocks: 256, fbdConnections: 512, artifactBytes: 1048576, bindings: 256 } })
    }
    if (method === 'GET' && path === '/runtime') {
      return json(route, { schemaVersion: '1.0', controllerId: 'foxlinx-lab', producerState: 'READY', activeRevisionId: null, lkgRevisionId: null, taskState: 'RUNNING', safeState: false, observedAt: new Date().toISOString() })
    }
    if (method === 'GET' && path === '/point-catalog') return json(route, { items: [] })
    if (method === 'GET' && path === '/projects') {
      return json(route, { items: [{ projectId: PROJECT_ID, name: 'AHU-01', etag: '"draft:1"', activeRevisionId: null, draftRevisionId: 'draft-1', updatedAt: new Date().toISOString() }] })
    }
    if (method === 'GET' && path === `/projects/${PROJECT_ID}`) {
      return json(route, { projectId: PROJECT_ID, name: 'AHU-01', etag: '"draft:1"', activeRevisionId: null, draftRevisionId: 'draft-1', updatedAt: new Date().toISOString(),
        draft: { schemaVersion: 1, project: { projectId: PROJECT_ID, name: 'AHU-01', functionalTags: [] },
          programs: [{ programId: PROGRAM_ID, name: 'Điều khiển AHU', kind: 'PROGRAM', language: 'ST', document: source, executionOrder: 0, functionalTags: [] }],
          variables: [], bindings: [], task: { taskId: 'task-1', periodMs: 1000, programOrder: [PROGRAM_ID] }, library: { profile: 'CORE_REVA', version: '1' } } })
    }
    await json(route, { error: { code: 'PRG-ERR-UNAVAILABLE-001', messageKey: 'x', retryable: true, keepsRunningRevision: true, correlationId: 'e2e' } }, 503)
  })
}
async function openEditor(page: Page, lineCount: number) {
  await installMocks(page, stSourceWithLines(lineCount))
  await page.addInitScript(() => window.localStorage.setItem('mkddc-lang', 'vi'))
  await login(page)
  await page.evaluate((target) => { window.history.pushState({}, '', target); window.dispatchEvent(new PopStateEvent('popstate')) }, `/eng/programming/projects/${PROJECT_ID}/design`)
  await page.waitForLoadState('networkidle').catch(() => undefined)
  await page.getByRole('button', { name: 'Mở Điều khiển AHU' }).click()
  await page.waitForSelector('textarea[id^="programming-st-source-"]')
}

/**
 * `DEV-PROG-021` / `DEV-PROG-024` — hai luật bố cục của workspace Thiết kế mà
 * jsdom KHÔNG kiểm được (ở đó mọi phần tử cao 0 px, nên mọi phép đo bố cục là
 * số giả). Cả hai đều từng hỏng thật và đều do người dùng phát hiện, không do
 * cổng nào:
 *
 *  1. Trang KHÔNG được tràn dọc. Chiều cao cột từng chốt bằng một hằng số đoán
 *     chrome phía trên (`calc(100vh - 18rem)`, lần đoán thứ ba); đoán thiếu thì
 *     tài liệu cao hơn viewport và người dùng phải cuộn để thấy hết chỗ mình gõ.
 *  2. Chỗ gõ phải giữ được PHẦN LỚN cột. Khay bàn làm việc và thanh công cụ ăn
 *     chung một ngân sách với nó; có lúc chỗ gõ chỉ còn 12 dòng trong khi khay
 *     tra cứu chiếm 35% cột để nói "không có vấn đề nào".
 */
const VIEWPORTS = [{ w: 1280, h: 800 }, { w: 1920, h: 1080 }]

for (const vp of VIEWPORTS) {
  test(`workspace Thiết kế ${vp.w}x${vp.h}: không tràn dọc, và chỗ gõ giữ được phần lớn cột`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h })
    await openEditor(page, 128)
    const m = await page.evaluate(() => {
      const ta = document.querySelector('textarea[id^="programming-st-source-"]') as HTMLTextAreaElement
      const height = (el: Element | null) => (el ? Math.round(el.getBoundingClientRect().height) : 0)
      const frame = ta.closest('.min-h-\\[18rem\\]') as HTMLElement | null
      return {
        doc: document.documentElement.scrollHeight,
        viewport: window.innerHeight,
        editor: height(ta),
        toolbar: height(frame?.parentElement?.firstElementChild ?? null),
        // Khay bàn làm việc: `<section>` bọc cả tay kéo lẫn dải tab.
        workbench: height(document.querySelector('[role="separator"]')?.parentElement ?? null),
        workbenchOpen: document.querySelector('[role="tabpanel"]') !== null,
      }
    })

    // Dung sai 1 px cho làm tròn của trình duyệt, KHÔNG hơn: 12 px cũng là tràn.
    expect(m.doc, `tài liệu ${m.doc} px trên viewport ${m.viewport} px`).toBeLessThanOrEqual(m.viewport + 1)

    /* Nơi LÀM VIỆC phải lớn hơn nơi TRA CỨU cộng thanh công cụ. Trước lát này
     * quan hệ ấy ngược: đo được chỗ gõ 254 px trong khi khay 181 px + thanh
     * công cụ 100 px = 281 px. Đây là bất biến, không phải một con số tỉ lệ ăn
     * theo chrome của trang — nên nó không đỏ giả khi app shell đổi. */
    expect(
      m.editor,
      `chỗ gõ ${m.editor}px vs khay ${m.workbench}px + thanh công cụ ${m.toolbar}px`,
    ).toBeGreaterThan(m.workbench + m.toolbar)

    // Khay tra cứu KHÔNG mở sẵn: nó lấy 120 px của chỗ gõ để nói "không có vấn đề nào".
    expect(m.workbenchOpen, 'khay bàn làm việc phải thu gọn sẵn').toBe(false)
  })
}
