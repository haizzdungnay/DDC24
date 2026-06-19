package main

import (
	"encoding/binary"
	"testing"
	"unsafe"
)

func TestDecodePoints(t *testing.T) {
	data := make([]byte, 8672)
	binary.LittleEndian.PutUint32(data[0:4], 0x4B584401)

	// AI1 at offAI=16, AI2 at 16+76=92
	setPoint(data, 16, 42.5, 0)
	setPoint(data, 92, 99.0, 1) // AI2: uncertain

	// AO1 at offAO=1232, value=5.0
	setPoint(data, 1232, 5.0, 0)

	// DO1 at offBO=1536, value=1.0 (ON)
	setPoint(data, 1536, 1.0, 0)

	// AV1 at offAV=1840, value=3.14
	setPoint(data, 1840, 3.14, 0)

	// BV1 at offBV=4272, value=0.0
	setPoint(data, 4272, 0.0, 0)

	// MSV1 at offMSV=5488
	setPoint(data, 5488, 123.0, 0)

	pts := decodePoints(data, nil)

	// Total: 8 AI + 8 DI + 4 AO + 4 DO + 32 AV + 16 BV + 8 MSV = 80
	if len(pts) != 80 {
		t.Errorf("expected 80 points, got %d", len(pts))
	}

	// Find AI1 (index 0)
	ai1 := pts[0]
	if ai1.ID != "AI1" {
		t.Errorf("AI1 id = %q, want AI1", ai1.ID)
	}
	if ai1.Kind != "AI" {
		t.Errorf("AI1 kind = %q, want AI", ai1.Kind)
	}
	if ai1.Quality != "good" {
		t.Errorf("AI1 quality = %q, want good", ai1.Quality)
	}
	if ai1.Fault {
		t.Errorf("AI1 fault = true, want false")
	}

	// AI2 (uncertain) — only "bad" quality sets fault=true
	ai2 := pts[1]
	if ai2.Quality != "uncertain" {
		t.Errorf("AI2 quality = %q, want uncertain", ai2.Quality)
	}
	if ai2.Fault {
		t.Errorf("AI2 fault = true, want false (uncertain is not fault)")
	}

	// Find DI1 (index 8)
	di1 := pts[8]
	if di1.ID != "DI1" {
		t.Errorf("DI1 id = %q, want DI1", di1.ID)
	}
	if di1.Kind != "DI" {
		t.Errorf("DI1 kind = %q, want DI", di1.Kind)
	}

	// AO1 (index 16)
	ao1 := pts[16]
	if ao1.ID != "AO1" {
		t.Errorf("AO1 id = %q, want AO1", ao1.ID)
	}
	if ao1.Kind != "AO" {
		t.Errorf("AO1 kind = %q, want AO", ao1.Kind)
	}

	// DO1 (index 20)
	do1 := pts[20]
	if do1.ID != "DO1" {
		t.Errorf("DO1 id = %q, want DO1", do1.ID)
	}
	if do1.Kind != "DO" {
		t.Errorf("DO1 kind = %q, want DO", do1.Kind)
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
	data := make([]byte, 8672)
	binary.LittleEndian.PutUint32(data[0:4], 0x4B584401)
	setPoint(data, 16, 0.0, 2) // AI1: bad quality
	pts := decodePoints(data, nil)
	ai1 := pts[0]
	if ai1.Quality != "bad" {
		t.Errorf("AI1 quality = %q, want bad", ai1.Quality)
	}
	if !ai1.Fault {
		t.Errorf("AI1 fault = false, want true (bad quality must set fault)")
	}
}

func TestDecodePointsIOUnit(t *testing.T) {
	plcData := make([]byte, 8672)
	binary.LittleEndian.PutUint32(plcData[0:4], 0x4B584401)
	setPoint(plcData, 16, 25.0, 0) // AI1 good

	// Build fake io_shm with magic + ui_unit at offset 56
	ioData := make([]byte, 216)
	binary.LittleEndian.PutUint32(ioData[0:4], 0x4B584401)
	// ui_unit[0] = "degC\0..." at offset 56
	copy(ioData[56:], []byte("degC\x00\x00\x00\x00"))
	// ui_unit[1] = "V\0..." at offset 64
	copy(ioData[64:], []byte("V\x00\x00\x00\x00\x00\x00\x00"))

	pts := decodePoints(plcData, ioData)
	if pts[0].Unit != "degC" {
		t.Errorf("AI1 unit = %q, want degC", pts[0].Unit)
	}
	if pts[1].Unit != "V" {
		t.Errorf("AI2 unit = %q, want V", pts[1].Unit)
	}
	// AI3 (no unit set) should be empty string
	if pts[2].Unit != "" {
		t.Errorf("AI3 unit = %q, want empty", pts[2].Unit)
	}
}

func setPoint(data []byte, offset int, value float32, quality uint8) {
	binary.LittleEndian.PutUint32(data[offset+0:offset+4], float32bits(value))
	data[offset+72] = quality
}

func float32bits(f float32) uint32 {
	return *(*uint32)(unsafe.Pointer(&f))
}
