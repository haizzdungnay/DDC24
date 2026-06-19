import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(() => {
  const env = loadEnv('', '.', '')
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
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            charts: ['recharts'],
            icons: ['lucide-react']
          }
        }
      }
    },
    preview: { host: '0.0.0.0', port: 4173 }
  }
})
