#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
component="all"
profile="full"
wave=""
repeat=1
build_root="${MKDDC_BUILD_ROOT:-$repo_root/build/verify}"

usage() {
  printf '%s\n' \
    'Dùng: scripts/verify-project.sh [--component NAME] [--profile NAME]' \
    '     scripts/verify-project.sh --wave W0..W8 [--repeat N]' \
    '' \
    'Component: layout | cpp | go | frontend | e2e | e2e-real | firmware | release | all' \
    'Profile C++: baseline | modbus | bacnet | modbus-bacnet | full (mặc định)' \
    'Wave: chạy đúng bộ cổng bắt buộc của một Wave Plan 59 và in bảng tổng kết.' \
    '      Cổng cần CI/board/instrument hiện NOT_RUN kèm runbook, không bao giờ PASS.' \
    '' \
    'Script không xóa SHM, dữ liệu người dùng hoặc build tree ngoài build_root.'
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --component) component="${2:?thiếu component}"; shift 2 ;;
    --wave) wave="${2:?thiếu wave}"; shift 2 ;;
    --repeat) repeat="${2:?thiếu số lần lặp}"; shift 2 ;;
    --profile) profile="${2:?thiếu profile}"; shift 2 ;;
    --build-root) build_root="${2:?thiếu build root}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'LỖI: tham số không hỗ trợ: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

active_path() {
  python3 - "$repo_root/tools/restructure/repository-path-map.json" "$1" <<'PY'
import json
import sys

manifest = json.load(open(sys.argv[1], encoding="utf-8"))
owner = sys.argv[2]
entry = next((item for item in manifest["migration"] if item["owner"] == owner), None)
if entry is None:
    raise SystemExit(f"không có owner trong path manifest: {owner}")
key = "to" if manifest["phase"] in {"g3-source-moved", "g4-modularized", "closed"} else "from"
print(entry[key])
PY
}

run_layout() {
  require_contract_python_deps
  # Guard đóng gói chạy TRƯỚC: script này dùng `set -e`, nên bất kỳ kiểm nào hỏng
  # ở trên cũng làm các kiểm phía dưới không bao giờ chạy. Bất biến phát hành
  # (đúng biến thể FE, không băm firmware chưa boot được) rẻ và độc lập với phần
  # còn lại, nên nó phải được chạy chứ không phụ thuộc vào việc gate layout có
  # đang đỏ vì lý do khác hay không.
  python3 -m unittest "$repo_root/tests/integration/test_release_packaging_guard.py"
  python3 "$repo_root/tools/restructure/verify_repository.py"
  python3 -m unittest "$repo_root/tests/integration/test_repository_contract_guard.py"
  python3 -m unittest "$repo_root/tests/integration/test_repository_dependency_guard.py"
  python3 "$repo_root/scripts/generate_programming_profile.py" --check
  python3 "$repo_root/scripts/generate_programming_library_registry.py" --check
  python3 "$repo_root/scripts/generate_programming_library_registry.py" --self-test
  python3 "$repo_root/scripts/generate_programming_errors.py" --check
  python3 -m unittest "$repo_root/tests/integration/test_programming_error_catalog.py"
  python3 "$repo_root/scripts/verify_programming_ipc_actions.py" --self-test
  python3 "$repo_root/scripts/verify_programming_pgm02_contract.py" --self-test
  python3 "$repo_root/scripts/verify_wave_gates.py" --self-test
  python3 "$repo_root/scripts/verify_programming_g1_contracts.py" --self-test
  python3 "$repo_root/scripts/verify_programming_artifact_manifest.py" --self-test
  python3 -m unittest "$repo_root/tests/integration/test_programming_production_tool_gate.py"
}

run_cpp() {
  require_contract_python_deps
  local modbus=OFF bacnet=OFF hmi=OFF
  case "$profile" in
    baseline) ;;
    modbus) modbus=ON ;;
    bacnet) bacnet=ON ;;
    modbus-bacnet) modbus=ON; bacnet=ON ;;
    full) modbus=ON; bacnet=ON; hmi=ON ;;
    *) printf 'LỖI: profile C++ không hỗ trợ: %s\n' "$profile" >&2; exit 2 ;;
  esac
  local cpp_build="$build_root/cpp-$profile"
  cmake --fresh -S "$repo_root" -B "$cpp_build" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_CXX_FLAGS="-Wall -Wextra -Werror" \
    -DMKDDC_ENABLE_MODBUS="$modbus" \
    -DMKDDC_ENABLE_BACNET="$bacnet" \
    -DMKDDC_ENABLE_HMI="$hmi"
  cmake --build "$cpp_build" --parallel "${MKDDC_BUILD_JOBS:-4}"
  ctest --test-dir "$cpp_build" --output-on-failure \
    --parallel "${MKDDC_TEST_JOBS:-4}"
}

