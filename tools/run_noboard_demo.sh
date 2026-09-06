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
PROGRAMMING_SOCK="/tmp/mkddc-programming-v1${MKDDC_DEMO_SUFFIX:-}.sock"
PROGRAMMING_STATE="${MKDDC_PROGRAMMING_STATE_DIR:-/tmp/mkddc-local-ddc24/state/programming}"
PTY_A="/tmp/mkddc-iop-a${MKDDC_DEMO_SUFFIX:-}"
PTY_B="/tmp/mkddc-iop-b${MKDDC_DEMO_SUFFIX:-}"
FIELDBUS_CONFIG="${MKDDC_DEMO_FIELDBUS_CONFIG:-}"
FIELDBUS_SOCK="${MKDDC_DEMO_FIELDBUS_SOCK:-}"
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
    rm -f /dev/shm/mkddc_io_shm /dev/shm/mkddc_plc_shm "$SOCK" "$PROGRAMMING_SOCK"
    if [ -n "$FIELDBUS_SOCK" ]; then
        rm -f "$FIELDBUS_SOCK"
    fi
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
# `start` dựng đúng chuỗi như `run` rồi THOÁT, không mở dashboard. Lane E2E
# real-backend cần `/dev/shm/mkddc_plc_shm` tồn tại nhưng không có ai ngồi xem
# dashboard; trước đây nó chỉ in cảnh báo rồi để Point Catalog trả 503, và spec
# đỏ ở một khẳng định cách đó 50 dòng.
start) ;;
*) die "lệnh lạ: $1 (run|start|do1..do4 0/1|kill-mcu|revive|stop)" ;;
esac

[ -x "$IOBUS" ] || die "chưa build: platform/packaging/build-release.sh"
if [ -n "$FIELDBUS_CONFIG" ] && [ -z "$FIELDBUS_SOCK" ]; then
    die "MKDDC_DEMO_FIELDBUS_CONFIG cần MKDDC_DEMO_FIELDBUS_SOCK đi kèm"
fi
mkdir -p "$LOGDIR"
cmd_stop > /dev/null 2>&1
sleep 0.5

# CHỜ ĐIỀU KIỆN, KHÔNG NGỦ MỘT KHOẢNG CỐ ĐỊNH.
#
# Các `sleep` cố định trước đây (0.7 s cho socat, 1.5 s cho iobus/core) là một
# cuộc đua với máy: trên máy dev rảnh thì thắng, trên runner CI đang chạy song
# song nhiều job thì thua. Thua ở đây không hiện ra thành "chưa sẵn sàng" mà
# thành một tiến trình chết kèm `Aborted (core dumped)` ở bước sau, tức triệu
# chứng nằm cách nguyên nhân vài dòng log.
#
# `wait_for` chờ đúng ĐIỀU KIỆN cần, và khi hết hạn thì IN ĐUÔI LOG của tiến
# trình liên quan rồi mới chết. Một lần đỏ ở CI phải tự nói ra vì sao, vì không
# ai ssh được vào runner đó.
wait_for() {  # $1 = mô tả, $2 = giây tối đa, $3 = file log, $4.. = lệnh kiểm
    local label="$1" limit="$2" logfile="$3"; shift 3
    local waited=0
    while ! "$@" > /dev/null 2>&1; do
        if [ "$waited" -ge "$((limit * 10))" ]; then
            echo "LỖI: quá $limit s vẫn chưa: $label" >&2
            if [ -f "$logfile" ]; then
                echo "----- 30 dòng cuối $logfile -----" >&2
                tail -30 "$logfile" >&2
                echo "---------------------------------" >&2
            else
                echo "(không có $logfile — tiến trình chưa kịp ghi dòng nào)" >&2
            fi
            exit 1
        fi
        sleep 0.1
        waited=$((waited + 1))
    done
}

echo "[1/4] socat tạo cặp PTY ảo $PTY_A <-> $PTY_B"
nohup socat PTY,raw,echo=0,link=$PTY_A PTY,raw,echo=0,link=$PTY_B > "$LOGDIR/socat.log" 2>&1 &
wait_for "cặp PTY $PTY_A/$PTY_B xuất hiện" 15 "$LOGDIR/socat.log" test -e "$PTY_A" -a -e "$PTY_B"

echo "[2/4] fake_mcu (MCU giả) bám đầu B"
nohup "$FAKE" --uart "$PTY_B" > "$LOGDIR/fake_mcu.log" 2>&1 &
fake_pid=$!
wait_for "fake_mcu còn sống" 10 "$LOGDIR/fake_mcu.log" kill -0 "$fake_pid"

echo "[3/4] mkddc-iobus poll 500Hz đầu A -> ghi /dev/shm/mkddc_io_shm"
iobus_fieldbus_args=()
core_fieldbus_args=()
if [ -n "$FIELDBUS_CONFIG" ]; then
    iobus_fieldbus_args=(--fieldbus-config "$FIELDBUS_CONFIG" --fieldbus-sock "$FIELDBUS_SOCK")
    core_fieldbus_args=(--fieldbus-sock "$FIELDBUS_SOCK")
fi
nohup "$IOBUS" --uart "$PTY_A" --config tools/demo/iobus_demo.conf --log-level debug \
    "${iobus_fieldbus_args[@]}" > "$LOGDIR/iobus.log" 2>&1 &
wait_for "/dev/shm/mkddc_io_shm xuất hiện" 30 "$LOGDIR/iobus.log" test -e /dev/shm/mkddc_io_shm

echo "[4/4] mkddc-core scan 1s, IPC tại $SOCK"
mkdir -p "$PROGRAMMING_STATE"
nohup env PROGRAMMING_STATE_DIR="$PROGRAMMING_STATE" PROGRAMMING_TARGET_ID=controller-local \
    "$CORE" --sock "$SOCK" --programming-sock "$PROGRAMMING_SOCK" --programming-runtime \
    "${core_fieldbus_args[@]}" > "$LOGDIR/core.log" 2>&1 &
wait_for "socket IPC $SOCK xuất hiện" 30 "$LOGDIR/core.log" test -S "$SOCK"

echo
echo "=== CHUỖI ĐANG CHẠY ===  log tại $LOGDIR/{socat,fake_mcu,iobus,core}.log"
echo "Mở terminal khác để nghịch:"
echo "  ./tools/run_noboard_demo.sh do1 1     # đóng relay DO1"
echo "  ./tools/run_noboard_demo.sh kill-mcu  # xem FAULT + safe-state"
echo "  ./tools/run_noboard_demo.sh revive    # xem tự hồi phục"
echo "  ./tools/run_noboard_demo.sh stop      # dọn sạch"
echo
if [ "${1:-run}" = "start" ]; then
    # Đợi PLC SHM hiện ra trước khi trả quyền: người gọi (lane E2E) dựa vào nó
    # để Point Catalog không trả 503, và "đã chạy lệnh" không đồng nghĩa "SHM đã
    # có". Thà hỏng ở đây với một câu rõ ràng — kèm đuôi log — còn hơn hỏng
    # trong Playwright ở một khẳng định cách đó 50 dòng.
    wait_for "/dev/shm/mkddc_plc_shm xuất hiện" 30 "$LOGDIR/core.log" test -e /dev/shm/mkddc_plc_shm
    echo "chuỗi no-board đã sẵn sàng: /dev/shm/mkddc_plc_shm"
    exit 0
fi

echo "Dashboard IO sống (Ctrl-C để thoát, chuỗi vẫn chạy):"
echo "──────────────────────────────────────────────────────"
exec "$DUMP" --watch
