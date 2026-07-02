package main

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
	"unsafe"
)

func TestDecodePoints(t *testing.T) {
	data := make([]byte, kxPlcShmMinLen)
	binary.LittleEndian.PutUint32(data[0:4], kxShmMagic)

	setPoint(data, offAI, 42.5, 0)
	setPoint(data, offAI+kxPointSize, 99.0, 1) // UI-02: uncertain

	setPoint(data, offAO, 5.0, 0)

	setPoint(data, offBO, 1.0, 0)

	setPoint(data, offAV, 3.14, 0)

	setPoint(data, offBV, 0.0, 0)

	setPoint(data, offMSV, 123.0, 0)

	pts := decodePoints(data, nil)

	// Total: 8 AI + 8 DI + 4 AO + 4 DO + 32 AV + 16 BV + 8 MSV = 80
	if len(pts) != 80 {
		t.Errorf("expected 80 points, got %d", len(pts))
	}

	// Find UI-01 (AI slot, index 0)
	ai1 := pts[0]
	if ai1.ID != "UI-01" {
		t.Errorf("UI-01 id = %q, want UI-01", ai1.ID)
	}
	if ai1.Kind != "UI" {
		t.Errorf("UI-01 kind = %q, want UI", ai1.Kind)
	}
	if ai1.Quality != "good" {
		t.Errorf("UI-01 quality = %q, want good", ai1.Quality)
	}
	if ai1.Fault {
		t.Errorf("UI-01 fault = true, want false")
	}

	// AI2 (uncertain) — only "bad" quality sets fault=true
	ai2 := pts[1]
	if ai2.Quality != "uncertain" {
		t.Errorf("AI2 quality = %q, want uncertain", ai2.Quality)
	}
	if ai2.Fault {
		t.Errorf("AI2 fault = true, want false (uncertain is not fault)")
	}

	// Find UI-16 (last UI slot, index 15)
	ui16 := pts[15]
	if ui16.ID != "UI-16" {
		t.Errorf("UI-16 id = %q, want UI-16", ui16.ID)
	}
	if ui16.Kind != "UI" {
		t.Errorf("UI-16 kind = %q, want UI", ui16.Kind)
	}

	// AO-01 (index 16)
	ao1 := pts[16]
	if ao1.ID != "AO-01" {
		t.Errorf("AO-01 id = %q, want AO-01", ao1.ID)
	}
	if ao1.Kind != "AO" {
		t.Errorf("AO-01 kind = %q, want AO", ao1.Kind)
	}

	// DO-01 (index 20)
	do1 := pts[20]
	if do1.ID != "DO-01" {
		t.Errorf("DO-01 id = %q, want DO-01", do1.ID)
	}
	if do1.Kind != "DO" {
		t.Errorf("DO-01 kind = %q, want DO", do1.Kind)
	}

	// AV1 (index 24)
	av1 := pts[24]
	if av1.ID != "AV1" {
		t.Errorf("AV1 id = %q, want AV1", av1.ID)
	}
	if av1.Kind != "virtual" {
		t.Errorf("AV1 kind = %q, want virtual", av1.Kind)
	}

	// BV1 (index 56)
	bv1 := pts[56]
	if bv1.ID != "BV1" {
		t.Errorf("BV1 id = %q, want BV1", bv1.ID)
	}

	// MSV1 (index 72)
	msv1 := pts[72]
	if msv1.ID != "MSV1" {
		t.Errorf("MSV1 id = %q, want MSV1", msv1.ID)
	}
}

func TestDecodePointsInvalidSHM(t *testing.T) {
	// Magic mismatch — decodePoints guard checks len < kxPlcShmMinLen
	data := []byte{0x00, 0x00, 0x00, 0x00}
	pts := decodePoints(data, nil)
	if len(pts) != 0 {
		t.Errorf("expected 0 points for short data, got %d", len(pts))
	}
}

func TestDecodePointsBadQualityFault(t *testing.T) {
	data := make([]byte, kxPlcShmMinLen)
	binary.LittleEndian.PutUint32(data[0:4], kxShmMagic)
	setPoint(data, offAI, 0.0, 2) // UI-01: bad quality
	pts := decodePoints(data, nil)
	ai1 := pts[0]
	if ai1.Quality != "bad" {
		t.Errorf("UI-01 quality = %q, want bad", ai1.Quality)
	}
	if !ai1.Fault {
		t.Errorf("UI-01 fault = false, want true (bad quality must set fault)")
	}
}

