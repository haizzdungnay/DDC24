import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

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
  const wsTarget = target.replace(/^http/, 'ws')

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      proxy: {
        '/api': { target, changeOrigin: true, secure: false, ws: true },
        '/ws': { target: wsTarget, ws: true, changeOrigin: true, secure: false }
      }
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
    preview: { host: '0.0.0.0', port: 4173 },
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
