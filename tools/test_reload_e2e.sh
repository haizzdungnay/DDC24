#!/usr/bin/env bash
# E2E SIGHUP reload (COR-008, CONFIG_SCHEMA D-5) — không restart core:
#   A. dựng chuỗi no-board, manual DO1=1 (web_ipc, accepted)
#   B. đổi io_safe_state.conf: DO2 default=closed → kill -HUP core
#      → DO2 lên 1 (default mức 6 mới), DO1 GIỮ 1 (manual không mất), core không restart
#   C. ghi config HỎNG → kill -HUP → core log "GIỮ config cũ", output không đổi
#   D. iobus: reload config an toàn (poll_period_ms) -> reload thành công, PID không đổi
#   E. iobus: reload config nguy hiểm (uart_device, baud) -> cảnh báo, giữ giá trị cũ, PID không đổi
#   F. iobus: reload config hỏng -> báo lỗi, giữ config cũ, PID không đổi
# Exit 0 = PASS.
set -u
cd "$(dirname "$0")/.."

BUILD="${MKDDC_CPP_BUILD_ROOT:-build/release/cpp}"
LOGDIR="$(pwd)/logs/reload-e2e"
SOCK=/tmp/mkddc-reload-core.sock
PTY_A=/tmp/mkddc-reload-a
PTY_B=/tmp/mkddc-reload-b
SAFE_CONF=/tmp/mkddc-reload-safe.conf
IOBUS_CONF=/tmp/mkddc-reload-iobus.conf

SOCAT_PID=""
MCU_PID=""
IOBUS_PID=""
CORE_PID=""

cleanup() {
    echo "[cleanup] killing processes spawned by this test..."
    [ -n "$IOBUS_PID" ] && kill "$IOBUS_PID" 2>/dev/null
    [ -n "$CORE_PID" ] && kill "$CORE_PID" 2>/dev/null
    [ -n "$MCU_PID" ] && kill "$MCU_PID" 2>/dev/null
    [ -n "$SOCAT_PID" ] && kill "$SOCAT_PID" 2>/dev/null
    
    # Wait for them to exit to avoid port conflict in quick successive runs
    [ -n "$IOBUS_PID" ] && wait "$IOBUS_PID" 2>/dev/null
    [ -n "$CORE_PID" ] && wait "$CORE_PID" 2>/dev/null
    [ -n "$MCU_PID" ] && wait "$MCU_PID" 2>/dev/null
    [ -n "$SOCAT_PID" ] && wait "$SOCAT_PID" 2>/dev/null

    rm -f /dev/shm/mkddc_io_shm /dev/shm/mkddc_plc_shm "$SOCK" "$SAFE_CONF" "$IOBUS_CONF" "$PTY_A" "$PTY_B"
}
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

do_cmd_val() {  # $1 = kênh 0-based → in giá trị do_cmd[ch]
    "$BUILD/iobus/shm_dump_io" --json | python3 -c \
        "import json,sys; print(json.load(sys.stdin)['do_cmd'][$1])"
}

send_web() {  # $1 = JSON line → in response
    python3 - "$1" <<'EOF'
import socket, sys
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect("/tmp/mkddc-reload-core.sock")
s.sendall((sys.argv[1] + "\n").encode())
s.settimeout(5)
print(s.recv(256).decode().strip())
EOF
}

