#!/usr/bin/env bash
# E2E 3 lớp safety trong 1 run (03_PHASE_PLAN P6 #5 / 07 §5.1):
#   Lớp 1  MCU FW : mất GET_IO > 200ms  → MCU tự safe            (đo qua fake_mcu log)
#   Lớp 2  iobus  : >100ms không IO_RESP → FAULT→RESET_IO→SAFE   (đo qua kx_io_shm.iop_status)
#   Lớp 3  core   : iop fault/stale      → do_cmd về safe ≤1 scan (đo qua kx_io_shm.do_cmd)
# Kịch bản:
#   A. dựng chuỗi, DO1=1, xác nhận fb=1
#   B. SIGSTOP iobus 600ms → lớp 1: fake_mcu safe trong 200..500ms → SIGCONT → recovery
#   C. kill fake_mcu      → lớp 2: iop_status đổi ≤500ms; lớp 3: do_cmd[0]→0 trong ≤1.5×scan
# Exit 0 = PASS cả 3 lớp.
set -u
cd "$(dirname "$0")/.."

BUILD="${MKDDC_CPP_BUILD_ROOT:-build/release/cpp}"
LOGDIR="$(pwd)/logs/safety-e2e"   # log trong codebase (logs/ gitignored)
SOCK=/tmp/mkddc-e2e-core.sock
PTY_A=/tmp/mkddc-e2e-a
PTY_B=/tmp/mkddc-e2e-b
SCAN_MS=1000

cleanup() {
    # CONT trước khi kill: process đang SIGSTOP không nhận TERM cho tới khi tỉnh
    for p in $(pgrep -x mkddc-iobus; pgrep -x mkddc-core; pgrep -x fake_mcu); do
        kill -CONT "$p" 2>/dev/null
        kill "$p" 2>/dev/null
    done
    pkill -f "PTY.*mkddc-e2e" 2>/dev/null
    rm -f /dev/shm/mkddc_io_shm /dev/shm/mkddc_plc_shm "$SOCK"
}
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

