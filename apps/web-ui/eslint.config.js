import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  },
  {
    /* Cổng lint cho `e2e/**` (Issue #664).
     *
     * `e2e/` là vùng mã DUY NHẤT của web-ui trước đây không cổng tĩnh nào
     * canh: script `lint` chỉ quét `src`. Khối này đưa nó vào diện kiểm.
     *
     * Globals là hợp của `node` và `browser`, vì một file spec Playwright sống
     * ở cả hai phía: thân test chạy trên Node (`process`, `fs`), còn phần thân
     * truyền vào `page.evaluate()` chạy trong trình duyệt (`document`,
     * `window`). Chỉ khai một phía thì phía kia thành `no-undef` giả. */
    files: ['e2e/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  },
  {
    files: ['src/features/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: [
            '../auth/**',
            '../dashboard/**',
            '../modbus-rtu/**',
            '../network/**',
            '../operations/**',
            '../points/**',
            '../../features/*/**'
          ],
          message: 'Feature chỉ được dùng public API của feature khác; dùng ../<feature> thay vì deep import.'
        }]
      }]
    }
  },
  {
    files: ['src/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['../../features/*/**'],
          message: 'Shared không được deep import feature; chỉ dùng public API đã duyệt.'
        }]
      }]
    }
  }
]
