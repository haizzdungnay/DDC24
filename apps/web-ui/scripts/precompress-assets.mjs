#!/usr/bin/env node
/* T63-104 (PERF-FE-01, Plan 63 §4.2) — nén sẵn JS/CSS trong `assets/` thành `.gz`.
 *
 * Vì sao nén SẴN mà không nén lúc phục vụ: mkddc-web chạy trên SOM 4 lõi A53, cùng
 * CPU0–2 với iobus. Nén gzip mỗi request là tốn CPU đúng chỗ Plan 63 đang dọn.
 * Nén một lần lúc build, `handleStatic` (apps/web-api/internal/app/http.go) chỉ
 * việc chọn file `.gz` khi client nhận gzip và request không có `Range`.
 *
 * Luật:
 *   - Chỉ `.js`/`.css` trong `assets/` (tên có hash nội dung, cache immutable).
 *     `index.html` KHÔNG nén: nó `no-cache`, ~1 KB, và là thứ trỏ vào bundle.
 *   - Bỏ file < MIN_BYTES và file nén không nhỏ hơn bản gốc: phục vụ bản gốc rẻ hơn.
 *   - Mức nén 9, header gzip không mang mtime/tên file ⇒ cùng input ra cùng byte.
 *   - Sau khi nén, ĐỌC LẠI từng `.gz`, giải nén và so với bản gốc; lệch là build hỏng.
 *
 * Cách chạy:
 *   node scripts/precompress-assets.mjs [--assets DIR]   (mặc định build/web-ui/dist/assets)
 *   node scripts/precompress-assets.mjs --self-test
 */
import { gunzipSync, gzipSync, constants } from 'node:zlib'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

export const MIN_BYTES = 1024
const EXTENSIONS = ['.js', '.css']

const here = dirname(fileURLToPath(import.meta.url))
const DEFAULT_ASSETS = resolve(here, '../../../build/web-ui/dist/assets')

function eligible(name) {
  return EXTENSIONS.some((ext) => name.endsWith(ext))
}

/** Nén mọi JS/CSS đủ lớn trong `assetsDir`. Trả tổng kết để in và để test. */
export function precompressAssets(assetsDir) {
  const summary = { compressed: [], skipped: [], rawBytes: 0, gzipBytes: 0 }
  for (const name of readdirSync(assetsDir).sort()) {
    const path = join(assetsDir, name)
    if (!eligible(name) || !statSync(path).isFile()) continue
    const raw = readFileSync(path)
    if (raw.length < MIN_BYTES) {
      summary.skipped.push({ name, reason: 'nhỏ hơn ngưỡng' })
      continue
    }
    const packed = gzipSync(raw, { level: constants.Z_BEST_COMPRESSION })
    if (packed.length >= raw.length) {
      summary.skipped.push({ name, reason: 'nén không nhỏ hơn' })
      continue
    }
    writeFileSync(`${path}.gz`, packed)
    summary.compressed.push({ name, raw: raw.length, gzip: packed.length })
    summary.rawBytes += raw.length
    summary.gzipBytes += packed.length
  }
  return summary
}

