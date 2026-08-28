import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

export function developmentProxy(target: string) {
  return {
    // Phải đứng trước `/api`: socket thật là `/api/v1/ws/monitor`, không phải
    // `/ws`. Nếu rơi vào rule tổng quát thì Origin không được rewrite và
    // mkddc-web từ chối đúng theo same-origin bằng 403.
    '^/api/v1/ws(?:/|$)': {
      target: target.replace(/^http/, 'ws'),
      ws: true,
      changeOrigin: true,
      // Chỉ rewrite ở proxy dev này; production tiếp tục do mkddc-web phục vụ
      // same-origin. Không bật CORS loopback hoặc nới allowlist backend.
      rewriteWsOrigin: true,
      secure: false
    },
    '/api': { target, changeOrigin: true, secure: false, ws: true }
  } as const
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  if (mode === 'production' && (env.VITE_API_ORIGIN || env.VITE_WS_ORIGIN)) {
    throw new Error('Production FE must use same-origin API/WebSocket paths; remove VITE_API_ORIGIN and VITE_WS_ORIGIN')
  }
  // 8081 phải khớp mặc định `PORT` của mkddc-web (`apps/web-api/internal/app/config.go`).
  // Hai giá trị này từng lệch nhau (proxy 8081 / backend 8080), nên `go run` local
  // mà không set PORT làm mọi endpoint trả 502 và người chạy tưởng frontend hỏng —
  // xem `docs/07_records/reviews/FE_PAGES_ERROR_REVIEW_2026-08-05.md` §6.
  const target = env.VITE_PROXY_TARGET || 'http://127.0.0.1:8081'

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      proxy: developmentProxy(target),
      // Dev server phục vụ E2E KHÔNG cần theo dõi file: Playwright không sửa
      // nguồn giữa lúc chạy, nên watcher chỉ đem lại hai thứ — hàng chục nghìn
      // inotify watch, và nguy cơ Vite rebuild giữa một assertion. Tắt hẳn cho
      // đường E2E; đường dev thường giữ nguyên HMR.
      watch: env.VITE_E2E_NO_WATCH === '1' ? null : undefined
    },
    build: {
      outDir: '../../build/web-ui/dist',
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router-dom')) {
              return 'react'
            }
            if (id.includes('node_modules/recharts')) {
              return 'charts'
            }
            if (id.includes('node_modules/lucide-react')) {
              return 'icons'
            }
          }
        }
      }
    },
    // E2E phục vụ bằng `vite preview` (bản đã build) chứ không phải dev server:
    // dev server biên dịch route theo yêu cầu ở lần chạm đầu, và khoản biên dịch
    // đó nằm trong ngân sách thời gian của test — nguồn gốc thật của chuỗi đỏ
    // ngắt quãng T59-604. Preview phải proxy y hệt dev, nếu không cùng một spec
    // lại gặp hai hành vi mạng khác nhau tuỳ đường phục vụ.
    preview: { host: '0.0.0.0', port: 4173, proxy: developmentProxy(target) },
    // F-23: môi trường test phải đi theo PROJECT, không theo lệnh gọi.
    //
    // Trước đây `environment: 'jsdom'` chỉ tồn tại dưới dạng cờ dòng lệnh trong
    // script `test` của package.json. Bất kỳ đường chạy nào không đi qua đúng
    // script đó — `npx vitest run`, test runner của IDE, `vitest --watch` gọi trực
    // tiếp, hay một bước CI viết tay — đều chạy trong môi trường `node` và fail
    // 93/133 với `ReferenceError: localStorage is not defined`, trông y như một
    // suite đang đỏ.
    test: {
      environment: 'jsdom',
      include: ['src/**/*.{test,spec}.{ts,tsx}']
    }
  }
})
