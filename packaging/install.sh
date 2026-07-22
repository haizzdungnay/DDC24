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
[ -x "$BUILD/netcfg/mkddc-netcfg" ] || { echo "ERROR: chưa build $BUILD/netcfg/mkddc-netcfg" >&2; exit 1; }

# user/group service (idempotent); user mkddc thuộc dialout để mở UART
getent group mkddc >/dev/null || groupadd --system mkddc
getent passwd mkddc >/dev/null || \
    useradd --system --gid mkddc --groups dialout --no-create-home \
            --shell /usr/sbin/nologin mkddc
for group in video input; do
    getent group "$group" >/dev/null && usermod -a -G "$group" mkddc
done

# /data/config: web ghi, service đọc (CONFIG_SCHEMA D-5)
install -d -m 0775 -o mkddc -g mkddc /data/config
# /data/mkddc: persist state.snap cho RuntimeCounter/PulseCounter (COR-010, GAP-08)
install -d -m 0755 -o mkddc -g mkddc /data/mkddc
install -d -m 0755 /etc/mkddc
[ -e /etc/mkddc/netcfg.conf ] || install -m 0644 packaging/netcfg.conf /etc/mkddc/netcfg.conf

install -m 0755 "$BUILD/iobus/mkddc-iobus" /usr/sbin/mkddc-iobus
install -m 0755 "$BUILD/core/mkddc-core"   /usr/sbin/mkddc-core
install -m 0755 "$BUILD/netcfg/mkddc-netcfg" /usr/sbin/mkddc-netcfg
install -m 0644 packaging/systemd/mkddc-iobus.service /etc/systemd/system/
install -m 0644 packaging/systemd/mkddc-core.service  /etc/systemd/system/
install -m 0644 packaging/systemd/mkddc-netcfg.service /etc/systemd/system/
if [ -e /etc/systemd/system/mkddc-web-pi.service ]; then
    install -d -m 0755 /etc/systemd/system/mkddc-web-pi.service.d
    install -m 0644 packaging/systemd/mkddc-web-pi-netcfg.conf \
        /etc/systemd/system/mkddc-web-pi.service.d/netcfg.conf
fi

HMI_INSTALLED=0
if [ -x "$BUILD/hmi/mkddc-hmi" ]; then
    install -m 0755 "$BUILD/hmi/mkddc-hmi" /usr/sbin/mkddc-hmi
    install -m 0644 services/hmi/packaging/mkddc-hmi.service /etc/systemd/system/
    install -d -m 0755 /usr/share/mkddc
    [ -e /etc/mkddc/hmi.conf ] || install -m 0640 -o root -g mkddc services/hmi/packaging/hmi.conf /etc/mkddc/hmi.conf
    [ -e /data/config/point_db.json ] || install -m 0640 -o mkddc -g mkddc services/hmi/packaging/point_db.example.json /data/config/point_db.json
    HMI_INSTALLED=1
fi

systemctl daemon-reload
if [ "$ENABLE" -eq 1 ]; then
    systemctl enable --now mkddc-iobus mkddc-core mkddc-netcfg
    [ "$HMI_INSTALLED" -eq 0 ] || systemctl enable --now mkddc-hmi
    systemctl --no-pager status mkddc-iobus mkddc-core mkddc-netcfg || true
else
    echo "OK: đã install, chưa enable (chạy: systemctl enable --now mkddc-iobus mkddc-core mkddc-netcfg)"
fi
