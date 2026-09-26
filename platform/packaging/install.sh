#!/usr/bin/env bash
# Install MK-DDC-24 SOM services lên board (06 §10 / 07 §9 — SKEL-005).
# Chạy từ root repo SAU khi build:
#   platform/packaging/build-release.sh
#   sudo platform/packaging/install.sh [--no-enable]
set -eu
MKDDC_REPOSITORY_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "$0")/../.." && pwd))"
export MKDDC_REPOSITORY_ROOT
# shellcheck source=repository-paths.sh
. "$MKDDC_REPOSITORY_ROOT/platform/packaging/repository-paths.sh"
cd "$MKDDC_REPOSITORY_ROOT"

BUILD="$MKDDC_CPP_BUILD_REL"
ENABLE=1
WITH_FAKE_MCU=0
for arg in "$@"; do
    case "$arg" in
        --no-enable)     ENABLE=0 ;;
        --with-fake-mcu) WITH_FAKE_MCU=1 ;;
        *) echo "ERROR: tham số không hợp lệ '$arg' (dùng --no-enable, --with-fake-mcu)" >&2; exit 1 ;;
    esac
done

# T59-606 — CÀI VÀO CÂY GIẢ ĐỂ DIỄN TẬP.
#
# `MKDDC_INSTALL_ROOT=DIR` đặt mọi đường đích dưới DIR và bỏ các thao tác cần
# quyền hệ thống (user/group, systemctl). Nhờ đó "cài mới / nâng cấp / rollback"
# kiểm chứng được BẰNG MÁY trước khi chạm bo thật, thay vì chỉ đọc script rồi
# tin. Cây thật là trường hợp DIR rỗng, đi đúng những dòng cũ.
DESTDIR="${MKDDC_INSTALL_ROOT:-}"
if [ -n "$DESTDIR" ]; then
    DRY=1
    mkdir -p "$DESTDIR"
    DESTDIR="$(cd "$DESTDIR" && pwd)"
    echo "INFO: DIỄN TẬP — cài vào cây giả $DESTDIR (không chạm hệ thống thật)"
else
    DRY=0
    [ "$(id -u)" -eq 0 ] || { echo "ERROR: cần root (sudo)" >&2; exit 1; }
fi

# Cài file: bỏ -o/-g khi diễn tập (không phải root nên không chown được).
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

# systemctl chỉ tồn tại trên bo thật; diễn tập ghi lại ý định để test đọc được.
sysctl_do() {
    if [ "$DRY" -eq 1 ]; then
        printf '%s\n' "$*" >> "$DESTDIR/dry-run-systemctl.log"
        # Xem ghi chú cùng tên ở rollback.sh: truy vấn trạng thái trả "KHÔNG"
        # khi diễn tập, nếu không các nhánh `... && <lệnh thật>` sẽ chạy thật.
        case "${1:-}" in
            is-enabled|is-active|is-failed) return 1 ;;
        esac
        return 0
    fi
    systemctl "$@"
}

SBIN="$DESTDIR/usr/sbin"
WEBDIR="$DESTDIR/opt/mkddc-web"
UNITDIR="$DESTDIR/etc/systemd/system"
SHAREDIR="$DESTDIR/usr/share/mkddc"
ETCDIR="$DESTDIR/etc"
DATADIR="$DESTDIR/data"
BACKUP_ROOT="$DESTDIR/var/backups/mkddc"
LIBEXECDIR="$DESTDIR/usr/libexec/mkddc"

# Trên bo thật các thư mục hệ thống này luôn có sẵn; trong cây giả thì chưa.
# `install -d` idempotent nên khối này không đổi gì ở đường cài thật.
inst -d -m 0755 "$SBIN" "$WEBDIR" "$UNITDIR" "$SHAREDIR" "$ETCDIR" "$LIBEXECDIR"

