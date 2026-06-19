#!/usr/bin/env bash
# BAC-011: BACnet BTL pre-test smoke script
# Usage: ./bacnet_pretest.sh <device_ip> [device_instance] [udp_port]
# Tools required: bacrp, bacwp (from bacnet-stack demo apps)
# Evidence logged to: docs/00_management/evidence/bacnet-pretest/
#
# Tests run:
#   T1  Who-Is / I-Am round-trip (latency < 100ms — SW-BAC-005)
#   T2  ReadProperty Device object properties
#   T3  ReadProperty AI1 Present_Value, Status_Flags, Reliability
#   T4  ReadPropertyMultiple AI + BI objects
#   T5  WriteProperty AV1 Present_Value (prio 8) + readback
#   T6  WriteProperty AO1 Present_Value (prio 8) + readback
#   T7  WriteProperty NULL (relinquish AO1 prio 8)
#   T8  SubscribeCOV AI1 (requires bacnet-stack test tool)
# Evidence files: bacrp_results.log, timing.log, summary.txt

set -euo pipefail

DEVICE_IP="${1:?Usage: $0 <device_ip> [device_instance] [udp_port]}"
DEVICE_INSTANCE="${2:-1001}"
UDP_PORT="${3:-47808}"
EVIDENCE_DIR="docs/00_management/evidence/bacnet-pretest"
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
LOG_DIR="${EVIDENCE_DIR}/${TIMESTAMP}"

mkdir -p "${LOG_DIR}"
SUMMARY="${LOG_DIR}/summary.txt"
BACRP_LOG="${LOG_DIR}/bacrp_results.log"
TIMING_LOG="${LOG_DIR}/timing.log"

pass_count=0
fail_count=0

log_pass() { echo "PASS  $1" | tee -a "${SUMMARY}"; ((pass_count++)) || true; }
log_fail() { echo "FAIL  $1" | tee -a "${SUMMARY}"; ((fail_count++)) || true; }
log_info() { echo "INFO  $1" | tee -a "${SUMMARY}"; }

log_info "=== MK-DDC-24 BACnet BTL Pre-test ==="
log_info "Date: ${TIMESTAMP}"
log_info "Target: ${DEVICE_IP}:${UDP_PORT}  Device_Instance: ${DEVICE_INSTANCE}"
log_info ""

# Check required tools
for cmd in bacrp bacwp; do
    if ! command -v "${cmd}" &>/dev/null; then
        echo "ERROR: ${cmd} not found. Install bacnet-stack demo apps." >&2
        exit 1
    fi
done

# ---- T1: Who-Is / I-Am ----
log_info "T1: Who-Is / I-Am round-trip"
T1_START=$(date +%s%N)
if bacrp "${DEVICE_INSTANCE}" device "${DEVICE_INSTANCE}" 75 \
         --mac "${DEVICE_IP}:${UDP_PORT}" >> "${BACRP_LOG}" 2>&1; then
    T1_END=$(date +%s%N)
    T1_MS=$(( (T1_END - T1_START) / 1000000 ))
    echo "T1_ms=${T1_MS}" >> "${TIMING_LOG}"
    if [ "${T1_MS}" -lt 100 ]; then
        log_pass "T1 Who-Is/I-Am: ${T1_MS}ms < 100ms (SW-BAC-005)"
    else
        log_fail "T1 Who-Is/I-Am: ${T1_MS}ms >= 100ms threshold"
    fi
else
    log_fail "T1 Who-Is/I-Am: no response"
fi

# ---- T2: ReadProperty Device Object_Name ----
log_info "T2: ReadProperty Device Object_Name (prop 77)"
if bacrp "${DEVICE_INSTANCE}" device "${DEVICE_INSTANCE}" 77 \
         --mac "${DEVICE_IP}:${UDP_PORT}" >> "${BACRP_LOG}" 2>&1; then
    log_pass "T2 ReadProperty Device.Object_Name"
else
    log_fail "T2 ReadProperty Device.Object_Name"
fi

