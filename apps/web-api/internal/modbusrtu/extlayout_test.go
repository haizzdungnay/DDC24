package modbusrtu

import "testing"

/*
`ISS-PIO-31` / `F-PIO-029`. Điều được kiểm ở đây không phải "hàm chạy đúng" mà
là **ba thao tác cấu hình bình thường làm slot dịch chỗ**, và không tầng nào
phát hiện được. Mỗi test dưới đây là một trong ba cơ chế, viết ra thành sự thật
chạy lại được thay vì một đoạn văn trong review.
*/

func device(id string, enabled bool) Device {
	return Device{DeviceID: id, Enabled: FlexBool(enabled)}
}

func point(deviceID, pointID, tag, dataType string, enabled bool) Point {
	return Point{DeviceID: deviceID, PointID: pointID, TagName: tag,
		DataType: dataType, Enabled: FlexBool(enabled)}
}

// Bố cục của kịch bản trong review: VFD-01 rồi PUMP-02.
func scenario() ([]Device, []Point) {
	devices := []Device{device("VFD-01", true), device("PUMP-02", true)}
	points := []Point{
		point("VFD-01", "p-vfd-a", "a_speed", "uint16", true),
		point("VFD-01", "p-vfd-b", "b_current", "uint16", true),
		point("PUMP-02", "p-pump-a", "a_cmd", "uint16", true),
		point("PUMP-02", "p-pump-b", "b_status", "uint16", true),
	}
	return devices, points
}

func TestExtLayoutIsOneBasedAtTheArtifactBoundary(t *testing.T) {
	devices, points := scenario()
	layout := BuildExtLayout(devices, points)

	/* Seam 0-based ↔ 1-based, khoá cả hai đầu như review yêu cầu: allocator
	 * `iobus` đếm từ 0, artifact/io_map kiểm `>= 1`. Điểm ĐẦU TIÊN phải là 1,
	 * không phải 0 — phát thẳng `ext_idx` thô sẽ lệch đúng một thanh ghi và
	 * vẫn hợp lệ với mọi phép kiểm hiện có. */
	first, ok := layout.Lookup("VFD-01", "p-vfd-a")
	if !ok || first.ExtIndex != 1 {
		t.Fatalf("điểm đầu tiên phải là extIndex=1 (0-based 0), nhận %+v ok=%v", first, ok)
	}
	if len(layout.Slots) != 4 {
		t.Fatalf("bố cục thiếu điểm: %d", len(layout.Slots))
	}
}

func TestExtLayoutAdvancesTwoSlotsFor32Bit(t *testing.T) {
	devices := []Device{device("VFD-01", true)}
	points := []Point{
		point("VFD-01", "p-a", "a_power", "float32", true),
		point("VFD-01", "p-b", "b_speed", "uint16", true),
	}
	layout := BuildExtLayout(devices, points)

	// Kiểu 32 bit chiếm HAI thanh ghi; điểm sau nó phải nhảy 2, không phải 1.
	// Sai chỗ này làm mọi điểm phía sau lệch một slot.
	a, _ := layout.Lookup("VFD-01", "p-a")
	b, _ := layout.Lookup("VFD-01", "p-b")
	if a.ExtIndex != 1 || a.RegisterCount != 2 || b.ExtIndex != 3 {
		t.Fatalf("bố cục 32-bit sai: a=%+v b=%+v", a, b)
	}
}

/* --- Ba cơ chế dịch chỗ, mỗi cái một test --- */

func TestDisablingADeviceShiftsEveryPointBehindIt(t *testing.T) {
	devices, points := scenario()
	before := BuildExtLayout(devices, points)
	pumpCmdBefore, _ := before.Lookup("PUMP-02", "p-pump-a")

	// Kỹ sư tắt VFD-01 để bảo trì — một thao tác hoàn toàn bình thường.
	devices[0].Enabled = FlexBool(false)
	after := BuildExtLayout(devices, points)
	pumpCmdAfter, _ := after.Lookup("PUMP-02", "p-pump-a")

	if pumpCmdBefore.ExtIndex == pumpCmdAfter.ExtIndex {
		t.Fatal("test không còn tái hiện được F-PIO-029: tắt thiết bị lẽ ra làm dịch slot")
	}

	/* Đây là chỗ nguy hiểm: binding cũ mang slot của PUMP-02 trước khi dịch,
	 * và slot đó nay thuộc về một điểm KHÁC — vẫn nằm trong dải hợp lệ, nên
	 * `st_io_map.cpp` không thấy gì. `VerifyBinding` phải thấy. */
	mismatch := after.VerifyBinding("PUMP-02", "p-pump-a", pumpCmdBefore.ExtIndex)
	if mismatch == nil {
		t.Fatal("binding trỏ sai thanh ghi mà không bị phát hiện — đúng lỗ hổng F-PIO-029")
	}
	if mismatch.GotExt != pumpCmdAfter.ExtIndex {
		t.Fatalf("thông báo phải nói điểm giờ ở đâu: %+v", mismatch)
	}
}

