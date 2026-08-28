#!/usr/bin/env bash
# Demo no-board MK-DDC-24 (20_VIRTUAL_COM_DECISION):
#   socat PTY <-> fake_mcu, mkddc-iobus, mkddc-core, rồi hiện dashboard shm sống.
# Dùng:
#   ./tools/run_noboard_demo.sh           # dựng chuỗi + dashboard --watch
#   ./tools/run_noboard_demo.sh do1 1     # bật relay DO1 (qua core, mức manual)
#   ./tools/run_noboard_demo.sh do1 0     # tắt DO1
#   ./tools/run_noboard_demo.sh kill-mcu  # giết fake MCU -> xem FAULT/safe-state
#   ./tools/run_noboard_demo.sh revive    # bật lại fake MCU -> xem tự recover
#   ./tools/run_noboard_demo.sh stop      # dọn sạch
set -u
cd "$(dirname "$0")/.."

BUILD="${MKDDC_CPP_BUILD_ROOT:-build/release/cpp}"
# Ba path này là singleton dùng chung toàn máy. Hai checkout cùng chạy demo sẽ
# giành nhau: checkout sau ghi đè socket, core của checkout trước thành zombie và
# Web API trước đó báo "core unavailable" — trông như code hỏng. Đặt
# MKDDC_DEMO_SUFFIX khác nhau cho mỗi checkout khi cần chạy song song.
SOCK="/tmp/mkddc-core${MKDDC_DEMO_SUFFIX:-}.sock"
PTY_A="/tmp/mkddc-iop-a${MKDDC_DEMO_SUFFIX:-}"
PTY_B="/tmp/mkddc-iop-b${MKDDC_DEMO_SUFFIX:-}"
LOGDIR="$(pwd)/logs/demo"   # log trong codebase (logs/ gitignored) cho dễ đọc
IOBUS=$BUILD/iobus/mkddc-iobus
CORE=$BUILD/core/mkddc-core
FAKE=$BUILD/iobus/fake_mcu
DUMP=$BUILD/iobus/shm_dump_io

die() { echo "LỖI: $*" >&2; exit 1; }

cmd_stop() {
    # Chỉ giết tiến trình của chính checkout này. `pkill -x mkddc-core` giết cả
    # core của checkout khác đang chạy song song — checkout kia mất core giữa
    # chừng và Web API của nó báo "core unavailable" không rõ lý do.
    pkill -f "$CORE --sock $SOCK" 2>/dev/null
    pkill -f "$IOBUS --uart $PTY_A" 2>/dev/null
    pkill -f "$FAKE --uart $PTY_B" 2>/dev/null
    pkill -f "PTY.*link=$PTY_A" 2>/dev/null
    rm -f /dev/shm/mkddc_io_shm /dev/shm/mkddc_plc_shm "$SOCK"
    echo "đã dừng + dọn sạch"
}

cmd_do() {  # $1 = kênh (1-4), $2 = 0/1
    python3 - "$1" "$2" "$SOCK" <<'EOF'
import socket, sys, time
ch, val, sock_path = sys.argv[1], sys.argv[2], sys.argv[3]
# Core cache response theo `id` để idempotent. Hardcode id=1 thì lần gọi thứ hai
# với giá trị khác sẽ bị `id_conflict` — demo trông như core từ chối ghi trong
# khi thực ra script gửi trùng id. Lấy id theo đồng hồ ns cho mỗi lệnh.
req_id = time.time_ns()
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect(sock_path)
s.sendall(f'{{"id":{req_id},"op":"write","point":"DO{ch}","value":{val},"source":"manual","user":"demo"}}\n'.encode())
s.settimeout(5)
print("core trả lời:", s.recv(256).decode().strip())
EOF
}

case "${1:-run}" in
stop)     cmd_stop; exit 0 ;;
do1|do2|do3|do4)
    cmd_do "${1#do}" "${2:?cần 0 hoặc 1}"; exit 0 ;;
kill-mcu)
    pkill -f "$FAKE --uart $PTY_B" && echo "fake MCU đã chết -> nhìn dashboard: iop_status chuyển FAULT->SAFE, DO về 0"
    exit 0 ;;
revive)
    nohup "$FAKE" --uart "$PTY_B" > "$LOGDIR/fake_mcu.log" 2>&1 &
    echo "fake MCU sống lại -> nhìn dashboard: ~5s sau reconnect, NORMAL trở lại"
    exit 0 ;;
run) ;;
*) die "lệnh lạ: $1 (run|do1..do4 0/1|kill-mcu|revive|stop)" ;;
esac

[ -x "$IOBUS" ] || die "chưa build: platform/packaging/build-release.sh"
mkdir -p "$LOGDIR"
cmd_stop > /dev/null 2>&1
sleep 0.5

echo "[1/4] socat tạo cặp PTY ảo $PTY_A <-> $PTY_B"
nohup socat PTY,raw,echo=0,link=$PTY_A PTY,raw,echo=0,link=$PTY_B > "$LOGDIR/socat.log" 2>&1 &
sleep 0.7

echo "[2/4] fake_mcu (MCU giả) bám đầu B"
nohup "$FAKE" --uart "$PTY_B" > "$LOGDIR/fake_mcu.log" 2>&1 &
sleep 0.3

echo "[3/4] mkddc-iobus poll 500Hz đầu A -> ghi /dev/shm/mkddc_io_shm"
nohup "$IOBUS" --uart "$PTY_A" --config tools/demo/iobus_demo.conf --log-level debug > "$LOGDIR/iobus.log" 2>&1 &
sleep 1.5

echo "[4/4] mkddc-core scan 1s, IPC tại $SOCK"
nohup "$CORE" --sock "$SOCK" > "$LOGDIR/core.log" 2>&1 &
sleep 1.5

echo
echo "=== CHUỖI ĐANG CHẠY ===  log tại $LOGDIR/{socat,fake_mcu,iobus,core}.log"
echo "Mở terminal khác để nghịch:"
echo "  ./tools/run_noboard_demo.sh do1 1     # đóng relay DO1"
echo "  ./tools/run_noboard_demo.sh kill-mcu  # xem FAULT + safe-state"
echo "  ./tools/run_noboard_demo.sh revive    # xem tự hồi phục"
echo "  ./tools/run_noboard_demo.sh stop      # dọn sạch"
echo
echo "Dashboard IO sống (Ctrl-C để thoát, chuỗi vẫn chạy):"
echo "──────────────────────────────────────────────────────"
exec "$DUMP" --watch
