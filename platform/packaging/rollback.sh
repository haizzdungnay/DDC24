#!/usr/bin/env bash
# Rollback MK-DDC-24 về một bản đã chụp trước đó.
#
#   sudo platform/packaging/rollback.sh              # về bản ngay trước
#   sudo platform/packaging/rollback.sh --list       # liệt kê snapshot
#   sudo platform/packaging/rollback.sh "$BACKUP_ROOT"/0.2.1-20260804-133430
#
# Snapshot do `install.sh` tự tạo trước mỗi lần ghi đè. Script này tồn tại để
# rollback là quy trình lặp lại được, thay vì thao tác ứng biến kiểu chép tay
# `mkddc-core.bak-*` vào `/usr/sbin` như trước đây.
set -eu

# T59-606 — diễn tập rollback trên cây giả, xem ghi chú cùng tên ở install.sh.
DESTDIR="${MKDDC_INSTALL_ROOT:-}"
if [ -n "$DESTDIR" ]; then
    DRY=1
    DESTDIR="$(cd "$DESTDIR" && pwd)"
else
    DRY=0
fi

BACKUP_ROOT="$DESTDIR/var/backups/mkddc"
SBIN="$DESTDIR/usr/sbin"
WEBDIR="$DESTDIR/opt/mkddc-web"
SHAREDIR="$DESTDIR/usr/share/mkddc"
DATADIR="$DESTDIR/data"

inst() {
    if [ "$DRY" -eq 1 ]; then
        local args=() skip=0
        for a in "$@"; do
            if [ "$skip" -eq 1 ]; then skip=0; continue; fi
            case "$a" in
                -o|-g) skip=1 ;;
                *) args+=("$a") ;;
            esac
        done
        install "${args[@]}"
    else
        install "$@"
    fi
}

sysctl_do() {
    if [ "$DRY" -eq 1 ]; then
        printf '%s\n' "$*" >> "$DESTDIR/dry-run-systemctl.log"
        # Truy vấn trạng thái phải trả "KHÔNG" khi diễn tập. Trả 0 cho
        # `is-enabled`/`is-active` làm mọi nhánh `... && <lệnh thật>` phía sau
        # chạy — và trong bản đầu, đúng nhánh đó đã restart mkddc-pty trên bo
        # thật, kéo theo mkddc-iobus tự thoát vì PTY biến mất. Một diễn tập
        # không được có tác dụng phụ, kể cả gián tiếp.
        case "${1:-}" in
            is-enabled|is-active|is-failed) return 1 ;;
        esac
        return 0
    fi
    systemctl "$@"
}