[ -x "$BUILD/iobus/mkddc-iobus" ] || fail "chưa build (platform/packaging/build-release.sh)"
mkdir -p "$LOGDIR"
rm -f "$LOGDIR"/*.log

# Best effort initial cleanup for any stray processes from previous crashes
pkill -f "PTY.*mkddc-reload" 2>/dev/null || true
rm -f /dev/shm/mkddc_io_shm /dev/shm/mkddc_plc_shm "$SOCK" "$SAFE_CONF" "$IOBUS_CONF" "$PTY_A" "$PTY_B"
sleep 0.5

echo "[setup] socat + fake_mcu + iobus + core"
echo '{ "do": [] }' > "$SAFE_CONF"
echo '{ "iop": { "uart_device": "'"$PTY_A"'", "poll_period_ms": 100 }, "log_level": "info" }' > "$IOBUS_CONF"

nohup socat PTY,raw,echo=0,link=$PTY_A PTY,raw,echo=0,link=$PTY_B > "$LOGDIR/socat.log" 2>&1 &
SOCAT_PID=$!
sleep 0.7
kill -0 "$SOCAT_PID" 2>/dev/null || fail "socat không chạy"

nohup "$BUILD/iobus/fake_mcu" --uart "$PTY_B" > "$LOGDIR/fake_mcu.log" 2>&1 &
MCU_PID=$!
sleep 0.3
kill -0 "$MCU_PID" 2>/dev/null || fail "fake_mcu không chạy"

nohup "$BUILD/iobus/mkddc-iobus" --config "$IOBUS_CONF" > "$LOGDIR/iobus.log" 2>&1 &
IOBUS_PID=$!
sleep 1.0
kill -0 "$IOBUS_PID" 2>/dev/null || fail "iobus không chạy"

nohup "$BUILD/core/mkddc-core" --sock "$SOCK" --safe-state-conf "$SAFE_CONF" \
    --scan-ms 500 > "$LOGDIR/core.log" 2>&1 &
CORE_PID=$!
sleep 1.5
kill -0 "$CORE_PID" 2>/dev/null || fail "core không chạy"

echo "[A] manual DO1=1 qua web_ipc"
RESP=$(send_web '{"id":1,"op":"write","point":"DO1","value":1,"source":"manual","user":"e2e"}')
echo "    response: $RESP"
echo "$RESP" | grep -q '"result":"accepted"' || fail "DO1=1 không được accepted: $RESP"
sleep 1.2
[ "$(do_cmd_val 0)" = "1" ] || fail "do_cmd[0] != 1 sau manual write"

echo "[B] đổi safe conf: DO2 default=closed → SIGHUP core"
echo '{ "do": [ {"ch":2,"safe":"closed"} ] }' > "$SAFE_CONF"
kill -HUP "$CORE_PID"
sleep 1.5
grep -q "core.reload SIGHUP" "$LOGDIR/core.log" || fail "core không nhận SIGHUP"
grep -q "reload.safe_state ok" "$LOGDIR/core.log" || fail "safe_state không reload"
[ "$(do_cmd_val 1)" = "1" ] || fail "DO2 default mới (closed) chưa áp"
[ "$(do_cmd_val 0)" = "1" ] || fail "manual DO1 BỊ MẤT sau reload"
kill -0 "$CORE_PID" 2>/dev/null || fail "core chết sau SIGHUP"
echo "    PASS — DO2 default áp, manual DO1 giữ, core sống"

echo "[C] config hỏng → SIGHUP core → giữ config cũ"
echo '{ "do": [ {"ch":2,' > "$SAFE_CONF"
kill -HUP "$CORE_PID"
sleep 1.5
grep -q "GIỮ config cũ" "$LOGDIR/core.log" || fail "không thấy log giữ config cũ"
[ "$(do_cmd_val 1)" = "1" ] || fail "config hỏng làm MẤT default cũ"
kill -0 "$CORE_PID" 2>/dev/null || fail "core chết vì config hỏng (phải sống)"
echo "    PASS — config hỏng không đổi output, core sống"

echo "[D] iobus: reload config an toàn (poll_period_ms: 100 -> 200)"
echo '{ "iop": { "poll_period_ms": 200 }, "log_level": "debug" }' > "$IOBUS_CONF"
kill -HUP "$IOBUS_PID"
sleep 1.5
grep -q "iobus.reload ok" "$LOGDIR/iobus.log" || fail "iobus không nhận SIGHUP reload thành công"
kill -0 "$IOBUS_PID" 2>/dev/null || fail "iobus chết sau reload an toàn"
echo "    PASS — iobus reload ok, iobus sống"

echo "[E] iobus: reload config nguy hiểm (đổi uart_device/baud) -> log cảnh báo, giữ cũ"
echo '{ "iop": { "uart_device": "/tmp/mkddc-new-uart", "baud": 115200, "poll_period_ms": 200 }, "log_level": "debug" }' > "$IOBUS_CONF"
kill -HUP "$IOBUS_PID"
sleep 1.5
grep -q "reload.requires_restart field=uart_device" "$LOGDIR/iobus.log" || fail "iobus không log cảnh báo uart_device"
grep -q "reload.requires_restart field=baud" "$LOGDIR/iobus.log" || fail "iobus không log cảnh báo baud"
kill -0 "$IOBUS_PID" 2>/dev/null || fail "iobus chết sau reload config nguy hiểm"
echo "    PASS — iobus cảnh báo, giữ cũ, iobus sống"

echo "[F] iobus: reload config hỏng -> giữ cũ"
echo '{ "iop": { ' > "$IOBUS_CONF"
kill -HUP "$IOBUS_PID"
sleep 1.5
grep -q "iobus.reload co phan fail" "$LOGDIR/iobus.log" || fail "iobus không log lỗi reload"
kill -0 "$IOBUS_PID" 2>/dev/null || fail "iobus chết sau reload config hỏng"
echo "    PASS — iobus reload hỏng giữ cũ, iobus sống"

echo
echo "=== PASS SIGHUP reload E2E (logs: $LOGDIR) ==="
