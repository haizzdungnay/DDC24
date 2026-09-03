package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

/* `ISS-PIO-03`/`F-PIO-003` — allocator slot cho Virtual Point.
 *
 * Con bug: VP tạo từ giao diện KHÔNG BAO GIỜ map được vào biến chương trình, vì
 * không ai gán `boundPointId`, nên Catalog phát `"VP12"` và eligibility kết
 * luận `UNSUPPORTED_IDENTITY`. Đường duy nhất là `curl` với `boundPointId` thủ
 * công. Mỗi test dưới đây khoá đúng một gạch đầu dòng trong điều kiện đóng. */

func vpItem(id, signalType, bound string) VirtualPoint {
	return VirtualPoint{ID: id, SignalType: signalType, BoundPointID: bound, Enabled: true}
}

func boundIDs(cfg ConfigVirtualPoints) []string {
	out := make([]string, 0, len(cfg.Items))
	for _, item := range cfg.Items {
		out = append(out, item.BoundPointID)
	}
	return out
}

// QUY TẮC CẤP PHÁT: `boolean` → BV, `integer`/`float` → AV.
func TestAllocatorAssignsPoolBySignalType(t *testing.T) {
	cfg, errs := assignVirtualPointSlots(ConfigVirtualPoints{Items: []VirtualPoint{
		vpItem("VP1", virtualPointSignalFloat, ""),
		vpItem("VP2", virtualPointSignalBoolean, ""),
		vpItem("VP3", virtualPointSignalInteger, ""),
	}})
	if len(errs) != 0 {
		t.Fatalf("cấp phát báo lỗi: %+v", errs)
	}
	want := []string{"AV-01", "BV-01", "AV-02"}
	for i, expected := range want {
		if cfg.Items[i].BoundPointID != expected {
			t.Fatalf("slot[%d] = %q (chờ %q); toàn bộ = %v", i, cfg.Items[i].BoundPointID, expected, boundIDs(cfg))
		}
	}
}

// Kiểu không có slot ở Core thì KHÔNG cấp — đó là câu trả lời đúng, không phải
// thiếu sót. Cấp bừa một slot `AV` cho một chuỗi là bịa ra một đích không đọc
// được.
func TestAllocatorLeavesTypesWithoutPoolUnbound(t *testing.T) {
	cfg, errs := assignVirtualPointSlots(ConfigVirtualPoints{Items: []VirtualPoint{
		vpItem("VP1", virtualPointSignalString, ""),
		vpItem("VP2", virtualPointSignalDateTime, ""),
	}})
	if len(errs) != 0 {
		t.Fatalf("cấp phát báo lỗi: %+v", errs)
	}
	for _, item := range cfg.Items {
		if item.BoundPointID != "" {
			t.Fatalf("VP kiểu %s được cấp slot %q — Core không có slot mang kiểu đó", item.SignalType, item.BoundPointID)
		}
	}
}

// COLLISION: slot đang bị giữ không bao giờ được phát lại — KỂ CẢ khi VP giữ nó
// đang tắt. Bỏ qua VP tắt sẽ khiến bật lại một VP cũ trở thành hành động cướp
// slot của VP mới.
func TestAllocatorNeverIssuesASlotAlreadyHeld(t *testing.T) {
	disabled := vpItem("VP1", virtualPointSignalFloat, "AV-02")
	disabled.Enabled = false
	cfg, errs := assignVirtualPointSlots(ConfigVirtualPoints{Items: []VirtualPoint{
		disabled,
		vpItem("VP2", virtualPointSignalFloat, ""),
	}})
	if len(errs) != 0 {
		t.Fatalf("cấp phát báo lỗi: %+v", errs)
	}
	if cfg.Items[1].BoundPointID == "AV-02" {
		t.Fatalf("cấp lại slot đang bị VP tắt giữ: %v", boundIDs(cfg))
	}
	if cfg.Items[1].BoundPointID != "AV-03" {
		t.Fatalf("slot mới = %q (chờ AV-03, ngay sau mốc cao nhất từng cấp)", cfg.Items[1].BoundPointID)
	}
}

// VP đã có `boundPointId` KHÔNG bị đụng tới: gán đè là tự ý đổi đích của một
// binding đang chạy.
func TestAllocatorNeverOverwritesAnExistingBinding(t *testing.T) {
	cfg, _ := assignVirtualPointSlots(ConfigVirtualPoints{Items: []VirtualPoint{
		vpItem("VP1", virtualPointSignalFloat, "AV-07"),
	}})
	if cfg.Items[0].BoundPointID != "AV-07" {
		t.Fatalf("binding sẵn có bị đổi thành %q", cfg.Items[0].BoundPointID)
	}
}

