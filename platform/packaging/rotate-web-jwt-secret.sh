#!/bin/sh
# Luân chuyển JWT_SECRET của mkddc-web và chuyển unit sang EnvironmentFile.
#
# Sửa 2026-07-30 theo review KX-DDC24-CODE-REVIEW-FE-BE-FWSOM:
#
#   F-19 — secret KHÔNG còn đi qua /tmp. Bản cũ dùng
#          `printf ... > /tmp/mkddc-web.env` rồi mới `install -m 0600`:
#          (1) file trung gian mang umask mặc định của người chạy (thường 0022 →
#              0644, ai cũng đọc được) trong cửa sổ giữa hai lệnh;
#          (2) đường dẫn cố định và đoán được trong thư mục ghi chung, nên một
#              user local đặt trước symlink /tmp/mkddc-web.env → ~/steal.txt thì
#              redirect ĐI THEO symlink và ghi secret vào file của kẻ tấn công,
#              còn `rm -f` chỉ xoá symlink.
#          Nay secret đi thẳng vào `install /dev/stdin` qua pipe — không có file
#          trung gian nào tồn tại, và không đặt secret vào biến shell để nó không
#          lọt vào `ps`/core dump.
#
#   F-20 — rollback đúng và bao trùm. Bản cũ định nghĩa rollback() SAU khi unit đã
#          bị sed sửa và daemon-reload đã chạy, không có trap, nên một thất bại
#          trong khoảng đó (với `set -eu`) làm script thoát khi unit ĐÃ bị sửa và
#          secret mới ĐÃ được cài, mà không hoàn tác gì. Ngoài ra rollback() chỉ
#          phục hồi unit, KHÔNG BAO GIỜ phục hồi envfile đã sao lưu — nên một hệ
#          thống "đã rollback" vẫn mang secret mới và mọi session đang hoạt động
#          vẫn bị vô hiệu, đúng cái mà rollback nhằm tránh.
set -eu

unit=/etc/systemd/system/mkddc-web-pi.service
envfile=/etc/mkddc-web.env
stamp="$(date +%Y%m%d_%H%M%S)"

# Nếu về sau có thêm bước ghi file nào thì nó cũng không mang quyền rộng.
umask 077

sudo cp -a "$unit" "$unit.bak.$stamp"
envfile_existed=false
if sudo test -f "$envfile"; then
  sudo cp -a "$envfile" "$envfile.bak.$stamp"
  envfile_existed=true
fi

# ---- rollback: định nghĩa TRƯỚC thay đổi đầu tiên, gắn trap ngay ----
rollback_done=false

rollback() {
  [ "$rollback_done" = true ] && return 0
  rollback_done=true
  echo "ROLLBACK: hoàn tác unit + env file về bản sao lưu $stamp" >&2

  sudo cp -a "$unit.bak.$stamp" "$unit"

  # Phục hồi CẢ env file, không chỉ unit (F-20 vấn đề 2).
  if [ "$envfile_existed" = true ]; then
    sudo cp -a "$envfile.bak.$stamp" "$envfile"
  else
    # Trước khi chạy không có envfile → trả về đúng trạng thái đó, đừng để lại
    # secret mới trên đĩa.
    sudo rm -f "$envfile"
  fi

  sudo systemctl daemon-reload
  sudo systemctl restart mkddc-web-pi || true
}

# Bất kỳ lệnh nào fail (set -e), bị ngắt, hay script thoát non-zero đều rollback.
# Trap được nhả ở cuối khi đã xác nhận thành công.
trap 'rollback' EXIT INT TERM

# ---- từ đây trở đi mọi thay đổi đều đã được rollback bảo vệ ----

# F-19: secret đi thẳng từ openssl vào install(1) qua stdin — không file trung
# gian, không qua /tmp, không bao giờ tồn tại với quyền rộng hơn 0600.
openssl rand -hex 32 \
  | sed 's/^/JWT_SECRET=/' \
  | sudo install -o root -g root -m 0600 /dev/stdin "$envfile"

sudo sed -i '/^Environment=JWT_SECRET=/d' "$unit"
if ! sudo grep -q '^EnvironmentFile=-/etc/mkddc-web.env$' "$unit"; then
  sudo sed -i '/^WorkingDirectory=/a EnvironmentFile=-/etc/mkddc-web.env' "$unit"
fi
sudo systemd-analyze verify "$unit"
sudo systemctl daemon-reload
sudo systemctl restart mkddc-web-pi

ready=false
i=0
while [ "$i" -lt 20 ]; do
  if systemctl is-active --quiet mkddc-web-pi && curl -fsS http://127.0.0.1:8081/login >/dev/null; then
    ready=true
    break
  fi
  i=$((i + 1))
  sleep 1
done
if [ "$ready" != true ]; then
  echo "LỖI: mkddc-web-pi không lên sau 20s" >&2
  exit 1   # trap EXIT sẽ rollback
fi

# Thành công: nhả trap để không rollback khi thoát bình thường.
trap - EXIT INT TERM

echo "JWT_ROTATE_STAMP=$stamp"
stat -c '%a %U %G %n' "$envfile"
grep -E '^(EnvironmentFile|Environment=JWT_SECRET)' "$unit"
systemctl is-active mkddc-web-pi
curl -fsS -o /dev/null -w 'login_http=%{http_code}\n' http://127.0.0.1:8081/login
