#!/bin/sh
# MK-DDC-24 — dồn việc nền của kernel khỏi CPU vòng quét (ADR-061 4.11, G2 tạm).
#
# Cài vào /usr/libexec/mkddc/rt-housekeeping; mkddc-core.service gọi bằng
#   ExecStartPre=-+/usr/libexec/mkddc/rt-housekeeping <danh-sách-CPU> <mask-hex>
# ví dụ `0-2 7` khi CPU3 dành riêng cho mkddc-core.
#
# Việc làm:
#   1. workqueue unbound (kworker không gắn CPU) chỉ chạy trên CPU housekeeping;
#   2. kthreadd và MỌI kernel thread không gắn CPU (affinity = mọi CPU online)
#      dời sang CPU housekeeping. Thread gắn CPU (ksoftirqd/N, migration/N,
#      kworker/N:*) giữ nguyên — không dời được, và cũng không nên.
#
# Vì sao (Foxlinx 2026-09-26, kernel 6.1 `PREEMPT_VOLUNTARY`): sau khi đã ghim
# service, dời IRQ và đặt `system.conf.d` CPUAffinity=0-2, CPU3 vẫn nhận ~460
# IPI đánh thức/giây cho các kernel thread không gắn CPU — chủ yếu luồng của
# driver Wi-Fi Realtek (`RTW_XMIT_THREAD`, `RTWHALXT`) mỗi lần web gửi gói
# qua mạng. Dưới tải giao diện: 0,73 % lần thức dậy của vòng quét 10 ms lệch
# > 100 µs, tối đa 215 µs. Dời 26 kernel thread không gắn CPU sang 0–2: 0 lần
# vượt trong hai cửa sổ 60 s, tối đa 61 / 85 µs.
#
# Chạy bằng root (`+`); lỗi không chặn khởi động core (`-`). Thread có cờ
# PF_NO_SETAFFINITY từ chối đổi affinity — được đếm, không coi là lỗi.
set -u

HOUSEKEEPING_CPUS=${1:-0-2}
WORKQUEUE_MASK=${2:-7}

workqueue="/sys/devices/virtual/workqueue/cpumask"
if [ -w "$workqueue" ]; then
    echo "$WORKQUEUE_MASK" > "$workqueue" 2>/dev/null || echo "rt-housekeeping: không ghi được $workqueue" >&2
fi

online=$(cat /sys/devices/system/cpu/online 2>/dev/null || echo "")
moved=0
fixed=0
for status in /proc/[0-9]*/status; do
    pid=${status#/proc/}
    pid=${pid%/status}
    ppid=$(awk '/^PPid:/ {print $2}' "$status" 2>/dev/null)
    # Kernel thread: chính kthreadd (pid 2) hoặc con trực tiếp của nó.
    [ "$pid" = 2 ] || [ "$ppid" = 2 ] || continue
    allowed=$(awk '/^Cpus_allowed_list:/ {print $2}' "$status" 2>/dev/null)
    [ -n "$online" ] && [ "$allowed" = "$online" ] || continue
    if taskset -pc "$HOUSEKEEPING_CPUS" "$pid" >/dev/null 2>&1; then
        moved=$((moved + 1))
    else
        fixed=$((fixed + 1))
    fi
done

echo "rt-housekeeping: cpus=$HOUSEKEEPING_CPUS workqueue=$(cat "$workqueue" 2>/dev/null) kthread_moved=$moved kthread_pinned_by_kernel=$fixed"
exit 0
