#!/bin/sh
# rs485_check.sh — Kiểm chứng cổng RS-485 trên board (Foxlinx SOM-DDC-24).
#
# VÌ SAO CẦN SCRIPT NÀY
#
# Trạng thái "RS-485 dùng được chưa" không đọc được từ device tree. DT chỉ nói
# UART đã enable và pin đã mux; nó KHÔNG nói dây RX có nối vào transceiver hay
# không. Chân RX lại có pull-up nội (đo được: `input bias pull up` trên
# gpio4-7), nên khi thả nổi nó vẫn đọc mức cao y hệt lúc transceiver kéo cao —
# tức là mọi phép đo tĩnh đều cho cùng một kết quả và không phân biệt được.
#
# Chỉ có hai phép thử phân biệt được, và script này làm cả hai:
#
#   loopback — nối tắt TX↔RX (chân 8↔10 trên P16, hoặc TXD↔RXD trên module).
#              Gửi một chuỗi mốc rồi đọc lại. Đọc đúng ⇒ đường TX và RX của
#              SoC đều thông. Đây là phép thử SoC, không đụng tới bus A/B.
#
#   scan     — quét slave Modbus RTU 1..247 bằng hàm 0x03. Bất kỳ khung trả lời
#              nào (kể cả exception) đều chứng minh cả TX lẫn RX thông TỚI
#              THIẾT BỊ THẬT trên bus A/B — mức bằng chứng cao nhất.
#
# Dùng:  ./rs485_check.sh loopback [port] [baud]
#        ./rs485_check.sh scan     [port] [baud] [slave_dau] [slave_cuoi]
#        ./rs485_check.sh info     [port]

set -u

MODE="${1:-info}"
PORT="${2:-/dev/rs485-1}"
BAUD="${3:-9600}"

die() { echo "LỖI: $*" >&2; exit 1; }

[ -e "$PORT" ] || die "không có $PORT. Kiểm tra device tree đã enable UART và udev rule đã tạo symlink chưa."

setup_port() {
  # min 0 / time N = đọc không chặn vô hạn: trả về sau N*100ms kể cả khi rỗng.
  stty -F "$PORT" "$BAUD" cs8 -parenb -cstopb raw -echo -crtscts min 0 time "${1:-3}" \
    || die "stty thất bại trên $PORT"
}

drain() { dd if="$PORT" of=/dev/null bs=1 count=256 2>/dev/null; }

# CRC-16/MODBUS (poly 0xA001, init 0xFFFF) — trả về "lo hi" dạng thập phân.
crc16() {
  crc=65535
  for b in "$@"; do
    crc=$(( crc ^ b ))
    i=0
    while [ $i -lt 8 ]; do
      if [ $(( crc & 1 )) -eq 1 ]; then
        crc=$(( (crc >> 1) ^ 40961 ))
      else
        crc=$(( crc >> 1 ))
      fi
      i=$(( i + 1 ))
    done
  done
  echo "$(( crc & 255 )) $(( (crc >> 8) & 255 ))"
}

tx_count() {
  awk -v n="$1" '$1==n":" {for(i=1;i<=NF;i++) if($i ~ /^tx:/){sub(/tx:/,"",$i); print $i}}' \
    /proc/tty/driver/serial 2>/dev/null
}
rx_count() {
  awk -v n="$1" '$1==n":" {for(i=1;i<=NF;i++) if($i ~ /^rx:/){sub(/rx:/,"",$i); print $i}}' \
    /proc/tty/driver/serial 2>/dev/null
}

# Số hiệu ttyS đứng sau symlink, để đọc bộ đếm trong /proc/tty/driver/serial.
# Trả về rỗng nếu cổng không phải ttyS* (ví dụ khi test trên pty): mọi chỗ dùng
# đều phải chịu được giá trị rỗng, vì bộ đếm chỉ là thông tin phụ — kết luận
# ĐẠT/KHÔNG ĐẠT dựa trên byte đọc lại được, không dựa trên bộ đếm.
port_index() {
  real=$(readlink -f "$PORT")
  case "$real" in
    */ttyS[0-9]*) echo "${real##*/ttyS}" ;;
    *) echo "" ;;
  esac
}

case "$MODE" in