func TestDisablingAPointShiftsEveryPointBehindItInTheSameDevice(t *testing.T) {
	devices, points := scenario()
	before := BuildExtLayout(devices, points)
	statusBefore, _ := before.Lookup("PUMP-02", "p-pump-b")

	// Tắt điểm đứng trước trong cùng thiết bị.
	points[2].Enabled = FlexBool(false)
	after := BuildExtLayout(devices, points)

	if mismatch := after.VerifyBinding("PUMP-02", "p-pump-b", statusBefore.ExtIndex); mismatch == nil {
		t.Fatal("tắt một điểm làm dịch điểm sau nó mà không ai phát hiện")
	}
}

func TestRenamingAPointReordersTheWholeDevice(t *testing.T) {
	devices, points := scenario()
	before := BuildExtLayout(devices, points)
	cmdBefore, _ := before.Lookup("PUMP-02", "p-pump-a")

	/* `BuildProfile` sắp theo TÊN, nên đổi tên một điểm đổi thứ tự cả thiết
	 * bị. Danh tính bền (`pointId`) không đổi — chỉ nhãn hiển thị đổi — nhưng
	 * slot thì đổi. Đó chính là điều `AC-PIO-ID-01` nói: `extIndex` không phải
	 * danh tính. */
	points[2].TagName = "z_cmd"
	after := BuildExtLayout(devices, points)
	cmdAfter, _ := after.Lookup("PUMP-02", "p-pump-a")

	if cmdBefore.ExtIndex == cmdAfter.ExtIndex {
		t.Fatal("đổi tên lẽ ra làm đổi thứ tự — test không còn tái hiện được cơ chế")
	}
	if mismatch := after.VerifyBinding("PUMP-02", "p-pump-a", cmdBefore.ExtIndex); mismatch == nil {
		t.Fatal("đổi tên làm binding trỏ sai thanh ghi mà không ai phát hiện")
	}
}

func TestVerifyBindingPassesWhenNothingMoved(t *testing.T) {
	// Chiều ngược lại, quan trọng không kém: một cổng báo động khi KHÔNG có gì
	// sai sẽ bị tắt trong tuần đầu.
	devices, points := scenario()
	layout := BuildExtLayout(devices, points)
	for _, slot := range layout.Slots {
		if mismatch := layout.VerifyBinding(slot.DeviceID, slot.PointID, slot.ExtIndex); mismatch != nil {
			t.Fatalf("báo lệch giả cho binding đúng: %v", mismatch)
		}
	}
}

func TestVerifyBindingNamesTheNewOccupantOfTheSlot(t *testing.T) {
	devices, points := scenario()
	devices[0].Enabled = FlexBool(false)
	after := BuildExtLayout(devices, points)

	// Slot 1 trước thuộc VFD-01, nay thuộc PUMP-02. Thông báo phải nói ra —
	// "binding không hợp lệ" không đủ để người vận hành biết chuyện gì xảy ra.
	mismatch := after.VerifyBinding("VFD-01", "p-vfd-a", 1)
	if mismatch == nil {
		t.Fatal("điểm của thiết bị đã tắt vẫn được coi là hợp lệ")
	}
	if mismatch.GotExt != 0 {
		t.Fatalf("điểm không còn trong cấu hình phải có GotExt=0: %+v", mismatch)
	}
	if want := "PUMP-02"; !contains(mismatch.Reason, want) {
		t.Fatalf("thông báo không nói slot nay thuộc về ai: %q", mismatch.Reason)
	}
}

func contains(haystack, needle string) bool {
	return len(haystack) >= len(needle) && (func() bool {
		for i := 0; i+len(needle) <= len(haystack); i++ {
			if haystack[i:i+len(needle)] == needle {
				return true
			}
		}
		return false
	})()
}
