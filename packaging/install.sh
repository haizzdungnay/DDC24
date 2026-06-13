#!/usr/bin/env bash
# Install MK-DDC-24 SOM services lên board (06 §10 / 07 §9 — SKEL-005).
# Chạy từ root repo SAU khi build:
#   cmake -S services -B build/services -DCMAKE_BUILD_TYPE=Release
#   cmake --build build/services -j
#   sudo packaging/install.sh [--no-enable]
set -eu
cd "$(dirname "$0")/.."

BUILD=build/services
ENABLE=1
[ "${1:-}" = "--no-enable" ] && ENABLE=0

[ "$(id -u)" -eq 0 ] || { echo "ERROR: cần root (sudo)" >&2; exit 1; }
[ -x "$BUILD/iobus/mkddc-iobus" ] || { echo "ERROR: chưa build $BUILD/iobus/mkddc-iobus" >&2; exit 1; }
[ -x "$BUILD/core/mkddc-core" ]   || { echo "ERROR: chưa build $BUILD/core/mkddc-core" >&2; exit 1; }

# user/group service (idempotent); user mkddc thuộc dialout để mở UART
getent group mkddc >/dev/null || groupadd --system mkddc
getent passwd mkddc >/dev/null || \
    useradd --system --gid mkddc --groups dialout --no-create-home \
            --shell /usr/sbin/nologin mkddc

# /data/config: web ghi, service đọc (CONFIG_SCHEMA D-5)
install -d -m 0775 -o mkddc -g mkddc /data/config
# /data/mkddc: persist state.snap cho RuntimeCounter/PulseCounter (COR-010, GAP-08)
install -d -m 0755 -o mkddc -g mkddc /data/mkddc

install -m 0755 "$BUILD/iobus/mkddc-iobus" /usr/sbin/mkddc-iobus
install -m 0755 "$BUILD/core/mkddc-core"   /usr/sbin/mkddc-core
install -m 0644 packaging/systemd/mkddc-iobus.service /etc/systemd/system/
install -m 0644 packaging/systemd/mkddc-core.service  /etc/systemd/system/

systemctl daemon-reload
if [ "$ENABLE" -eq 1 ]; then
    systemctl enable --now mkddc-iobus mkddc-core
    systemctl --no-pager status mkddc-iobus mkddc-core || true
else
    echo "OK: đã install, chưa enable (chạy: systemctl enable --now mkddc-iobus mkddc-core)"
fi
