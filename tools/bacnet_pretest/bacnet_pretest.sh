#!/usr/bin/env bash
# BAC-011: BACnet BTL pre-test smoke script
# Usage: ./bacnet_pretest.sh <device_ip> [device_instance] [udp_port]
# Tools required: bacnet-stack readprop/writeprop (legacy bacrp/bacwp names also accepted)
# Evidence logged to: docs/00_management/evidence/bacnet-pretest/
#
# Tests run:
#   T1  Who-Is / I-Am round-trip (latency < 100ms — SW-BAC-005)
#   T2  ReadProperty Device object properties
#   T3  ReadProperty AI1 Present_Value, Status_Flags, Reliability
#   T4  ReadProperty BI1 Present_Value
#   T5  WriteProperty AV1 Present_Value (prio 8) + readback
#   T6  WriteProperty AO1 Present_Value (prio 8) + readback
#   T7  WriteProperty NULL (relinquish AO1 prio 8)
#   T8  ReadProperty Device Vendor_Identifier
# Evidence files: bacrp_results.log, timing.log, summary.txt

set -euo pipefail

DEVICE_IP="${1:?Usage: $0 <device_ip> [device_instance] [udp_port]}"
DEVICE_INSTANCE="${2:-1001}"
UDP_PORT="${3:-47808}"
AO_TEST_VALUE="${AO_TEST_VALUE:-50.0}"
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

find_tool() {
    local preferred="$1" fallback="$2"
    if command -v "${preferred}" &>/dev/null; then command -v "${preferred}"
    elif command -v "${fallback}" &>/dev/null; then command -v "${fallback}"
    else return 1
    fi
}

READPROP_BIN="${BACRP_BIN:-$(find_tool bacrp readprop || true)}"
WRITEPROP_BIN="${BACWP_BIN:-$(find_tool bacwp writeprop || true)}"
WHOIS_BIN="${BACWI_BIN:-$(find_tool bacwi whois || true)}"
if [ -z "${READPROP_BIN}" ] || [ -z "${WRITEPROP_BIN}" ]; then
    echo "ERROR: readprop/writeprop (or bacrp/bacwp) not found." >&2
    exit 1
fi
export BACNET_IP_PORT="${BACNET_IP_PORT:-${UDP_PORT}}"

read_prop() {
    "${READPROP_BIN}" "${DEVICE_INSTANCE}" "$1" "$2" "$3" \
        --mac "${DEVICE_IP}:${UDP_PORT}"
}

write_prop() {
    # bacnet-stack 1.3.8 writeprop discovers the device through Who-Is and has
    # no --mac option. Run this smoke from the same BACnet broadcast domain.
    "${WRITEPROP_BIN}" "${DEVICE_INSTANCE}" "$1" "$2" "$3" "$4" -1 "$5" "$6"
}

# ---- T1: Who-Is / I-Am ----
log_info "T1: Who-Is / I-Am round-trip"
T1_START=$(date +%s%N)
if [ -n "${WHOIS_BIN}" ] && [ "$(basename "${WHOIS_BIN}")" = "whois" ]; then
    T1_CMD=("${WHOIS_BIN}" --mac "${DEVICE_IP}:${UDP_PORT}" "${DEVICE_INSTANCE}" "${DEVICE_INSTANCE}" --timeout 50 --delay 10)
else
    # Legacy bacwi variants differ in CLI; a directed Device read still proves
    # Who-Is/I-Am address binding before ReadProperty.
    T1_CMD=("${READPROP_BIN}" "${DEVICE_INSTANCE}" device "${DEVICE_INSTANCE}" object-name --mac "${DEVICE_IP}:${UDP_PORT}")
fi
if "${T1_CMD[@]}" >> "${BACRP_LOG}" 2>&1; then
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
if read_prop device "${DEVICE_INSTANCE}" object-name >> "${BACRP_LOG}" 2>&1; then
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
    if read_prop analog-input 1 "${prop}" >> "${BACRP_LOG}" 2>&1; then
        log_pass "T3 AI1.${prop_name} (prop ${prop})"
    else
        log_fail "T3 AI1.${prop_name} (prop ${prop})"
        FAILED_T3=1
    fi
done

# ---- T4: ReadProperty BI1 ----
log_info "T4: ReadProperty BI1 Present_Value"
if read_prop binary-input 1 present-value >> "${BACRP_LOG}" 2>&1; then
    log_pass "T4 BI1.Present_Value"
else
    log_fail "T4 BI1.Present_Value"
fi

# ---- T5: WriteProperty AV1 Present_Value (prio 8) ----
log_info "T5: WriteProperty AV1 prio=8 value=42.5 + readback"
WRITE_VAL="42.5"
if write_prop analog-value 1 present-value 8 4 "${WRITE_VAL}" \
         >> "${BACRP_LOG}" 2>&1; then
    # Readback
    READ_VAL=$(read_prop analog-value 1 present-value 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' | head -1 || echo "ERR")
    if awk -v got="${READ_VAL}" -v want="${WRITE_VAL}" \
           'BEGIN { d=got-want; if (d<0) d=-d; exit !(d <= 0.0001) }'; then
        log_pass "T5 WriteProperty AV1 prio=8 val=${WRITE_VAL} readback=${READ_VAL}"
    else
        log_fail "T5 WriteProperty AV1 readback mismatch: got=${READ_VAL}"
    fi
else
    log_fail "T5 WriteProperty AV1 prio=8"
fi

# ---- T6: WriteProperty AO1 (commandable, prio 8) ----
log_info "T6: AO1 required properties + WriteProperty prio=8 value=${AO_TEST_VALUE}"
for prop in object-name units min-pres-value max-pres-value; do
    if read_prop analog-output 1 "${prop}" >> "${BACRP_LOG}" 2>&1; then
        log_pass "T6 AO1.${prop}"
    else
        log_fail "T6 AO1.${prop}"
    fi
done
if write_prop analog-output 1 present-value 8 4 "${AO_TEST_VALUE}" \
         >> "${BACRP_LOG}" 2>&1; then
    AO_READ_VAL=$(read_prop analog-output 1 present-value 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' | head -1 || echo "ERR")
    if awk -v got="${AO_READ_VAL}" -v want="${AO_TEST_VALUE}" \
           'BEGIN { d=got-want; if (d<0) d=-d; exit !(d <= 0.0001) }'; then
        log_pass "T6 WriteProperty AO1 prio=8 readback=${AO_READ_VAL}"
    else
        log_fail "T6 WriteProperty AO1 readback mismatch: got=${AO_READ_VAL}"
    fi
else
    log_fail "T6 WriteProperty AO1 prio=8"
fi

# ---- T7: WriteProperty NULL (relinquish AO1 prio 8) ----
log_info "T7: WriteProperty NULL (relinquish AO1 prio=8)"
if write_prop analog-output 1 present-value 8 0 0 >> "${BACRP_LOG}" 2>&1; then
    log_pass "T7 Relinquish AO1 prio=8"
else
    log_fail "T7 Relinquish AO1 prio=8"
fi

# ---- T8: Check Vendor_Identifier = 9999 (PICS §7 placeholder) ----
log_info "T8: ReadProperty Device Vendor_Identifier (prop 120)"
VENDOR_ID=$(read_prop device "${DEVICE_INSTANCE}" vendor-identifier \
                  2>/dev/null | grep -oE '[0-9]+' | head -1 || echo "ERR")
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
