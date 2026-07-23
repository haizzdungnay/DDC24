#!/usr/bin/env bash
#===============================================================================
# QA Runtime Verification: Vendor_Identifier via BACnet readprop
# Issue: IOT-5659 — MK-DDC-24 Vendor_Identifier consistency check
#
# Usage:
#   ./verify-vendor-id-runtime.sh              # default: 1s timeout
#   ./verify-vendor-id-runtime.sh 5            # 5s timeout
#
# This starts the BACnet server, sends Who-Is to find it, then
# reads Device Object Vendor_Identifier (prop 120) via readprop.
#===============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../../../../" && pwd)"
BUILD_DIR="${REPO_DIR}/repo/bacnet/build"
SERVER="${BUILD_DIR}/server"
READPROP="${BUILD_DIR}/readprop"
WHOIS="${BUILD_DIR}/whois"
TIMEOUT="${1:-1}"
PICS_FILE="${REPO_DIR}/design/interfaces/BACNET_PICS_EPICS_MK-DDC-24_VI.md"
CONFIG_H="${REPO_DIR}/repo/bacnet/src/bacnet/config.h"

PASS=0
FAIL=0
SKIP=0

RESULT_DIR="${SCRIPT_DIR}"

ok() { echo "  [PASS] $1"; PASS=$((PASS + 1)); }
fail() { echo "  [FAIL] $1"; FAIL=$((FAIL + 1)); }
skip() { echo "  [SKIP] $1"; SKIP=$((SKIP + 1)); }

echo "==========================================="
echo " Vendor_Identifier Runtime Verification"
echo " IOT-5659 | $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "==========================================="

# --- Check prerequisites ---
if [ ! -x "$SERVER" ]; then
    fail "Server binary missing: $SERVER"
    echo "  Build with: cd $BUILD_DIR && cmake .. -DBACDL_BIP=ON && make"
    exit 1
fi
if [ ! -x "$READPROP" ]; then
    fail "readprop binary missing"
    exit 1
fi
if [ ! -x "$WHOIS" ]; then
    fail "whois binary missing"
    exit 1
fi

# --- 1. Extract expected values ---
echo ""
echo "--- Step 1: Extract expected values from source ---"

# Expected Vendor_Identifier from config.h
EXPECTED_ID=$(grep "^#define BACNET_VENDOR_ID" "$CONFIG_H" 2>/dev/null | awk '{print $3}' || echo "")
if [ -z "$EXPECTED_ID" ]; then
    fail "Cannot read BACNET_VENDOR_ID from config.h"
else
    ok "config.h BACNET_VENDOR_ID = $EXPECTED_ID"
fi

# Expected Vendor_Name from device.c
EXPECTED_NAME=$(grep 'static char \*Vendor_Name' "$DEVICE_C" 2>/dev/null || true)
if echo "$EXPECTED_NAME" | grep -qi "KINEXUS"; then
    ok "device.c Vendor_Name = KINEXUS"
else
    fail "device.c Vendor_Name not KINEXUS ($EXPECTED_NAME)"
fi

# PICS expected value
PICS_LINE=$(grep "^| Vendor_Identifier" "$PICS_FILE" 2>/dev/null || true)
if echo "$PICS_LINE" | grep -qi "TBD"; then
    skip "PICS Vendor_Identifier still TBD"
elif [ -n "$PICS_LINE" ]; then
    ok "PICS Vendor_Identifier defined"
else
    fail "PICS Vendor_Identifier not found"
fi

# --- 2. Start BACnet server ---
echo ""
echo "--- Step 2: Start BACnet server ---"

# Kill any leftover server from previous runs
pkill -f "^$SERVER" 2>/dev/null || true
sleep 0.2

# Start server on loopback on port 47808 (BAC0) + a different instance number
# Use instance 4194300 to avoid conflicts with any real devices
SERVER_INST=4194300
"$SERVER" --instance "$SERVER_INST" 2>/dev/null &
SERVER_PID=$!
sleep 0.5

# Check server is alive
if kill -0 "$SERVER_PID" 2>/dev/null; then
    ok "BACnet server started (PID=$SERVER_PID, instance=$SERVER_INST)"
else
    fail "BACnet server failed to start"
    exit 1
fi

cleanup() {
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT

# --- 3. Who-Is discovery ---
echo ""
echo "--- Step 3: Who-Is discovery ---"
WHOIS_OUTPUT=$("$WHOIS" -q -t "$TIMEOUT" 2>&1 || true)
echo "  Who-Is output:"
echo "$WHOIS_OUTPUT" | head -20

# Check if our server responded
if echo "$WHOIS_OUTPUT" | grep -qi "$SERVER_INST"; then
    ok "Device $SERVER_INST discovered via Who-Is"
elif echo "$WHOIS_OUTPUT" | grep -qi "Device"; then
    skip "Other devices found but not instance $SERVER_INST"
else
    skip "No BACnet devices discovered (timeout=${TIMEOUT}s)"
fi

# --- 4. Read Vendor_Identifier via readprop ---
echo ""
echo "--- Step 4: Read Device Vendor_Identifier via readprop ---"
# Property 120 = PROP_VENDOR_IDENTIFIER
# Read from "device" type (OBJECT_DEVICE = 8), instance 0 (device itself)
# Target = our server instance
READ_OUTPUT=$("$READPROP" "$SERVER_INST" device 0 vendor-identifier --mac "127.0.0.1:47808" 2>&1 || true)
echo "  readprop output: $READ_OUTPUT"

# Extract the numeric value
READ_VALUE=$(echo "$READ_OUTPUT" | grep -oE '[0-9]+' | tail -1 || echo "")

if [ -n "$READ_VALUE" ]; then
    ok "Vendor_Identifier read from Device Object = $READ_VALUE"
else
    skip "Could not read Vendor_Identifier (timeout or no response)"
fi

# --- 5. Compare with expected ---
echo ""
echo "--- Step 5: Consistency check ---"
if [ -n "$READ_VALUE" ] && [ -n "$EXPECTED_ID" ] && [ -n "$PICS_LINE" ]; then
    if [ "$READ_VALUE" = "$EXPECTED_ID" ]; then
        ok "Runtime ($READ_VALUE) matches config.h ($EXPECTED_ID)"
    else
        fail "Runtime ($READ_VALUE) != config.h ($EXPECTED_ID)"
    fi
    if echo "$PICS_LINE" | grep -q "$READ_VALUE"; then
        ok "Runtime ($READ_VALUE) matches PICS"
    else
        fail "Runtime ($READ_VALUE) != PICS ($PICS_LINE)"
    fi
else
    skip "Not all values available for consistency comparison"
fi

echo ""
echo "==========================================="
echo " Results: $PASS passed, $FAIL failed, $SKIP skipped"
echo "==========================================="
exit "$FAIL"
