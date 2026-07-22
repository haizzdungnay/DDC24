#!/bin/sh
set -eu

unit=/etc/systemd/system/mkddc-web-pi.service
envfile=/etc/mkddc-web.env
stamp="$(date +%Y%m%d_%H%M%S)"

sudo cp -a "$unit" "$unit.bak.$stamp"
if sudo test -f "$envfile"; then
  sudo cp -a "$envfile" "$envfile.bak.$stamp"
fi

secret="$(openssl rand -hex 32)"
printf 'JWT_SECRET=%s\n' "$secret" > /tmp/mkddc-web.env
unset secret
sudo install -o root -g root -m 0600 /tmp/mkddc-web.env "$envfile"
rm -f /tmp/mkddc-web.env

sudo sed -i '/^Environment=JWT_SECRET=/d' "$unit"
if ! sudo grep -q '^EnvironmentFile=-/etc/mkddc-web.env$' "$unit"; then
  sudo sed -i '/^WorkingDirectory=/a EnvironmentFile=-/etc/mkddc-web.env' "$unit"
fi
sudo systemd-analyze verify "$unit"
sudo systemctl daemon-reload

rollback() {
  sudo cp -a "$unit.bak.$stamp" "$unit"
  sudo systemctl daemon-reload
  sudo systemctl restart mkddc-web-pi
}

if ! sudo systemctl restart mkddc-web-pi; then
  rollback
  exit 1
fi

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
  rollback
  exit 1
fi

echo "JWT_ROTATE_STAMP=$stamp"
stat -c '%a %U %G %n' "$envfile"
grep -E '^(EnvironmentFile|Environment=JWT_SECRET)' "$unit"
systemctl is-active mkddc-web-pi
curl -fsS -o /dev/null -w 'login_http=%{http_code}\n' http://127.0.0.1:8081/login
