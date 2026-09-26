#!/bin/sh
# MK-DDC-24 — giữ tần số cố định cho cụm CPU chứa CPU vòng quét (ADR-061 4.11, F17).
#
# Cài vào /usr/libexec/mkddc/rt-cpufreq; mkddc-core.service gọi bằng
#   ExecStartPre=-+/usr/libexec/mkddc/rt-cpufreq hold 3
#   ExecStopPost=-+/usr/libexec/mkddc/rt-cpufreq release 3
#
# `hold <cpu>`: đặt governor `performance` cho policy cpufreq chứa <cpu>, lưu
# governor cũ vào /run để `release` trả lại. `release <cpu>`: trả governor cũ.
#
# Vì sao (Foxlinx 2026-09-26, RV1126B, kernel 6.1 `PREEMPT_VOLUNTARY`): bốn lõi
# chung MỘT policy (`related_cpus=0 1 2 3`) với governor `schedutil`, đổi tần số
# khoảng 100 lần/giây. Mỗi lần đổi, cả cụm khựng — kể cả CPU3 đang rảnh chờ
# đánh thức vòng quét: trace CPU3 cho thấy đoạn `sched_waking` → `sched_wakeup`
# của mkddc-core kéo dài 57–81 µs (bình thường ~18 µs), đẩy lần thức dậy lên
# 109–163 µs (> C4 100 µs) dù không có tác vụ nào khác chen vào CPU3. Cùng tải
# (ghi 64 MB fsync + `systemctl daemon-reload` ở CPU0–2), A/B lặp hai lần:
# `schedutil` +3 và +7 lần vượt 100 µs (3 455 lần đổi tần số), `performance`
# +0 và +0 (0 lần đổi tần số).
#
# Chạy bằng root (`+`); lỗi không chặn khởi động core (`-`). Bo không có cpufreq
# thì không làm gì. Core tự log `rt.cpufreq_scaling` khi ràng buộc này thiếu.
set -u

ACTION=${1:-}
CPU=${2:-3}
policy_dir=$(readlink -f "/sys/devices/system/cpu/cpu$CPU/cpufreq" 2>/dev/null || true)
if [ -z "$policy_dir" ] || [ ! -r "$policy_dir/scaling_governor" ]; then
    echo "rt-cpufreq: cpu=$CPU không có cpufreq, bỏ qua"
    exit 0
fi
policy=$(basename "$policy_dir")
saved="/run/mkddc-cpufreq-$policy.governor"
current=$(cat "$policy_dir/scaling_governor" 2>/dev/null)

case "$ACTION" in
hold)
    # Chỉ lưu khi governor hiện tại KHÁC performance: restart core liên tiếp
    # không được ghi đè governor gốc bằng chính "performance".
    if [ "$current" != performance ] && [ ! -e "$saved" ]; then
        echo "$current" > "$saved"
    fi
    if ! echo performance > "$policy_dir/scaling_governor" 2>/dev/null; then
        echo "rt-cpufreq: không đặt được governor performance cho $policy" >&2
        exit 0
    fi
    echo "rt-cpufreq: cpu=$CPU $policy related_cpus=$(cat "$policy_dir/related_cpus" 2>/dev/null)" \
         "governor=$current->performance cur_khz=$(cat "$policy_dir/scaling_cur_freq" 2>/dev/null)"
    ;;
release)
    if [ -e "$saved" ]; then
        previous=$(cat "$saved")
        echo "$previous" > "$policy_dir/scaling_governor" 2>/dev/null \
            || echo "rt-cpufreq: không trả được governor $previous cho $policy" >&2
        rm -f "$saved"
        echo "rt-cpufreq: cpu=$CPU $policy governor=$current->$previous"
    fi
    ;;
*)
    echo "cách dùng: rt-cpufreq hold|release <cpu>" >&2
    exit 0
    ;;
esac
exit 0
