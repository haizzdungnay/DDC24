#!/usr/bin/env bash
# Deploy MK-DDC-24 xuống Orange Pi 5B — backup, hoán đổi, health check, rollback.
# Chạy TRÊN board. Nguồn: /home/orangepi/mkddc-src-main (đã build sẵn ở build/fw).
set -euo pipefail

SRC=/home/orangepi/mkddc-src-main
BUILD=$SRC/build/fw
STAGE=/home/orangepi/mkddc-stage          # nơi host đã đẩy mkddc-web + dist
TS=$(date -u +%Y%m%d-%H%M%S)
BACKUP=/opt/mkddc-backups/$TS
COMMIT="${1:-unknown}"

SBIN_BINS=(mkddc-core mkddc-iobus mkddc-netcfg mkddc-hmi mkddc-st-compile mkddc-st-validate mkddc-schedule-sim)
UNITS_STOP=(mkddc-web-pi mkddc-reload-helper mkddc-core mkddc-iobus mkddc-netcfg)
UNITS_START=(mkddc-netcfg mkddc-iobus mkddc-core mkddc-reload-helper mkddc-web-pi)

log() { echo "[$(date -u +%H:%M:%S)] $*"; }
die() { echo "FATAL: $*" >&2; exit 1; }

# --- Guard: netcfg không được restart mù khi còn giao dịch dở (ADR-022 §2.7) ---
JOURNAL=/data/mkddc/netcfg-transaction.json
if [ -f "$JOURNAL" ]; then
  ST=$(sudo -n python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("state",""))' "$JOURNAL" 2>/dev/null || echo "")
  log "netcfg transaction state = ${ST:-<unreadable>}"
  case "$ST" in
    confirmed|rolled_back|""|idle) : ;;
    *) die "netcfg đang có giao dịch '$ST' chưa kết thúc — huỷ deploy." ;;
  esac
fi

# --- 1. Backup ---
log "Backup → $BACKUP"
sudo -n mkdir -p "$BACKUP"
for b in "${SBIN_BINS[@]}"; do
  [ -f "/usr/sbin/$b" ] && sudo -n cp -a "/usr/sbin/$b" "$BACKUP/$b"
done
sudo -n cp -a /opt/mkddc-web/mkddc-web "$BACKUP/mkddc-web"
sudo -n cp -a /opt/mkddc-web/dist "$BACKUP/dist"
[ -f /opt/mkddc-web/users.conf ] && sudo -n cp -a /opt/mkddc-web/users.conf "$BACKUP/users.conf"
sudo -n sha256sum "$BACKUP"/mkddc-* | sudo -n tee "$BACKUP/SHA256SUMS.old" >/dev/null

# --- 2. Cài vào đường dẫn tạm ---
log "Staging binary mới"
TMP=/opt/mkddc-stage-$TS
sudo -n mkdir -p "$TMP"
sudo -n install -m 0755 "$BUILD/core/mkddc-core"            "$TMP/mkddc-core"
sudo -n install -m 0755 "$BUILD/core/mkddc-st-compile"      "$TMP/mkddc-st-compile"
sudo -n install -m 0755 "$BUILD/core/mkddc-st-validate"     "$TMP/mkddc-st-validate"
# P1-03: mô phỏng lịch dùng CHUNG engine với controller, nên nó là một binary
# riêng phải có mặt trên bo. Thiếu nó thì POST /schedules/{id}/simulate trả 503
# vĩnh viễn — backend cố tình không tự tính thay.
sudo -n install -m 0755 "$BUILD/core/mkddc-schedule-sim"    "$TMP/mkddc-schedule-sim"
sudo -n install -m 0755 "$BUILD/iobus/mkddc-iobus"          "$TMP/mkddc-iobus"
sudo -n install -m 0755 "$BUILD/netcfg/mkddc-netcfg"        "$TMP/mkddc-netcfg"
sudo -n install -m 0755 "$BUILD/hmi/mkddc-hmi"              "$TMP/mkddc-hmi"
sudo -n install -m 0755 "$STAGE/mkddc-web"                  "$TMP/mkddc-web"
[ -d "$STAGE/dist" ] || die "thiếu $STAGE/dist"

# --- 2b. Quy tắc udev cho cổng RS-485 ---
#
# `/dev` là devtmpfs, dựng lại ở MỖI lần khởi động, nên symlink tạo bằng tay
# biến mất sau reboot. Hậu quả quan sát được trên Foxlinx 2026-08-06: iobus lặp
# `bus_worker.connect_fail ... No such file or directory` vô hạn trong khi service
# vẫn `active` và `NRestarts=0` — tức KHÔNG có tín hiệu nào ở tầng systemd cho
# thấy Modbus đã chết. Cài quy tắc udev là cách duy nhất để tên cổng bền qua boot.
RS485_RULES="$SRC/platform/udev/99-mkddc-rs485.rules"
if [ -f "$RS485_RULES" ]; then
  log "Cài quy tắc udev RS-485"
  sudo -n install -m 0644 "$RS485_RULES" /etc/udev/rules.d/99-mkddc-rs485.rules
  sudo -n udevadm control --reload-rules || true
  sudo -n udevadm trigger --subsystem-match=tty || true
else
  log "CẢNH BÁO: thiếu $RS485_RULES — cổng RS-485 sẽ KHÔNG có tên ổn định sau reboot"
fi

# --- 3. Dừng service theo thứ tự an toàn ---
log "Dừng service: ${UNITS_STOP[*]}"
for u in "${UNITS_STOP[@]}"; do sudo -n systemctl stop "$u" || true; done

