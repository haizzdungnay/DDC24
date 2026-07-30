#!/usr/bin/env bash
# Test hermetic cho packaging/rotate-web-jwt-secret.sh — không cần root, không
# chạm hệ thống thật.
#
# Chốt hai finding của review 2026-07-30:
#   F-19 — secret không bao giờ đi qua file trung gian ở /tmp, và env file luôn
#          mang quyền 0600 kể cả khi người chạy có umask 022.
#   F-20 — rollback được gắn TRƯỚC thay đổi đầu tiên (qua trap) và phục hồi CẢ
#          unit LẪN env file.
#
# Cách làm: copy script thật, chỉ đổi hai đường dẫn `unit=`/`envfile=` sang thư
# mục tạm, rồi chèn stub `sudo`/`systemctl`/`systemd-analyze`/`curl` vào PATH.
# Toàn bộ luồng điều khiển và thứ tự lệnh giữ nguyên như bản production.
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$REPO/packaging/rotate-web-jwt-secret.sh"
[ -f "$SCRIPT" ] || { echo "không tìm thấy $SCRIPT"; exit 1; }

pass=0
fail=0

check() { # check <mô tả> <giá trị thực> <giá trị mong đợi>
  if [ "$2" = "$3" ]; then
    printf '  OK   %s\n' "$1"
    pass=$((pass + 1))
  else
    printf '  FAIL %s\n       thực tế=%s\n       mong đợi=%s\n' "$1" "$2" "$3"
    fail=$((fail + 1))
  fi
}

# $1 = thư mục làm việc, $2 = "verify_fail"|"never_ready"|"ok",
# $3 = "with_env"|"no_env"
setup_case() {
  local work="$1" verify_mode="$2" env_mode="$3"
  mkdir -p "$work/bin" "$work/etc"

  cat > "$work/etc/mkddc-web-pi.service" <<'UNIT'
[Unit]
Description=mkddc web
[Service]
WorkingDirectory=/opt/mkddc
Environment=JWT_SECRET=secret-cu-trong-unit
ExecStart=/usr/local/bin/mkddc-web
[Install]
WantedBy=multi-user.target
UNIT

  if [ "$env_mode" = with_env ]; then
    printf 'JWT_SECRET=secret-cu-trong-envfile\n' > "$work/etc/mkddc-web.env"
    chmod 0600 "$work/etc/mkddc-web.env"
  fi

  # sudo giả: chạy thẳng lệnh, không leo quyền.
  #
  # Riêng install(1): bỏ cặp `-o root`/`-g root` vì test không chạy dưới root
  # (production chạy sudo thật nên chown thành công). `-m 0600` GIỮ NGUYÊN — đó
  # chính là điều F-19 cần chốt, và install thật vẫn được thực thi.
  cat > "$work/bin/sudo" <<'SUDO'
#!/bin/sh
if [ "$1" = install ]; then
  shift
  kept=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -o|-g) shift 2 ;;
      *) kept="$kept
$1"; shift ;;
    esac
  done
  OLDIFS=$IFS
  IFS='
'
  # shellcheck disable=SC2086
  set -- $kept
  IFS=$OLDIFS
  exec install "$@"
fi
exec "$@"
SUDO

  cat > "$work/bin/systemctl" <<'SYSCTL'
#!/bin/sh
case "$1 $2" in
  "is-active --quiet") exit "${MKDDC_TEST_ACTIVE_RC:-0}" ;;
esac
case "$1" in
  is-active) echo active ;;
