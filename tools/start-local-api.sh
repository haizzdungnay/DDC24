#!/usr/bin/env bash
# Khởi động Web API cho luồng no-board (RUN_PROJECT.md §6).
# Tách hẳn khỏi phiên gọi bằng setsid, nếu không tiến trình chết theo `wsl -- bash -lc`.
set -eu

REPO=/mnt/e/TuanDuong/INTERN/DDC24_project/MK-DDC-24
RUN=/tmp/mkddc-local-ddc24
CPP="$REPO/build/release/cpp/core"

mkdir -p "$RUN/config" "$RUN/state/programming"
pkill -f "$RUN/mkddc-web" 2>/dev/null || true
sleep 1

setsid env \
  JWT_SECRET=local-ddc24-secret-at-least-32-bytes \
  USERS_CONF="$REPO/apps/web-api/config/users.conf" \
  CONFIG_DIR="$RUN/config" \
  STATE_DIR="$RUN/state" \
  PROGRAMMING_STATE_DIR="$RUN/state/programming" \
  CORE_SOCK=/tmp/mkddc-core.sock \
  PROGRAMMING_REV_A=1 \
  PROGRAMMING_SOCKET=/tmp/mkddc-programming-v1.sock \
  PROGRAMMING_SIM_WORKER="$CPP/mkddc-programming-sim-worker" \
  PROGRAMMING_COMPILER="$CPP/mkddc-st-compile" \
  PROGRAMMING_PACKAGER="$CPP/mkddc-st-package" \
  PORT=8081 \
  "$RUN/mkddc-web" > "$RUN/web.out.log" 2> "$RUN/web.err.log" < /dev/null &

disown 2>/dev/null || true

for i in $(seq 1 40); do
  if ss -ltn 2>/dev/null | grep -q ':8081'; then
    echo "API sẵn sàng ở cổng 8081"
    exit 0
  fi
  sleep 0.5
done

echo "LỖI: quá 20 s API chưa nghe cổng 8081" >&2
echo "----- web.err.log -----" >&2
tail -30 "$RUN/web.err.log" >&2 || true
exit 1