# ADR-022 §7: không được chạm mkddc-netcfg khi còn giao dịch mạng dở dang.
# Kiểm tra TRƯỚC khi ghi bất kỳ file nào để huỷ deploy sạch, không để nửa vời.
NETCFG_JOURNAL="$DATADIR/mkddc/netcfg-transaction.json"
if [ -f "$NETCFG_JOURNAL" ] && grep -qE '"state"[[:space:]]*:[[:space:]]*"(staged|applying|awaiting_confirmation)"' "$NETCFG_JOURNAL" 2>/dev/null; then
    echo "ERROR: mkddc-netcfg còn giao dịch mạng chưa kết thúc ($NETCFG_JOURNAL)." >&2
    echo "       Huỷ deploy theo ADR-022 §7. Chờ giao dịch confirm hoặc rollback xong rồi chạy lại." >&2
    exit 1
fi
[ -x "$BUILD/iobus/mkddc-iobus" ] || { echo "ERROR: chưa build $BUILD/iobus/mkddc-iobus" >&2; exit 1; }
[ -x "$BUILD/core/mkddc-core" ]   || { echo "ERROR: chưa build $BUILD/core/mkddc-core" >&2; exit 1; }
[ -x "$BUILD/netcfg/mkddc-netcfg" ] || { echo "ERROR: chưa build $BUILD/netcfg/mkddc-netcfg" >&2; exit 1; }
# SRC-F-01: `POST /api/v1/schedules/{id}/simulate` fork binary này (xem
# apps/web-api/internal/app/schedulesimulate.go). Thiếu nó thì endpoint trả lỗi
# "không tìm thấy mkddc-schedule-sim" trên MỌI bo cài bằng script này — lỗi chỉ
# không lộ trên bo lab vì tools/deploy/deploy_board.sh có copy riêng.
[ -x "$BUILD/core/mkddc-schedule-sim" ] || { echo "ERROR: chưa build $BUILD/core/mkddc-schedule-sim" >&2; exit 1; }
[ -x "$BUILD/core/mkddc-st-compile" ] || { echo "ERROR: chưa build $BUILD/core/mkddc-st-compile" >&2; exit 1; }
# T59-605: `mkddc-st-package` là writer artifact v2 mà BE gọi ở bước Commission
# (`ProgrammingPackagerPath`, mặc định "$SBIN/mkddc-st-package)." Nó được build
# nhưng KHÔNG được cài, nên trên bo mới cài, Commission gọi vào một đường dẫn
# không tồn tại — lỗi chỉ lộ ra ở đúng thao tác cuối của người vận hành.
[ -x "$BUILD/core/mkddc-st-package" ] || { echo "ERROR: chưa build $BUILD/core/mkddc-st-package" >&2; exit 1; }
# T59-814 / ADR-053: worker mô phỏng ephemeral. Nó KHÔNG phải service — không có
# unit systemd và không auto-restart; `mkddc-web` sinh nó theo từng phiên. Thiếu
# binary thì capability SIMULATE tự TẮT (`PROGRAMMING_SIM_WORKER` trỏ vào một
# đường dẫn không tồn tại), nên bo vẫn chạy bình thường — nhưng bản phát hành
# thì phải có nó, và guard đóng gói canh đúng điều đó.
[ -x "$BUILD/core/mkddc-programming-sim-worker" ] || { echo "ERROR: chưa build $BUILD/core/mkddc-programming-sim-worker" >&2; exit 1; }
[ -x "$MKDDC_GO_BINARY_REL" ] || { echo "ERROR: chưa build $MKDDC_GO_BINARY_REL (chạy platform/packaging/build-release.sh)" >&2; exit 1; }
[ -f "$MKDDC_WEB_UI_DIST_REL/index.html" ] || { echo "ERROR: chưa build frontend $MKDDC_WEB_UI_DIST_REL" >&2; exit 1; }
[ -f build/release/provenance.json ] || { echo "ERROR: thiếu provenance.json" >&2; exit 1; }
[ -f build/release/checksums.sha256 ] || { echo "ERROR: thiếu checksums.sha256" >&2; exit 1; }
sha256sum --check build/release/checksums.sha256