esac
exit 0
SYSCTL

  if [ "$verify_mode" = verify_fail ]; then
    printf '#!/bin/sh\necho "unit khong hop le" >&2\nexit 1\n' > "$work/bin/systemd-analyze"
  else
    printf '#!/bin/sh\nexit 0\n' > "$work/bin/systemd-analyze"
  fi

  if [ "$verify_mode" = never_ready ]; then
    printf '#!/bin/sh\nexit 22\n' > "$work/bin/curl"
  else
    printf '#!/bin/sh\nexit 0\n' > "$work/bin/curl"
  fi

  chmod +x "$work/bin"/*

  # Chỉ đổi hai đường dẫn; mọi thứ khác giữ nguyên bản production.
  sed -e "s#^unit=.*#unit=$work/etc/mkddc-web-pi.service#" \
      -e "s#^envfile=.*#envfile=$work/etc/mkddc-web.env#" \
      "$SCRIPT" > "$work/rotate.sh"
  chmod +x "$work/rotate.sh"
}

run_case() { # run_case <work> -> in ra rc
  local work="$1"
  ( umask 022; PATH="$work/bin:$PATH" sh "$work/rotate.sh" >"$work/out.log" 2>&1 )
  echo $?
}

echo "== Case 1: happy path =="
W1="$(mktemp -d)"; trap 'rm -rf "$W1"' EXIT
setup_case "$W1" ok with_env
rc1="$(run_case "$W1")"
check "script thoát 0" "$rc1" "0"
check "env file quyền 0600 dù umask 022 (F-19)" \
  "$(stat -c '%a' "$W1/etc/mkddc-web.env")" "600"
check "secret đã được thay" \
  "$(grep -c 'secret-cu-trong-envfile' "$W1/etc/mkddc-web.env")" "0"
check "env file đúng định dạng JWT_SECRET=<hex>" \
  "$(grep -cE '^JWT_SECRET=[0-9a-f]{64}$' "$W1/etc/mkddc-web.env")" "1"
check "unit đã bỏ Environment=JWT_SECRET" \
  "$(grep -c '^Environment=JWT_SECRET=' "$W1/etc/mkddc-web-pi.service")" "0"
check "unit đã thêm EnvironmentFile" \
  "$(grep -c '^EnvironmentFile=-/etc/mkddc-web.env$' "$W1/etc/mkddc-web-pi.service")" "1"
check "KHÔNG rollback khi thành công" \
  "$(grep -c ROLLBACK "$W1/out.log")" "0"
check "không để lại file trung gian /tmp/mkddc-web.env (F-19)" \
  "$([ -e /tmp/mkddc-web.env ] && echo yes || echo no)" "no"

echo "== Case 2: systemd-analyze verify FAIL — thất bại TRƯỚC restart =="
# Đây chính là khoảng mà bản cũ không có rollback nào: unit đã bị sed sửa và
# secret mới đã được cài, rồi `set -e` làm script thoát.
W2="$(mktemp -d)"; trap 'rm -rf "$W1" "$W2"' EXIT
setup_case "$W2" verify_fail with_env
rc2="$(run_case "$W2")"
check "script thoát khác 0" "$([ "$rc2" != 0 ] && echo yes || echo no)" "yes"
check "rollback ĐÃ chạy (F-20 vấn đề 1)" \
  "$(grep -c ROLLBACK "$W2/out.log")" "1"
check "env file đã phục hồi secret CŨ (F-20 vấn đề 2)" \
  "$(grep -c '^JWT_SECRET=secret-cu-trong-envfile$' "$W2/etc/mkddc-web.env")" "1"
check "unit đã phục hồi Environment=JWT_SECRET cũ" \
  "$(grep -c '^Environment=JWT_SECRET=secret-cu-trong-unit$' "$W2/etc/mkddc-web-pi.service")" "1"

echo "== Case 3: service không bao giờ ready =="
W3="$(mktemp -d)"; trap 'rm -rf "$W1" "$W2" "$W3"' EXIT
setup_case "$W3" never_ready with_env
rc3="$(run_case "$W3")"
check "script thoát khác 0" "$([ "$rc3" != 0 ] && echo yes || echo no)" "yes"
check "rollback đã chạy" "$(grep -c ROLLBACK "$W3/out.log")" "1"
check "env file đã phục hồi secret CŨ" \
  "$(grep -c '^JWT_SECRET=secret-cu-trong-envfile$' "$W3/etc/mkddc-web.env")" "1"

echo "== Case 4: trước khi chạy KHÔNG có env file, rồi thất bại =="
W4="$(mktemp -d)"; trap 'rm -rf "$W1" "$W2" "$W3" "$W4"' EXIT
setup_case "$W4" never_ready no_env
rc4="$(run_case "$W4")"
check "script thoát khác 0" "$([ "$rc4" != 0 ] && echo yes || echo no)" "yes"
check "env file bị xoá, không để lại secret mới trên đĩa" \
  "$([ -e "$W4/etc/mkddc-web.env" ] && echo con || echo mat)" "mat"

echo
echo "PASS=$pass FAIL=$fail"
[ "$fail" -eq 0 ]
