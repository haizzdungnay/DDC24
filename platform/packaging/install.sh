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

[ "$(id -u)" -eq 0 ] || { echo "ERROR: cần root (sudo)" >&2; exit 1; }

# ADR-022 §7: không được chạm mkddc-netcfg khi còn giao dịch mạng dở dang.
# Kiểm tra TRƯỚC khi ghi bất kỳ file nào để huỷ deploy sạch, không để nửa vời.
NETCFG_JOURNAL=/data/mkddc/netcfg-transaction.json
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
# (`ProgrammingPackagerPath`, mặc định /usr/sbin/mkddc-st-package). Nó được build
# nhưng KHÔNG được cài, nên trên bo mới cài, Commission gọi vào một đường dẫn
# không tồn tại — lỗi chỉ lộ ra ở đúng thao tác cuối của người vận hành.
[ -x "$BUILD/core/mkddc-st-package" ] || { echo "ERROR: chưa build $BUILD/core/mkddc-st-package" >&2; exit 1; }
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

if ! has_group mkddc; then
    if command -v groupadd >/dev/null 2>&1; then
        groupadd --system mkddc
    elif command -v addgroup >/dev/null 2>&1; then
        addgroup -S mkddc 2>/dev/null || addgroup mkddc
    fi
fi

if ! has_user mkddc; then
    if command -v useradd >/dev/null 2>&1; then
        useradd --system --gid mkddc --groups dialout --no-create-home \
                --shell /usr/sbin/nologin mkddc
    elif command -v adduser >/dev/null 2>&1; then
        adduser -S -G mkddc -s /bin/false -D -H mkddc 2>/dev/null || adduser -D -G mkddc mkddc
    fi
fi

if has_group dialout; then
    if command -v usermod >/dev/null 2>&1; then
        usermod -a -G dialout mkddc 2>/dev/null || true
    elif command -v addgroup >/dev/null 2>&1; then
        addgroup mkddc dialout 2>/dev/null || true
    fi
fi

for group in video input; do
    if has_group "$group"; then
        if command -v usermod >/dev/null 2>&1; then
            usermod -a -G "$group" mkddc 2>/dev/null || true
        elif command -v addgroup >/dev/null 2>&1; then
            addgroup mkddc "$group" 2>/dev/null || true
        fi
    fi
done

# /data/config: web ghi, service đọc (CONFIG_SCHEMA D-5)
install -d -m 0775 -o mkddc -g mkddc /data/config
install -d -m 0775 -o mkddc -g mkddc /data/config/profiles
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
install -d -m 0775 -o mkddc -g mkddc /data/mkddc
install -d -m 0750 -o mkddc -g mkddc /data/mkddc/programming
install -d -m 0750 -o mkddc -g mkddc /data/mkddc/programming/artifacts
install -d -m 0700 -o mkddc -g mkddc /data/mkddc/programming/scratch
install -d -m 0755 /etc/mkddc
[ -e /etc/mkddc/netcfg.conf ] || install -m 0644 "$MKDDC_PACKAGING_SOURCE_REL/netcfg.conf" /etc/mkddc/netcfg.conf
[ -e /data/config/io_config.conf ] || install -m 0644 -o mkddc -g mkddc "$MKDDC_PACKAGING_SOURCE_REL/io_config.conf" /data/config/io_config.conf
[ -e /data/config/users.conf ] || install -m 0644 -o mkddc -g mkddc "$MKDDC_PACKAGING_SOURCE_REL/users.conf" /data/config/users.conf
if [ ! -s /etc/mkddc-web.env ]; then
    sec="$(head -c 32 /dev/urandom | tr -dc 'a-f0-9' | head -c 64 2>/dev/null || echo "mkddc-secret-$(date +%s)")"
    printf 'JWT_SECRET=%s\n' "$sec" > /etc/mkddc-web.env
    # REV-PLT-01: file này từng chỉ có JWT_SECRET, nên CORS_ORIGIN không bao giờ
    # được đặt trên bo và biên CORS/WebSocket chạy bằng allowlist của chế độ dev.
    # Nay mặc định là fail-closed (chỉ same-origin) và dòng dưới đây ghi sẵn để
    # người triển khai thấy chỗ cần sửa khi FE chạy ở origin khác.
    printf '# CORS_ORIGIN=https://ddc.toanha.local,http://192.168.1.110:8082\n' >> /etc/mkddc-web.env
    printf '# CORS_ALLOW_LOOPBACK=1   # CHỈ máy dev; mở mọi cổng loopback\n' >> /etc/mkddc-web.env
    chmod 0600 /etc/mkddc-web.env
    chown root:root /etc/mkddc-web.env
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
if ! grep -q '^PROGRAMMING_REV_A=' /etc/mkddc-web.env 2>/dev/null; then
    printf 'PROGRAMMING_REV_A=1\n' >> /etc/mkddc-web.env
    echo "INFO: bật PROGRAMMING_REV_A=1 trong /etc/mkddc-web.env (T59-605)"
fi