# user/group service (idempotent); user mkddc thuộc dialout để mở UART
has_group() {
    if command -v getent >/dev/null 2>&1; then
        getent group "$1" >/dev/null 2>&1
    else
        grep -qE "^${1}:" /etc/group 2>/dev/null
    fi
}
has_user() {
    if command -v getent >/dev/null 2>&1; then
        getent passwd "$1" >/dev/null 2>&1
    else
        grep -qE "^${1}:" /etc/passwd 2>/dev/null
    fi
}

if [ "$DRY" -eq 0 ] && ! has_group mkddc; then
    if command -v groupadd >/dev/null 2>&1; then
        groupadd --system mkddc
    elif command -v addgroup >/dev/null 2>&1; then
        addgroup -S mkddc 2>/dev/null || addgroup mkddc
    fi
fi

if [ "$DRY" -eq 0 ] && ! has_user mkddc; then
    if command -v useradd >/dev/null 2>&1; then
        useradd --system --gid mkddc --groups dialout --no-create-home \
                --shell /usr/sbin/nologin mkddc
    elif command -v adduser >/dev/null 2>&1; then
        adduser -S -G mkddc -s /bin/false -D -H mkddc 2>/dev/null || adduser -D -G mkddc mkddc
    fi
fi

if [ "$DRY" -eq 0 ] && has_group dialout; then
    if command -v usermod >/dev/null 2>&1; then
        usermod -a -G dialout mkddc 2>/dev/null || true
    elif command -v addgroup >/dev/null 2>&1; then
        addgroup mkddc dialout 2>/dev/null || true
    fi
fi

for group in $([ "$DRY" -eq 0 ] && echo video input); do
    if has_group "$group"; then
        if command -v usermod >/dev/null 2>&1; then
            usermod -a -G "$group" mkddc 2>/dev/null || true
        elif command -v addgroup >/dev/null 2>&1; then
            addgroup mkddc "$group" 2>/dev/null || true
        fi
    fi
done

# /data/config: web ghi, service đọc (CONFIG_SCHEMA D-5)
inst -d -m 0775 -o mkddc -g mkddc "$DATADIR/config"
inst -d -m 0775 -o mkddc -g mkddc "$DATADIR/config/profiles"
# /data/mkddc: persist state.snap cho RuntimeCounter/PulseCounter (COR-010, GAP-08)
# và journal giao dịch mạng của mkddc-netcfg.
#
# PHẢI có quyền ghi cho NHÓM, không phải 0755.
#
# mkddc-netcfg chạy `User=root Group=mkddc` với
# `CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_RAW` — tức KHÔNG có CAP_DAC_OVERRIDE,
# nên root ở đây phải tuân thủ quyền DAC như người dùng thường. Thư mục thuộc
# `mkddc:mkddc` mode 0755 ⇒ root (egid mkddc) chỉ có r-x ⇒ mọi lần `stage` trả
# JOURNAL_WRITE_FAILED và toàn bộ cơ chế giao dịch mạng chết ngay ở bước đầu.
# Quan sát được trên bo Foxlinx 2026-08-08. `mkddc-time-helper` đã xin sẵn
# CAP_DAC_OVERRIDE cho đúng lớp vấn đề này; netcfg thì bị bỏ sót.
inst -d -m 0775 -o mkddc -g mkddc "$DATADIR/mkddc"
inst -d -m 0750 -o mkddc -g mkddc "$DATADIR/mkddc/programming"
inst -d -m 0750 -o mkddc -g mkddc "$DATADIR/mkddc/programming/artifacts"
inst -d -m 0700 -o mkddc -g mkddc "$DATADIR/mkddc/programming/scratch"
inst -d -m 0755 "$ETCDIR/mkddc"
[ -e "$ETCDIR/mkddc/netcfg.conf" ] || inst -m 0644 "$MKDDC_PACKAGING_SOURCE_REL/netcfg.conf" "$ETCDIR/mkddc/netcfg.conf"
[ -e "$DATADIR/config/io_config.conf" ] || inst -m 0644 -o mkddc -g mkddc "$MKDDC_PACKAGING_SOURCE_REL/io_config.conf" "$DATADIR/config/io_config.conf"
[ -e "$DATADIR/config/users.conf" ] || inst -m 0644 -o mkddc -g mkddc "$MKDDC_PACKAGING_SOURCE_REL/users.conf" "$DATADIR/config/users.conf"
if [ ! -s "$ETCDIR/mkddc-web.env" ]; then
    sec="$(head -c 32 /dev/urandom | tr -dc 'a-f0-9' | head -c 64 2>/dev/null || echo "mkddc-secret-$(date +%s)")"
    printf 'JWT_SECRET=%s\n' "$sec" > "$ETCDIR/mkddc-web.env"
    # REV-PLT-01: file này từng chỉ có JWT_SECRET, nên CORS_ORIGIN không bao giờ
    # được đặt trên bo và biên CORS/WebSocket chạy bằng allowlist của chế độ dev.
    # Nay mặc định là fail-closed (chỉ same-origin) và dòng dưới đây ghi sẵn để
    # người triển khai thấy chỗ cần sửa khi FE chạy ở origin khác.
    printf '# CORS_ORIGIN=https://ddc.toanha.local,http://192.168.1.110:8082\n' >> "$ETCDIR/mkddc-web.env"
    printf '# CORS_ALLOW_LOOPBACK=1   # CHỈ máy dev; mở mọi cổng loopback\n' >> "$ETCDIR/mkddc-web.env"
    chmod 0600 "$ETCDIR/mkddc-web.env"
    [ "$DRY" -eq 1 ] || chown root:root "$ETCDIR/mkddc-web.env"
