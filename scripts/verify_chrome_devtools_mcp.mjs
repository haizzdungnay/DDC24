#!/usr/bin/env node
// Cổng kiểm chứng lane BROWSER/DEVTOOLS: `chrome-devtools-mcp` có THỰC SỰ điều
// khiển được một Chrome headful trên host này hay không.
//
// Vì sao cổng này tồn tại: trước bản vá, mọi bảng kiểm chứng ghi
// `Chrome DevTools MCP = NOT_RUN` vì Chrome headful không có X server. Cái đáng
// sợ của `NOT_RUN` là nó không đỏ — nó im. Không ai biết lane đó hỏng cho tới
// lúc cần bằng chứng Console/Network và không có gì để đưa ra. Cổng này biến
// tình trạng ấy thành một lệnh chạy được, exit code khác 0 khi lane không chạy.
//
// Script KHÔNG dùng SDK MCP: nó nói JSON-RPC qua stdio bằng tay, để cổng không
// phụ thuộc thêm gói nào ngoài chính server đang được kiểm.
//
// Biến điều khiển:
//   MKDDC_DEVTOOLS_PROBE_URL   URL để điều hướng (mặc định `about:blank`)
//   MKDDC_DEVTOOLS_EVIDENCE    đường dẫn ghi evidence JSON (tuỳ chọn)

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, '..');
const launcher = resolve(scriptDir, 'chrome-devtools-mcp.sh');
const probeUrl = process.env.MKDDC_DEVTOOLS_PROBE_URL || 'about:blank';
const evidencePath = process.env.MKDDC_DEVTOOLS_EVIDENCE || '';
const callTimeoutMs = Number(process.env.MKDDC_DEVTOOLS_TIMEOUT_MS || 180000);

const child = spawn(launcher, [], {
  cwd: repositoryRoot,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: process.env,
});

let stderr = '';
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});

let buffer = '';
const pending = new Map();
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    const resolver = pending.get(message.id);
    if (resolver) {
      pending.delete(message.id);
      resolver(message);
    }
  }
});

let nextId = 1;
function request(method, params) {
  const id = nextId++;
  const promise = new Promise((res, rej) => {
    pending.set(id, res);
    setTimeout(() => {
      if (pending.delete(id)) rej(new Error(`hết giờ chờ ${method}`));
    }, callTimeoutMs);
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return promise;
}

function notify(method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
}

// callTool trả về text đã gộp; ném lỗi khi server đánh dấu `isError`.
//
// Đây là điểm mấu chốt: "Missing X server to start the headful browser" KHÔNG
// đến dưới dạng JSON-RPC error — nó đến trong một kết quả tool bình thường có
// `isError: true`. Chỉ kiểm `result` tồn tại là đủ để cổng báo xanh trên đúng
// cái hỏng mà nó sinh ra để bắt.
async function callTool(name, args) {
  const response = await request('tools/call', { name, arguments: args });
  const text = (response.result?.content || [])
    .map((item) => item.text || '')
    .join('\n');
  if (response.result?.isError === true) {
    throw new Error(`tool ${name} lỗi: ${text.slice(0, 400)}`);
  }
  if (response.error) {
    throw new Error(`tool ${name} lỗi RPC: ${JSON.stringify(response.error).slice(0, 400)}`);
  }
  return text;
}

const checks = [];
function record(name, detail) {
  checks.push({ name, status: 'PASS', detail });
  process.stdout.write(`PASS  ${name} — ${detail}\n`);
}

let exitCode = 0;
try {
  const init = await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'mkddc-verify-chrome-devtools', version: '1.0.0' },
  });
  const serverInfo = init.result?.serverInfo;
  if (!serverInfo?.name) throw new Error('server không trả serverInfo');
  record('initialize', `${serverInfo.name}@${serverInfo.version}`);
  notify('notifications/initialized', {});

  const tools = await request('tools/list', {});
  const toolNames = (tools.result?.tools || []).map((tool) => tool.name);
  for (const required of ['list_pages', 'navigate_page', 'take_snapshot', 'list_console_messages', 'list_network_requests']) {
    if (!toolNames.includes(required)) throw new Error(`thiếu tool bắt buộc: ${required}`);
  }
  record('tools/list', `${toolNames.length} tool`);

  // Đây là lời gọi ĐẦU TIÊN buộc server phải spawn Chrome thật. Nó là phép đo
  // duy nhất trả lời được câu hỏi "lane devtools có chạy không"; những bước trên
  // chỉ chứng minh tiến trình Node khởi động được.
  const pagesText = await callTool('list_pages', {});
  const match = pagesText.match(/(\d+):/);
  if (!match) throw new Error(`không đọc được pageId từ: ${pagesText.slice(0, 200)}`);
  const pageId = Number(match[1]);
  record('list_pages (Chrome headful khởi động)', pagesText.split('\n').join(' | ').slice(0, 160));

  const navigateText = await callTool('navigate_page', { url: probeUrl, pageId });
  // `navigate_page` KHÔNG đặt `isError` khi điều hướng hỏng: nó trả kết quả
  // bình thường có nội dung "Unable to navigate in the selected page: ...".
  // Bản đầu của cổng này chỉ dựa vào `isError` nên nó báo PASS cho một lần
  // điều hướng thất bại (đo được với `http://127.0.0.1:1/…` → `ERR_UNSAFE_PORT`).
  // Với `about:blank` thì không bao giờ lộ ra, nhưng ngay khi ai đó trỏ
  // `MKDDC_DEVTOOLS_PROBE_URL` vào FE thật — đúng công dụng chính của cổng —
  // nó sẽ xanh trên một trang không tải được. Phải kiểm nội dung.
  if (!navigateText.includes('Successfully navigated')) {
    throw new Error(`navigate_page không tới được ${probeUrl}: ${navigateText.split('\n')[0].slice(0, 200)}`);
  }
  record('navigate_page', `${probeUrl} → ${navigateText.split('\n')[0].slice(0, 120)}`);

  const snapshotText = await callTool('take_snapshot', { pageId });
  record('take_snapshot', `${snapshotText.length} ký tự`);

  const consoleText = await callTool('list_console_messages', { pageId });
  record('list_console_messages', consoleText.split('\n')[0].slice(0, 120) || '(rỗng)');

  const networkText = await callTool('list_network_requests', { pageId });
  record('list_network_requests', networkText.split('\n')[0].slice(0, 120) || '(rỗng)');

  process.stdout.write(`\nKẾT QUẢ: lane Chrome DevTools MCP = PASS (${checks.length} phép kiểm)\n`);
} catch (error) {
  exitCode = 1;
  checks.push({ name: 'lane', status: 'FAIL', detail: error.message });
  process.stdout.write(`\nFAIL  ${error.message}\n`);
  process.stdout.write(`stderr server (200 dòng cuối):\n${stderr.split('\n').slice(-200).join('\n')}\n`);
} finally {
  if (evidencePath) {
    const target = resolve(repositoryRoot, evidencePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      `${JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          display: process.env.DISPLAY || '(do launcher tự dựng)',
          probe_url: probeUrl,
          verdict: exitCode === 0 ? 'PASS' : 'FAIL',
          checks,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    process.stdout.write(`evidence: ${target}\n`);
  }
  child.kill('SIGKILL');
}

process.exit(exitCode);