run_go() {
  local go_dir
  go_dir="$(active_path web-api)"
	local compiler_binary="$build_root/cpp-full/core/mkddc-st-compile"
	local packager_binary="$build_root/cpp-full/core/mkddc-st-package"
	# Sim worker cũng là production tool của cổng Go: `client_test.go` spawn ĐÚNG
	# binary này để kiểm hợp đồng liên tiến trình (bắt tay, khung lệnh, thu hồi).
	# Nó KHÔNG công bố `profile_sha256` trong `--version` — nó không đọc product
	# profile — nên nó được canh riêng bằng phép kiểm executable, không đi qua
	# vòng so profile phía dưới.
	local sim_worker_binary="$build_root/cpp-full/core/mkddc-programming-sim-worker"
	local expected_profile_sha
	expected_profile_sha="$(sha256sum "$repo_root/contracts/programming/product_profile_v2.json" | awk '{print $1}')"
	for production_tool in "$compiler_binary" "$packager_binary"; do
		if [ ! -x "$production_tool" ]; then
			printf 'LỖI: thiếu production tool từ chính build của cổng cpp: %s\n' "$production_tool" >&2
			printf '      chạy --component cpp --profile full với cùng MKDDC_BUILD_ROOT trước cổng go\n' >&2
			return 1
		fi
		local production_version
		production_version="$("$production_tool" --version)"
		if [[ "$production_version" != *"profile_sha256=$expected_profile_sha"* ]]; then
			printf 'LỖI: production tool stale/không chứng minh được profile hiện hành: %s\n' "$production_tool" >&2
			printf '      cần profile_sha256=%s; nhận: %s\n' "$expected_profile_sha" "$production_version" >&2
			return 1
		fi
		sha256sum "$production_tool"
		printf '%s\n' "$production_version"
	done
	if [ ! -x "$sim_worker_binary" ]; then
		printf 'LỖI: thiếu production tool từ chính build của cổng cpp: %s\n' "$sim_worker_binary" >&2
		printf '      chạy --component cpp --profile full với cùng MKDDC_BUILD_ROOT trước cổng go\n' >&2
		return 1
	fi
	sha256sum "$sim_worker_binary"
	printf '%s\n' "$("$sim_worker_binary" --version)"
	export MKDDC_REQUIRE_PRODUCTION_TOOLS=1
	export MKDDC_ST_COMPILER_BINARY="$compiler_binary"
	export MKDDC_ST_PACKAGER_BINARY="$packager_binary"
	# Truyền tường minh, đúng như hai tool trên: không truyền thì test tự dò
	# `build/fw` rồi `build/verify/cpp-full` bằng đường dẫn CỨNG, tức nó bỏ qua
	# MKDDC_BUILD_ROOT — và với `MKDDC_REQUIRE_PRODUCTION_TOOLS=1` thì "không tìm
	# thấy" là FAIL chứ không phải SKIP. Đó đúng là cách cổng Go đỏ trên CI.
	export MKDDC_SIM_WORKER_BINARY="$sim_worker_binary"
  if [ "$profile" = "race" ]; then
    (cd "$repo_root/$go_dir" && go vet ./... && go test -race ./... -count=1)
  else
    (cd "$repo_root/$go_dir" && go vet ./... && go test ./... -count=1)
  fi
}

run_frontend() {
  require_contract_python_deps
  local frontend_dir
  frontend_dir="$(active_path web-ui)"
  (cd "$repo_root/$frontend_dir" && \
    npx vitest --run --environment jsdom src && \
    npm run lint && npm run build)
}