fi

# T59-605 — Programming BẬT mặc định trong gói phát hành.
#
# BE đọc `PROGRAMMING_REV_A` qua `envTruthy` (mặc định TẮT), còn FE lấy cờ lúc
# build (`npm run build:release`). Trước đây chỉ FE được bật: bo cài xong hiện
# đủ bốn workspace Programming nhưng MỌI endpoint phía sau trả 404 — triệu chứng
# giống hệt "backend hỏng" trong khi thật ra chưa ai bật cờ. Hai nửa của cùng một
# tính năng phải bật cùng một chỗ.
#
# Dòng này đặt cả ở nhánh nâng cấp: file env đã tồn tại từ bản trước sẽ KHÔNG
# được sửa bởi khối `if` phía trên, nên nâng cấp mà thiếu bước này sẽ để bo cũ
# mãi mãi ở trạng thái FE-bật/BE-tắt.
if ! grep -q '^PROGRAMMING_REV_A=' "$ETCDIR/mkddc-web.env" 2>/dev/null; then
    printf 'PROGRAMMING_REV_A=1\n' >> "$ETCDIR/mkddc-web.env"
    echo "INFO: bật PROGRAMMING_REV_A=1 trong $ETCDIR/mkddc-web.env (T59-605)"
fi

# ADR-052 — provisioning khoá ký của THIẾT BỊ này.
#
# Artifact do bo tự biên dịch được ký bằng khoá của chính bo; khoá hãng không bao
# giờ nằm trên thiết bị. Sinh MỘT LẦN: khối `if` dưới đây bỏ qua khi khoá đã có,
# và `--gen-device-key` cũng tự từ chối ghi đè. Sinh lại khoá làm mọi artifact
# đang chạy mất hiệu lực cùng lúc, GỒM CẢ LKG — tức phá đúng đường lùi, và phá
# vào đúng lúc nâng cấp là lúc cần nó nhất.
inst -d -m 0750 -o mkddc -g mkddc "$DATADIR/mkddc/keys"
if [ ! -f "$DATADIR/mkddc/keys/device.key" ]; then
    if "$BUILD/core/mkddc-st-compile" --gen-device-key "$DATADIR/mkddc/keys" >/dev/null; then
        [ "$DRY" -eq 1 ] || chown mkddc:mkddc "$DATADIR/mkddc/keys/device.key" \
                                              "$DATADIR/mkddc/keys/device.pub"
        echo "INFO: đã sinh khoá ký thiết bị tại $DATADIR/mkddc/keys (ADR-052)"
    else
        echo "ERROR: không sinh được khoá thiết bị — Programming sẽ không ký được artifact" >&2
        exit 1
    fi