# Chụp bản đang cài trước khi ghi đè, để rollback là thao tác có quy trình thay vì
# ứng biến. Trước đây không có bước này nên /usr/sbin tích tụ các bản sao tay kiểu
# mkddc-core.bak-*/.prev-*, và rollback phụ thuộc trí nhớ người trực.
if [ -x /usr/sbin/mkddc-core ]; then
    prev_ver=unknown
    [ -f /usr/share/mkddc/provenance.json ] && \
        prev_ver="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
                    /usr/share/mkddc/provenance.json | head -1)"
    [ -n "$prev_ver" ] || prev_ver=unknown
    SNAP="/var/backups/mkddc/${prev_ver}-$(date +%Y%m%d-%H%M%S)"
    install -d -m 0755 "$SNAP"
    for f in /usr/sbin/mkddc-core /usr/sbin/mkddc-iobus /usr/sbin/mkddc-netcfg \
             /usr/sbin/mkddc-st-compile /usr/sbin/mkddc-st-package \
             /usr/sbin/mkddc-fake-mcu /usr/sbin/mkddc-hmi /opt/mkddc-web/mkddc-web \
             /opt/mkddc-web/mkddc-schedule-sim \
             /usr/share/mkddc/provenance.json /usr/share/mkddc/checksums.sha256; do
        [ -e "$f" ] && cp -a "$f" "$SNAP/" || true
    done
    ln -sfn "$SNAP" /var/backups/mkddc/previous
    echo "INFO: đã chụp bản đang chạy ($prev_ver) vào $SNAP"
fi