# Bộ e2e được canh. Mở rộng ngày 2026-08-20: trước đó CHỈ `network-qa.spec.ts`
# (1 test) chạy trong CI, còn 9 bộ kia — khoảng 59 test — chưa cổng nào đụng tới
# và đang mục dần đúng theo kịch bản `F-07` mà chính comment trong workflow cảnh
# báo.
#
# CÁCH LY (T59-604): `point-names.spec.ts` từng nằm ngoài vì 14 test trong đó hỏng
# sẵn, độc lập với thay đổi FE. Chạy lại 2026-08-21: **18/18 PASS** — nguyên nhân
# đã được sửa ở đâu đó trong W5 nhưng cách ly thì không ai gỡ.
#
# Đó là dạng mục ruỗng thứ hai của cổng: cách ly cũ không chỉ giấu một spec đang
# hỏng, nó còn giấu một spec đã LÀNH khỏi cổng — mọi hồi quy sau đó trong file ấy
# lại không ai bắt. Nay danh sách cách ly rỗng, và `run_e2e` tự kiểm: spec còn
# trong cách ly mà PASS thì cổng ĐỎ kèm yêu cầu gỡ, để lần sau không mục lại.
MKDDC_E2E_QUARANTINE=""
# Spec của LANE KHÁC — KHÔNG phải cách ly. Chúng có config Playwright riêng và
# đăng nhập vào backend THẬT, nên chạy lẫn với bộ mock sẽ vừa lặp test vừa làm
# sai failure boundary của hai gate.
#
# `programming-real.spec.ts` có cổng riêng `e2e-real`.
# `programming-target-fault.spec.ts` thuộc lane target
# (`playwright.programming-target.config.ts`) và chỉ chạy trong cửa sổ fault
# injection có kiểm soát trên bo thật; ở lane mock nó chỉ tồn tại để bị `skip`.
#
# Trước bản vá, chỉ spec real-backend được loại. Spec target vì thế vừa bị lane
# mock chạy (rồi skip), vừa bị cổng "một helper đăng nhập" bắt lỗi vì nó có
# `loginIfNeeded` riêng — mà nó BUỘC phải có, do nó đăng nhập vào backend thật
# chứ không phải lane mock. Cổng đó chưa từng chạy trên CI (job FE luôn chết
# trước ở bước khác), nên vi phạm này ngồi im trong repo.
MKDDC_E2E_REAL_SPEC="e2e/programming-real.spec.ts"
MKDDC_E2E_OTHER_LANE_SPECS=(
  "e2e/programming-real.spec.ts"
  "e2e/programming-target-fault.spec.ts"
)

# spec_owned_by_other_lane trả 0 khi spec thuộc lane khác.
spec_owned_by_other_lane() {
  local candidate="$1" owned
  for owned in "${MKDDC_E2E_OTHER_LANE_SPECS[@]}"; do
    [ "$candidate" = "$owned" ] && return 0
  done
  return 1
}

run_e2e() {
  require_contract_python_deps
  local frontend_dir specs=()
  frontend_dir="$(active_path web-ui)"
  # Liệt kê động: một spec mới thêm vào thư mục sẽ tự vào cổng, không phải nhớ
  # sửa script. Đó là cách duy nhất để danh sách này không lại tụt hậu.
  while IFS= read -r spec; do
    [ -n "$MKDDC_E2E_QUARANTINE" ] && [ "$spec" = "$MKDDC_E2E_QUARANTINE" ] && continue
    spec_owned_by_other_lane "$spec" && continue
    specs+=("$spec")
  done < <(cd "$repo_root/$frontend_dir" && find e2e -maxdepth 1 -name '*.spec.ts' | sort)
  if [ "${#specs[@]}" -eq 0 ]; then
    printf 'LỖI: không tìm thấy spec e2e nào — kiểm tra lại đường dẫn\n' >&2
    exit 2
  fi
  # T59-604 — CHỈ MỘT helper đăng nhập. Trước đây helper này được chép tay ở
  # bảy spec; bản vá "chờ điều kiện thay vì đua với dev server" chỉ áp được cho
  # một bản, nên sáu bản còn lại giữ nguyên cuộc đua và cổng vẫn đỏ ngắt quãng ở
  # chỗ khác. Một bản vá nằm ở một trong bảy bản sao không phải bản vá.
  #
  # Spec real-backend nằm NGOÀI phép kiểm này một cách có chủ ý: nó đăng nhập vào
  # backend Go thật bằng JWT thật, còn `helpers/session.ts` là đường đăng nhập của
  # lane mock. Ép chung một helper sẽ buộc helper phải biết cả hai chế độ xác
  # thực — đúng kiểu trừu tượng hoá làm hỏng ranh giới lỗi của hai gate.
  local dup all_login
  all_login="$(cd "$repo_root/$frontend_dir" && grep -rln 'async function login' e2e --include='*.spec.ts' || true)"
  dup=""
  while IFS= read -r spec; do
    [ -z "$spec" ] && continue
    spec_owned_by_other_lane "$spec" && continue
    dup="${dup}${spec}"$'\n'
  done <<< "$all_login"
  dup="$(printf '%s' "$dup")"
  if [ -n "$dup" ]; then
    printf 'LỖI: spec định nghĩa lại helper đăng nhập thay vì dùng e2e/helpers/session.ts:\n%s\n' \
      "$dup" >&2
    exit 1
  fi

  printf 'e2e: chạy %d spec (cách ly: %s; gate riêng: %s)\n' \
    "${#specs[@]}" "${MKDDC_E2E_QUARANTINE:-<rỗng>}" "$MKDDC_E2E_REAL_SPEC"
  (cd "$repo_root/$frontend_dir" && npx playwright test "${specs[@]}")
  # Cách ly phải TỰ HẾT HẠN: spec đang bị cách ly mà chạy PASS nghĩa là lý do
  # cách ly đã hết, và giữ nó ngoài cổng từ đó trở đi chỉ giấu hồi quy tương lai.
  if [ -n "$MKDDC_E2E_QUARANTINE" ]; then
    if (cd "$repo_root/$frontend_dir" && npx playwright test "$MKDDC_E2E_QUARANTINE" >/dev/null 2>&1); then
      printf 'LỖI: spec cách ly %s nay PASS — gỡ khỏi MKDDC_E2E_QUARANTINE\n' \
        "$MKDDC_E2E_QUARANTINE" >&2
      exit 1
    fi
    printf 'e2e: spec cách ly %s vẫn đỏ (đúng như ghi nhận)\n' "$MKDDC_E2E_QUARANTINE"
  fi
}