else
    echo "INFO: khoá thiết bị đã có, giữ nguyên (sinh lại sẽ vô hiệu hoá cả LKG)"
fi

# Chụp bản đang cài trước khi ghi đè, để rollback là thao tác có quy trình thay vì
# ứng biến. Trước đây không có bước này nên /usr/sbin tích tụ các bản sao tay kiểu
# mkddc-core.bak-*/.prev-*, và rollback phụ thuộc trí nhớ người trực.
if [ -x "$SBIN/mkddc-core" ]; then
    prev_ver=unknown
    [ -f "$SHAREDIR/provenance.json" ] && \
        prev_ver="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
                    "$SHAREDIR/provenance.json" | head -1)"
    [ -n "$prev_ver" ] || prev_ver=unknown
    SNAP="$BACKUP_ROOT/${prev_ver}-$(date +%Y%m%d-%H%M%S)"
    inst -d -m 0755 "$SNAP"
    for f in "$SBIN/mkddc-core" "$SBIN/mkddc-iobus" "$SBIN/mkddc-netcfg" \
             "$SBIN/mkddc-st-compile" "$SBIN/mkddc-st-package" \
             "$SBIN/mkddc-fake-mcu" "$SBIN/mkddc-hmi" "$WEBDIR/mkddc-web" \
             "$WEBDIR/mkddc-schedule-sim" "$WEBDIR/mkddc-programming-sim-worker" \
             "$SHAREDIR/provenance.json" "$SHAREDIR/checksums.sha256"; do
        [ -e "$f" ] && cp -a "$f" "$SNAP/" || true
    done
    # F-P59-ROLLBACK-DB-001 — CHỤP CẢ STORE PROGRAMMING, không chỉ binary.
    #
    # BE tự chạy migration khi khởi động và **từ chối chạy** nếu schema mới hơn
    # binary ("schema Programming mới hơn binary: version N"). Vì vậy rollback
    # chỉ-binary sau một bản có migration làm mkddc-web crash-loop và web tier
    # chết hẳn — đo thật trên bo Foxlinx 2026-08-24: sau khi hạ binary về bản
    # trước migration `0012`, service restart 7 lần rồi bỏ cuộc, `/api/v1/health`
    # từ chối kết nối. Không có bản chụp DB thì đường quay lại không tồn tại.
    #
    # Chụp cả `-wal`/`-shm`: bỏ hai file đó có thể khôi phục một DB thiếu đúng
    # phần giao dịch cuối, và hỏng theo kiểu im lặng.
    for db in "$DATADIR/config/programming/programming-v1.sqlite" \
              "$DATADIR/config/programming/programming-v1.sqlite-wal" \
              "$DATADIR/config/programming/programming-v1.sqlite-shm"; do
        [ -e "$db" ] && cp -a "$db" "$SNAP/" || true
    done
    ln -sfn "$SNAP" "$BACKUP_ROOT/previous"
    echo "INFO: đã chụp bản đang chạy ($prev_ver) vào $SNAP"
fi

