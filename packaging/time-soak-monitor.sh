#!/bin/sh
set -eu

duration_s="${1:-86400}"
interval_s="${2:-60}"
out="${3:-$HOME/time-soak-$(date +%Y%m%d_%H%M%S).log}"
end=$(( $(date +%s) + duration_s ))

printf 'started_utc=%s duration_s=%s interval_s=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$duration_s" "$interval_s" >> "$out"
while [ "$(date +%s)" -lt "$end" ]; do
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  services="$(systemctl is-active mkddc-time-helper.service mkddc-web-pi mkddc-core mkddc-iobus chrony.service 2>&1 | tr '\n' ',')"
  sync="$(timedatectl show --property=Timezone --property=NTPSynchronized 2>&1 | tr '\n' ',')"
  tracking="$(chronyc tracking 2>&1 | grep -E 'Reference ID|System time|Leap status|Last offset' | tr '\n' ';' || true)"
  rtc="$(cat /sys/class/rtc/rtc0/date /sys/class/rtc/rtc0/time 2>&1 | tr '\n' 'T')"
  disk="$(df -P / | tail -1 | awk '{print $5}')"
  busy="$(journalctl -u mkddc-web-pi --since '-2 min' --no-pager 2>/dev/null | grep -c 'SQLITE_BUSY' || true)"
  printf '%s services=%s sync=%s tracking=%s rtc=%s disk=%s sqlite_busy_2m=%s\n' "$now" "$services" "$sync" "$tracking" "$rtc" "$disk" "$busy" >> "$out"
  sleep "$interval_s"
done
printf 'completed_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$out"
