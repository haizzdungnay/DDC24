#!/usr/bin/env node
/**
 * `T61-505` / `ISS-PGM04-18` — thu bằng chứng PGM-04 bằng **Chrome DevTools Protocol**.
 *
 * ## Vì sao tệp này tồn tại
 *
 * Phiên audit `2026-09-03` không khởi động được Chrome DevTools MCP vì máy đo
 * không có X server, nên toàn bộ bằng chứng UI của PGM-04 dừng ở ảnh Playwright.
 * `ISS-PGM04-18` từ chối đóng với đúng tình trạng ấy ("Chrome DevTools chưa chạy
 * nhưng dùng ảnh Playwright thay thế"), và điều đó đúng: ảnh Playwright không
 * mang Console, không mang Network, và không nói được điều gì về `Accessibility`.
 *
 * Bản này KHÔNG đi qua Playwright. Nó nói chuyện thẳng với Chrome bằng CDP —
 * đúng giao thức mà DevTools và `chrome-devtools-mcp` dùng — trên một Chrome
 * `--headless=new` với **profile cô lập**. `--headless=new` chính là cách khắc
 * phục "thiếu X server" mà issue yêu cầu; không cần Xvfb.
 *
 * ## Vì sao chạy trên backend THẬT
 *
 * Chặn request để dựng trạng thái sẽ biến lane này thành một lane mock thứ hai.
 * Ở đây mọi trạng thái là trạng thái THẬT: dữ liệu do API tạo trong chính lần
 * chạy, phiên viewer là một tài khoản thật, và `offline` dựng bằng
 * `Network.emulateNetworkConditions` — một khả năng của DevTools, không phải một
 * fixture.
 *
 * ## Bí mật
 *
 * Không ghi header, cookie hay token vào bằng chứng. `redactHeaders` giữ lại
 * TÊN header và thay giá trị bằng `[redacted]`: biết một request có gửi
 * `authorization` hay không là thông tin cần cho review, còn giá trị thì không.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

/* `WebSocket` toàn cục của Node 22 — cố ý KHÔNG dùng gói `ws`.
   Lane đo không được kéo thêm phụ thuộc npm: một cổng chỉ chạy được sau khi cài
   thêm thứ gì đó là một cổng sẽ bị bỏ qua ở máy không cài được. */

const BASE = process.env.PGM04_AUDIT_BASE_URL ?? 'http://127.0.0.1:4175'
const CDP = process.env.PGM04_AUDIT_CDP ?? 'http://127.0.0.1:9333'
const OUT = process.env.PGM04_AUDIT_OUT ?? 'artifacts/ui-audit/pgm04'
const AXE = process.env.PGM04_AUDIT_AXE ?? 'apps/web-ui/node_modules/axe-core/axe.min.js'

/** Bốn dải khổ của `SPEC-PGM04-VISUAL-001` §1, cộng khổ 700 px quyết định. */
const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900, band: '>=1280', inspector: 'dock' },
  { name: '1280x800', width: 1280, height: 800, band: '>=1280', inspector: 'dock' },
  { name: '1024x768', width: 1024, height: 768, band: '1024-1279', inspector: 'dock' },
  { name: '768x1024', width: 768, height: 1024, band: '768-1023', inspector: 'drawer' },
  /* `700` nằm trong dải 640–767, dải DUY NHẤT phân biệt được ngưỡng `640` với
     `768`. Bỏ nó thì một lưới chuyển cột ở sai ngưỡng vẫn "đạt" ở cả bốn khổ
     kia — và sai ngưỡng nghĩa là hai cột hiện ra DƯỚI ngưỡng chỉ-đọc. */
  { name: '700x900', width: 700, height: 900, band: '<768', inspector: 'fullscreen' },
  { name: '390x844', width: 390, height: 844, band: '<768', inspector: 'fullscreen' },
]

const SECRET_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key', 'proxy-authorization'])

function redactHeaders(headers = {}) {
  const out = {}
  for (const [key, value] of Object.entries(headers)) {
    out[key] = SECRET_HEADERS.has(key.toLowerCase()) ? '[redacted]' : String(value).slice(0, 200)
  }
  return out
}

