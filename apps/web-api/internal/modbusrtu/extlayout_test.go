package modbusrtu

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

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

func TestExtLayoutAdvancesOneSlotFor32Bit(t *testing.T) {
	devices := []Device{device("VFD-01", true)}
	points := []Point{
		point("VFD-01", "p-a", "a_power", "float32", true),
		point("VFD-01", "p-b", "b_speed", "uint16", true),
	}
	layout := BuildExtLayout(devices, points)

	/* Kiểu 32 bit chiếm HAI THANH GHI trên dây nhưng ĐÚNG MỘT SLOT `ext`:
	 * `ext_slots_for_point` trả `pt.count / 2` cho kiểu 32 bit, và
	 * `bus_worker.cpp` ghi thẳng "đếm theo ĐIỂM LUẬN LÝ, không theo số
	 * register". Cộng cursor bằng 2 làm mọi điểm phía sau lệch lên một slot so
	 * với runtime — bản đồ nói dối đúng ở ca nó sinh ra để bắt. */
	a, _ := layout.Lookup("VFD-01", "p-a")
	b, _ := layout.Lookup("VFD-01", "p-b")
	if a.ExtIndex != 1 || a.RegisterCount != 2 || b.ExtIndex != 2 {
		t.Fatalf("bố cục 32-bit sai: a=%+v b=%+v (mong đợi a.ext=1, a.reg=2, b.ext=2)", a, b)
	}
}

// TestExtLayoutSortsByPointIDLikeBuildProfile khoá KHOÁ SẮP XẾP.
//
// `BuildProfile` sắp row theo `rows[i]["name"]`, và `name` được gán từ
// `point.PointID`. Sắp bản đồ theo `TagName` cho ra thứ tự khác ngay khi hai
// trường không cùng thứ tự — và `TagName` là nhãn hiển thị, người dùng đổi nó
// thường xuyên. Dữ liệu dưới đây cố ý cho hai khoá NGƯỢC nhau; test cũ dùng dữ
// liệu mà hai khoá trùng thứ tự nên không thấy gì.
func TestExtLayoutSortsByPointIDLikeBuildProfile(t *testing.T) {
	devices := []Device{device("VFD-01", true)}
	points := []Point{
		point("VFD-01", "p-01-dau", "z_nhan_cuoi", "uint16", true),
		point("VFD-01", "p-02-sau", "a_nhan_dau", "uint16", true),
	}
	layout := BuildExtLayout(devices, points)

	first, _ := layout.Lookup("VFD-01", "p-01-dau")
	second, _ := layout.Lookup("VFD-01", "p-02-sau")
	if first.ExtIndex != 1 || second.ExtIndex != 2 {
		t.Fatalf("bản đồ sắp theo TagName thay vì PointID: p-01-dau=%d p-02-sau=%d"+
			" (mong đợi 1 và 2 — BuildProfile sắp theo PointID)",
			first.ExtIndex, second.ExtIndex)
	}
}

// TestExtLayoutMatchesIobusAllocator là CỔNG CHỐNG TRÔI.
//
// `extSlotsForPoint` và khoá sắp xếp ở đây là BẢN CHÉP của hai nơi khác:
// `ext_slots_for_point` trong `device_profile.cpp`, và `BuildProfile` trong
// `persistence.go`. Bản chép không có người canh đúng là cách hai lỗi đầu tiên
// của file này sinh ra. Test đọc thẳng cả hai nguồn và so, nên lần lệch tiếp
// theo đỏ ngay thay vì đi vào bo.
func TestExtLayoutMatchesIobusAllocator(t *testing.T) {
	source := readDeviceProfileSource(t)

	/* Luật 32 bit: HAI thanh ghi gộp thành MỘT điểm luận lý. Nếu dòng này không
	 * còn ở C++ thì `extSlotsForPoint` phải được xem lại cùng lúc. */
	if !strings.Contains(source, "pt.count / 2u") {
		t.Fatal("luật 32-bit ở device_profile.cpp đã đổi; cập nhật extSlotsForPoint cùng lúc")
	}
	if !strings.Contains(source, "if (pt.fc == 1 || pt.fc == 2) return pt.count;") {
		t.Fatal("luật bit-FC ở device_profile.cpp đã đổi; cập nhật extSlotsForPoint cùng lúc")
	}

	/* Khoá sắp xếp của profile: `name` phải vẫn là `PointID`. Nếu ai đó đổi nó
	 * sang `TagName`, bản đồ phải đổi theo trong cùng một lần sửa. */
	profileSource := readPersistenceSource(t)
	if !strings.Contains(profileSource, `"name": point.PointID`) {
		t.Fatal("BuildProfile không còn đặt name = PointID; cập nhật khoá sắp xếp của BuildExtLayout cùng lúc")
	}
}