# --- 4. Hoán đổi ---
log "Hoán đổi artifact"
for b in "${SBIN_BINS[@]}"; do sudo -n install -m 0755 "$TMP/$b" "/usr/sbin/$b"; done
sudo -n install -o mkddc -g mkddc -m 0755 "$TMP/mkddc-web" /opt/mkddc-web/mkddc-web
sudo -n rm -rf /opt/mkddc-web/dist.deploying
sudo -n cp -a "$STAGE/dist" /opt/mkddc-web/dist.deploying
sudo -n chown -R mkddc:mkddc /opt/mkddc-web/dist.deploying
sudo -n rm -rf /opt/mkddc-web/dist
sudo -n mv /opt/mkddc-web/dist.deploying /opt/mkddc-web/dist

# --- 5. Khởi động ---
log "Khởi động service: ${UNITS_START[*]}"
sudo -n systemctl daemon-reload
for u in "${UNITS_START[@]}"; do sudo -n systemctl start "$u"; sleep 1; done
sleep 5

# --- 6. Health check ---
# mkddc-web mất vài chục giây để migrate historian rồi mới bind 8081.
# Kiểm ngay sau start sẽ nhận connection-refused và kích hoạt rollback nhầm,
# nên phải CHỜ CÓ HẠN thay vì bắn một phát.
http_code() { curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$1" 2>/dev/null || echo 000; }

wait_http() {
  local deadline=$((SECONDS + 90)) code
  while [ $SECONDS -lt $deadline ]; do
    code=$(http_code http://127.0.0.1:8081/)
    [ "$code" = "200" ] && { echo "  web bind sau $((SECONDS))s"; return 0; }
    sleep 3
  done
  echo "  FAIL web không bind 8081 trong 90s (lần cuối: $code)"
  return 1
}

health() {
  local ok=0
  for u in "${UNITS_START[@]}"; do
    if ! systemctl is-active --quiet "$u"; then echo "  FAIL unit $u không active"; ok=1; fi
  done
  wait_http || ok=1
  local code
  code=$(http_code http://127.0.0.1:8081/)
  [ "$code" = "200" ] || { echo "  FAIL GET / = $code"; ok=1; }
  code=$(http_code http://127.0.0.1:8081/api/v1/system/status)
  [ "$code" = "401" ] || { echo "  FAIL GET /api/v1/system/status = $code (mong đợi 401)"; ok=1; }
  for s in /dev/shm/mkddc_io_shm /dev/shm/mkddc_plc_shm; do
    [ -f "$s" ] || { echo "  FAIL thiếu $s"; ok=1; continue; }
    local sz; sz=$(stat -c %s "$s")
    [ "$sz" -gt 0 ] || { echo "  FAIL $s rỗng"; ok=1; }
    local magic; magic=$(sudo -n od -An -tx4 -N4 "$s" | tr -d ' \n')
    echo "  $s size=$sz magic=0x$magic"
    # Magic ABI hiện hành là v5 (0x4B584405). Giữ v4 trong danh sách chấp nhận
    # để lần deploy đầu tiên sau nâng cấp — lúc SHM cũ chưa bị xoá — không báo
    # động giả. Giá trị đảo byte là do `od` trên máy little-endian.
    case "$magic" in
      4b584405|0544584b|4b584404|0444584b) : ;;
      *) echo "  WARN magic bất thường: 0x$magic" ;;
    esac
  done
  return $ok
}

log "Health check"
if health; then
  log "HEALTH OK"
else
  log "HEALTH FAIL → ROLLBACK về $BACKUP"
  for u in "${UNITS_STOP[@]}"; do sudo -n systemctl stop "$u" || true; done
  for b in "${SBIN_BINS[@]}"; do
    [ -f "$BACKUP/$b" ] && sudo -n install -m 0755 "$BACKUP/$b" "/usr/sbin/$b"
  done
  sudo -n install -o mkddc -g mkddc -m 0755 "$BACKUP/mkddc-web" /opt/mkddc-web/mkddc-web
  sudo -n rm -rf /opt/mkddc-web/dist
  sudo -n cp -a "$BACKUP/dist" /opt/mkddc-web/dist
  sudo -n chown -R mkddc:mkddc /opt/mkddc-web/dist
  for u in "${UNITS_START[@]}"; do sudo -n systemctl start "$u" || true; done
  sleep 5
  health && log "Rollback xong, hệ thống trở lại bản cũ" || log "ROLLBACK CŨNG FAIL — cần can thiệp tay"
  exit 1
fi

# --- 7. Bằng chứng + prune backup ---
log "Bằng chứng"
{
  echo "commit: $COMMIT"
  echo "deployed_at_utc: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "backup: $BACKUP"
  echo "sha256:"
  sha256sum /usr/sbin/mkddc-core /usr/sbin/mkddc-iobus /usr/sbin/mkddc-netcfg \
            /usr/sbin/mkddc-hmi /usr/sbin/mkddc-st-compile /usr/sbin/mkddc-st-validate \
            /usr/sbin/mkddc-schedule-sim \
            /opt/mkddc-web/mkddc-web
} | sudo -n tee "$BACKUP/DEPLOY_MANIFEST.txt"

sudo -n rm -rf "$TMP"
# giữ 5 backup gần nhất
ls -1dt /opt/mkddc-backups/*/ 2>/dev/null | tail -n +6 | xargs -r sudo -n rm -rf
log "DEPLOY THÀNH CÔNG"
