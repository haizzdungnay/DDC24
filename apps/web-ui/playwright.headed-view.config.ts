import { defineConfig } from '@playwright/test'
import base from './playwright.config'

export default defineConfig({
  ...base,
  webServer: undefined,
  timeout: 30_000,
  workers: 1,
  reporter: 'list',
  use: {
    ...base.use,
    actionTimeout: 10_000,
    navigationTimeout: 10_000,
    baseURL: 'http://127.0.0.1:4174',
    headless: true,
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: {
        ...base.projects?.[0]?.use,
        channel: undefined,
        headless: true,
      },
    },
  ],
})