func readDeviceProfileSource(t *testing.T) string {
	t.Helper()
	return readRepoFile(t, filepath.Join("apps", "iobus", "adapters", "modbus_rtu", "device_profile.cpp"))
}

func readPersistenceSource(t *testing.T) string {
	t.Helper()
	return readRepoFile(t, filepath.Join("apps", "web-api", "internal", "modbusrtu", "persistence.go"))
}

func readRepoFile(t *testing.T, relative string) string {
	t.Helper()
	_, current, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("không xác định được vị trí file test")
	}
	root := filepath.Clean(filepath.Join(filepath.Dir(current), "..", "..", "..", ".."))
	path := filepath.Join(root, relative)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("không đọc được authority %s: %v", path, err)
	}
	return string(data)
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

func TestChangingATagNameDoesNotMoveAnySlot(t *testing.T) {
	/* Đính chính so với bản đầu của file này: `BuildProfile` sắp theo
	 * `PointID`, KHÔNG theo `TagName`. Đổi nhãn hiển thị vì thế KHÔNG dịch slot
	 * — và đó là hành vi đúng, vì nhãn không phải danh tính. Test cũ khẳng định
	 * ngược lại và chỉ xanh nhờ bản đồ khi ấy sắp sai khoá. */
	devices, points := scenario()
	before := BuildExtLayout(devices, points)
	cmdBefore, _ := before.Lookup("PUMP-02", "p-pump-a")

	points[2].TagName = "z_cmd"
	after := BuildExtLayout(devices, points)
	cmdAfter, _ := after.Lookup("PUMP-02", "p-pump-a")

	if cmdBefore.ExtIndex != cmdAfter.ExtIndex {
		t.Fatalf("đổi nhãn hiển thị KHÔNG được dịch slot: %d -> %d",
			cmdBefore.ExtIndex, cmdAfter.ExtIndex)
	}
	if mismatch := after.VerifyBinding("PUMP-02", "p-pump-a", cmdBefore.ExtIndex); mismatch != nil {
		t.Fatalf("báo lệch giả sau khi chỉ đổi nhãn: %v", mismatch)
	}
}

func TestChangingAPointIDReordersTheWholeDevice(t *testing.T) {
	devices, points := scenario()
	before := BuildExtLayout(devices, points)
	cmdBefore, _ := before.Lookup("PUMP-02", "p-pump-a")

	/* Cơ chế THẬT: thứ tự profile theo `PointID`. Một điểm mới chen vào giữa —
	 * hoặc `pointId` đổi khi nhập lại cấu hình — dịch mọi điểm phía sau, dù
	 * không ai đụng vào chúng. `extIndex` không phải danh tính (`AC-PIO-ID-01`). */
	points = append(points, point("PUMP-02", "p-pump-0", "aa_moi", "uint16", true))
	after := BuildExtLayout(devices, points)
	cmdAfter, _ := after.Lookup("PUMP-02", "p-pump-a")

	if cmdBefore.ExtIndex == cmdAfter.ExtIndex {
		t.Fatal("chen một điểm đứng trước lẽ ra làm dịch slot — test không còn tái hiện được cơ chế")
	}
	if mismatch := after.VerifyBinding("PUMP-02", "p-pump-a", cmdBefore.ExtIndex); mismatch == nil {
		t.Fatal("binding trỏ sai thanh ghi mà không ai phát hiện")
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

// `AC-PIO-ID-02` — bố cục phải chở theo THỨ SLOT TRỎ TỚI, không chỉ số slot.
// Không có bốn trường này thì tầng trên chỉ đối chiếu được `extIndex`, mà
// `extIndex` giữ nguyên vẫn có thể trỏ vào một thanh ghi/kiểu/quyền khác.
func TestExtLayoutCarriesRegisterTargetOfEachSlot(t *testing.T) {
	devices := []Device{{DeviceID: "bus-1-slave-2", Enabled: true}}
	points := []Point{{
		PointID: "PUMP_CMD", DeviceID: "bus-1-slave-2", Enabled: true,
		RegisterType: "holding_register", Address: 40001, DataType: "uint16", ReadWrite: "read_write",
	}}

	slot, ok := BuildExtLayout(devices, points).Lookup("bus-1-slave-2", "PUMP_CMD")
	if !ok {
		t.Fatal("không tra được slot vừa dựng")
	}
	if slot.RegisterType != "holding_register" || slot.Address != 40001 ||
		slot.DataType != "uint16" || slot.ReadWrite != "read_write" {
		t.Fatalf("slot phải chở đủ register/address/datatype/access, nhận %+v", slot)
	}
}