/* DELETE / REUSE — điểm cốt lõi.
 *
 * Một Program bind vào `AV-02`. Xoá VP đang giữ `AV-02` rồi tạo VP mới: nếu
 * allocator nhặt lại `AV-02` thì chương trình ÂM THẦM chuyển sang ghi vào VP
 * khác, và Catalog vẫn có mục `AV-02` nên Check vẫn nói "khớp". Đó đúng lớp lỗi
 * `ISS-PIO-31` vừa dẹp ở phía Modbus. */
func TestAllocatorDoesNotSilentlyRecycleAFreedSlot(t *testing.T) {
	afterDelete := ConfigVirtualPoints{Items: []VirtualPoint{
		vpItem("VP1", virtualPointSignalFloat, "AV-01"),
		vpItem("VP3", virtualPointSignalFloat, "AV-03"),
		vpItem("VP4", virtualPointSignalFloat, ""), // VP2 giữ AV-02 vừa bị xoá
	}}
	cfg, errs := assignVirtualPointSlots(afterDelete)
	if len(errs) != 0 {
		t.Fatalf("cấp phát báo lỗi: %+v", errs)
	}
	if cfg.Items[2].BoundPointID == "AV-02" {
		t.Fatalf("nhặt lại slot đã trả về ⇒ binding cũ trỏ sang VP khác trong im lặng")
	}
	if cfg.Items[2].BoundPointID != "AV-04" {
		t.Fatalf("slot mới = %q (chờ AV-04)", cfg.Items[2].BoundPointID)
	}
}

/* HẾT SLOT: hành vi xác định, báo rõ, KHÔNG im lặng — và phải nói ra thu hồi
 * được slot nào. Một thông báo "hết chỗ" không nêu đường thoát thì đẩy người
 * vận hành vào ngõ cụt. */
func TestAllocatorReportsExhaustionAndNamesReclaimableSlots(t *testing.T) {
	items := make([]VirtualPoint, 0, kxNBV+1)
	for channel := 1; channel <= kxNBV; channel++ {
		items = append(items, vpItem(fmt.Sprintf("VP%d", channel), virtualPointSignalBoolean, formatPointID("BV", channel)))
	}
	// Trả lại một slot ở giữa rồi mới xin slot mới.
	items[4].BoundPointID = ""
	items[4].SignalType = virtualPointSignalString // để nó không xin lại slot BV
	items = append(items, vpItem("VP99", virtualPointSignalBoolean, ""))

	_, errs := assignVirtualPointSlots(ConfigVirtualPoints{Items: items})
	if len(errs) != 1 {
		t.Fatalf("chờ đúng một lỗi hết slot, nhận %+v", errs)
	}
	message := errs[0].Message
	if !strings.Contains(message, "hết slot BV") || !strings.Contains(message, "BV-05") {
		t.Fatalf("thông báo hết slot không nêu pool hoặc slot thu hồi được: %q", message)
	}
}

/* PERSISTENCE: sổ cấp phát dựng lại TỪ CHÍNH cấu hình đã lưu, nên nó bền qua
 * reboot mà không cần tệp trạng thái thứ hai. Chạy allocator hai lần trên cùng
 * dữ liệu phải cho cùng kết quả — nếu không, mỗi lần khởi động lại là một lần
 * đổi đích binding. */
func TestAllocatorIsStableAcrossRestarts(t *testing.T) {
	first, _ := assignVirtualPointSlots(ConfigVirtualPoints{Items: []VirtualPoint{
		vpItem("VP1", virtualPointSignalFloat, ""),
		vpItem("VP2", virtualPointSignalBoolean, ""),
	}})
	second, _ := assignVirtualPointSlots(first)
	for i := range first.Items {
		if first.Items[i].BoundPointID != second.Items[i].BoundPointID {
			t.Fatalf("chạy lại đổi slot: %v → %v", boundIDs(first), boundIDs(second))
		}
	}
}

/* Đường đi thật của con bug: tạo VP qua API rồi hỏi Catalog. Trước bản vá,
 * `pointId` là `"VP1"` và eligibility trả `UNSUPPORTED_IDENTITY`. */
func TestVirtualPointCreatedThroughApiIsMappable(t *testing.T) {
	app, token := newTestAppWithRole(t, RoleAdmin, fakeCore{})
	req := newAuthRequest(http.MethodPost, "/api/v1/virtual-points",
		`{"tag":"zone setpoint","signalType":"float","enabled":true,"writable":true,"value":22}`, token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("create status = %d body=%s", w.Code, w.Body.String())
	}
	var created VirtualPoint
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	if created.BoundPointID != "AV-01" {
		t.Fatalf("VP tạo qua API có boundPointId = %q; chờ AV-01 — không có nó thì VP không map được vào biến chương trình (F-PIO-003)", created.BoundPointID)
	}
}
