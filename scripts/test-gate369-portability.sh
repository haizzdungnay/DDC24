#!/usr/bin/env bash
# Regression guard for ISS-STED-20 gate helpers.
# A release gate must run from any clone/worktree, not only the original WSL path.
set -eu

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

scripts=(
  scripts/gate369-stage-a.sh
  scripts/gate369-stage-b.sh
  scripts/gate369-stage-c.sh
  scripts/gate369-rerun-ctest.sh
  scripts/gate369-cli-capture.sh
)

for script in "${scripts[@]}"; do
  bash -n "$script"
  if grep -Fq '/mnt/e/TuanDuong/INTERN/DDC24_project/MK-DDC-24' "$script"; then
    echo "ERROR: $script still contains the original machine-specific repository path" >&2
    exit 1
  fi
done

# Stage (c) must prove CLI -> Go -> FE on ONE source/diagnostic. Separate green
# CLI, Go and FE tests are insufficient because the transformation boundary is
# exactly where F-STED-003/F-STED-004 previously lost information.
grep -Fq 'ProblemsDrawer.test.tsx' scripts/gate369-stage-c.sh
grep -Fq 'gate369-cli-capture.sh' scripts/gate369-stage-c.sh
grep -Fq 'GATE369_CLI_DIAGNOSTIC_FILE' scripts/gate369-stage-c.sh
grep -Fq 'GATE369_ST_FIXTURE' scripts/gate369-stage-c.sh
grep -Fq 'gate369-warning.st' scripts/gate369-stage-c.sh
grep -Fq 'gate369-cli-go-fe-real.spec.ts' scripts/gate369-stage-c.sh
grep -Fq 'playwright.programming-real.config.ts' scripts/gate369-stage-c.sh
grep -Fq 'gate369-cli-capture.exit' scripts/gate369-stage-c.sh
grep -Fq 'gate369-real-diagnostic-e2e.exit' scripts/gate369-stage-c.sh
grep -Fq 'npm run lint' scripts/gate369-stage-c.sh
grep -Fq 'npm run build' scripts/gate369-stage-c.sh

test -f scripts/fixtures/gate369-warning.st
test -f apps/web-ui/e2e/gate369-cli-go-fe-real.spec.ts
grep -Fq "toBe('WARNING')" apps/web-ui/e2e/gate369-cli-go-fe-real.spec.ts
grep -Fq "expect(checked.state).toBe('PASSED')" apps/web-ui/e2e/gate369-cli-go-fe-real.spec.ts
grep -Fq 'api.detailCode).toBe(cliDiagnostic.code)' apps/web-ui/e2e/gate369-cli-go-fe-real.spec.ts
grep -Fq 'api.message).toBe(cliDiagnostic.message)' apps/web-ui/e2e/gate369-cli-go-fe-real.spec.ts
grep -Fq 'api.severity).toLowerCase()).toBe(String(cliDiagnostic.severity).toLowerCase())' apps/web-ui/e2e/gate369-cli-go-fe-real.spec.ts
grep -Fq 'location.line).toBe(cliDiagnostic.line)' apps/web-ui/e2e/gate369-cli-go-fe-real.spec.ts
grep -Fq 'location.column).toBe(cliDiagnostic.column)' apps/web-ui/e2e/gate369-cli-go-fe-real.spec.ts
grep -Fq 'location.length).toBe(cliDiagnostic.length)' apps/web-ui/e2e/gate369-cli-go-fe-real.spec.ts
grep -Fq 'toContainText(uiSeverityLabel(api.severity))' apps/web-ui/e2e/gate369-cli-go-fe-real.spec.ts

# A named file passed to `playwright test` is still intersected with config
# `testMatch`. Keep Gate369 explicitly discoverable or stage-c can fail with
# "No tests found" without exercising the CLI -> Go -> FE path at all.
grep -Fq 'gate369-cli-go-fe-real' apps/web-ui/playwright.programming-real.config.ts
grep -Fq 'programming-real' apps/web-ui/playwright.programming-real.config.ts

# Regression for P1 review on PR #521: valid WARNING JSON must never mask a
# non-zero mkddc-st-validate exit. Use an injected fake binary so this guard is
# runnable without a C++ build and verifies behavior rather than source text.
tmpdir="$(mktemp -d)"
cleanup() { rm -rf "$tmpdir"; }
trap cleanup EXIT

cat > "$tmpdir/mkddc-st-validate" <<'SH'
#!/usr/bin/env bash
cat <<'JSON'
{"diagnostics":[{"code":"ST-WARN-002","message":"mock warning","severity":"WARNING","line":1,"column":1,"length":1}]}
JSON
exit 42
SH
chmod +x "$tmpdir/mkddc-st-validate"

set +e
GATE369_ST_VALIDATE_BIN="$tmpdir/mkddc-st-validate" bash scripts/gate369-cli-capture.sh >/dev/null 2>&1
capture_status=$?
set -e
if (( capture_status != 42 )); then
  echo "ERROR: gate369 CLI capture masked compiler exit 42 as $capture_status" >&2
  exit 1
fi

# The opposite failure mode must also stay closed: a successful CLI with invalid
# diagnostic JSON cannot make the gate green.
cat > "$tmpdir/mkddc-st-validate" <<'SH'
#!/usr/bin/env bash
printf '%s\n' '{"diagnostics":[]}'
exit 0
SH
chmod +x "$tmpdir/mkddc-st-validate"

set +e
GATE369_ST_VALIDATE_BIN="$tmpdir/mkddc-st-validate" bash scripts/gate369-cli-capture.sh >/dev/null 2>&1
validation_capture_status=$?
set -e
if (( validation_capture_status == 0 )); then
  echo "ERROR: gate369 CLI capture accepted invalid/empty diagnostic JSON" >&2
  exit 1
fi

echo 'gate369 portability/CLI-Go-FE WARNING same-diagnostic guard: PASS'