/** Một phiên CDP tối thiểu: gửi lệnh, chờ đúng `id`, và phát sự kiện ra handler. */
class Session {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    this.handlers = new Map()
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString())
      if (message.id !== undefined) {
        const entry = this.pending.get(message.id)
        if (!entry) return
        this.pending.delete(message.id)
        if (message.error) entry.reject(new Error(`${entry.method}: ${JSON.stringify(message.error)}`))
        else entry.resolve(message.result)
        return
      }
      for (const handler of this.handlers.get(message.method) ?? []) handler(message.params)
    })
  }
  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (!this.pending.has(id)) return
        this.pending.delete(id)
        reject(new Error(`${method}: quá hạn 30 s`))
      }, 30_000)
    })
  }
  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, [])
    this.handlers.get(method).push(handler)
  }
}

async function openSession() {
  const targets = await (await fetch(`${CDP}/json/list`)).json()
  const page = targets.find((target) => target.type === 'page')
  if (!page) throw new Error('Chrome không có tab nào để gắn CDP')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  return new Session(ws)
}

function newLog() {
  return { consoleErrors: [], pageErrors: [], requestFailures: [], httpErrors: [] }
}

function attachLog(session, log) {
  session.on('Runtime.consoleAPICalled', (params) => {
    if (params.type !== 'error') return
    log.consoleErrors.push(params.args.map((arg) => arg.description ?? arg.value ?? arg.type).join(' '))
  })
  session.on('Runtime.exceptionThrown', (params) => {
    log.pageErrors.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? 'unknown')
  })
  session.on('Network.loadingFailed', (params) => {
    log.requestFailures.push({ requestId: params.requestId, errorText: params.errorText, type: params.type })
  })
  session.on('Network.responseReceived', (params) => {
    if (params.response.status < 400) return
    log.httpErrors.push({
      status: params.response.status,
      url: new URL(params.response.url).pathname,
      headers: redactHeaders(params.response.headers),
    })
  })
}

async function evaluate(session, expression) {
  const result = await session.send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(`evaluate: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`)
  }
  return result.result.value
}

async function setViewport(session, viewport) {
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width, height: viewport.height,
    deviceScaleFactor: 1, mobile: viewport.width < 768,
  })
}

async function screenshot(session, file) {
  const shot = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(file, Buffer.from(shot.data, 'base64'))
}

/** axe THẬT, nạp vào trang và chạy trong chính Chrome này — không qua wrapper. */
async function runAxe(session) {
  const source = readFileSync(AXE, 'utf8')
  await evaluate(session, `${source}\n//# sourceURL=axe-core.js`)
  return evaluate(session, `
    (async () => {
      const result = await window.axe.run(document.querySelector('main') ?? document, {
        runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'] }
      })
      return result.violations
        .filter((violation) => ['serious','critical'].includes(violation.impact))
        .map((violation) => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.length }))
    })()
  `)
}

/**
 * Đo BỐ CỤC bằng toạ độ thật, không bằng lớp CSS: một lớp Tailwind sai ngưỡng
 * vẫn "có mặt" trong `className`, còn toạ độ thì không nói dối.
 */
async function measureLayout(session) {
  return evaluate(session, `
    (() => {
      const cards = [...document.querySelectorAll('[data-testid="library-block-card"]')]
      const top = cards.length ? cards[0].getBoundingClientRect().top : 0
      const columns = cards.filter((card) => Math.abs(card.getBoundingClientRect().top - top) < 1).length
      const drawer = document.querySelector('[data-testid="library-inspector-drawer"]')
      const tablist = document.querySelector('[role="tablist"][aria-label*="chi tiết"], [role="tablist"][aria-label*="detail"]')
      const dockPanel = tablist ? tablist.closest('section') : null
      const small = [...document.querySelectorAll('main button, main a[href], main input, main [role="tab"]')]
        .filter((node) => {
          const rect = node.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0 && rect.height < 24
        })
        .map((node) => (node.getAttribute('aria-label') || node.textContent || '').trim().slice(0, 40))
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        cards: cards.length,
        columns,
        inspector: drawer ? (drawer.dataset.mode ?? 'drawer') : 'dock',
        drawerWidth: drawer ? Math.round(drawer.getBoundingClientRect().width) : null,
        dockWidth: drawer ? null : Math.round(dockPanel ? dockPanel.getBoundingClientRect().width : 0),
        smallHitTargets: [...new Set(small)],
      }
    })()
  `)
}

