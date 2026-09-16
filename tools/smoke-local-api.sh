#!/usr/bin/env bash
# Kiểm tra nhanh API cục bộ (luồng no-board): login, /me, khả năng Programming.
set -eu

API="${1:-http://localhost:8081}"

curl -sS -X POST "$API/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' > /tmp/mkddc-login.json

TOKEN=$(python3 -c 'import json;print(json.load(open("/tmp/mkddc-login.json"))["token"])')

echo "== /api/v1/me =="
curl -sS "$API/api/v1/me" -H "Authorization: Bearer $TOKEN"
echo

echo "== /api/v1/programming/capabilities =="
curl -sS "$API/api/v1/programming/capabilities" -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool

echo "== /api/v1/programming/projects =="
curl -sS "$API/api/v1/programming/projects" -H "Authorization: Bearer $TOKEN" \
  | head -c 600
echo