func TestDecodePointsIOUnit(t *testing.T) {
	plcData := make([]byte, kxPlcShmMinLen)
	binary.LittleEndian.PutUint32(plcData[0:4], kxShmMagic)
	setPoint(plcData, offAI, 25.0, 0) // UI-01 good

	// Build fake io_shm v4 with unit + raw metadata.
	ioData := make([]byte, kxIOShmMinLen)
	binary.LittleEndian.PutUint32(ioData[0:4], kxShmMagic)
	copy(ioData[offIOUnit:], []byte("degC\x00\x00\x00\x00"))
	copy(ioData[offIOUnit+kxIOUnitSize:], []byte("V\x00\x00\x00\x00\x00\x00\x00"))
	binary.LittleEndian.PutUint32(ioData[offIORaw:], float32bits(2.5))
	copy(ioData[offIORawUnit:], []byte("V\x00\x00\x00\x00\x00\x00\x00"))

	pts := decodePoints(plcData, ioData)
	if pts[0].Unit != "degC" {
		t.Errorf("UI-01 unit = %q, want degC", pts[0].Unit)
	}
	if pts[0].Raw == nil || *pts[0].Raw != 2.5 || pts[0].RawUnit != "V" {
		t.Errorf("UI-01 raw = %v %q, want 2.5 V", pts[0].Raw, pts[0].RawUnit)
	}
	if pts[1].Unit != "V" {
		t.Errorf("UI-02 unit = %q, want V", pts[1].Unit)
	}
	// AI3 (no unit set) should be empty string
	if pts[2].Unit != "" {
		t.Errorf("UI-03 unit = %q, want empty", pts[2].Unit)
	}
}

func TestDecodePointsBoolUnitOmitsRaw(t *testing.T) {
	plcData := make([]byte, kxPlcShmMinLen)
	binary.LittleEndian.PutUint32(plcData[0:4], kxShmMagic)
	setPoint(plcData, offAI, 1.0, 0)

	ioData := make([]byte, kxIOShmMinLen)
	binary.LittleEndian.PutUint32(ioData[0:4], kxShmMagic)
	copy(ioData[offIOUnit:], []byte("bool\x00\x00\x00\x00"))

	pts := decodePoints(plcData, ioData)
	if pts[0].Value != true {
		t.Errorf("UI-01 value = %#v, want true", pts[0].Value)
	}
	if pts[0].Raw != nil || pts[0].RawUnit != "" {
		t.Errorf("UI-01 raw = %v %q, want omitted", pts[0].Raw, pts[0].RawUnit)
	}
}

func TestReadIOStatusUsesV4IOPStatusOffset(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mkddc_io_shm")
	data := make([]byte, kxIOShmMinLen)
	binary.LittleEndian.PutUint32(data[0:4], kxShmMagic)
	data[offIOPStatus] = 2   // real iop_status: SAFE
	data[offIOPStatus+4] = 0 // padding after mcu_temp_x10; old-style bug would read NORMAL
	binary.LittleEndian.PutUint32(data[offIOCRCErrors:offIOCRCErrors+4], 3)
	binary.LittleEndian.PutUint32(data[offIOTimeouts:offIOTimeouts+4], 4)
	binary.LittleEndian.PutUint32(data[offIOSeqErrors:offIOSeqErrors+4], 5)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}

	status, err := (&CoreClient{IOShm: path}).readIOStatus()
	if err != nil {
		t.Fatal(err)
	}
	if status.Status != "safe" {
		t.Fatalf("status = %q, want safe", status.Status)
	}
	if status.CRCErrors != 3 || status.Timeouts != 4 || status.SeqErrors != 5 {
		t.Fatalf("metrics = %#v, want crc=3 timeout=4 seq=5", status)
	}
}

func setPoint(data []byte, offset int, value float32, quality uint8) {
	binary.LittleEndian.PutUint32(data[offset+0:offset+4], float32bits(value))
	data[offset+72] = quality
}

func float32bits(f float32) uint32 {
	return *(*uint32)(unsafe.Pointer(&f))
}