# Cài đặt shared libraries phụ trợ (nếu có trong gói release)
if [ -d build/release/lib ]; then
    cp -a build/release/lib/* /usr/lib/ 2>/dev/null || true
fi

install -m 0755 "$BUILD/iobus/mkddc-iobus" /usr/sbin/mkddc-iobus
install -m 0755 "$BUILD/core/mkddc-core"   /usr/sbin/mkddc-core
install -m 0755 "$BUILD/netcfg/mkddc-netcfg" /usr/sbin/mkddc-netcfg
install -m 0755 "$BUILD/core/mkddc-st-compile" /usr/sbin/mkddc-st-compile
install -m 0755 "$BUILD/core/mkddc-st-package" /usr/sbin/mkddc-st-package
# SRC-F-01: đặt cạnh mkddc-web, KHÔNG vào /usr/sbin. `scheduleSimBinary()` dò
# theo thứ tự env → PATH → thư mục chứa chính nó; service chạy `User=mkddc` với
# PATH systemd mặc định (không có /usr/sbin), nên chỉ nhánh "cạnh binary" là
# chắc chắn tìm thấy.
install -d -m 0755 /opt/mkddc-web
install -m 0755 "$BUILD/core/mkddc-schedule-sim" /opt/mkddc-web/mkddc-schedule-sim
install -m 0755 "$MKDDC_GO_BINARY_REL" /opt/mkddc-web/mkddc-web
install -d -m 0755 /opt/mkddc-web/dist
cp -a "$MKDDC_WEB_UI_DIST_REL/." /opt/mkddc-web/dist/
install -m 0644 "$MKDDC_SYSTEMD_SOURCE_REL/mkddc-iobus.service" /etc/systemd/system/
install -m 0644 "$MKDDC_SYSTEMD_SOURCE_REL/mkddc-core.service"  /etc/systemd/system/
install -m 0644 "$MKDDC_SYSTEMD_SOURCE_REL/mkddc-netcfg.service" /etc/systemd/system/
install -m 0644 "$MKDDC_SYSTEMD_SOURCE_REL/mkddc-web-pi.service" /etc/systemd/system/
install -d -m 0755 /usr/libexec/mkddc /usr/share/mkddc/avahi
install -m 0644 build/release/provenance.json /usr/share/mkddc/provenance.json
install -m 0644 build/release/checksums.sha256 /usr/share/mkddc/checksums.sha256
{
    /usr/sbin/mkddc-core --version
    /usr/sbin/mkddc-iobus --version
    /usr/sbin/mkddc-netcfg --version
    /usr/sbin/mkddc-st-compile --version
    /usr/sbin/mkddc-st-package --version
    /opt/mkddc-web/mkddc-web --version
} > /usr/share/mkddc/runtime-build-info.txt
sha256sum /usr/sbin/mkddc-core /usr/sbin/mkddc-iobus /usr/sbin/mkddc-netcfg \
    /usr/sbin/mkddc-st-compile /usr/sbin/mkddc-st-package \
    /opt/mkddc-web/mkddc-web /opt/mkddc-web/mkddc-schedule-sim \
    > /usr/share/mkddc/runtime-checksums.sha256
install -m 0755 "$MKDDC_PACKAGING_SOURCE_REL/configure-web-hostname.sh" /usr/libexec/mkddc/configure-web-hostname
install -m 0644 "$MKDDC_PACKAGING_SOURCE_REL/avahi/mkddc-web.service" /usr/share/mkddc/avahi/mkddc-web.service
if [ -e /etc/systemd/system/mkddc-web-pi.service ]; then
    install -d -m 0755 /etc/systemd/system/mkddc-web-pi.service.d
    install -m 0644 "$MKDDC_SYSTEMD_SOURCE_REL/mkddc-web-pi-netcfg.conf" \
        /etc/systemd/system/mkddc-web-pi.service.d/netcfg.conf
fi

# fake MCU chỉ dành cho board lab/no-MCU. Cài khi được yêu cầu tường minh, hoặc
# khi unit đã có sẵn trên máy (tức board này vốn đang chạy cấu hình lab). Không
# bao giờ tự đưa fake MCU lên board có MCU thật.
FAKE_MCU_INSTALLED=0
if [ -x "$BUILD/iobus/fake_mcu" ] && \
   { [ "$WITH_FAKE_MCU" -eq 1 ] || [ -e /etc/systemd/system/mkddc-fakemcu.service ]; }; then
    install -m 0755 "$BUILD/iobus/fake_mcu" /usr/sbin/mkddc-fake-mcu
    install -m 0644 "$MKDDC_SYSTEMD_SOURCE_REL/mkddc-fakemcu.service" /etc/systemd/system/
    install -m 0644 "$MKDDC_SYSTEMD_SOURCE_REL/mkddc-pty.service" /etc/systemd/system/
    FAKE_MCU_INSTALLED=1
fi

HMI_INSTALLED=0
# Giữ nguyên trạng thái enable/disable sẵn có của HMI. Trước đây script bật HMI
# chỉ vì binary tồn tại, làm board không có panel rơi vào vòng lặp restart
# (`HMI DRM no connected connector`).
HMI_WAS_ENABLED=0
systemctl is-enabled mkddc-hmi >/dev/null 2>&1 && HMI_WAS_ENABLED=1
if [ -x "$BUILD/hmi/mkddc-hmi" ]; then
    install -m 0755 "$BUILD/hmi/mkddc-hmi" /usr/sbin/mkddc-hmi
    install -m 0644 "$MKDDC_SYSTEMD_SOURCE_REL/mkddc-hmi.service" /etc/systemd/system/
    install -d -m 0755 /usr/share/mkddc
    [ -e /etc/mkddc/hmi.conf ] || install -m 0640 -o root -g mkddc "$MKDDC_HMI_SOURCE_REL/packaging/hmi.conf" /etc/mkddc/hmi.conf
    [ -e /data/config/point_db.json ] || install -m 0640 -o mkddc -g mkddc "$MKDDC_HMI_SOURCE_REL/packaging/point_db.example.json" /data/config/point_db.json
    HMI_INSTALLED=1
fi

systemctl daemon-reload
if [ "$ENABLE" -eq 1 ]; then
    systemctl enable mkddc-iobus mkddc-core mkddc-netcfg mkddc-web-pi >/dev/null
    if [ "$FAKE_MCU_INSTALLED" -eq 1 ]; then
        if command -v socat >/dev/null 2>&1; then
            systemctl enable mkddc-pty >/dev/null 2>&1 || true
            systemctl restart mkddc-pty >/dev/null 2>&1 || true
        fi
        systemctl enable mkddc-fakemcu >/dev/null 2>&1 || true
        systemctl restart mkddc-fakemcu
    fi
    systemctl restart mkddc-iobus
    systemctl restart mkddc-core
    systemctl restart mkddc-web-pi

    # netcfg đã qua kiểm tra journal ở đầu script nên restart được an toàn.
    systemctl restart mkddc-netcfg

    if [ "$HMI_INSTALLED" -eq 1 ]; then
        if [ "$HMI_WAS_ENABLED" -eq 1 ]; then
            systemctl restart mkddc-hmi
        else
            echo "INFO: mkddc-hmi đã cài nhưng giữ nguyên trạng thái disabled."
            echo "      Bật thủ công khi board có panel: systemctl enable --now mkddc-hmi"
        fi
    fi

    # Xác minh tiến trình thực sự chạy binary mới, không còn giữ inode đã xoá.
    stale=0
    for unit in mkddc-iobus mkddc-core mkddc-netcfg mkddc-web-pi; do
        pid="$(systemctl show "$unit" -p MainPID --value)"
        [ -n "$pid" ] && [ "$pid" != "0" ] || continue
        if readlink "/proc/$pid/exe" 2>/dev/null | grep -q '(deleted)'; then
            echo "ERROR: $unit (pid $pid) vẫn chạy binary cũ đã bị thay." >&2
            stale=1
        fi
    done
    [ "$stale" -eq 0 ] || { echo "ERROR: install chưa hoàn tất — có service chạy code cũ." >&2; exit 1; }

    systemctl --no-pager status mkddc-iobus mkddc-core mkddc-netcfg mkddc-web-pi || true
else
    echo "OK: đã install, chưa enable (chạy: systemctl enable --now mkddc-iobus mkddc-core mkddc-netcfg mkddc-web-pi)"
fi