async function waitFor(session, expression, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await evaluate(session, `!!(${expression})`)) return
    if (Date.now() > deadline) throw new Error(`chờ quá hạn: ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

/**
 * Điều hướng TRONG ứng dụng, không nạp lại trang.
 *
 * `AuthProvider` giữ phiên trong React state, nên mỗi `Page.navigate` là một lần
 * mất phiên và bị đá về `/login`. Bản đầu của tệp này đăng nhập rồi `Page.navigate`
 * tới màn Thư viện — và đứng chờ mãi một thẻ khối không bao giờ xuất hiện, vì
 * trang đang hiển thị form đăng nhập. Điều hướng phía client giữ nguyên phiên,
 * đúng cách người dùng thật đi giữa các màn.
 */
async function navigate(session, path) {
  await evaluate(session, `
    (() => {
      window.history.pushState({}, '', ${JSON.stringify(path)})
      window.dispatchEvent(new PopStateEvent('popstate'))
      return true
    })()
  `)
}

/**
 * Chọn thẻ đầu tiên, và LẶP cho tới khi khay Inspector THẬT SỰ có nội dung.
 *
 * Hai cái bẫy, cả hai đã dính thật:
 *
 *  1. Một `.click()` có thể rơi vào hư không. Ngay sau khi danh sách tải lại,
 *     React thay nút cũ bằng nút mới; cú bấm gửi vào nút đã bị gỡ khỏi cây thì
 *     không handler nào chạy. Bấm một lần rồi đứng chờ sẽ hỏng ở khổ ĐẦU TIÊN
 *     của vòng lặp — đúng khổ đi ngay sau lần tải lại.
 *  2. `entry=` vào URL ngay lúc bấm, còn khay dựng sau đó một nhịp. Đo bề rộng
 *     giữa hai nhịp ấy cho `dockWidth = 0` — một con số trông như lỗi bố cục
 *     nhưng thật ra là lỗi của phép đo.
 *
 * Nên điều kiện dừng là **bề rộng khay đã đo được**, không phải "URL đã đổi".
 */
async function selectFirstCard(session, label) {
  const deadline = Date.now() + 25_000
  for (;;) {
    const state = await evaluate(session, `
      (() => {
        const drawer = document.querySelector('[data-testid="library-inspector-drawer"]')
        const tablist = document.querySelector('[role="tablist"][aria-label*="chi tiết"], [role="tablist"][aria-label*="detail"]')
        const panel = tablist ? tablist.closest('section') : null
        return {
          entry: new URLSearchParams(location.search).get('entry'),
          ready: Boolean(drawer) || Boolean(panel && panel.getBoundingClientRect().width > 0),
          cards: document.querySelectorAll('[data-testid="library-block-card"]').length,
          tablists: [...document.querySelectorAll('[role="tablist"]')].map((node) => node.getAttribute('aria-label')),
        }
      })()
    `)
    if (state.ready) return
    await evaluate(session, `
      (() => {
        const card = document.querySelector('[data-testid="library-block-card"]')
        if (card) card.click()
        return true
      })()
    `)
    if (Date.now() > deadline) {
      /* Lỗi phải TỰ NÓI RA nó thấy gì: chạy lại cả stack chỉ để biết trên màn
         hình có gì là vài phút cho một câu trả lời vốn nằm ngay trong DOM. */
      throw new Error(`khay Inspector không dựng ở ${label} | DOM: ${JSON.stringify(state)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

async function login(session, path, username, password) {
  /* Vào bằng DEEP LINK rồi mới đăng nhập: `AuthProvider` phải quay lại đúng
     route sau khi đăng nhập, và đó cũng là điều đáng kiểm. */
  await session.send('Page.navigate', { url: `${BASE}${path}` })
  await waitFor(session, `document.querySelector('input[type="password"]') || document.querySelector('[data-testid="library-block-card"]')`, 'form đăng nhập')
  if (!(await evaluate(session, `!!document.querySelector('input[type="password"]')`))) return
  await evaluate(session, `
    (() => {
      const setValue = (node, value) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(node, value)
        node.dispatchEvent(new Event('input', { bubbles: true }))
      }
      const inputs = [...document.querySelectorAll('input')]
      const user = inputs.find((node) => node.type !== 'password')
      const pass = inputs.find((node) => node.type === 'password')
      setValue(user, ${JSON.stringify(username)})
      setValue(pass, ${JSON.stringify(password)})
      const submit = [...document.querySelectorAll('button')].find((node) => node.type === 'submit' || /Đăng nhập|Sign in/i.test(node.textContent))
      submit.click()
      return true
    })()
  `)
  await waitFor(session, `!location.pathname.endsWith('/login')`, `đăng nhập ${username}`)
}

/**
 * Tạo khối PROJECT qua **API thật**, giữa hai lần chụp.
 *
 * `capabilities.limits.projectsPerController = 1`, nên không thể có một Project
 * thứ hai để đóng vai "thư viện rỗng". Trạng thái rỗng vì thế được chụp TRƯỚC,
 * rồi khối mới được tạo — thứ tự thời gian thay cho hai Project song song.
 *
 * Đây là bước DỰNG BỐI CẢNH, đi qua HTTP chứ không qua giao diện: audit không
 * bấm nút Lưu hộ người dùng, và mọi ảnh chụp sau đó vẫn là ảnh của một trạng
 * thái do máy chủ thật giữ.
 */
async function seedEntryOverApi(apiBase, projectID) {
  const login = await (await fetch(`${apiBase}/api/v1/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })).json()
  const project = await (await fetch(`${apiBase}/api/v1/programming/projects/${projectID}`, {
    headers: { authorization: `Bearer ${login.token}` },
  })).json()
  /* BA khối, không phải một.
     Số cột của lưới đo bằng "bao nhiêu thẻ nằm trên hàng đầu". Với một thẻ, con
     số ấy luôn bằng 1 ở mọi khổ — nó "đạt" mọi ngưỡng và không nói được gì về
     bố cục. Ba thẻ là số nhỏ nhất phân biệt được 1/2/3 cột. */
  let etag = project.etag
  for (const name of ['SCALE_AUDIT', 'LIMIT_AUDIT', 'DELAY_AUDIT']) {
  const response = await fetch(`${apiBase}/api/v1/programming/projects/${projectID}/library/entries`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${login.token}`, 'content-type': 'application/json',
      'x-correlation-id': crypto.randomUUID(), 'x-idempotency-key': crypto.randomUUID(),
      'if-match': etag,
    },
    body: JSON.stringify({
      schemaVersion: '1.0', entryId: crypto.randomUUID(), kind: 'FUNCTION',
      name, language: 'ST',
      source: `FUNCTION ${name} : REAL\nVAR_INPUT\n  X : REAL;\nEND_VAR\n${name} := X * 2.0;\nEND_FUNCTION\n`,
      interface: {
        inputs: [{ name: 'X', type: 'REAL' }], returnType: 'REAL',
        dispatch: 'FUNC_TABLE', polymorphic: false, typedPortNames: [], category: 'math',
        labelVi: 'Tỉ lệ (audit)', labelEn: 'Scale (audit)', allowedTypes: ['REAL'], defaultType: 'REAL',
        ports: [
          { name: 'X', direction: 'INPUT', dataType: 'REAL' },
          { name: 'OUT', direction: 'OUTPUT', dataType: 'REAL' },
        ],
      },
      dependencies: [], category: 'math', description: 'Khối dùng cho phiên audit giao diện',
      tags: ['audit'],
    }),
  })
  if (response.status !== 200) {
    throw new Error(`tạo khối audit hỏng: ${response.status} ${await response.text()}`)
  }
  etag = (await response.json()).etag
  }
}