info)
  IDX=$(port_index)
  REAL=$(readlink -f "$PORT")
  echo "Cổng     : $PORT -> $REAL"
  if [ -z "$IDX" ]; then
    echo "Lưu ý    : không phải cổng ttyS* — bỏ qua bộ đếm, pin mux và quét tiến trình."
    exit 0
  fi
  echo "Bộ đếm   : $(grep "^${IDX}:" /proc/tty/driver/serial 2>/dev/null || echo 'không đọc được')"
  echo "Pin mux  :"
  MUX=$(grep -E "function uart${IDX}\b" \
    /sys/kernel/debug/pinctrl/pinctrl-rockchip-pinctrl/pinmux-pins 2>/dev/null)
  if [ -n "$MUX" ]; then echo "$MUX" | sed 's/^/  /'
  else echo "  (không đọc được — thử: mount -t debugfs none /sys/kernel/debug)"; fi
  echo "Tiến trình đang mở cổng:"
  found=0
  for p in /proc/[0-9]*; do
    [ -d "$p/fd" ] || continue
    if ls -l "$p/fd" 2>/dev/null | grep -q "ttyS${IDX}$"; then
      echo "  PID ${p##*/} ($(cat "$p/comm" 2>/dev/null))"; found=1
    fi
  done
  [ $found -eq 0 ] && echo "  (không có — cổng đang rảnh)"
  ;;

loopback)
  echo "== Loopback trên $PORT @ ${BAUD}bps =="
  echo "Yêu cầu: đã nối tắt TX↔RX (P16 chân 8 ↔ chân 10, hoặc TXD↔RXD trên module)."
  IDX=$(port_index)
  setup_port 5
  drain
  MARK="MKDDC-RS485-LOOPBACK-$$"
  T0=$(tx_count "$IDX"); R0=$(rx_count "$IDX")
  printf '%s\n' "$MARK" > "$PORT"
  GOT=$(dd if="$PORT" bs=1 count=$(( ${#MARK} + 1 )) 2>/dev/null | tr -d '\r\n')
  T1=$(tx_count "$IDX"); R1=$(rx_count "$IDX")
  echo "Đã gửi   : $MARK"
  echo "Đọc lại  : ${GOT:-<rỗng>}"
  echo "Bộ đếm   : tx ${T0:-?} -> ${T1:-?} , rx ${R0:-?} -> ${R1:-?}"
  if [ "$GOT" = "$MARK" ]; then
    echo "KẾT QUẢ  : ĐẠT — cả TX và RX của SoC đều thông."
    exit 0
  elif [ -n "$GOT" ]; then
    echo "KẾT QUẢ  : SAI LỆCH — có nhận được byte nhưng không khớp."
    echo "           Thường do sai baud, sai parity, hoặc transceiver cắt đầu/cuối khung."
    exit 2
  else
    echo "KẾT QUẢ  : KHÔNG ĐẠT — gửi được nhưng không nhận lại byte nào."
    echo "           Nếu đã nối tắt đúng thì đường RX (P16 chân 10) không thông."
    exit 1
  fi
  ;;

scan)
  FROM="${4:-1}"; TO="${5:-247}"
  echo "== Quét Modbus RTU trên $PORT @ ${BAUD}bps, slave $FROM..$TO =="
  IDX=$(port_index)
  setup_port 3
  FOUND=0
  ID=$FROM
  while [ "$ID" -le "$TO" ]; do
    drain
    # 0x03 read holding registers, addr 0x0000, qty 1
    set -- "$ID" 3 0 0 0 1
    CRC=$(crc16 "$@")
    LO=${CRC% *}; HI=${CRC#* }
    printf "\\$(printf '%03o' "$ID")\\003\\000\\000\\000\\001\\$(printf '%03o' "$LO")\\$(printf '%03o' "$HI")" > "$PORT"
    RESP=$(dd if="$PORT" bs=1 count=16 2>/dev/null | od -An -tx1 | tr -s ' ' | tr -d '\n')
    if [ -n "$(echo "$RESP" | tr -d ' ')" ]; then
      echo "  slave $ID: TRẢ LỜI ->$RESP"
      FOUND=$(( FOUND + 1 ))
    fi
    ID=$(( ID + 1 ))
  done
  echo "Tổng bộ đếm: $(grep "^${IDX}:" /proc/tty/driver/serial)"
  if [ "$FOUND" -gt 0 ]; then
    echo "KẾT QUẢ  : ĐẠT — $FOUND slave trả lời. TX và RX thông tới thiết bị thật trên bus A/B."
    exit 0
  else
    echo "KẾT QUẢ  : KHÔNG CÓ SLAVE TRẢ LỜI."
    echo "           Không phân biệt được 'bus trống' với 'RX không nối'."
    echo "           Chạy '$0 loopback $PORT $BAUD' sau khi nối tắt chân 8↔10 để tách hai khả năng."
    exit 1
  fi
  ;;

*)
  die "chế độ không hợp lệ '$MODE'. Dùng: info | loopback | scan"
  ;;
esac