# Cài đặt shared libraries phụ trợ (nếu có trong gói release)
if [ -d build/release/lib ]; then
    inst -d -m 0755 "$DESTDIR/usr/lib"
    cp -a build/release/lib/* "$DESTDIR/usr/lib/" 2>/dev/null || true
fi

inst -m 0755 "$BUILD/iobus/mkddc-iobus" "$SBIN/mkddc-iobus"
inst -m 0755 "$BUILD/core/mkddc-core"   "$SBIN/mkddc-core"
inst -m 0755 "$BUILD/netcfg/mkddc-netcfg" "$SBIN/mkddc-netcfg"
inst -m 0755 "$BUILD/core/mkddc-st-compile" "$SBIN/mkddc-st-compile"
inst -m 0755 "$BUILD/core/mkddc-st-package" "$SBIN/mkddc-st-package"
# SRC-F-01: đặt cạnh mkddc-web, KHÔNG vào /usr/sbin. `scheduleSimBinary()` dò
# theo thứ tự env → PATH → thư mục chứa chính nó; service chạy `User=mkddc` với
# PATH systemd mặc định (không có /usr/sbin), nên chỉ nhánh "cạnh binary" là
# chắc chắn tìm thấy.
inst -d -m 0755 "$WEBDIR"
inst -m 0755 "$BUILD/core/mkddc-schedule-sim" "$WEBDIR/mkddc-schedule-sim"
# T59-814: đặt CẠNH mkddc-web như mkddc-schedule-sim, không vào /usr/sbin.
# `mkddc-web` chạy `User=mkddc` với PATH systemd mặc định (không có /usr/sbin),
# và supervisor gọi bằng đường dẫn tuyệt đối lấy từ `PROGRAMMING_SIM_WORKER`.
inst -m 0755 "$BUILD/core/mkddc-programming-sim-worker" "$WEBDIR/mkddc-programming-sim-worker"
inst -m 0755 "$MKDDC_GO_BINARY_REL" "$WEBDIR/mkddc-web"
inst -d -m 0755 "$WEBDIR/dist"
cp -a "$MKDDC_WEB_UI_DIST_REL/." "$WEBDIR/dist/"
inst -m 0644 "$MKDDC_SYSTEMD_SOURCE_REL/mkddc-iobus.service" "$UNITDIR/"
inst -m 0644 "$MKDDC_SYSTEMD_SOURCE_REL/mkddc-core.service"  "$UNITDIR/"
inst -m 0644 "$MKDDC_SYSTEMD_SOURCE_REL/mkddc-netcfg.service" "$UNITDIR/"
inst -m 0644 "$MKDDC_SYSTEMD_SOURCE_REL/mkddc-web-pi.service" "$UNITDIR/"
# ADR-061 4.11: irqbalance không đặt IRQ lên CPU3 (CPU riêng của mkddc-core).
inst -d -m 0755 "$UNITDIR/irqbalance.service.d"
inst -m 0644 "$MKDDC_SYSTEMD_SOURCE_REL/irqbalance-mkddc-rt.conf" "$UNITDIR/irqbalance.service.d/mkddc-rt.conf"
# ADR-061 4.11: PID 1 và mọi tiến trình khác mặc định chạy CPU0–2; CPU3 chỉ
# dành cho mkddc-core (unit tự khai CPUAffinity=3). Hiệu lực từ lần boot kế.
inst -d -m 0755 "$DESTDIR/etc/systemd/system.conf.d"
inst -m 0644 "$MKDDC_SYSTEMD_SOURCE_REL/system-mkddc-rt.conf" "$DESTDIR/etc/systemd/system.conf.d/mkddc-rt.conf"
# Hai helper đặc quyền — BỎ SÓT cho tới 2026-09-13.
#
# `mkddc-web` chạy `User=mkddc` với `NoNewPrivileges=true`, nên nó KHÔNG tự
# restart service và KHÔNG tự ghi cấu hình chrony được. Hai việc đó đi qua hai
# subcommand của chính binary này, chạy root dưới systemd và phục vụ trên unix
# socket trong /run/mkddc — xem reloadhelper_linux.go và timehelper_linux.go.
#
# Trước bản vá này script cài mọi unit khác nhưng KHÔNG cài hai unit helper, nên
# trên bo không bao giờ có `/run/mkddc/reload-helper.sock` và
# `/run/mkddc/time-helper.sock`. Hậu quả quan sát được trên Foxlinx 2026-09-12:
# lưu cấu hình BACnet/fieldbus hay đổi nguồn NTP đều GHI ĐƯỢC file mà không bao
# giờ có hiệu lực — đúng lớp triệu chứng của finding F-01 mà reload helper sinh
# ra để đóng. Không có tín hiệu nào ở tầng systemd vì unit không tồn tại thì
# cũng không có gì để `failed`.
inst -m 0644 "$MKDDC_SYSTEMD_SOURCE_REL/mkddc-reload-helper.service" "$UNITDIR/"
inst -m 0644 "$MKDDC_SYSTEMD_SOURCE_REL/mkddc-time-helper.service" "$UNITDIR/"
# `mkddc-time-helper` có `ProtectSystem=strict` + `ReadWritePaths=/etc/chrony/sources.d`.
# systemd dựng mount namespace TRƯỚC khi chạy ExecStart, nên ReadWritePaths trỏ
# vào thư mục chưa tồn tại làm unit chết ngay ở bước setup — helper tự MkdirAll
# cũng không cứu được vì nó chưa kịp chạy. Tạo sẵn ở đây.
inst -d -m 0755 "$ETCDIR/chrony"
inst -d -m 0755 "$ETCDIR/chrony/sources.d"
inst -d -m 0755 "$LIBEXECDIR" "$SHAREDIR/avahi"
inst -m 0644 build/release/provenance.json "$SHAREDIR/provenance.json"
inst -m 0644 build/release/checksums.sha256 "$SHAREDIR/checksums.sha256"
{
    "$SBIN/mkddc-core" --version
    "$SBIN/mkddc-iobus" --version
    "$SBIN/mkddc-netcfg" --version
    "$SBIN/mkddc-st-compile" --version
    "$SBIN/mkddc-st-package" --version
    "$WEBDIR/mkddc-programming-sim-worker" --version
    "$WEBDIR/mkddc-web" --version
} > "$SHAREDIR/runtime-build-info.txt"
sha256sum "$SBIN/mkddc-core" "$SBIN/mkddc-iobus" "$SBIN/mkddc-netcfg" \
    "$SBIN/mkddc-st-compile" "$SBIN/mkddc-st-package" \
    "$WEBDIR/mkddc-web" "$WEBDIR/mkddc-schedule-sim" \
    "$WEBDIR/mkddc-programming-sim-worker" \
    > "$SHAREDIR/runtime-checksums.sha256"
inst -m 0755 "$MKDDC_PACKAGING_SOURCE_REL/configure-web-hostname.sh" "$LIBEXECDIR/configure-web-hostname"
inst -m 0644 "$MKDDC_PACKAGING_SOURCE_REL/avahi/mkddc-web.service" "$SHAREDIR/avahi/mkddc-web.service"
if [ -e "$UNITDIR/mkddc-web-pi.service" ]; then
    inst -d -m 0755 "$UNITDIR/mkddc-web-pi.service.d"
    inst -m 0644 "$MKDDC_SYSTEMD_SOURCE_REL/mkddc-web-pi-netcfg.conf" \
        "$UNITDIR/mkddc-web-pi.service.d/netcfg.conf"
fi

# fake MCU chỉ dành cho board lab/no-MCU. Cài khi được yêu cầu tường minh, hoặc
# khi unit đã có sẵn trên máy (tức board này vốn đang chạy cấu hình lab). Không
# bao giờ tự đưa fake MCU lên board có MCU thật.
FAKE_MCU_INSTALLED=0
if [ -x "$BUILD/iobus/fake_mcu" ] && \
   { [ "$WITH_FAKE_MCU" -eq 1 ] || [ -e "$UNITDIR/mkddc-fakemcu.service" ]; }; then
    inst -m 0755 "$BUILD/iobus/fake_mcu" "$SBIN/mkddc-fake-mcu"
    inst -m 0644 "$MKDDC_SYSTEMD_SOURCE_REL/mkddc-fakemcu.service" "$UNITDIR/"
    inst -m 0644 "$MKDDC_SYSTEMD_SOURCE_REL/mkddc-pty.service" "$UNITDIR/"
    FAKE_MCU_INSTALLED=1
fi

HMI_INSTALLED=0
# Giữ nguyên trạng thái enable/disable sẵn có của HMI. Trước đây script bật HMI
# chỉ vì binary tồn tại, làm board không có panel rơi vào vòng lặp restart
# (`HMI DRM no connected connector`).
HMI_WAS_ENABLED=0
sysctl_do is-enabled mkddc-hmi >/dev/null 2>&1 && HMI_WAS_ENABLED=1
if [ -x "$BUILD/hmi/mkddc-hmi" ]; then
    inst -m 0755 "$BUILD/hmi/mkddc-hmi" "$SBIN/mkddc-hmi"
    inst -m 0644 "$MKDDC_SYSTEMD_SOURCE_REL/mkddc-hmi.service" "$UNITDIR/"
    inst -d -m 0755 "$SHAREDIR"
    [ -e "$ETCDIR/mkddc/hmi.conf" ] || inst -m 0640 -o root -g mkddc "$MKDDC_HMI_SOURCE_REL/packaging/hmi.conf" "$ETCDIR/mkddc/hmi.conf"
    [ -e "$DATADIR/config/point_db.json" ] || inst -m 0640 -o mkddc -g mkddc "$MKDDC_HMI_SOURCE_REL/packaging/point_db.example.json" "$DATADIR/config/point_db.json"
    HMI_INSTALLED=1
fi

sysctl_do daemon-reload
if [ "$ENABLE" -eq 1 ]; then
    sysctl_do enable mkddc-iobus mkddc-core mkddc-netcfg mkddc-web-pi >/dev/null
    # Hai helper phải chạy TRƯỚC mkddc-web-pi (cả hai unit đã khai
    # `Before=mkddc-web-pi.service`); enable ở đây để chúng có mặt sau mỗi lần boot.
    sysctl_do enable mkddc-reload-helper mkddc-time-helper >/dev/null
    if [ "$FAKE_MCU_INSTALLED" -eq 1 ]; then
        if command -v socat >/dev/null 2>&1; then
            sysctl_do enable mkddc-pty >/dev/null 2>&1 || true
            sysctl_do restart mkddc-pty >/dev/null 2>&1 || true
        fi
        sysctl_do enable mkddc-fakemcu >/dev/null 2>&1 || true
        sysctl_do restart mkddc-fakemcu
    fi
    # Helper phải sống lại TRƯỚC web: web nối tới socket của chúng lúc xử lý
    # request, nhưng khởi động lại theo đúng thứ tự này giữ cho lần lưu cấu hình
    # đầu tiên sau khi cài không rơi vào khoảng trống không có socket.
    sysctl_do restart mkddc-reload-helper
    sysctl_do restart mkddc-time-helper
    sysctl_do restart mkddc-iobus
    sysctl_do restart mkddc-core
    sysctl_do restart mkddc-web-pi

    # netcfg đã qua kiểm tra journal ở đầu script nên restart được an toàn.
    sysctl_do restart mkddc-netcfg

    if [ "$HMI_INSTALLED" -eq 1 ]; then
        if [ "$HMI_WAS_ENABLED" -eq 1 ]; then
            sysctl_do restart mkddc-hmi
        else
            echo "INFO: mkddc-hmi đã cài nhưng giữ nguyên trạng thái disabled."
            echo "      Bật thủ công khi board có panel: systemctl enable --now mkddc-hmi"
        fi
    fi

    # Xác minh tiến trình thực sự chạy binary mới, không còn giữ inode đã xoá.
    stale=0
    for unit in mkddc-iobus mkddc-core mkddc-netcfg mkddc-web-pi; do
        pid="$(sysctl_do show "$unit" -p MainPID --value)"
        [ -n "$pid" ] && [ "$pid" != "0" ] || continue
        if readlink "/proc/$pid/exe" 2>/dev/null | grep -q '(deleted)'; then
            echo "ERROR: $unit (pid $pid) vẫn chạy binary cũ đã bị thay." >&2
            stale=1
        fi
    done
    [ "$stale" -eq 0 ] || { echo "ERROR: install chưa hoàn tất — có service chạy code cũ." >&2; exit 1; }

    sysctl_do --no-pager status mkddc-iobus mkddc-core mkddc-netcfg mkddc-web-pi || true
else
    echo "OK: đã install, chưa enable (chạy: systemctl enable --now mkddc-iobus mkddc-core mkddc-netcfg mkddc-web-pi)"
fi
