package main

import (
	"bufio"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"
	"unsafe"
)

func fakeCoreSocket(t *testing.T, response string) (string, <-chan map[string]any) {
	t.Helper()
	path := filepath.Join(os.TempDir(), fmt.Sprintf("mkddc-core-test-%d-%d.sock", os.Getpid(), time.Now().UnixNano()))
	_ = os.Remove(path)
	ln, err := net.Listen("unix", path)
	if err != nil {
		t.Skipf("unix socket unavailable: %v", err)
	}
	t.Cleanup(func() {
		_ = ln.Close()
		_ = os.Remove(path)
	})

	cmdCh := make(chan map[string]any, 1)
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		line, err := bufio.NewReader(conn).ReadBytes('\n')
		if err != nil {
			return
		}
		var cmd map[string]any
		if err := json.Unmarshal(line, &cmd); err == nil {
			cmdCh <- cmd
		}
		_, _ = conn.Write([]byte(response + "\n"))
	}()
	return path, cmdCh
}

func readFakeCommand(t *testing.T, cmdCh <-chan map[string]any) map[string]any {
	t.Helper()
	select {
	case cmd := <-cmdCh:
		return cmd
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for fake core command")
		return nil
	}
}

func TestReadAlarmsUsesCoreIPCAndMapsDTO(t *testing.T) {
	path, cmdCh := fakeCoreSocket(t, `{"id":7,"result":"accepted","alarms":[{"id":"ALM-1","alarmSettingId":"ALM-1","time":"2026-07-02T08:15:30Z","status":"active","sourcePointId":"UI-01","value":31.8,"triggerLevel":"HH","threshold":30,"priority":"high","label":"Supply air","alarmType":1,"occurrence":2,"active":true}]}`)
	alarms, err := (&CoreClient{SockPath: path}).ReadAlarms(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	cmd := readFakeCommand(t, cmdCh)
	if cmd["op"] != "alarm_list" || cmd["user"] != "web" {
		t.Fatalf("command = %#v, want alarm_list from web", cmd)
	}
	if len(alarms) != 1 {
		t.Fatalf("len(alarms) = %d, want 1", len(alarms))
	}
	got := alarms[0]
	if got.ID != "ALM-1" || got.Severity != "high" || got.Status != "active" {
		t.Fatalf("alarm identity/status = %#v", got)
	}
	if got.Message != "Supply air" || got.Source != "UI-01" || got.Value != "31.8" {
		t.Fatalf("alarm display fields = %#v", got)
	}
	if got.TriggerLevel != "HH" || got.Threshold != "30" {
		t.Fatalf("alarm trigger fields = %#v", got)
	}
	if !got.Active {
		t.Fatalf("alarm active = false, want true")
	}
	if got.Returnable == nil || !*got.Returnable {
		t.Fatalf("alarm returnable = %#v, want true", got.Returnable)
	}
	if got.Detail != "trip=HH threshold=30 current=31.8 (High-high); occurrence=2" {
		t.Fatalf("detail = %q", got.Detail)
	}
}

func TestAckAlarmUsesCoreIPC(t *testing.T) {
	path, cmdCh := fakeCoreSocket(t, `{"id":8,"result":"accepted","alarmId":"ALM-1"}`)
	permanent := true
	if err := (&CoreClient{SockPath: path}).AckAlarm(context.Background(), " ALM-1 ", AlarmActionRequest{Permanent: &permanent}); err != nil {
		t.Fatal(err)
	}
	cmd := readFakeCommand(t, cmdCh)
	if cmd["op"] != "alarm_ack" || cmd["alarmId"] != "ALM-1" || cmd["user"] != "web" || cmd["permanent"] != true {
		t.Fatalf("command = %#v, want alarm_ack ALM-1 from web", cmd)
	}
}

func TestHMICommandPointForwardsTTLAndActorToCore(t *testing.T) {
	path, cmdCh := fakeCoreSocket(t, `{"id":8,"result":"accepted","applied_value":7.5,"active_source":"manual","remaining_ttl_s":300}`)
	point, err := (&CoreClient{SockPath: path}).CommandPoint(
		context.Background(), "AO-01", 7.5, false, 300, "hmi:operator")
	if err != nil {
		t.Fatal(err)
	}
	cmd := readFakeCommand(t, cmdCh)
	if cmd["op"] != "write" || cmd["point"] != "AO1" || cmd["source"] != "manual" ||
		cmd["user"] != "hmi:operator" || cmd["ttlS"] != float64(300) {
		t.Fatalf("command = %#v", cmd)
	}
	if point.Priority != "manual" || point.Value != float64(7.5) {
		t.Fatalf("point = %#v", point)
	}
	if point.OverrideExpiresInS == nil || *point.OverrideExpiresInS != 300 {
		t.Fatalf("expiry = %#v", point.OverrideExpiresInS)
	}
}

func TestHMIAckForwardsActorToCore(t *testing.T) {
	path, cmdCh := fakeCoreSocket(t, `{"id":9,"result":"accepted","alarmId":"ALM-1"}`)
	if err := (&CoreClient{SockPath: path}).AckAlarmAs(
		context.Background(), "ALM-1", AlarmActionRequest{}, "hmi:operator"); err != nil {
		t.Fatal(err)
	}
	cmd := readFakeCommand(t, cmdCh)
	if cmd["op"] != "alarm_ack" || cmd["user"] != "hmi:operator" {
		t.Fatalf("command = %#v", cmd)
	}
}

func TestAckAlarmUnknownMapsError(t *testing.T) {
	path, _ := fakeCoreSocket(t, `{"id":9,"result":"rejected","error":"unknown_alarm"}`)
	err := (&CoreClient{SockPath: path}).AckAlarm(context.Background(), "ALM-missing", AlarmActionRequest{})
	if err == nil || ackAlarmErrorStatus(err) != 404 {
		t.Fatalf("err = %v, want unknown alarm -> 404", err)
	}
}

func TestSuppressAlarmUsesCoreIPC(t *testing.T) {
	path, cmdCh := fakeCoreSocket(t, `{"id":11,"result":"accepted","alarmId":"ALM-1"}`)
	duration := float64(90)
	if err := (&CoreClient{SockPath: path}).SuppressAlarm(context.Background(), " ALM-1 ", AlarmActionRequest{DurationS: &duration}); err != nil {
		t.Fatal(err)
	}
	cmd := readFakeCommand(t, cmdCh)
	if cmd["op"] != "alarm_suppress" || cmd["alarmId"] != "ALM-1" || cmd["user"] != "web" || cmd["durationS"] != float64(90) {
		t.Fatalf("command = %#v, want alarm_suppress ALM-1 durationS=90 from web", cmd)
	}
}

func TestReturnAlarmUsesCoreIPC(t *testing.T) {
	path, cmdCh := fakeCoreSocket(t, `{"id":10,"result":"accepted","alarmId":"ALM-1"}`)
	if err := (&CoreClient{SockPath: path}).ReturnAlarm(context.Background(), " ALM-1 "); err != nil {
		t.Fatal(err)
	}
	cmd := readFakeCommand(t, cmdCh)
	if cmd["op"] != "alarm_return" || cmd["alarmId"] != "ALM-1" || cmd["user"] != "web" {
		t.Fatalf("command = %#v, want alarm_return ALM-1 from web", cmd)
	}
}

func TestAlarmWritesReturnCoreUnavailable(t *testing.T) {
	missing := filepath.Join(os.TempDir(), fmt.Sprintf("mkddc-missing-core-%d-%d.sock", os.Getpid(), time.Now().UnixNano()))
	if err := (&CoreClient{SockPath: missing}).AckAlarm(context.Background(), "ALM-1", AlarmActionRequest{}); !errors.Is(err, errCoreUnavailable) {
		t.Fatalf("AckAlarm err = %v, want core unavailable", err)
	}
	if err := (&CoreClient{SockPath: missing}).SuppressAlarm(context.Background(), "ALM-1", AlarmActionRequest{}); !errors.Is(err, errCoreUnavailable) {
		t.Fatalf("SuppressAlarm err = %v, want core unavailable", err)
	}
	if err := (&CoreClient{SockPath: missing}).ReturnAlarm(context.Background(), "ALM-1"); !errors.Is(err, errCoreUnavailable) {
		t.Fatalf("ReturnAlarm err = %v, want core unavailable", err)
	}
}

func TestReadAlarmsCoreUnavailableReturnsError(t *testing.T) {
	missing := filepath.Join(os.TempDir(), fmt.Sprintf("mkddc-missing-core-%d-%d.sock", os.Getpid(), time.Now().UnixNano()))
	alarms, err := (&CoreClient{SockPath: missing}).ReadAlarms(context.Background())
	if !errors.Is(err, errCoreUnavailable) {
		t.Fatalf("ReadAlarms err = %v, want core unavailable", err)
	}
	if alarms != nil {
		t.Fatalf("alarms = %#v, want nil on core unavailable", alarms)
	}
}

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
