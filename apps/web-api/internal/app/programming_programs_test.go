package app

import (
	"context"
	"encoding/json"
	"sync/atomic"
	"testing"
)

// T60-011 — hợp đồng quan trọng nhất của bước decode nằm ở chỗ KHÔNG có dữ liệu:
// khoá `programs` VẮNG và mảng `programs` RỖNG là hai câu trả lời khác nhau và
// phía đọc phải phân biệt được.
//
//	vắng ⇒ nil ⇒ Core đời cũ chưa biết trường này ⇒ UNAVAILABLE
//	[]   ⇒ slice rỗng non-nil ⇒ Core sống, hệ không có Program nào
//
// Trộn hai thứ này sẽ báo "không có Program nào" cho một bo mà web-api thật ra
// không đọc được gì.
func TestCorePointSnapshotDistinguishesMissingProgramsFromEmptyArray(t *testing.T) {
	atomic.StoreUint64(&webCommandID, 900)
	path, _ := fakeCoreSocket(t, `{"id":901,"result":"accepted","snapshotId":7,"snapshotObservedAtUtc":"2026-08-23T10:00:00.500Z","capturedMonotonicNs":456,"points":[]}`)
	legacy, err := (&CoreClient{SockPath: path}).ReadPointSnapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if legacy.Programs != nil {
		t.Fatalf("khoá `programs` vắng phải ra nil, nhận %#v", legacy.Programs)
	}

	atomic.StoreUint64(&webCommandID, 910)
	path, _ = fakeCoreSocket(t, `{"id":911,"result":"accepted","snapshotId":8,"snapshotObservedAtUtc":"2026-08-23T10:00:01.500Z","capturedMonotonicNs":556,"programs":[],"programsTruncated":false,"points":[]}`)
	empty, err := (&CoreClient{SockPath: path}).ReadPointSnapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if empty.Programs == nil {
		t.Fatal("mảng rỗng phải ra slice non-nil — đó là câu trả lời hợp lệ của Core đang sống")
	}
	if len(empty.Programs) != 0 || empty.ProgramsTruncated {
		t.Fatalf("programs = %#v truncated=%v", empty.Programs, empty.ProgramsTruncated)
	}
}

// TestCorePointSnapshotDecodesProgramRow khoá tên field khớp NGUYÊN VĂN JSON của
// Core, đặc biệt hai trường rất dễ đọc nhầm nhau: `lastExecNs` (THỜI LƯỢNG một
// lần chạy) và `lastRunMonoNs` (MỐC lần chạy gần nhất).
func TestCorePointSnapshotDecodesProgramRow(t *testing.T) {
	atomic.StoreUint64(&webCommandID, 920)
	path, _ := fakeCoreSocket(t, `{"id":921,"result":"accepted","snapshotId":9,"snapshotObservedAtUtc":"2026-08-23T10:00:02.500Z","capturedMonotonicNs":9000000000,"programs":[{"instanceId":"prog-ahu-supply","state":"RUNNING","enabled":true,"periodMs":1000,"lastExecNs":12000000,"maxExecNs":41500000,"missedReleaseCount":3,"consecutiveMissedRelease":0,"lastRunMonoNs":8500000000,"lane":0}],"programsTruncated":true,"points":[]}`)
	snapshot, err := (&CoreClient{SockPath: path}).ReadPointSnapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Programs) != 1 || !snapshot.ProgramsTruncated {
		t.Fatalf("snapshot = %+v", snapshot)
	}
	program := snapshot.Programs[0]
	if program.InstanceID != "prog-ahu-supply" || program.State != "RUNNING" || !program.Enabled ||
		program.PeriodMS != 1000 || program.Lane != 0 {
		t.Fatalf("identity/chu kỳ sai: %+v", program)
	}
	if program.LastExecNS != 12_000_000 || program.MaxExecNS != 41_500_000 {
		t.Fatalf("thời lượng chạy sai: %+v", program)
	}
	if program.LastRunMonoNS != 8_500_000_000 {
		t.Fatalf("mốc lần chạy gần nhất sai — `lastExecNs` KHÔNG phải mốc: %+v", program)
	}
	if program.MissedReleaseCount != 3 || program.ConsecutiveMissedRelease != 0 {
		t.Fatalf("hai bộ đếm lỡ nhịp phải tách rời: %+v", program)
	}
}