[ -x "$BUILD/iobus/mkddc-iobus" ] || fail "chưa build (platform/packaging/build-release.sh)"
mkdir -p "$LOGDIR"
rm -f "$LOGDIR"/*.log
cleanup
sleep 0.5

echo "[setup] dựng chuỗi socat + fake_mcu + iobus + core (scan ${SCAN_MS}ms)"
nohup socat PTY,raw,echo=0,link=$PTY_A PTY,raw,echo=0,link=$PTY_B > "$LOGDIR/socat.log" 2>&1 &
sleep 0.7
nohup "$BUILD/iobus/fake_mcu" --uart "$PTY_B" > "$LOGDIR/fake_mcu.log" 2>&1 &
sleep 0.3
nohup "$BUILD/iobus/mkddc-iobus" --uart "$PTY_A" > "$LOGDIR/iobus.log" 2>&1 &
sleep 2
nohup "$BUILD/core/mkddc-core" --sock "$SOCK" --scan-ms "$SCAN_MS" > "$LOGDIR/core.log" 2>&1 &
sleep 2.5

python3 - "$SOCK" <<'EOF' || fail "không ghi được DO1=1"
import socket, sys
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect(sys.argv[1]); s.settimeout(5)
s.sendall(b'{"id":1,"op":"write","point":"DO1","value":1,"source":"manual","user":"e2e"}\n')
resp = s.recv(256).decode()
assert '"accepted"' in resp, resp
EOF
sleep 2.5
"$BUILD/iobus/shm_dump_io" --json | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert d['do_feedback'][0] == 1, 'DO1 feedback chưa lên: %s' % d['do_feedback']
print('[setup] DO1=1 fb=1 OK — chuỗi sống')
" || fail "setup DO1"

# ===================== LỚP 1: MCU safe ≤200ms =====================
echo "[layer1] SIGSTOP iobus 600ms → MCU (fake) phải tự safe sau ~200ms idle"
IOBUS_PID=$(pgrep -nx mkddc-iobus)   # -n: newest (phòng process mồ côi)
kill -STOP "$IOBUS_PID"
sleep 0.6
kill -CONT "$IOBUS_PID"

L1_MS=$(grep -o "MCU SAFE-STATE after [0-9]* ms" "$LOGDIR/fake_mcu.log" | grep -o "[0-9]*" | head -1)
[ -n "$L1_MS" ] || fail "lớp 1: fake_mcu không vào safe-state khi mất GET_IO"
[ "$L1_MS" -ge 200 ] || fail "lớp 1: safe quá sớm (${L1_MS}ms < 200ms spec)"
[ "$L1_MS" -le 500 ] || fail "lớp 1: safe quá trễ (${L1_MS}ms > 500ms budget)"
echo "[layer1] PASS — MCU safe sau ${L1_MS}ms idle (spec >200ms, budget ≤500ms)"

# chờ recovery đầy đủ (iobus FAULT→reconnect→handshake; manual DO1 còn mức 2 → relay đóng lại)
echo "[recovery] chờ hệ tự hồi sau khi iobus tỉnh lại..."
MKDDC_SHM_DUMP="$BUILD/iobus/shm_dump_io" python3 - <<'EOF' || fail "recovery sau lớp 1 không hoàn tất trong 20s"
import json, subprocess, time
import os
deadline = time.monotonic() + 20
while time.monotonic() < deadline:
    try:
        d = json.loads(subprocess.run([os.environ["MKDDC_SHM_DUMP"], "--json"],
                                      capture_output=True, text=True).stdout)
        if d["iop_status"] == "NORMAL" and d["do_feedback"][0] == 1:
            print("[recovery] OK — NORMAL + DO1 tự đóng lại")
            break
    except Exception:
        pass
    time.sleep(0.2)
else:
    raise SystemExit(1)
EOF

# ===================== LỚP 2 + 3: iobus ≤100ms+retry, core ≤1 scan =====================
echo "[layer2+3] kill fake_mcu → đo iop_status đổi (lớp 2) và do_cmd về 0 (lớp 3)"
MKDDC_SHM_DUMP="$BUILD/iobus/shm_dump_io" python3 - "$SCAN_MS" <<'EOF' || fail "lớp 2/3"
import json, os, subprocess, sys, time

scan_ms = int(sys.argv[1])

def shm():
    out = subprocess.run([os.environ["MKDDC_SHM_DUMP"], "--json"],
                         capture_output=True, text=True).stdout
    return json.loads(out)

assert shm()["iop_status"] == "NORMAL"
subprocess.run(["pkill", "-x", "fake_mcu"], check=True)
t0 = time.monotonic()

t_iobus = t_core = None
deadline = time.monotonic() + 10
while time.monotonic() < deadline and (t_iobus is None or t_core is None):
    d = shm()
    now = time.monotonic()
    if t_iobus is None and d["iop_status"] != "NORMAL":
        t_iobus = now - t0
    if t_core is None and d["do_cmd"][0] == 0:
        t_core = now - t0
    time.sleep(0.02)

assert t_iobus is not None, "lớp 2: iop_status không đổi sau 10s"
assert t_core is not None, "lớp 3: do_cmd không về 0 sau 10s"

# Lớp 2: spec phát hiện >100ms + retry (3×10ms) + ghi shm — budget 500ms (PTY slack)
l2_ms = t_iobus * 1000
assert l2_ms <= 500, f"lớp 2 quá trễ: {l2_ms:.0f}ms > 500ms"
# Lớp 3: ≤1 scan sau khi iobus báo fault — budget 1.5×scan
l3_ms = (t_core - t_iobus) * 1000
assert l3_ms <= 1.5 * scan_ms, f"lớp 3 quá trễ: {l3_ms:.0f}ms > {1.5*scan_ms:.0f}ms"

print(f"[layer2] PASS — iobus báo fault sau {l2_ms:.0f}ms (spec 100ms+retry, budget 500ms)")
print(f"[layer3] PASS — core safe do_cmd→0 sau thêm {l3_ms:.0f}ms (≤1 scan {scan_ms}ms)")
EOF

grep -q "safe_state.enter" "$LOGDIR/core.log" || fail "core không log safe_state.enter"
grep -q "IOP_TIMEOUT" "$LOGDIR/iobus.log" || fail "iobus không phát alarm IOP_TIMEOUT"

echo
echo "=== PASS cả 3 lớp safety (logs: $LOGDIR) ==="
exit 0
