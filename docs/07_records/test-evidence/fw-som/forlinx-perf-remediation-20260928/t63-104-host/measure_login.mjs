// Đo transfer size cold load trang login (T63-104) bằng Playwright + Chromium có sẵn.
// Dùng: node measure_login.mjs <baseURL> <label> <out.json>
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire('/home/user/MK-DDC-24/apps/web-ui/package.json')
const { chromium } = require('playwright')

const [baseURL, label, outPath] = process.argv.slice(2)
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const runs = []
for (let i = 0; i < 3; i++) {
  // Context mới mỗi lượt = cache trống (cold load).
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: false })
  const page = await context.newPage()
  const consoleErrors = []
  const failed = []
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
  page.on('requestfailed', (req) => failed.push(`${req.url()} ${req.failure()?.errorText}`))
  const responses = []
  page.on('requestfinished', async (req) => {
    const resp = await req.response()
    if (!resp) return
    const sizes = await req.sizes()
    const headers = await resp.allHeaders()
    responses.push({
      url: req.url().replace(baseURL, ''),
      type: req.resourceType(),
      status: resp.status(),
      encoding: headers['content-encoding'] || 'identity',
      vary: headers['vary'] || '',
      cacheControl: headers['cache-control'] || '',
      contentType: headers['content-type'] || '',
      transferBody: sizes.responseBodySize,
      transferHeaders: sizes.responseHeadersSize,
    })
  })
  const started = Date.now()
  await page.goto(`${baseURL}/login`, { waitUntil: 'networkidle' })
  const loadMs = Date.now() - started
  await page.waitForTimeout(300)
  const statics = responses.filter((r) => ['document', 'script', 'stylesheet', 'font', 'image'].includes(r.type))
  const sum = (list, key) => list.reduce((n, r) => n + r[key], 0)
  runs.push({
    loadMs,
    requests: responses.length,
    staticRequests: statics.length,
    staticTransferBody: sum(statics, 'transferBody'),
    staticTransferTotal: sum(statics, 'transferBody') + sum(statics, 'transferHeaders'),
    allTransferTotal: sum(responses, 'transferBody') + sum(responses, 'transferHeaders'),
    gzipResponses: statics.filter((r) => r.encoding === 'gzip').length,
    chartsLoaded: statics.some((r) => /\/assets\/charts-/.test(r.url)),
    consoleErrors,
    failed,
    resources: statics.sort((a, b) => b.transferBody - a.transferBody),
  })
  await context.close()
}
await browser.close()
const summary = {
  label,
  baseURL,
  viewport: '1366x768',
  browser: 'chromium-1194 (/opt/pw-browsers), playwright ' + require('playwright/package.json').version,
  runs: runs.map(({ resources, ...rest }) => rest),
  resourcesRun1: runs[0].resources,
}
writeFileSync(outPath, JSON.stringify(summary, null, 2))
const r = runs[0]
console.log(`${label}: static ${r.staticRequests} req, body ${(r.staticTransferBody / 1024).toFixed(1)} KiB, ` +
  `tổng kèm header ${(r.staticTransferTotal / 1024).toFixed(1)} KiB, gzip ${r.gzipResponses}, charts=${r.chartsLoaded}, ` +
  `console error ${r.consoleErrors.length}, failed ${r.failed.length}, load ${runs.map((x) => x.loadMs).join('/')} ms`)
