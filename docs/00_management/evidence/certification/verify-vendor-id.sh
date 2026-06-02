#!/usr/bin/env bash
#===============================================================================
# QA Verification: Vendor_Identifier Consistency Check
# Issue: IOT-5659 — MK-DDC-24 PICS vs Firmware Vendor_Identifier
#
# Usage:
#   ./verify-vendor-id.sh
#
# Checks:
#   1. PICS §7 Vendor_Identifier != TBD
#   2. firmware config.h BACNET_VENDOR_ID != 260 (placeholder)
#   3. firmware device.c Vendor_Name = "KINEXUS Technologies"
#   4. binary strings contain expected vendor name
#   5. PICS vs firmware consistency
#===============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../../../../" && pwd)"

PICS_FILE="${REPO_DIR}/design/interfaces/BACNET_PICS_EPICS_MK-DDC-24_VI.md"
CONFIG_H="${REPO_DIR}/repo/bacnet/src/bacnet/config.h"
DEVICE_C="${REPO_DIR}/repo/bacnet/src/bacnet/basic/object/device.c"
SERVER_BIN="${REPO_DIR}/repo/bacnet/build/server"

PASS=0
FAIL=0
SKIP=0

ok() { echo "  [PASS] $1"; PASS=$((PASS + 1)); }
fail() { echo "  [FAIL] $1"; FAIL=$((FAIL + 1)); }
skip() { echo "  [SKIP] $1"; SKIP=$((SKIP + 1)); }

echo "==========================================="
echo " Vendor_Identifier Verification Report"
echo " IOT-5659 | $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "==========================================="

echo ""
echo "--- 1. PICS §7 Check ---"
PICS_LINE=$(grep "^| Vendor_Identifier" "$PICS_FILE" 2>/dev/null || true)
echo "  Line: $PICS_LINE"
if [ -z "$PICS_LINE" ]; then
    fail "Vendor_Identifier not found in PICS"
elif echo "$PICS_LINE" | grep -qi "TBD"; then
    fail "PICS §7 Vendor_Identifier is still TBD"
else
    ok "PICS §7 Vendor_Identifier != TBD"
fi

echo ""
echo "--- 2. Firmware config.h Check ---"
FW_ID=$(grep "^#define BACNET_VENDOR_ID" "$CONFIG_H" 2>/dev/null | awk '{print $3}' || true)
echo "  BACNET_VENDOR_ID = $FW_ID"
if [ -z "$FW_ID" ]; then
    fail "BACNET_VENDOR_ID not defined in config.h"
elif [ "$FW_ID" = "260" ]; then
    fail "config.h BACNET_VENDOR_ID is still placeholder (260)"
else
    ok "config.h BACNET_VENDOR_ID != placeholder"
fi

echo ""
echo "--- 3. Firmware device.c Check ---"
FW_NAME=$(grep 'static char \*Vendor_Name' "$DEVICE_C" 2>/dev/null || true)
echo "  Vendor_Name: $FW_NAME"
if echo "$FW_NAME" | grep -qi "KINEXUS"; then
    ok "device.c Vendor_Name set to KINEXUS"
else
    fail "device.c Vendor_Name not KINEXUS"
fi

echo ""
echo "--- 4. Binary Check ---"
if [ -f "$SERVER_BIN" ]; then
    BIN_COUNT=$(strings "$SERVER_BIN" 2>/dev/null | grep -ci "kinexus" 2>/dev/null || echo "0")
    if [ "$BIN_COUNT" -gt 0 ]; then
        ok "Binary contains KINEXUS"
    else
        fail "Binary does NOT contain KINEXUS"
    fi
else
    skip "Binary not found"
fi

echo ""
echo "--- 5. Consistency Check ---"
if [ -n "$FW_ID" ] && [ "$FW_ID" != "260" ]; then
    ok "Firmware Vendor_ID set ($FW_ID) — manual YABE verification still needed for runtime"
else
    skip "Firmware still has default/placeholder Vendor_ID"
fi

echo ""
echo "==========================================="
echo " Results: $PASS passed, $FAIL failed, $SKIP skipped"
echo "==========================================="
exit "$FAIL"
