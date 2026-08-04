#!/usr/bin/env bash
# Rollback MK-DDC-24 về một bản đã chụp trước đó.
#
#   sudo platform/packaging/rollback.sh              # về bản ngay trước
#   sudo platform/packaging/rollback.sh --list       # liệt kê snapshot
#   sudo platform/packaging/rollback.sh /var/backups/mkddc/0.2.1-20260804-133430
#
# Snapshot do `install.sh` tự tạo trước mỗi lần ghi đè. Script này tồn tại để
# rollback là quy trình lặp lại được, thay vì thao tác ứng biến kiểu chép tay
# `mkddc-core.bak-*` vào `/usr/sbin` như trước đây.
set -eu

BACKUP_ROOT=/var/backups/mkddc

if [ "${1:-}" = "--list" ]; then
    ls -1dt "$BACKUP_ROOT"/*/ 2>/dev/null || echo "(chưa có snapshot nào)"
    exit 0
fi

[ "$(id -u)" -eq 0 ] || { echo "ERROR: cần root (sudo)" >&2; exit 1; }

SNAP="${1:-$BACKUP_ROOT/previous}"
[ -d "$SNAP" ] || { echo "ERROR: không thấy snapshot '$SNAP' (xem --list)" >&2; exit 1; }
[ -x "$SNAP/mkddc-core" ] || { echo "ERROR: snapshot thiếu mkddc-core" >&2; exit 1; }

# ADR-022 §7: không chạm netcfg khi còn giao dịch mạng dở dang.
NETCFG_JOURNAL=/data/mkddc/netcfg-transaction.json
if [ -f "$NETCFG_JOURNAL" ] && grep -qE '"state"[[:space:]]*:[[:space:]]*"(staged|applying|awaiting_confirmation)"' "$NETCFG_JOURNAL" 2>/dev/null; then
    echo "ERROR: mkddc-netcfg còn giao dịch mạng chưa kết thúc. Huỷ rollback." >&2
    exit 1
fi

echo "INFO: rollback về $SNAP"

# Chụp lại bản hiện tại trước khi ghi đè, để rollback cũng có đường quay lại.
if [ -x /usr/sbin/mkddc-core ]; then
    cur_ver=unknown
    [ -f /usr/share/mkddc/provenance.json ] && \
        cur_ver="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
                   /usr/share/mkddc/provenance.json | head -1)"
    [ -n "$cur_ver" ] || cur_ver=unknown
    PRE="$BACKUP_ROOT/pre-rollback-${cur_ver}-$(date +%Y%m%d-%H%M%S)"
    install -d -m 0755 "$PRE"
    for f in /usr/sbin/mkddc-core /usr/sbin/mkddc-iobus /usr/sbin/mkddc-netcfg \
             /usr/sbin/mkddc-fake-mcu /usr/sbin/mkddc-hmi /opt/mkddc-web/mkddc-web \
             /usr/share/mkddc/provenance.json /usr/share/mkddc/checksums.sha256; do
        [ -e "$f" ] && cp -a "$f" "$PRE/" || true
    done
    echo "INFO: bản hiện tại ($cur_ver) đã chụp vào $PRE"
fi

restore() {  # $1 = tên file trong snapshot, $2 = đích
    [ -e "$SNAP/$1" ] || return 0
    install -m 0755 "$SNAP/$1" "$2"
    echo "  khôi phục $2"
}
restore mkddc-iobus    /usr/sbin/mkddc-iobus
restore mkddc-core     /usr/sbin/mkddc-core
restore mkddc-netcfg   /usr/sbin/mkddc-netcfg
restore mkddc-fake-mcu /usr/sbin/mkddc-fake-mcu
restore mkddc-hmi      /usr/sbin/mkddc-hmi
restore mkddc-web      /opt/mkddc-web/mkddc-web
for meta in provenance.json checksums.sha256; do
    [ -e "$SNAP/$meta" ] && install -m 0644 "$SNAP/$meta" "/usr/share/mkddc/$meta"
done

# Thứ tự như install.sh: nguồn dữ liệu trước, tiêu thụ sau. iobus và core dùng
# chung SHM nên phải restart cùng nhau.
systemctl is-enabled mkddc-pty     >/dev/null 2>&1 && systemctl restart mkddc-pty     || true
systemctl is-enabled mkddc-fakemcu >/dev/null 2>&1 && systemctl restart mkddc-fakemcu || true
systemctl restart mkddc-iobus
systemctl restart mkddc-core
systemctl restart mkddc-web-pi
systemctl restart mkddc-netcfg
systemctl is-active mkddc-hmi >/dev/null 2>&1 && systemctl restart mkddc-hmi || true

# Ghi lại runtime info theo bản vừa khôi phục, nếu không provenance sẽ nói dối.
{
    /usr/sbin/mkddc-core --version
    /usr/sbin/mkddc-iobus --version
    /usr/sbin/mkddc-netcfg --version
    /opt/mkddc-web/mkddc-web --version
} > /usr/share/mkddc/runtime-build-info.txt
sha256sum /usr/sbin/mkddc-core /usr/sbin/mkddc-iobus /usr/sbin/mkddc-netcfg \
    /opt/mkddc-web/mkddc-web > /usr/share/mkddc/runtime-checksums.sha256

# Không service nào được giữ inode đã bị thay.
stale=0
for unit in mkddc-iobus mkddc-core mkddc-netcfg mkddc-web-pi; do
    pid="$(systemctl show "$unit" -p MainPID --value)"
    [ -n "$pid" ] && [ "$pid" != "0" ] || continue
    if readlink "/proc/$pid/exe" 2>/dev/null | grep -q '(deleted)'; then
        echo "ERROR: $unit (pid $pid) vẫn chạy binary cũ đã bị thay." >&2
        stale=1
    fi
done
[ "$stale" -eq 0 ] || { echo "ERROR: rollback chưa hoàn tất." >&2; exit 1; }

echo "OK: rollback xong — version=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' /usr/share/mkddc/provenance.json | head -1)"
systemctl --no-pager --plain is-active mkddc-iobus mkddc-core mkddc-netcfg mkddc-web-pi
