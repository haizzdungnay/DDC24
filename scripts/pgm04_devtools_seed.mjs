#!/usr/bin/env node
/**
 * `T61-505` / `ISS-PGM04-18` — gieo dữ liệu cho lane audit, qua **API thật**.
 *
 * Mọi trạng thái mà audit chụp phải là trạng thái CÓ THẬT trong store: một
 * Project có khối, một Project rỗng, và một tài khoản `viewer` thật. Dựng chúng
 * bằng `page.route` sẽ biến lane BROWSER thành một lane mock thứ hai — đúng thứ
 * `ISS-PGM04-18` từ chối.
 *
 * Tài khoản viewer dùng mật khẩu SINH NGẪU NHIÊN mỗi lần chạy và chỉ sống trong
 * store tạm của stack (`run_programming_real_e2e_stack.sh` chép `users.conf` vào
 * thư mục runtime). Mật khẩu đi qua stdout cho tiến trình cha, KHÔNG ghi vào
 * bằng chứng.
 */
import { randomUUID, randomBytes } from 'node:crypto'

const PORT = process.env.PGM04_SEED_PORT ?? '4183'
const BASE = `http://127.0.0.1:${PORT}`

async function call(path, options = {}, expected = 200) {
  const response = await fetch(`${BASE}${path}`, options)
  const text = await response.text()
  if (response.status !== expected) {
    throw new Error(`${options.method ?? 'GET'} ${path} -> ${response.status}: ${text}`)
  }
  return text ? JSON.parse(text) : {}
}

function mutationHeaders(token, extra = {}) {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'x-correlation-id': randomUUID(),
    'x-idempotency-key': randomUUID(),
    ...extra,
  }
}

const login = await call('/api/v1/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'admin123' }),
})
const token = login.token

async function createProject(name) {
  return call('/api/v1/programming/projects', {
    method: 'POST', headers: mutationHeaders(token),
    body: JSON.stringify({ schemaVersion: '1.0', name, description: 'PGM-04 DevTools audit' }),
  }, 201)
}

/* MỘT Project, không phải hai.
   `capabilities.limits.projectsPerController = 1`, nên lần tạo thứ hai trả 409.
   Trạng thái "thư viện rỗng" vì thế được chụp TRƯỚC khi có khối nào — thứ tự
   thời gian thay cho hai Project song song. */
const project = await createProject('AHU T61-505 audit')

/* Tài khoản viewer THẬT cho ca "permission". Mật khẩu ngẫu nhiên mỗi lần chạy;
   store là bản sao trong thư mục runtime của stack nên nó biến mất cùng stack. */
const viewer = `viewer-audit-${randomBytes(3).toString('hex')}`
const viewerPassword = `Aa1!${randomBytes(9).toString('base64url')}`
await call('/api/v1/users', {
  method: 'POST', headers: mutationHeaders(token),
  body: JSON.stringify({ username: viewer, password: viewerPassword, role: 'viewer' }),
}, 201)

process.stdout.write(JSON.stringify({
  projectId: project.resource.projectId,
  viewer, viewerPassword,
}))
