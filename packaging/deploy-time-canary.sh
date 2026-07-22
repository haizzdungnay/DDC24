#!/bin/sh
set -eu

expected_sha="$1"
backend_src="/tmp/mkddc-web-time-pi"
dist_src="/tmp/mkddc-time-dist"
install_dir="/opt/mkddc-web"
helper_unit_src="/tmp/mkddc-time-helper.service"
helper_unit="/etc/systemd/system/mkddc-time-helper.service"
stamp="$(date +%Y%m%d_%H%M%S)"

actual_sha="$(sha256sum "$backend_src" | awk '{print $1}')"
test "$actual_sha" = "$expected_sha"
test -f "$dist_src/index.html"
test -f "$helper_unit_src"

sudo cp -a "$install_dir/mkddc-web" "$install_dir/mkddc-web.bak.$stamp"
sudo cp -a "$install_dir/dist" "$install_dir/dist.bak.$stamp"
if sudo test -f "$helper_unit"; then
  sudo cp -a "$helper_unit" "$helper_unit.bak.$stamp"
fi

sudo install -o root -g root -m 0755 "$backend_src" "$install_dir/mkddc-web"
sudo install -o root -g root -m 0644 "$helper_unit_src" "$helper_unit"
sudo systemd-analyze verify "$helper_unit"
sudo systemctl daemon-reload
sudo systemctl enable --now mkddc-time-helper.service
sudo rm -rf "$install_dir/dist.new"
sudo cp -a "$dist_src" "$install_dir/dist.new"
sudo chown -R root:root "$install_dir/dist.new"
sudo find "$install_dir/dist.new" -type d -exec chmod 0755 {} \;
sudo find "$install_dir/dist.new" -type f -exec chmod 0644 {} \;
sudo mv "$install_dir/dist" "$install_dir/dist.old.$stamp"
sudo mv "$install_dir/dist.new" "$install_dir/dist"

rollback() {
  sudo systemctl stop mkddc-web-pi || true
  sudo install -o root -g root -m 0755 "$install_dir/mkddc-web.bak.$stamp" "$install_dir/mkddc-web"
  sudo rm -rf "$install_dir/dist"
  sudo cp -a "$install_dir/dist.bak.$stamp" "$install_dir/dist"
  sudo systemctl restart mkddc-web-pi
}

ready=false
if sudo systemctl restart mkddc-web-pi; then
  attempts=0
  while [ "$attempts" -lt 20 ]; do
    if sudo systemctl is-active --quiet mkddc-time-helper.service &&
       test -S /run/mkddc/time-helper.sock &&
       sudo systemctl is-active --quiet mkddc-web-pi &&
       curl -fsS http://127.0.0.1:8081/login >/dev/null; then
      ready=true
      break
    fi
    attempts=$((attempts + 1))
    sleep 1
  done
fi
if [ "$ready" != true ]; then
  rollback
  exit 1
fi

echo "DEPLOY_STAMP=$stamp"
sha256sum "$install_dir/mkddc-web"
systemctl is-active mkddc-web-pi
curl -fsS -o /dev/null -w 'login_http=%{http_code}\n' http://127.0.0.1:8081/login
