#!/usr/bin/env bash
# Configure the stable mDNS name used by same-origin Web clients.
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

usage() {
    echo "usage: $0 --check|--apply HOST_LABEL [WEB_PORT]" >&2
    exit 2
}

[ "$#" -ge 2 ] && [ "$#" -le 3 ] || usage
mode="$1"
host_label="${2,,}"
web_port="${3:-8081}"
[ "$mode" = "--check" ] || [ "$mode" = "--apply" ] || usage

if [[ ! "$host_label" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]] ||
   [ "$host_label" = "localhost" ]; then
    echo "ERROR: HOST_LABEL must be one DNS label (1..63 lowercase letters, digits or internal hyphens)" >&2
    exit 2
fi
if [[ ! "$web_port" =~ ^[0-9]+$ ]] || (( web_port < 1 || web_port > 65535 )); then
    echo "ERROR: WEB_PORT must be in range 1..65535" >&2
    exit 2
fi

required=(hostnamectl systemctl avahi-daemon install sed)
missing=()
for command_name in "${required[@]}"; do
    command -v "$command_name" >/dev/null 2>&1 || missing+=("$command_name")
done
if [ "${#missing[@]}" -ne 0 ]; then
    echo "ERROR: missing runtime tools: ${missing[*]}" >&2
    echo "Install avahi-daemon before applying this configuration." >&2
    exit 1
fi
systemctl cat avahi-daemon.service >/dev/null 2>&1 || {
    echo "ERROR: avahi-daemon.service is not installed" >&2
    exit 1
}

echo "hostname=${host_label}"
echo "url=http://${host_label}.local:${web_port}/"
echo "avahi_service=/etc/avahi/services/mkddc-web.service"
[ "$mode" = "--apply" ] || exit 0
[ "$(id -u)" -eq 0 ] || { echo "ERROR: --apply requires root" >&2; exit 1; }

template="$repo_root/packaging/avahi/mkddc-web.service"
[ -f "$template" ] || template="/usr/share/mkddc/avahi/mkddc-web.service"
[ -f "$template" ] || { echo "ERROR: missing Avahi service template" >&2; exit 1; }
service_path="/etc/avahi/services/mkddc-web.service"
old_hostname="$(hostnamectl --static)"
[ -n "$old_hostname" ] || { echo "ERROR: current static hostname is empty" >&2; exit 1; }
avahi_was_enabled=0
avahi_was_active=0
if systemctl is-enabled --quiet avahi-daemon.service; then avahi_was_enabled=1; fi
if systemctl is-active --quiet avahi-daemon.service; then avahi_was_active=1; fi
temp_dir="$(mktemp -d /tmp/mkddc-hostname.XXXXXX)"
generated_service="$temp_dir/mkddc-web.service"
had_service=0
rollback_needed=1

cleanup() {
    status=$?
    if [ "$status" -ne 0 ] && [ "$rollback_needed" -eq 1 ]; then
        hostnamectl set-hostname "$old_hostname" >/dev/null 2>&1 || true
        if [ "$had_service" -eq 1 ]; then
            install -o root -g root -m 0644 "$temp_dir/previous.service" "$service_path" || true
        else
            rm -f -- "$service_path"
        fi
        if [ "$avahi_was_enabled" -eq 1 ]; then
            systemctl enable avahi-daemon.service >/dev/null 2>&1 || true
        else
            systemctl disable avahi-daemon.service >/dev/null 2>&1 || true
        fi
        if [ "$avahi_was_active" -eq 1 ]; then
            systemctl restart avahi-daemon.service >/dev/null 2>&1 || true
        else
            systemctl stop avahi-daemon.service >/dev/null 2>&1 || true
        fi
    fi
    rm -rf -- "$temp_dir"
    trap - EXIT
    exit "$status"
}
trap cleanup EXIT

install -d -o root -g root -m 0755 /etc/avahi/services /data/mkddc
if [ -f "$service_path" ]; then
    cp -p -- "$service_path" "$temp_dir/previous.service"
    had_service=1
fi
if [ ! -e /data/mkddc/hostname-before-mdns ]; then
    printf '%s\n' "$old_hostname" > "$temp_dir/previous-hostname"
    install -o root -g root -m 0600 "$temp_dir/previous-hostname" /data/mkddc/hostname-before-mdns
fi
sed "s/@WEB_PORT@/$web_port/g" "$template" > "$generated_service"

hostnamectl set-hostname "$host_label"
install -o root -g root -m 0644 "$generated_service" "$service_path"
systemctl enable --now avahi-daemon.service
systemctl restart avahi-daemon.service
systemctl is-active --quiet avahi-daemon.service
[ "$(hostnamectl --static)" = "$host_label" ]
rollback_needed=0

echo "OK: browse http://${host_label}.local:${web_port}/ after client-side mDNS resolves"