if [ "${1:-}" = "--list" ]; then
    ls -1dt "$BACKUP_ROOT"/*/ 2>/dev/null || echo "(chưa có snapshot nào)"
    exit 0
fi

[ "$DRY" -eq 1 ] || [ "$(id -u)" -eq 0 ] || { echo "ERROR: cần root (sudo)" >&2; exit 1; }

SNAP="${1:-$BACKUP_ROOT/previous}"
[ -d "$SNAP" ] || { echo "ERROR: không thấy snapshot '$SNAP' (xem --list)" >&2; exit 1; }
[ -x "$SNAP/mkddc-core" ] || { echo "ERROR: snapshot thiếu mkddc-core" >&2; exit 1; }

# ADR-022 §7: không chạm netcfg khi còn giao dịch mạng dở dang.
NETCFG_JOURNAL="$DATADIR/mkddc/netcfg-transaction.json"
if [ -f "$NETCFG_JOURNAL" ] && grep -qE '"state"[[:space:]]*:[[:space:]]*"(staged|applying|awaiting_confirmation)"' "$NETCFG_JOURNAL" 2>/dev/null; then
    echo "ERROR: mkddc-netcfg còn giao dịch mạng chưa kết thúc. Huỷ rollback." >&2
    exit 1
fi

echo "INFO: rollback về $SNAP"

# Chụp lại bản hiện tại trước khi ghi đè, để rollback cũng có đường quay lại.
if [ -x "$SBIN"/mkddc-core ]; then
    cur_ver=unknown
    [ -f "$SHAREDIR/provenance.json" ] && \
        cur_ver="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
                   "$SHAREDIR/provenance.json" | head -1)"
    [ -n "$cur_ver" ] || cur_ver=unknown
    PRE="$BACKUP_ROOT/pre-rollback-${cur_ver}-$(date +%Y%m%d-%H%M%S)"
    inst -d -m 0755 "$PRE"
    for f in "$SBIN"/mkddc-core "$SBIN"/mkddc-iobus "$SBIN"/mkddc-netcfg \
             "$SBIN"/mkddc-st-compile "$SBIN"/mkddc-st-package \
             "$SBIN"/mkddc-fake-mcu "$SBIN"/mkddc-hmi "$WEBDIR/mkddc-web" \
             "$WEBDIR/mkddc-schedule-sim" \
             "$SHAREDIR/provenance.json" "$SHAREDIR/checksums.sha256"; do
        [ -e "$f" ] && cp -a "$f" "$PRE/" || true
    done
    echo "INFO: bản hiện tại ($cur_ver) đã chụp vào $PRE"
fi

restore() {  # $1 = tên file trong snapshot, $2 = đích
    [ -e "$SNAP/$1" ] || return 0
    inst -m 0755 "$SNAP/$1" "$2"
    echo "  khôi phục $2"
}
restore mkddc-iobus    "$SBIN"/mkddc-iobus
restore mkddc-core     "$SBIN"/mkddc-core
restore mkddc-netcfg   "$SBIN"/mkddc-netcfg
restore mkddc-st-compile "$SBIN"/mkddc-st-compile
# T59-606: bỏ sót binary này thì sau rollback bo giữ WRITER artifact của bản MỚI
# trong khi compiler/loader/Core đã về bản cũ — hai nửa của cùng một định dạng gói
# lệch phiên bản, và chỗ hỏng chỉ lộ ra ở lần Commission kế tiếp. Cùng lớp lỗi mà
# `T59-605` vừa vá cho install.sh (build nhưng không cài).
restore mkddc-st-package "$SBIN"/mkddc-st-package
restore mkddc-fake-mcu "$SBIN"/mkddc-fake-mcu
restore mkddc-hmi      "$SBIN"/mkddc-hmi
restore mkddc-web      "$WEBDIR/mkddc-web"
# SRC-F-01: rollback bỏ sót binary này thì bản cũ chạy lại với engine simulate
# của bản mới — hai phiên bản lệch nhau ở đúng chỗ không ai nghĩ tới khi truy sự cố.
restore mkddc-schedule-sim "$WEBDIR/mkddc-schedule-sim"
for meta in provenance.json checksums.sha256; do
    [ -e "$SNAP/$meta" ] && inst -m 0644 "$SNAP/$meta" "$SHAREDIR/$meta"
done

# F-P59-ROLLBACK-DB-001 — KHÔI PHỤC STORE PROGRAMMING CÙNG BINARY.
#
# BE chạy migration khi khởi động và **từ chối chạy** khi schema mới hơn binary
# ("schema Programming mới hơn binary: version N"). Rollback chỉ-binary sau một
# bản có migration vì thế không trả bo về trạng thái chạy được: đo thật trên bo
# Foxlinx 2026-08-24, hạ mkddc-web về bản trước migration `0012` làm service
# crash-loop 7 lần và `/api/v1/health` từ chối kết nối. Bản chụp DB nằm trong
# cùng snapshot với binary nên hai thứ luôn khớp phiên bản.
PROGRAMMING_DB="$DATADIR/config/programming/programming-v1.sqlite"
if [ -e "$SNAP/programming-v1.sqlite" ]; then
    sysctl_do stop mkddc-web-pi >/dev/null 2>&1 || true
    # Giữ lại DB hiện tại: nó là dữ liệu vận hành, không phải file tạm. Không có
    # bản này thì một lần rollback nhầm là mất toàn bộ Project/Revision mới.
    if [ -e "$PROGRAMMING_DB" ]; then
        cp -a "$PROGRAMMING_DB" "$PRE/programming-v1.sqlite.pre-rollback" 2>/dev/null || true
    fi
    rm -f "$PROGRAMMING_DB" "$PROGRAMMING_DB-wal" "$PROGRAMMING_DB-shm"
    inst -m 0600 "$SNAP/programming-v1.sqlite" "$PROGRAMMING_DB"
    for extra in wal shm; do
        [ -e "$SNAP/programming-v1.sqlite-$extra" ] && \
            inst -m 0600 "$SNAP/programming-v1.sqlite-$extra" "$PROGRAMMING_DB-$extra"
    done
    chown mkddc:mkddc "$PROGRAMMING_DB" "$PROGRAMMING_DB-wal" "$PROGRAMMING_DB-shm" 2>/dev/null || true
    echo "  khôi phục $PROGRAMMING_DB (kèm -wal/-shm nếu có)"
elif [ -e "$PROGRAMMING_DB" ]; then
    echo "CẢNH BÁO: snapshot không có bản chụp store Programming." >&2
    echo "          Nếu bản đang chạy đã áp migration mới hơn binary được khôi phục," >&2
    echo "          mkddc-web sẽ TỪ CHỐI khởi động ('schema Programming mới hơn binary')." >&2
    echo "          Khôi phục thủ công từ $DATADIR/config/programming/programming-backups" >&2
    echo "          trước khi coi rollback là xong." >&2
fi

# Thứ tự như install.sh: nguồn dữ liệu trước, tiêu thụ sau. iobus và core dùng
# chung SHM nên phải restart cùng nhau.
sysctl_do is-enabled mkddc-pty     >/dev/null 2>&1 && sysctl_do restart mkddc-pty     || true
sysctl_do is-enabled mkddc-fakemcu >/dev/null 2>&1 && sysctl_do restart mkddc-fakemcu || true
sysctl_do restart mkddc-iobus
sysctl_do restart mkddc-core
sysctl_do restart mkddc-web-pi
sysctl_do restart mkddc-netcfg
sysctl_do is-active mkddc-hmi >/dev/null 2>&1 && sysctl_do restart mkddc-hmi || true

# Ghi lại runtime info theo bản vừa khôi phục, nếu không provenance sẽ nói dối.
{
    "$SBIN"/mkddc-core --version
    "$SBIN"/mkddc-iobus --version
    "$SBIN"/mkddc-netcfg --version
    "$SBIN"/mkddc-st-compile --version
    "$WEBDIR/mkddc-web" --version
} > "$SHAREDIR"/runtime-build-info.txt
sha256sum "$SBIN"/mkddc-core "$SBIN"/mkddc-iobus "$SBIN"/mkddc-netcfg \
    "$SBIN"/mkddc-st-compile \
    "$WEBDIR/mkddc-web" "$WEBDIR/mkddc-schedule-sim" \
    > "$SHAREDIR"/runtime-checksums.sha256

# Không service nào được giữ inode đã bị thay.
stale=0
for unit in mkddc-iobus mkddc-core mkddc-netcfg mkddc-web-pi; do
    pid="$(sysctl_do show "$unit" -p MainPID --value)"
    [ -n "$pid" ] && [ "$pid" != "0" ] || continue
    if readlink "/proc/$pid/exe" 2>/dev/null | grep -q '(deleted)'; then
        echo "ERROR: $unit (pid $pid) vẫn chạy binary cũ đã bị thay." >&2
        stale=1
    fi
done
[ "$stale" -eq 0 ] || { echo "ERROR: rollback chưa hoàn tất." >&2; exit 1; }

echo "OK: rollback xong — version=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$SHAREDIR/provenance.json" | head -1)"
sysctl_do --no-pager --plain is-active mkddc-iobus mkddc-core mkddc-netcfg mkddc-web-pi
