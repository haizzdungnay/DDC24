#!/usr/bin/env bash
# Gate #369 chặng (c) — CLI -> Go -> FE trên cùng diagnostic, kèm gate Go/FE.
# Ghi exit code thật từng bước; chạy được từ mọi clone/worktree.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
mkdir -p logs

(
  cd apps/web-api || exit 1
  go vet ./...
) > logs/gate369-govet.log 2>&1
govet=$?
echo "$govet" > logs/gate369-govet.exit

(
  cd apps/web-api || exit 1
  go test ./... -count=1
) > logs/gate369-gotest.log 2>&1
gotest=$?
echo "$gotest" > logs/gate369-gotest.exit

(
  cd apps/web-ui || exit 1
  npx vitest --run --environment jsdom \
    src/features/programming/shared/ProblemsDrawer.test.tsx
) > logs/gate369-fe-diagnostic.log 2>&1
fe_diag=$?
echo "$fe_diag" > logs/gate369-fe-diagnostic.exit

# Đo authority C++ trực tiếp trên CHÍNH source WARNING mà E2E sẽ gửi qua backend.
# WARNING là ca quyết định: lịch sử F-STED-004 từng đè mọi severity thành ERROR,
# nên một fixture ERROR không thể chứng minh biên severity đã được giữ đúng.
bash scripts/gate369-cli-capture.sh > logs/gate369-cli-capture.log 2>&1
cli_diag=$?
echo "$cli_diag" > logs/gate369-cli-capture.exit

# ISS-STED-20 chặng (c): spec đọc JSON CLI vừa chụp, tạo Project với cùng source,
# chạy production Check, so CLI diagnostic với Go API rồi đòi chính diagnostic
# API đó xuất hiện trên ProblemsDrawer. Không có fixture diagnostic thứ hai.
# Trình duyệt đo đi vào log để người ký biết phép đo chạy trên cái gì. Rỗng =
# chromium đi kèm Playwright (mặc định mới, xem playwright.programming-real.config.ts).
echo "MKDDC_E2E_CHROME_CHANNEL=${MKDDC_E2E_CHROME_CHANNEL:-<chromium đi kèm Playwright>}"
echo "MKDDC_E2E_CHROMIUM_PATH=${MKDDC_E2E_CHROMIUM_PATH:-<browser mặc định của Playwright>}"

(
  cd apps/web-ui || exit 1
  GATE369_CLI_DIAGNOSTIC_FILE="$ROOT/logs/gate369-cli-diagnostic.json" \
    GATE369_ST_FIXTURE="$ROOT/scripts/fixtures/gate369-warning.st" \
    npx playwright test \
      --config playwright.programming-real.config.ts \
      e2e/gate369-cli-go-fe-real.spec.ts
) > logs/gate369-real-diagnostic-e2e.log 2>&1
real_diag=$?
echo "$real_diag" > logs/gate369-real-diagnostic-e2e.exit

(
  cd apps/web-ui || exit 1
  npm run lint
) > logs/gate369-fe-lint.log 2>&1
fe_lint=$?
echo "$fe_lint" > logs/gate369-fe-lint.exit

(
  cd apps/web-ui || exit 1
  npm run build
) > logs/gate369-fe-build.log 2>&1
fe_build=$?
echo "$fe_build" > logs/gate369-fe-build.exit

echo "govet=$govet gotest=$gotest fe_diag=$fe_diag cli_diag=$cli_diag real_diag=$real_diag fe_lint=$fe_lint fe_build=$fe_build"

if [ "$govet" -ne 0 ] || [ "$gotest" -ne 0 ] || [ "$fe_diag" -ne 0 ] || \
   [ "$cli_diag" -ne 0 ] || [ "$real_diag" -ne 0 ] || [ "$fe_lint" -ne 0 ] || \
   [ "$fe_build" -ne 0 ]; then
  exit 1
fi