/** Mọi JS/CSS đủ lớn phải có `.gz` giải nén ra ĐÚNG byte gốc; `.gz` mồ côi là lỗi. */
export function verifyPrecompressed(assetsDir) {
  const problems = []
  const names = new Set(readdirSync(assetsDir))
  for (const name of [...names].sort()) {
    const path = join(assetsDir, name)
    if (name.endsWith('.gz')) {
      const source = name.slice(0, -3)
      if (!names.has(source)) problems.push(`${name}: không có file gốc ${source}`)
      else if (!eligible(source)) problems.push(`${name}: chỉ nén JS/CSS, không nén ${source}`)
      else if (!gunzipSync(readFileSync(path)).equals(readFileSync(join(assetsDir, source)))) {
        problems.push(`${name}: giải nén không khớp ${source}`)
      }
      continue
    }
    if (!eligible(name)) continue
    const raw = readFileSync(path)
    if (raw.length < MIN_BYTES || names.has(`${name}.gz`)) continue
    if (gzipSync(raw, { level: constants.Z_BEST_COMPRESSION }).length < raw.length) {
      problems.push(`${name}: thiếu ${name}.gz`)
    }
  }
  return problems
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'precompress-'))
  const failures = []
  const expect = (label, ok) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`)
    if (!ok) failures.push(label)
  }
  try {
    const big = Buffer.from('export const x = "mkddc";\n'.repeat(400))
    writeFileSync(join(dir, 'index-AbC123.js'), big)
    writeFileSync(join(dir, 'index-AbC123.css'), Buffer.from('.a{color:red}\n'.repeat(200)))
    writeFileSync(join(dir, 'tiny-1.js'), Buffer.from('x()'))
    writeFileSync(join(dir, 'logo-2.svg'), Buffer.from('<svg/>'.repeat(400)))
    writeFileSync(join(dir, 'random-3.js'), randomBytes(4096)) // không nén được

    const summary = precompressAssets(dir)
    expect('nén JS lớn', existsSync(join(dir, 'index-AbC123.js.gz')))
    expect('nén CSS lớn', existsSync(join(dir, 'index-AbC123.css.gz')))
    expect('bỏ JS < 1 KiB', !existsSync(join(dir, 'tiny-1.js.gz')))
    expect('không nén SVG (chỉ JS/CSS)', !existsSync(join(dir, 'logo-2.svg.gz')))
    expect('bỏ file nén không nhỏ hơn', !existsSync(join(dir, 'random-3.js.gz')))
    expect('giải nén trùng byte gốc',
      gunzipSync(readFileSync(join(dir, 'index-AbC123.js.gz'))).equals(big))
    expect('tổng kết đếm đúng 2 file', summary.compressed.length === 2)
    const again = readFileSync(join(dir, 'index-AbC123.js.gz'))
    precompressAssets(dir)
    expect('cùng input ra cùng byte (không mtime trong header)',
      readFileSync(join(dir, 'index-AbC123.js.gz')).equals(again))
    expect('verify sạch sau khi nén', verifyPrecompressed(dir).length === 0)

    rmSync(join(dir, 'index-AbC123.css.gz'))
    expect('verify bắt JS/CSS thiếu .gz',
      verifyPrecompressed(dir).some((p) => p.includes('index-AbC123.css: thiếu')))
    precompressAssets(dir)
    writeFileSync(join(dir, 'index-AbC123.js.gz'), gzipSync(Buffer.from('khác')))
    expect('verify bắt .gz lệch nội dung',
      verifyPrecompressed(dir).some((p) => p.includes('giải nén không khớp')))
    precompressAssets(dir)
    writeFileSync(join(dir, 'gone-4.js.gz'), gzipSync(big))
    expect('verify bắt .gz mồ côi', verifyPrecompressed(dir).some((p) => p.includes('không có file gốc')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  console.log(`self-test: ${failures.length ? 'FAIL' : 'PASS'} (${failures.length} lỗi)`)
  return failures.length ? 1 : 0
}

function main(argv) {
  if (argv.includes('--self-test')) return selfTest()
  const at = argv.indexOf('--assets')
  const assetsDir = at >= 0 ? resolve(argv[at + 1]) : DEFAULT_ASSETS
  if (!existsSync(assetsDir)) {
    console.error(`precompress: không thấy ${assetsDir} — chạy vite build trước`)
    return 1
  }
  const summary = precompressAssets(assetsDir)
  const problems = verifyPrecompressed(assetsDir)
  const kib = (n) => (n / 1024).toFixed(1)
  console.log(`precompress: ${summary.compressed.length} file JS/CSS, ${kib(summary.rawBytes)} KiB → ` +
    `${kib(summary.gzipBytes)} KiB gzip; bỏ qua ${summary.skipped.length}`)
  for (const problem of problems) console.error(`precompress: ${problem}`)
  return problems.length ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)))
}
