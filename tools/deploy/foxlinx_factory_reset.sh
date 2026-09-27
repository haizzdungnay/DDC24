#!/bin/bash
# Cài sạch bo lab Foxlinx như mới xuất xưởng — dùng thật lần đầu 2026-09-27
# (hồ sơ docs/07_records/test-evidence/fw-som/2026-09-27-foxlinx-factory-reset.md,
# quy trình ở DEPLOY_FOXLINX.md mục "Cài sạch bo lab").
#
# Chạy TRÊN bo, từng pha: stop | wipe | install. Pha sau chỉ chạy khi pha trước đạt,
# và CHỈ sau khi đã sao lưu toàn bộ bo về máy khác (wipe không hoàn tác được).
# Gói cài (install.sh + build/release/...) phải nằm sẵn ở $STAGE.
#
# Lỗi đã biết khi chạy trên main@05182713: install.sh sinh JWT_SECRET chỉ vài ký tự,
# web lặp restart với "cursor secret >=16 byte". Xem hồ sơ, mục F-FR-04.
#
# GIỮ: cấu hình thiết bị Modbus (fieldbus.conf/.lkg.json/.journal, profiles/*.json);
# mạng (/etc/mkddc/netcfg.conf, journal netcfg); SSH + khoá; ba unit bảo mật sau sự cố
# (ssh-guard, incident-ipblock, port-redirect); cấu hình lab không MCU (fake MCU, drop-in
# nomcu.conf và pidfile.conf của iobus — pidfile.conf gỡ khi PR #783 lên bo).
# XOÁ: mọi binary/unit/dữ liệu ứng dụng còn lại, sao lưu cũ, rác thử nghiệm, journal.
set -euo pipefail
STAGE=/var/tmp/mkddc-release
phase="${1:-}"

stop_units() {
    for u in mkddc-web-pi mkddc-reload-helper mkddc-time-helper mkddc-core mkddc-iobus \
             mkddc-fakemcu mkddc-pty mkddc-hmi; do
        systemctl stop "$u" 2>/dev/null || true
    done
    for u in mkddc-web-pi mkddc-reload-helper mkddc-time-helper mkddc-core mkddc-iobus \
             mkddc-fakemcu mkddc-pty mkddc-hmi; do
        printf '%s=%s\n' "$u" "$(systemctl is-active "$u" 2>/dev/null || true)"
    done
    pgrep -a -x 'mkddc-(web|core|iobus|fake-mcu|hmi)' || echo "không còn tiến trình ứng dụng"
}

wipe() {
    grep -q '"state": "confirmed"' /data/mkddc/netcfg-transaction.json \
        || { echo "netcfg journal không ở confirmed — dừng" >&2; exit 1; }
    if pgrep -x mkddc-core >/dev/null || pgrep -x mkddc-iobus >/dev/null || pgrep -x mkddc-web >/dev/null; then
        echo "còn tiến trình ứng dụng — chạy pha stop trước" >&2; exit 1
    fi
    # Unit ứng dụng: disable rồi gỡ. install.sh cài và enable lại. Giữ netcfg/fakemcu/pty
    # (install.sh ghi đè), drop-in iobus của bo lab, và ba unit bảo mật.
    for u in mkddc-core mkddc-iobus mkddc-web-pi mkddc-reload-helper mkddc-time-helper mkddc-hmi; do
        systemctl disable "$u" >/dev/null 2>&1 || true
        rm -f "/etc/systemd/system/$u.service"
    done
    rm -f /etc/systemd/system/mkddc-netcfg.service.prev
    rm -rf /etc/systemd/system/mkddc-core.service.d /etc/systemd/system/mkddc-web-pi.service.d
    # Binary, web, bản sao lưu cũ.
    rm -f /usr/sbin/mkddc-*
    rm -rf /opt/mkddc-web /opt/mkddc-backups /var/backups/mkddc /usr/libexec/mkddc /usr/share/mkddc
    # Cấu hình và dữ liệu ứng dụng — chỉ giữ Modbus.
    find /data/config -mindepth 1 -maxdepth 1 ! -name fieldbus.conf ! -name fieldbus.lkg.json \
        ! -name fieldbus.journal ! -name profiles -exec rm -rf {} +
    find /data/config/profiles -mindepth 1 ! -name '*.json' -exec rm -rf {} +
    find /data/mkddc -mindepth 1 -maxdepth 1 ! -name netcfg-transaction.json -exec rm -rf {} +
    rm -rf /data/backup /data/releases /data/mkddc-backups
    rm -f /etc/mkddc-web.env /etc/mkddc-web.env.bak-t59817 /etc/mkddc/hmi.conf /etc/mkddc/netcfg.conf.prev
    # Rác thử nghiệm/triển khai của các phiên trước (đã sao lưu về máy dev).
    rm -rf /root/backup /root/backup-20260806-083448 /root/deploy /root/stage-fix /root/f17 \
           /root/quarantine /root/.vscode-server /root/.cache /root/.debug
    rm -f /root/fieldbus.conf.bak-* /root/nomcu.conf.bak-* /usr/local/bin/rs485_check.sh
    systemctl daemon-reload
    # Journal cũ (đã sao lưu), giữ từ đây về sau.
    journalctl --rotate >/dev/null 2>&1 || true
    journalctl --vacuum-time=1s >/dev/null 2>&1 || true
    echo "== còn lại trong /data"; find /data -maxdepth 3 | sort
    echo "== unit mkddc"; ls /etc/systemd/system | grep -E '^mkddc' || true
    ls /etc/systemd/system/mkddc-iobus.service.d
    df -h / | tail -1; du -sh /var/log/journal
}

install_release() {
    [ -x "$STAGE/platform/packaging/install.sh" ] || { echo "thiếu $STAGE" >&2; exit 1; }
    cd "$STAGE"
    bash platform/packaging/install.sh --with-fake-mcu
    # Bo lab: router chuyển cổng tới 8082 (+ mkddc-port-redirect 8081->8082), còn
    # unit chuẩn nghe 8081. Thiếu drop-in này thì web không vào được từ ngoài.
    install -d -m 0755 /etc/systemd/system/mkddc-web-pi.service.d
    printf '# Bo lab Foxlinx: router chuyển cổng tới 8082 (+ mkddc-port-redirect 8081->8082).\n[Service]\nEnvironment=PORT=8082\n' \
        > /etc/systemd/system/mkddc-web-pi.service.d/port.conf
    systemctl daemon-reload
    systemctl restart mkddc-web-pi
}

case "$phase" in
    stop) stop_units ;;
    wipe) wipe ;;
    install) install_release ;;
    *) echo "dùng: $0 stop|wipe|install" >&2; exit 2 ;;
esac