// TestWebIPCResponseKeepsProgramsNilness canh đúng chỗ dễ hỏng khi ai đó "dọn
// dẹp" struct decode: thêm `omitempty` hay chuẩn hoá nil thành `[]` ở tầng này
// sẽ xoá mất sự phân biệt mà mọi lớp trên đang dựa vào.
func TestWebIPCResponseKeepsProgramsNilness(t *testing.T) {
	var missing webIPCResponse
	if err := json.Unmarshal([]byte(`{"id":1,"result":"accepted"}`), &missing); err != nil {
		t.Fatal(err)
	}
	if missing.Programs != nil {
		t.Fatalf("programs = %#v; want nil", missing.Programs)
	}
	var null webIPCResponse
	if err := json.Unmarshal([]byte(`{"id":1,"result":"accepted","programs":null}`), &null); err != nil {
		t.Fatal(err)
	}
	if null.Programs != nil {
		t.Fatalf("`programs:null` cũng là không có bảng: %#v", null.Programs)
	}
	var empty webIPCResponse
	if err := json.Unmarshal([]byte(`{"id":1,"result":"accepted","programs":[]}`), &empty); err != nil {
		t.Fatal(err)
	}
	if empty.Programs == nil {
		t.Fatal("`programs:[]` phải ra slice non-nil")
	}
}

// T60-012 — adapter phải chuyển tiếp sự phân biệt nil/rỗng nguyên vẹn sang
// `MonitorTruthSnapshot`, và mang theo `capturedMonotonicNs` (cùng họ đồng hồ
// với `lastRunMonoNs`) để lớp trên tính được tuổi số đo bằng một phép trừ trong
// CÙNG một snapshot.
func TestReadProgrammingMonitorSnapshotForwardsProgramsWithoutFlatteningNil(t *testing.T) {
	app, _ := newTestAppWithAdmin(t)
	app.core = &programmingMonitorCore{
		pointsCore: &pointsCore{},
		snapshot: RuntimePointSnapshot{
			SnapshotObservedAtUTC: "2026-08-23T10:00:02.500Z", CapturedMonotonicNs: 9_000_000_000,
			Programs: []RuntimeProgramSnapshot{{
				InstanceID: "prog-ahu-supply", State: "RUNNING", Enabled: true, PeriodMS: 1000,
				LastExecNS: 12_000_000, MaxExecNS: 41_500_000, MissedReleaseCount: 3,
				ConsecutiveMissedRelease: 1, LastRunMonoNS: 8_500_000_000, Lane: 2,
			}},
			ProgramsTruncated: true,
		},
	}
	truth, err := app.programmingPointCatalog().ReadProgrammingMonitorSnapshot(context.Background())
	if err != nil {
		t.Fatalf("ReadProgrammingMonitorSnapshot: %v", err)
	}
	if truth.CapturedMonotonicNs != 9_000_000_000 || !truth.ProgramsTruncated {
		t.Fatalf("envelope sai: %+v", truth)
	}
	if len(truth.Programs) != 1 {
		t.Fatalf("programs = %+v", truth.Programs)
	}
	program := truth.Programs[0]
	if program.InstanceID != "prog-ahu-supply" || program.State != "RUNNING" || !program.Enabled ||
		program.PeriodMS != 1000 || program.LastExecNS != 12_000_000 || program.MaxExecNS != 41_500_000 ||
		program.MissedReleaseCount != 3 || program.ConsecutiveMissedRelease != 1 ||
		program.LastRunMonoNS != 8_500_000_000 || program.Lane != 2 {
		t.Fatalf("chuyển tiếp số đo sai: %+v", program)
	}

	app.core = &programmingMonitorCore{
		pointsCore: &pointsCore{},
		snapshot: RuntimePointSnapshot{
			SnapshotObservedAtUTC: "2026-08-23T10:00:02.500Z", Programs: nil,
		},
	}
	legacy, err := app.programmingPointCatalog().ReadProgrammingMonitorSnapshot(context.Background())
	if err != nil {
		t.Fatalf("ReadProgrammingMonitorSnapshot: %v", err)
	}
	if legacy.Programs != nil {
		t.Fatalf("Core đời cũ phải đi tiếp thành nil, nhận %#v", legacy.Programs)
	}

	app.core = &programmingMonitorCore{
		pointsCore: &pointsCore{},
		snapshot: RuntimePointSnapshot{
			SnapshotObservedAtUTC: "2026-08-23T10:00:02.500Z",
			Programs:              []RuntimeProgramSnapshot{},
		},
	}
	empty, err := app.programmingPointCatalog().ReadProgrammingMonitorSnapshot(context.Background())
	if err != nil {
		t.Fatalf("ReadProgrammingMonitorSnapshot: %v", err)
	}
	if empty.Programs == nil {
		t.Fatal("mảng rỗng phải giữ được là slice non-nil qua adapter")
	}
	if len(empty.Programs) != 0 {
		t.Fatalf("programs = %+v", empty.Programs)
	}
}