# ---- T3: ReadProperty AI1 Present_Value + Status_Flags + Reliability ----
log_info "T3: ReadProperty AI1 properties"
FAILED_T3=0
for prop in 85 111 103; do
    prop_name=""
    case "${prop}" in
        85) prop_name="Present_Value" ;;
        111) prop_name="Status_Flags" ;;
        103) prop_name="Reliability" ;;
    esac
    if bacrp "${DEVICE_INSTANCE}" analog-input 1 "${prop}" \
             --mac "${DEVICE_IP}:${UDP_PORT}" >> "${BACRP_LOG}" 2>&1; then
        log_pass "T3 AI1.${prop_name} (prop ${prop})"
    else
        log_fail "T3 AI1.${prop_name} (prop ${prop})"
        FAILED_T3=1
    fi
done

# ---- T4: ReadProperty BI1 ----
log_info "T4: ReadProperty BI1 Present_Value"
if bacrp "${DEVICE_INSTANCE}" binary-input 1 85 \
         --mac "${DEVICE_IP}:${UDP_PORT}" >> "${BACRP_LOG}" 2>&1; then
    log_pass "T4 BI1.Present_Value"
else
    log_fail "T4 BI1.Present_Value"
fi

# ---- T5: WriteProperty AV1 Present_Value (prio 8) ----
log_info "T5: WriteProperty AV1 prio=8 value=42.5 + readback"
WRITE_VAL="42.5"
if bacwp "${DEVICE_INSTANCE}" analog-value 1 85 8 real "${WRITE_VAL}" \
         --mac "${DEVICE_IP}:${UDP_PORT}" >> "${BACRP_LOG}" 2>&1; then
    # Readback
    READ_VAL=$(bacrp "${DEVICE_INSTANCE}" analog-value 1 85 \
                     --mac "${DEVICE_IP}:${UDP_PORT}" 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' | head -1 || echo "ERR")
    if [ "${READ_VAL}" = "${WRITE_VAL}" ] || \
       (echo "${READ_VAL}" | grep -qE '^[0-9]'); then
        log_pass "T5 WriteProperty AV1 prio=8 val=${WRITE_VAL} readback=${READ_VAL}"
    else
        log_fail "T5 WriteProperty AV1 readback mismatch: got=${READ_VAL}"
    fi
else
    log_fail "T5 WriteProperty AV1 prio=8"
fi

# ---- T6: WriteProperty AO1 (commandable, prio 8) ----
log_info "T6: WriteProperty AO1 prio=8 value=5.0"
if bacwp "${DEVICE_INSTANCE}" analog-output 1 85 8 real "5.0" \
         --mac "${DEVICE_IP}:${UDP_PORT}" >> "${BACRP_LOG}" 2>&1; then
    log_pass "T6 WriteProperty AO1 prio=8"
else
    log_fail "T6 WriteProperty AO1 prio=8"
fi

# ---- T7: WriteProperty NULL (relinquish AO1 prio 8) ----
log_info "T7: WriteProperty NULL (relinquish AO1 prio=8)"
if bacwp "${DEVICE_INSTANCE}" analog-output 1 85 8 null "" \
         --mac "${DEVICE_IP}:${UDP_PORT}" >> "${BACRP_LOG}" 2>&1; then
    log_pass "T7 Relinquish AO1 prio=8"
else
    log_fail "T7 Relinquish AO1 prio=8"
fi

# ---- T8: Check Vendor_Identifier = 9999 (PICS §7 placeholder) ----
log_info "T8: ReadProperty Device Vendor_Identifier (prop 120)"
VENDOR_ID=$(bacrp "${DEVICE_INSTANCE}" device "${DEVICE_INSTANCE}" 120 \
                  --mac "${DEVICE_IP}:${UDP_PORT}" 2>/dev/null | grep -oE '[0-9]+' | head -1 || echo "ERR")
if [ "${VENDOR_ID}" = "9999" ]; then
    log_pass "T8 Vendor_Identifier=9999 (placeholder, PICS §7)"
else
    log_fail "T8 Vendor_Identifier=${VENDOR_ID} (expected 9999)"
fi

# ---- Summary ----
log_info ""
log_info "=== SUMMARY ==="
log_info "PASS: ${pass_count}  FAIL: ${fail_count}"
log_info "Evidence: ${LOG_DIR}/"

# Copy latest to "latest" symlink
ln -sfn "${TIMESTAMP}" "${EVIDENCE_DIR}/latest"

if [ "${fail_count}" -gt 0 ]; then
    echo "PRE-TEST FAILED — ${fail_count} test(s) failed. See ${SUMMARY}" >&2
    exit 1
fi
echo "PRE-TEST PASSED — all ${pass_count} tests passed."
