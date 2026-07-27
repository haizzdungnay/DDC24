import { defineConfig, devices } from '@playwright/test'

const webOrigin = process.env.RBAC_E2E_WEB_ORIGIN ?? 'http://127.0.0.1:4174'
const apiOrigin = process.env.RBAC_E2E_API_ORIGIN ?? 'http://127.0.0.1:4175'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'rbac-live.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  outputDir: './node_modules/.cache/playwright-rbac-results',
  use: {
    baseURL: webOrigin,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off'
  },
  projects: [{ name: 'rbac-chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'go test -count=1 -run ^TestRBACE2EServer$ -timeout 10m .',
      cwd: '../../web/backend',
      url: `${apiOrigin}/__rbac_e2e/ready`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        RBAC_E2E_SERVER: '1',
        RBAC_E2E_ADDR: new URL(apiOrigin).host,
        RBAC_E2E_CORS_ORIGIN: webOrigin
      }
    },
    {
      command: 'npm run dev -- --port 4174 --strictPort',
      url: `${webOrigin}/login`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        VITE_DDC_MODE: 'live',
        VITE_AUTH_MODE: 'jwt',
        VITE_API_ORIGIN: apiOrigin,
        VITE_WS_ORIGIN: apiOrigin,
        VITE_HISTORIAN_V2_TRENDS: '1'
      }
    }
  ]
})