run_e2e_real() {
  require_contract_python_deps
  local frontend_dir
  frontend_dir="$(active_path web-ui)"
  (cd "$repo_root/$frontend_dir" && npm run test:e2e:programming-real)
}

run_firmware() {
  make -C "$repo_root/$(active_path stm32)"
}

run_release() {
  "$repo_root/$(active_path packaging)/build-release.sh"
  (cd "$repo_root" && sha256sum --check build/release/checksums.sha256)
  # T59-606: diễn tập CÀI MỚI → NÂNG CẤP → ROLLBACK trên chính gói vừa dựng.
  # Đặt ở đây chứ không ở `layout` vì nó cần build/release có thật; đặt ở
  # `layout` sẽ thành một test tự SKIP mãi mãi — tức một cổng chỉ trông như cổng.
  python3 -m unittest "$repo_root/tests/integration/test_release_dryrun.py"
}

# `--wave` là đường đi MỘT LỆNH cho cả ma trận cổng. Nó cố ý KHÔNG dùng `set -e`
# của script này: runner chạy hết mọi cổng rồi mới kết luận, vì dừng ở cổng hỏng
# đầu tiên chính là lý do lỗi phía sau nằm im rất lâu.
# Tiền kiểm phụ thuộc Python của các cổng hợp đồng.
#
# Gọi ở ĐẦU từng component thật sự chạy script hợp đồng (`layout`, `cpp`,
# `frontend`, `e2e`, `e2e-real`, `--wave`), KHÔNG gọi vô điều kiện: `firmware`
# và `release` không đụng tới `jsonschema`, bắt chúng cài gói là dựng một phụ
# thuộc giả — và đúng như vậy đã làm job "MCU Firmware" đỏ ở `476723a`.
#
# Vì sao đứng ở đây: chín script sinh/kiểm hợp đồng `import jsonschema` và cần
# `Draft202012Validator` (jsonschema >= 4). Ubuntu 22.04 đóng sẵn jsonschema
# 3.2, nên trên runner CI các script đó chết bằng `ImportError` THÔ. Trong
# `ctest` cái chết đó hiện ra là "st_language_profile_contract Failed" — đọc y
# hệt một vi phạm hợp đồng ngôn ngữ, trong khi thứ thiếu chỉ là một gói pip.
# Một cổng nói sai lý do hỏng còn tốn thời gian hơn một cổng không chạy.
require_contract_python_deps() {
  python3 - <<'DEPCHECK' || exit 1
import sys

try:
    from jsonschema import Draft202012Validator  # noqa: F401
except Exception as exc:  # ImportError, và cả jsonschema quá cũ
    sys.stderr.write(
        "LỖI: thiếu phụ thuộc Python cho cổng hợp đồng: %s\n"
        "     cài bằng: python3 -m pip install -r requirements-ci.txt\n"
        "     (cần jsonschema >= 4.17 — bản 3.2 đóng sẵn trên Ubuntu 22.04 KHÔNG có\n"
        "      Draft202012Validator, và đây KHÔNG phải lỗi hợp đồng)\n" % exc)
    raise SystemExit(1)
DEPCHECK
}

if [ -n "$wave" ]; then
  require_contract_python_deps
  exec python3 "$repo_root/scripts/verify_wave_gates.py" --wave "$wave" --repeat "$repeat"
fi

case "$component" in
  layout) run_layout ;;
  cpp) run_cpp ;;
  go) run_go ;;
  frontend) run_frontend ;;
  e2e) run_e2e ;;
  e2e-real) run_e2e_real ;;
  firmware) run_firmware ;;
  release) run_release ;;
  all)
    run_layout
    run_cpp
    run_go
    run_frontend
    run_e2e
    run_e2e_real
    run_firmware
    ;;
  *) printf 'LỖI: component không hỗ trợ: %s\n' "$component" >&2; exit 2 ;;
esac
