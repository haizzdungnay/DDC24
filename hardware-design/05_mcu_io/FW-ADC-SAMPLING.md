# FW ADC Sampling - Universal Input 16CH

> **Document:** FW-ADC-SAMPLING | Rev 1.0 | 2026-06-23  
> **Scope:** STM32 firmware sampling sequence for 16 UI Rev A  
> **Related:** HW-DES-03-UI, HW-DES-05-MCU, IOP_PROTOCOL

---

## 1. Sampling Definitions

| Term | Definition | Nominal Rev A value |
|------|------------|---------------------|
| ADC sample rate | ADS131M08 converter output data rate | 1 kSPS/channel initial target |
| MCU scan rate | STM32 task rate that accepts raw ADC samples and status | 1 ms |
| CM3 publish rate | UART/IOP frame cadence to Linux | 10 ms |
| UI application update rate | Filtered/scaled value rate consumed by control logic | 10-100 ms, configurable |

Do not use one number such as "16 channels / 1ms" without naming which rate is being discussed.

---

## 2. Mode Configuration Model

Rev A uses per-channel mode latch. Modes are stable during normal sampling.

Boot/config sequence:

1. Load `ui_config[16]` from nonvolatile configuration.
2. Validate mode values and calibration version.
3. Shift 48 mode bits into the UI mode latch chain.
4. Latch outputs and wait analog settle time.
5. Discard first sample after latch update.
6. Mark channel valid only after a fresh ADC sample passes status checks.

Mode latch changes during runtime are allowed only through a configuration command path, not inside the normal 1ms hot path.

---

## 3. 1ms Acquisition Task

```text
TIM 1ms tick or DRDY-driven scheduler
  |
  v
io_sample_task
  1. Check DRDY1/DRDY2 or wait within timeout budget.
  2. Read ADS131M08 #1 status + 8 x signed 24-bit samples over SPI3.
  3. Read ADS131M08 #2 status + 8 x signed 24-bit samples over SPI3.
  4. Sign-extend each s24 raw sample to int32.
  5. Update raw_active[16], adc_status_1/2, channel_status_bitmap.
  6. Apply lightweight validity/overrange/open/short checks.
  7. Swap/copy to publish buffer under short critical section.
  8. Increment sample counter and update timestamp_us.
```

SPI timing budget must be measured with oscilloscope/logic analyzer. If both ADCs cannot be read comfortably within the 1ms budget at the selected SPI clock and ADS frame format, reduce ADC ODR or publish rate claims before layout release.

---

## 4. ADS Raw Handling

Each ADS data word is signed 24-bit two's-complement.

Firmware stores:

```c
int32_t raw_adc[16];
```

Firmware must not store/send UI raw as unsigned `uint24` semantic data. Packing may use bytes, but semantic type is signed int32 after sign extension.

---

## 5. Filtering Policy

Initial Rev A filter policy:

| Stage | Location | Rule |
|-------|----------|------|
| Raw capture | STM32 | No float; int32 raw only |
| Spike/status checks | STM32 | Reject impossible jumps only if they indicate fault/noise; preserve raw diagnostics |
| Moving average / engineering filter | CM3/Linux preferred | Uses mode, calibration, and application update period |
| Dry contact debounce | STM32 allowed | 20ms default, based on raw threshold/deadband |
| NTC/voltage/current scaling | CM3/Linux | Uses calibration and selected mode |

---

## 6. Fault Handling

| Fault | Detection | Status behavior |
|-------|-----------|-----------------|
| DRDY1 timeout | No DRDY1 within budget | Set DRDY1 timeout bit, ADC1 invalid |
| DRDY2 timeout | No DRDY2 within budget | Set DRDY2 timeout bit, ADC2 invalid |
| SPI timeout | DMA/SPI transaction not complete | ADC timeout bit, attempt reinit policy |
| ADS status fault | ADS status word indicates fault | Preserve status word in frame |
| Channel overrange | Raw near full-scale or mode-specific threshold | Set channel overrange bit |
| Open/short | Mode-specific detection | Set channel open/short where supported |
| Mode latch update | Configuration changed | Mark affected channel invalid until settle/discard done |

The MCU continues to publish frames with invalid bits set so CM3 can distinguish stale/faulted data from a dead UART link.

---

## 7. CM3 Publish Sequence

Every 10ms nominal:

1. `iop_comm_task` copies latest publish buffer.
2. Build binary UI ADC frame defined in `IOP_PROTOCOL.md`.
3. Include sequence, timestamp, ADC status words, raw int32 array, channel status bitmap.
4. Append CRC16.
5. Transmit over UART.

CM3 drops frames with bad CRC and detects missed sequence numbers.

---

## 8. Test Hooks

Required firmware instrumentation:

- GPIO toggle around ADS #1 read.
- GPIO toggle around ADS #2 read.
- Counter for DRDY1 timeout.
- Counter for DRDY2 timeout.
- Counter for SPI/ADC timeout.
- Counter for UART CRC fail observed by receiver, if mirrored through diagnostics.
- Mode latch debug command that reports current `ui_config[16].mode`.

---

## 9. Acceptance Criteria

- [ ] ADS #1/#2 reads are both observed on SPI3 with independent CS pins.
- [ ] Raw sign extension passes boundary tests: `0x7FFFFF`, `0x800000`, `0xFFFFFF`.
- [ ] 16 x int32 raw values appear in IOP frame in channel order UI1..UI16.
- [ ] CM3 receives frames at 10ms nominal without JSON or float payload.
- [ ] CRC fail causes frame drop and counter increment.
- [ ] DRDY timeout and ADC timeout are distinguishable.
- [ ] Mode change invalidates affected samples until settle/discard completes.

---

**Document ID:** FW-ADC-SAMPLING | Rev 1.0 | 2026-06-23