async function main() {
  const projectID = process.env.PGM04_AUDIT_PROJECT
  const apiBase = process.env.PGM04_AUDIT_API
  if (!projectID || !apiBase) {
    throw new Error('Thiếu PGM04_AUDIT_PROJECT / PGM04_AUDIT_API; phải chạy qua scripts/run-pgm04-devtools-audit.sh')
  }
  mkdirSync(OUT, { recursive: true })
  const commit = execSync('git rev-parse HEAD').toString().trim()
  const startedAt = new Date().toISOString()

  const session = await openSession()
  await session.send('Page.enable')
  await session.send('Runtime.enable')
  await session.send('Network.enable')
  await session.send('Accessibility.enable')
  const log = newLog()
  attachLog(session, log)

  /* NGÔN NGỮ phải khoá trước khi trang chạy dòng mã đầu tiên.
  
     `I18nProvider` chọn ngôn ngữ theo `navigator.language` cho hồ sơ mới, và
     Chrome headless mặc định là `en-US`. Bản đầu của tệp này không khoá gì, nên
     giao diện hiện tiếng Anh trong khi mọi phép chờ hỏi chuỗi tiếng Việt —
     audit đứng chờ một nhãn không bao giờ xuất hiện, và thông báo lỗi ("chờ quá
     hạn: Inspector") trỏ vào một thành phần hoàn toàn khoẻ mạnh.
  
     `Page.addScriptToEvaluateOnNewDocument` chạy TRƯỚC script của trang, nên
     `localStorage` đã có giá trị lúc `I18nProvider` đọc. Đặt sau khi tải xong
     thì phải nạp lại thêm một lần, và lần nạp ấy làm mất phiên. */
  await session.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { window.localStorage.setItem('mkddc-lang', 'vi') } catch { /* private mode */ }`,
  })

  const evidence = { lane: 'BROWSER/HOST', tool: 'Chrome DevTools Protocol (headless=new, profile cô lập)', commit, startedAt, baseURL: BASE, captures: [] }
  const browserVersion = await (await fetch(`${CDP}/json/version`)).json()
  evidence.browser = browserVersion.Browser
  evidence.protocol = browserVersion['Protocol-Version']

  async function capture(name, viewport, extra = {}) {
    const file = join(OUT, `${name}.png`)
    await screenshot(session, file)
    const layout = await measureLayout(session)
    const axe = await runAxe(session)
    evidence.captures.push({
      name, viewport: viewport.name, band: viewport.band, expectedInspector: viewport.inspector,
      url: await evaluate(session, 'location.pathname + location.search'),
      at: new Date().toISOString(), screenshot: `${name}.png`, layout, axeSeriousOrCritical: axe, ...extra,
    })
    return { layout, axe }
  }

  const libraryPath = `/eng/programming/projects/${projectID}/library?scope=PROJECT`
  await login(session, libraryPath, 'admin', 'admin123')

  /* ---- EMPTY trước: Project chưa có khối nào ------------------------ */
  const desktopFirst = VIEWPORTS[1]
  await setViewport(session, desktopFirst)
  await waitFor(session, `document.body.innerText.includes('chưa có khối nào')`, 'trạng thái rỗng')
  await capture('empty-project-1280x800', desktopFirst, { state: 'empty-project' })

  /* Rồi mới có khối. Xem `seedEntryOverApi`: một controller chỉ giữ MỘT Project. */
  await seedEntryOverApi(apiBase, projectID)

  /* Ứng dụng không biết store vừa đổi. Đổi tab phạm vi rồi quay lại là một lần
     ĐỌC LẠI TỪ MÁY CHỦ — `T61-302` khoá đúng hành vi ấy: bộ lọc chạy ở server,
     không chạy trên trang đã tải. Một `pushState` về cùng đường dẫn thì React
     Router coi là không đổi và không gọi lại gì. */
  await navigate(session, `/eng/programming/projects/${projectID}/library?scope=SYSTEM`)
  await waitFor(session, `document.querySelectorAll('[data-testid="library-block-card"]').length > 0`, 'tab Hệ thống')
  await navigate(session, libraryPath)
  await waitFor(session, `document.querySelectorAll('[data-testid="library-block-card"]').length > 0`, 'khối audit vừa tạo')

  /* ---- Trạng thái READY ở CẢ SÁU khổ ------------------------------- */
  for (const viewport of VIEWPORTS) {
    await setViewport(session, viewport)
    await navigate(session, libraryPath)
    await waitFor(session, `document.querySelectorAll('[data-testid="library-block-card"]').length > 0`, `thẻ khối ở ${viewport.name}`)
    /* Chọn một khối để Inspector CÓ nội dung: một khay rỗng không tràn được,
       nên đo lúc nó rỗng là đo một thứ không có rủi ro. */
    await selectFirstCard(session, viewport.name)
    /* Chờ URL mang `entry=`, không chờ một nhãn.
    
       Ở khổ cắm, khay Inspector CÓ MẶT SẴN kể cả khi chưa chọn gì (nó hiện
       "Chọn một khối để xem chi tiết"), nên "thấy khay" không phân biệt được
       "đã chọn" với "chưa chọn". Khối đang chọn nằm trong URL (`T61-304`), và
       đó là tín hiệu nói đúng thứ cần biết. */
    await capture(`ready-${viewport.name}`, viewport, { state: 'ready' })
  }

  const desktop = VIEWPORTS[1]
  const tablet = VIEWPORTS[3]
  const mobile = VIEWPORTS[5]

  /* ---- EMPTY-FILTER: 0 kết quả vì bộ lọc, KHÁC thư viện rỗng -------- */
  await setViewport(session, desktop)
  await navigate(session, libraryPath)
  await waitFor(session, `document.querySelectorAll('[data-testid="library-block-card"]').length > 0`, 'thẻ khối')
  await evaluate(session, `
    (() => {
      const box = document.querySelector('input[type="search"], [role="searchbox"]')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(box, 'KHONG_TON_TAI_KHOI_NAO')
      box.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()
  `)
  await waitFor(session, `document.body.innerText.includes('khớp bộ lọc')`, 'trạng thái 0 kết quả vì bộ lọc')
  await capture('empty-filter-1280x800', desktop, { state: 'empty-filter' })

  /* ---- REVIEW_REQUIRED: khối SYSTEM chờ Controls/Safety ------------- */
  await navigate(session, `/eng/programming/projects/${projectID}/library?scope=SYSTEM`)
  await waitFor(session, `document.body.innerText.includes('Chờ review')`, 'badge chờ review')
  await evaluate(session, `
    (() => {
      const card = [...document.querySelectorAll('[data-testid="library-block-card"]')]
        .find((node) => node.innerText.startsWith('PID'))
      card.click()
      return true
    })()
  `)
  await waitFor(session, `document.body.innerText.includes('chưa qua review')`, 'cảnh báo review')
  const reviewInsert = await evaluate(session, `
    (() => {
      const buttons = [...document.querySelectorAll('button')].filter((node) => /Chèn vào POU/.test(node.textContent))
      return { count: buttons.length, allDisabled: buttons.every((node) => node.disabled) }
    })()
  `)
  await capture('review-required-1280x800', desktop, { state: 'review-required', reviewInsert })

  /* ---- AUTHORING: drawer soạn thảo mở theo yêu cầu ------------------ */
  await navigate(session, libraryPath)
  await waitFor(session, `document.querySelectorAll('[data-testid="library-block-card"]').length > 0`, 'thẻ khối')
  /* FOCUS nút mở TRƯỚC khi bấm.
     Bản đầu gọi thẳng `.click()`, nên `document.activeElement` vẫn là `body`
     lúc hộp thoại mở — và phép đo "trả tiêu điểm về đâu" sau đó đọc được `BODY`
     rồi kết luận sai rằng sản phẩm không trả tiêu điểm. Người dùng thật tới nút
     bằng bàn phím hoặc chuột, và cả hai đều đặt tiêu điểm lên nó. */
  await evaluate(session, `
    (() => {
      const button = [...document.querySelectorAll('button')].find((node) => /Khối PROJECT mới/.test(node.textContent))
      button.focus()
      button.click()
      return true
    })()
  `)
  await waitFor(session, `document.querySelector('[role="dialog"]')`, 'drawer soạn thảo')
  await capture('authoring-1280x800', desktop, { state: 'authoring' })

  /* ---- FOCUS RETURN: Esc đóng drawer và trả tiêu điểm về đúng nút ---
     Kiểm bằng TƯƠNG TÁC THẬT (`Input.dispatchKeyEvent`), không bằng ảnh: một
     ảnh chụp không nói được tiêu điểm đang ở đâu sau khi hộp thoại đóng. */
  await session.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await waitFor(session, `!document.querySelector('[role="dialog"]')`, 'drawer đóng bằng Esc')
  const focusAfterEscape = await evaluate(session, `
    (() => {
      const active = document.activeElement
      return { tag: active?.tagName ?? null, label: (active?.textContent ?? '').trim().slice(0, 40) }
    })()
  `)
  evidence.focusAfterEscape = focusAfterEscape

  /* ---- TARGET CHOOSER: hộp chọn POU đích của đường Chèn ------------- */
  await selectFirstCard(session, 'target chooser')
  await waitFor(session, `[...document.querySelectorAll('button')].some((n) => /Chèn vào POU/.test(n.textContent))`, 'nút Chèn')
  const insertOpened = await evaluate(session, `
    (() => {
      const button = [...document.querySelectorAll('button')].find((node) => /Chèn vào POU/.test(node.textContent))
      if (button.disabled) return { opened: false, disabled: true, reason: (document.querySelector('[data-testid="library-insert-reason"]')?.textContent ?? '').trim() }
      button.click()
      return { opened: true, disabled: false }
    })()
  `)
  if (insertOpened.opened) {
    await waitFor(session, `document.querySelector('[role="dialog"]')`, 'hộp chọn POU đích')
  }
  await capture('target-chooser-1280x800', desktop, { state: 'target-chooser', insertOpened })

  /* ---- TABLET DRAWER: hình thái khay ở dải 768–1023 ----------------- */
  await setViewport(session, tablet)
  await navigate(session, libraryPath)
  await waitFor(session, `document.querySelectorAll('[data-testid="library-block-card"]').length > 0`, 'thẻ khối tablet')
  await selectFirstCard(session, 'tablet')
  await capture('tablet-drawer-768x1024', tablet, { state: 'drawer-open' })

  /* ---- MOBILE READ-ONLY: dưới 768 px không một đường ghi nào bật ---- */
  await setViewport(session, mobile)
  await navigate(session, libraryPath)
  await waitFor(session, `document.querySelectorAll('[data-testid="library-block-card"]').length > 0`, 'thẻ khối mobile')
  await selectFirstCard(session, 'mobile')
  const mobileWrites = await evaluate(session, `
    (() => {
      const labels = [/Khối PROJECT mới/, /Chèn vào POU/, /^Sửa/, /^Xoá khối/]
      const found = []
      for (const node of document.querySelectorAll('button')) {
        if (!labels.some((pattern) => pattern.test(node.textContent.trim()))) continue
        found.push({ label: node.textContent.trim().slice(0, 40), disabled: node.disabled })
      }
      return { controls: found, anyEnabled: found.some((item) => !item.disabled) }
    })()
  `)
  await capture('mobile-readonly-390x844', mobile, { state: 'mobile-read-only', mobileWrites })

  /* ---- OFFLINE: dựng bằng DevTools, không bằng fixture -------------- */
  await setViewport(session, desktop)
  await session.send('Network.emulateNetworkConditions', {
    offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
  })
  const offlineLog = newLog()
  const offlineEvidence = []
  attachLog(session, offlineLog)
  /* Kích một lần ĐỌC LẠI trong ứng dụng, KHÔNG `location.reload()`.
     Nạp lại trang làm mất phiên (phiên nằm trong React state) nên màn hình rơi
     về `/login` — và ảnh chụp khi ấy nói về trang đăng nhập, không nói gì về
     hành vi fail-closed của Thư viện. Đổi tab phạm vi là một lượt gọi máy chủ
     thật, và lượt ấy chết vì mạng đang bị cắt. */
  await navigate(session, `/eng/programming/projects/${projectID}/library?scope=SYSTEM`)
  await new Promise((resolve) => setTimeout(resolve, 5_000))
  const offlineText = await evaluate(session, `document.body.innerText.slice(0, 4000)`).catch(() => '')
  offlineEvidence.push({ sawFailClosedBanner: /Chưa đọc được|không phản hồi|Không tải được/.test(offlineText) })
  await screenshot(session, join(OUT, 'offline-1280x800.png'))
  evidence.captures.push({
    name: 'offline-1280x800', viewport: desktop.name, band: desktop.band, state: 'offline',
    at: new Date().toISOString(), screenshot: 'offline-1280x800.png',
    note: 'Mất mạng dựng bằng Network.emulateNetworkConditions của DevTools, không bằng fixture.',
    offline: offlineEvidence[0],
    /* Lỗi mạng ở đây là lỗi do CHÍNH phép đo bơm vào — phải tách khỏi lỗi sản
       phẩm, nếu không ngân sách "0 lỗi" sẽ vô nghĩa ở mọi case đường hỏng. */
    inducedRequestFailures: offlineLog.requestFailures.length,
  })
  await session.send('Network.emulateNetworkConditions', {
    offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
  })

  /* ---- PERMISSION: phiên viewer THẬT -------------------------------- */
  const viewer = process.env.PGM04_AUDIT_VIEWER
  const viewerPassword = process.env.PGM04_AUDIT_VIEWER_PASSWORD
  if (viewer && viewerPassword) {
    /* Đăng nhập lại bằng vai viewer: `Page.navigate` ở đây là CÓ CHỦ Ý — nó bỏ
       phiên admin trong React state, đúng thứ cần để phiên sau là một phiên
       viewer thật chứ không phải admin đội lốt. */
    await login(session, libraryPath, viewer, viewerPassword)
    await waitFor(session, `document.querySelectorAll('[data-testid="library-block-card"]').length > 0`, 'thẻ khối vai viewer')
    const viewerWrites = await evaluate(session, `
      (() => {
        const create = [...document.querySelectorAll('button')].find((node) => /Khối PROJECT mới/.test(node.textContent))
        return {
          createVisible: Boolean(create),
          createDisabled: create ? create.disabled : null,
          reason: (document.body.innerText.match(/Vai hiện tại không sửa được[^\\n]*/) ?? [null])[0],
        }
      })()
    `)
    await capture('permission-viewer-1280x800', desktop, { state: 'permission', role: 'viewer', viewerWrites })
  } else {
    evidence.captures.push({ name: 'permission-viewer-1280x800', state: 'permission', skipped: 'NOT_RUN — thiếu PGM04_AUDIT_VIEWER' })
  }

  evidence.finishedAt = new Date().toISOString()
  /* Ngân sách lỗi tính trên TOÀN phiên, và tách riêng phần do phép đo bơm vào. */
  evidence.consoleErrors = log.consoleErrors
  evidence.pageErrors = log.pageErrors
  evidence.requestFailures = log.requestFailures
  evidence.httpErrors = log.httpErrors
  /* TỰ KIỂM bí mật trước khi ghi.
  
     `AGENTS.md` cấm đưa token/cookie/header bí mật vào báo cáo, và
     `redactHeaders` là chỗ thực thi lệnh cấm ấy. Nhưng một hàm lọc chỉ đúng khi
     KHÔNG AI đi vòng qua nó — mà bằng chứng ở đây gom từ năm nguồn khác nhau,
     và nguồn thứ sáu thêm vào ngày mai sẽ không tự nhớ phải lọc. Nên kiểm trên
     CHÍNH chuỗi sắp ghi ra đĩa: đó là thứ duy nhất người đọc sẽ thấy. */
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`
  const leaks = []
  if (/Bearer\s+[A-Za-z0-9._-]{16,}/.test(serialized)) leaks.push('Bearer token')
  if (process.env.PGM04_AUDIT_VIEWER_PASSWORD && serialized.includes(process.env.PGM04_AUDIT_VIEWER_PASSWORD)) {
    leaks.push('mật khẩu viewer')
  }
  if (/"(authorization|cookie|set-cookie|x-api-key)":\s*"(?!\[redacted\])/i.test(serialized)) {
    leaks.push('header nhạy cảm chưa che')
  }
  if (leaks.length > 0) {
    throw new Error(`bằng chứng chứa bí mật (${leaks.join(', ')}) — KHÔNG ghi ra đĩa`)
  }
  writeFileSync(join(OUT, 'evidence.json'), serialized)

  const serious = evidence.captures.flatMap((capture) => capture.axeSeriousOrCritical ?? [])
  console.log(`[T61-505] lane=BROWSER/HOST browser=${evidence.browser} captures=${evidence.captures.length}`
    + ` axeSerious=${serious.length} consoleErrors=${log.consoleErrors.length}`
    + ` pageErrors=${log.pageErrors.length} httpErrors=${log.httpErrors.length}`)
  if (serious.length > 0 || log.consoleErrors.length > 0 || log.pageErrors.length > 0) {
    console.error('[T61-505] CÓ lỗi nghiêm trọng — xem evidence.json')
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(`[T61-505] audit hỏng: ${error.message}`)
  process.exitCode = 1
})
