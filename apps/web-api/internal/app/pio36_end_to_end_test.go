package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"mkddc-web/internal/capabilities"
	programmingapplication "mkddc-web/internal/programming/application"
	coreipc "mkddc-web/internal/programming/coreipc"
)

/* `ISS-PIO-36` (#382) — CỔNG V&V ĐẦU-CUỐI CHO LỚP POINT/I/O, kịch bản 3–7.
 *
 * VÌ SAO BỘ NÀY KHÔNG NẰM Ở LỚP ĐƠN VỊ
 * ------------------------------------
 * Thân issue nói thẳng lý do nó ở Đợt 1: "332 test FE hiện xanh trong khi 7
 * finding Cao đang tồn tại — không bộ test nào phủ được các đường đó, nên
 * 'xanh' hiện không chứng minh gì về lớp Point."
 *
 * Mỗi kịch bản dưới đây vì thế phải đi qua ĐÚNG đường mà sản phẩm đi:
 *   - ghi cấu hình THẬT vào `ConfigDir` (`io_config.conf`, `virtual_points.conf`,
 *     `fieldbus.conf`) chứ không dựng struct bằng tay;
 *   - đọc qua ĐÚNG adapter production (`programmingPointCatalog`,
 *     `programmingModbusSlots`) chứ không mock provider;
 *   - hỏi ĐÚNG authority mà Check/Commission hỏi.
 *
 * Cùng nguyên tắc đã dùng cho nhóm `5a…5g` ở
 * `programming_modbus_identity_scenarios_test.go`: một bộ bằng chứng dựng dữ
 * liệu bằng tay sẽ lặp lại đúng lỗ hổng nó sinh ra để bịt.
 *
 * Kịch bản 1, 2 và 8 KHÔNG ở đây: chúng đòi chân "chạy runtime, có giá trị
 * thật"/"giá trị đúng ở thiết bị". Chân đó không dựng lại được trên host bằng
 * Go — phần chứng minh được của kịch bản 8 nằm ở
 * `apps/iobus/adapters/modbus_rtu/tests/test_modbus_master_fake.cpp` (slave RTU
 * thật trên PTY).
 */

// pio36Core là Core giả CHỈ chở đúng danh sách điểm mà một Core thật sẽ chở.
// Nó không tính toán gì: mọi phép biến đổi cần kiểm chứng đều nằm ở phía
// web-api, đúng chỗ bộ bằng chứng này nhắm tới.
type pio36Core struct{ points []PointDTO }

func (c *pio36Core) ReadStatus(context.Context) (CoreStatus, error) { return CoreStatus{}, nil }

func (c *pio36Core) ReadPoints(context.Context) ([]PointDTO, error) {
	return append([]PointDTO(nil), c.points...), nil
}

// pio36Runtime — `NewRuntimeService` đòi một `RuntimeStatusReader`, nhưng không
// kịch bản nào dưới đây hỏi Core về trạng thái runtime. Trả lỗi để nếu một
// đường nào đó lỡ hỏi thì test hỏng to thay vì đọc phải số bịa.
type pio36Runtime struct{}

func (pio36Runtime) Call(context.Context, coreipc.Request) (coreipc.Response, error) {
	return coreipc.Response{}, fmt.Errorf("kịch bản này không hỏi runtime")
}

func pio36RuntimeService(t *testing.T, app *App) *programmingapplication.RuntimeService {
	t.Helper()
	service, err := programmingapplication.NewRuntimeService(programmingapplication.RuntimeServiceOptions{
		Runtime: pio36Runtime{}, ControllerID: "ddc-24-vv",
		Catalog:      app.programmingPointCatalog(),
		CursorSecret: []byte("0123456789abcdef0123456789abcdef"),
		Now:          func() time.Time { return time.Unix(1_760_000_000, 0).UTC() },
	})
	if err != nil {
		t.Fatalf("dựng RuntimeService quanh adapter production: %v", err)
	}
	return service
}

func pio36WriteConfig(t *testing.T, app *App, file string, payload any) {
	t.Helper()
	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal %s: %v", file, err)
	}
	if err := os.WriteFile(filepath.Join(app.cfg.ConfigDir, file), data, 0o644); err != nil {
		t.Fatalf("ghi %s: %v", file, err)
	}
}

/* ---------------------------------------------------------------------------
 * Kịch bản 3 — CATALOG > 500 MỤC (F-PIO-004)
 * ------------------------------------------------------------------------ */

// pio36FullCatalogConfig dựng một cấu hình HỢP LỆ ở đúng trần thật của hệ:
// 24 LOCAL + 464 VP + 256 EXT = 744 điểm. "Vượt 500" không phải ca biên hiếm —
// nó là cấu hình tối đa mà sản phẩm tự nhận là hỗ trợ.
func pio36FullCatalogConfig(t *testing.T, app *App) {
	t.Helper()
	uiRows := make([]map[string]any, 0, 24)
	corePoints := make([]PointDTO, 0, 24+256)
	for channel := 1; channel <= 24; channel++ {
		id := fmt.Sprintf("UI-%02d", channel)
		uiRows = append(uiRows, map[string]any{"ch": channel, "tag": strings.ToLower(id), "type": "0-10V"})
		corePoints = append(corePoints, PointDTO{
			ID: id, Kind: "UI", Value: float32(20), Quality: "good",
			UpdatedAt: "2026-09-05T00:00:00Z",
		})
	}
	pio36WriteConfig(t, app, configGroupIO.file, map[string]any{"ui": uiRows, "ao": []any{}, "do": []any{}})

	vpItems := make([]map[string]any, 0, virtualPointTotalCapacity)
	for index := 1; index <= virtualPointTotalCapacity; index++ {
		vpItems = append(vpItems, map[string]any{
			"id": fmt.Sprintf("VP%d", index), "tag": fmt.Sprintf("vp %03d", index),
			"signalType": "float", "enabled": true, "writable": true, "value": 1.5,
		})
	}
	pio36WriteConfig(t, app, configGroupVirtualPoints.file, map[string]any{"items": vpItems})

	mbPoints := make([]map[string]any, 0, 256)
	for index := 1; index <= 256; index++ {
		pointID := fmt.Sprintf("REG_%03d", index)
		mbPoints = append(mbPoints, map[string]any{
			"point_id": pointID, "device_id": "bus-1-slave-2", "enabled": true,
			"register_type": "holding_register", "address": index, "data_type": "uint16",
			"read_write": "read", "tag_name": strings.ToLower(pointID),
			"display_name": pointID, "scale": 1, "byte_order": "big", "word_order": "high_low",
		})
		corePoints = append(corePoints, PointDTO{
			ID: pointID, Kind: "modbus_rtu", BusID: 1, SlaveAddr: 2,
			Value: float32(index), Quality: "good", UpdatedAt: "2026-09-05T00:00:00Z",
		})
	}
	pio36WriteConfig(t, app, configGroupFieldbus.file, map[string]any{
		"devices": []map[string]any{{"device_id": "bus-1-slave-2", "enabled": true}},
		"points":  mbPoints,
	})
	app.core = &pio36Core{points: corePoints}
}

// pio36WalkCatalog đi hết mọi trang và trả về khoá bền của từng mục theo thứ tự
// nhận được, kèm số trang đã khai "còn nữa".
func pio36WalkCatalog(t *testing.T, service *programmingapplication.RuntimeService,
	limit int) (keys []string, pagesWithMore int) {
	t.Helper()
	cursor := ""
	for page := 0; page < 200; page++ {
		result, err := service.ListPointCatalog(context.Background(), cursor, limit)
		if err != nil {
			t.Fatalf("trang %d: %v", page, err)
		}
		for _, item := range result.Items {
			keys = append(keys, item.Category+"|"+item.DeviceID+"|"+item.PointID)
		}
		if result.NextCursor == nil {
			return keys, pagesWithMore
		}
		pagesWithMore++
		cursor = *result.NextCursor
	}
	t.Fatal("phân trang không kết thúc sau 200 trang")
	return nil, 0
}

/* Cấu hình 744 điểm THẬT, đọc qua đúng adapter production, phân trang tới hết.
 *
 * Test đơn vị `TestCatalogOver500ItemsPaginatesWithoutLosingAny` đã chứng minh
 * LUẬT phân trang đúng trên một provider dựng tay. Nó KHÔNG chứng minh rằng thứ
 * đọc từ ba tệp cấu hình thật cho ra đúng 744 mục có khoá bền phân biệt được —
 * mà đó mới là điều `F-PIO-004` nói dối: bảng thiếu điểm và không có dấu hiệu
 * nào cho biết đang thiếu.
 */
func TestPIO36Scenario3CatalogOver500FromRealConfigLosesNothing(t *testing.T) {
	app, _ := newTestAppWithAdmin(t)
	pio36FullCatalogConfig(t, app)
	service := pio36RuntimeService(t, app)

	// Đường KHÔNG phân trang của cùng adapter là mốc so sánh: nó và đường phân
	// trang phải nói về cùng một tập điểm, không phải hai tập gần giống nhau.
	all, err := app.programmingPointCatalog().ListPointCatalog(context.Background())
	if err != nil {
		t.Fatalf("đọc catalog qua adapter production: %v", err)
	}
	if len(all) != 744 {
		t.Fatalf("catalog dựng từ cấu hình thật có %d mục; chờ 744 (24 LOCAL + 464 VP + 256 EXT)", len(all))
	}

	expected := make(map[string]bool, len(all))
	for _, entry := range all {
		key := entry.Category + "|" + entry.DeviceID + "|" + entry.PointID
		if expected[key] {
			t.Fatalf("khoá bền %q trùng — phân trang theo khoá sẽ nuốt mất một mục", key)
		}
		expected[key] = true
	}

	// Trang nhỏ hơn nhiều so với tổng số: một lỗi cursor chỉ lộ khi phải sang
	// trang nhiều lần, còn `limit = 500` chỉ đi đúng hai trang.
	walked, pagesWithMore := pio36WalkCatalog(t, service, 100)
	if pagesWithMore != 7 {
		t.Fatalf("744 mục ở trang 100 phải có 7 trang khai `còn nữa`, nhận %d", pagesWithMore)
	}
	if len(walked) != len(all) {
		t.Fatalf("đi hết phân trang được %d mục nhưng catalog có %d", len(walked), len(all))
	}
	seen := make(map[string]bool, len(walked))
	for _, key := range walked {
		if seen[key] {
			t.Fatalf("mục %q xuất hiện hai lần khi phân trang", key)
		}
		if !expected[key] {
			t.Fatalf("phân trang sinh ra mục %q không có trong catalog", key)
		}
		seen[key] = true
	}
	for key := range expected {
		if !seen[key] {
			t.Fatalf("mục %q có trong catalog nhưng phân trang KHÔNG bao giờ trả về", key)
		}
	}
}

/* `complete` đúng = trang cuối, và CHỈ trang cuối, không còn cursor.
 *
 * FE suy "bảng đã đủ" từ đúng một tín hiệu là `nextCursor == nil`. Một trang
 * giữa mà khai hết là mất điểm im lặng; một trang cuối mà khai còn là vòng lặp
 * không bao giờ dừng.
 */
func TestPIO36Scenario3CompletenessSignalIsTruthfulOnEveryPage(t *testing.T) {
	app, _ := newTestAppWithAdmin(t)
	pio36FullCatalogConfig(t, app)
	service := pio36RuntimeService(t, app)

	cursor := ""
	remaining := 744
	for page := 0; ; page++ {
		result, err := service.ListPointCatalog(context.Background(), cursor, 250)
		if err != nil {
			t.Fatalf("trang %d: %v", page, err)
		}
		remaining -= len(result.Items)
		if remaining > 0 && result.NextCursor == nil {
			t.Fatalf("trang %d khai ĐÃ ĐỦ trong khi còn %d điểm — đúng lỗi F-PIO-004", page, remaining)
		}
		if remaining == 0 && result.NextCursor != nil {
			t.Fatalf("trang %d đã hết điểm nhưng vẫn khai còn nữa", page)
		}
		if result.NextCursor == nil {
			break
		}
		cursor = *result.NextCursor
	}
	if remaining != 0 {
		t.Fatalf("còn thừa %d điểm sau khi phân trang tự nhận là hết", remaining)
	}
}

/* ---------------------------------------------------------------------------
 * Kịch bản 4 — QUALITY LẠ KHÔNG BAO GIỜ HIỆN THÀNH GOOD (F-PIO-001)
 * ------------------------------------------------------------------------ */

/* Điểm Core mang quality rỗng/lạ/CONFIG_ERROR đi hết đường thật ra Catalog.
 *
 * `TestPointCatalogQualityNeverFabricatesGood` gọi thẳng `pointCatalogQuality`.
 * Giữa hàm đó và Catalog còn ba lớp overlay (`overlayVirtualPoints`,
 * `overlayPointMetadata`, `overlayOverrideState`) — mỗi lớp đều ghi vào
 * `PointDTO`, và đó mới là chỗ một giá trị có thể bị viết lại thành `good`.
 */
func TestPIO36Scenario4StrangeQualityNeverReachesCatalogAsGood(t *testing.T) {
	app, _ := newTestAppWithAdmin(t)
	pio36WriteConfig(t, app, configGroupIO.file, map[string]any{
		"ui": []map[string]any{
			{"ch": 1, "tag": "ui-01", "type": "0-10V"}, {"ch": 2, "tag": "ui-02", "type": "0-10V"},
			{"ch": 3, "tag": "ui-03", "type": "0-10V"}, {"ch": 4, "tag": "ui-04", "type": "0-10V"},
			{"ch": 5, "tag": "ui-05", "type": "0-10V"}, {"ch": 6, "tag": "ui-06", "type": "0-10V"},
		},
		"ao": []any{}, "do": []any{},
	})
	app.core = &pio36Core{points: []PointDTO{
		{ID: "UI-01", Kind: "UI", Value: float32(1), Quality: ""},
		{ID: "UI-02", Kind: "UI", Value: float32(2), Quality: "garbled_xyz"},
		{ID: "UI-03", Kind: "UI", Value: float32(3), Quality: "UNKNOWN"},
		{ID: "UI-04", Kind: "UI", Value: float32(4), Quality: "CONFIG_ERROR"},
		{ID: "UI-05", Kind: "UI", Value: float32(5), Quality: "STALE"},
		{ID: "UI-06", Kind: "UI", Value: float32(6), Quality: "OFFLINE"},
	}}

	entries, err := app.programmingPointCatalog().ListPointCatalog(context.Background())
	if err != nil {
		t.Fatalf("đọc catalog: %v", err)
	}
	want := map[string]string{
		"UI-01": "UNKNOWN", "UI-02": "UNKNOWN", "UI-03": "UNKNOWN",
		"UI-04": "BAD", "UI-05": "STALE", "UI-06": "OFFLINE",
	}
	for _, entry := range entries {
		expect, tracked := want[entry.PointID]
		if !tracked {
			continue
		}
		if entry.Quality == "GOOD" {
			t.Fatalf("%s ra Catalog với quality GOOD — đúng lỗi F-PIO-001", entry.PointID)
		}
		if entry.Quality != expect {
			t.Fatalf("%s quality = %q; chờ %q", entry.PointID, entry.Quality, expect)
		}
		delete(want, entry.PointID)
	}
	if len(want) != 0 {
		t.Fatalf("các điểm sau không ra tới Catalog: %v", want)
	}
}

/* VP CHƯA AI TỪNG GHI không được hiện là GOOD.
 *
 * `validateConfigVirtualPoints` KHÔNG bắt buộc khoá `value`, nên một VP tạo qua
 * đúng API sản phẩm có thể không mang giá trị nào. Bản trước bản vá đóng dấu
 * `quality: good` vô điều kiện ở `virtualPointDTO`, nên số 0 do
 * `defaultVirtualPointValue` sinh ra đi thẳng ra Point Catalog dưới nhãn GOOD:
 * người vận hành đọc một con số chưa ai ghi như một số đo tốt. Đây đúng là hình
 * dạng của `F-PIO-001` mà kịch bản 4 tồn tại để bắt.
 */
func TestPIO36Scenario4VirtualPointWithNoValueIsNotGood(t *testing.T) {
	app, _ := newTestAppWithAdmin(t)
	pio36WriteConfig(t, app, configGroupVirtualPoints.file, map[string]any{
		"items": []map[string]any{
			{"id": "VP1", "tag": "chua ai ghi", "signalType": "float", "enabled": true, "writable": true},
			{"id": "VP2", "tag": "da co gia tri", "signalType": "float", "enabled": true, "writable": true, "value": 22.5},
		},
	})
	app.core = &pio36Core{}

	entries, err := app.programmingPointCatalog().ListPointCatalog(context.Background())
	if err != nil {
		t.Fatalf("đọc catalog: %v", err)
	}
	quality := map[string]string{}
	for _, entry := range entries {
		quality[entry.PointID] = entry.Quality
	}
	if got := quality["VP1"]; got != "UNKNOWN" {
		t.Fatalf("VP chưa ai ghi có quality = %q; chờ UNKNOWN (F-PIO-001)", got)
	}
	// Vế còn lại của cùng một luật: có giá trị trong cấu hình thì GOOD là đúng.
	// Thiếu vế này thì bản vá có thể là "đổi hết thành UNKNOWN", vô dụng như nhau.
	if got := quality["VP2"]; got != "GOOD" {
		t.Fatalf("VP đã có giá trị lại ra quality = %q; chờ GOOD", got)
	}
}

/* ---------------------------------------------------------------------------
 * Kịch bản 5 — RESTART + TẮT MỘT THIẾT BỊ MODBUS (F-PIO-029)
 * ------------------------------------------------------------------------ */

// pio36FieldbusTwoDevices dựng hai thiết bị, mỗi thiết bị hai điểm. Hai thiết bị
// là bắt buộc: với một thiết bị thì "tắt thiết bị" và "xoá hết điểm" không phân
// biệt được, mà chúng là hai câu trả lời khác nhau.
func pio36FieldbusTwoDevices(t *testing.T, app *App, secondEnabled bool) {
	t.Helper()
	pio36WriteConfig(t, app, configGroupFieldbus.file, map[string]any{
		"devices": []map[string]any{
			{"device_id": "bus-1-slave-2", "enabled": true},
			{"device_id": "bus-1-slave-3", "enabled": secondEnabled},
		},
		"points": []map[string]any{
			{"point_id": "AHU_SAT", "device_id": "bus-1-slave-2", "enabled": true,
				"register_type": "holding_register", "address": 10, "data_type": "uint16", "read_write": "read"},
			{"point_id": "AHU_CMD", "device_id": "bus-1-slave-2", "enabled": true,
				"register_type": "holding_register", "address": 11, "data_type": "uint16", "read_write": "read_write"},
			{"point_id": "VFD_HZ", "device_id": "bus-1-slave-3", "enabled": true,
				"register_type": "holding_register", "address": 20, "data_type": "uint16", "read_write": "read"},
			{"point_id": "VFD_CMD", "device_id": "bus-1-slave-3", "enabled": true,
				"register_type": "holding_register", "address": 21, "data_type": "uint16", "read_write": "read_write"},
		},
	})
}

func pio36Slots(t *testing.T, app *App) programmingapplication.ModbusSlotSnapshot {
	t.Helper()
	snapshot, err := app.programmingModbusSlots().ResolveModbusSlots(context.Background())
	if err != nil {
		t.Fatalf("phân giải slot qua adapter production: %v", err)
	}
	return snapshot
}

/* RESTART = một tiến trình web-api MỚI đọc lại CÙNG thư mục cấu hình.
 *
 * `App` không giữ cache bố cục EXT, nên chỗ duy nhất một lần restart có thể đổi
 * nghĩa binding là bản thân phép phân giải. Dựng `App` thứ hai trên cùng
 * `ConfigDir` tái lập đúng điều đó — và binding đóng dấu trước restart phải qua
 * được authority sau restart, với cùng con số slot.
 */
func TestPIO36Scenario5BindingSurvivesRestartUnchanged(t *testing.T) {
	before, _ := newTestAppWithAdmin(t)
	pio36FieldbusTwoDevices(t, before, true)
	beforeSnapshot := pio36Slots(t, before)

	binding, found := beforeSnapshot.Lookup("bus-1-slave-3", "VFD_HZ")
	if !found {
		t.Fatal("không tra được điểm để đóng dấu binding")
	}

	after := &App{cfg: Config{ConfigDir: before.cfg.ConfigDir}}
	afterSnapshot := pio36Slots(t, after)

	if reason := afterSnapshot.VerifyBinding(binding); reason != "" {
		t.Fatalf("binding đóng dấu trước restart bị chặn sau restart: %s", reason)
	}
	current, found := afterSnapshot.Lookup("bus-1-slave-3", "VFD_HZ")
	if !found {
		t.Fatal("điểm biến mất sau restart dù cấu hình không đổi")
	}
	if current.ExtIndex != binding.ExtIndex {
		t.Fatalf("slot đổi qua restart: trước %d, sau %d", binding.ExtIndex, current.ExtIndex)
	}
}

/* TẮT NGUỒN một thiết bị Modbus KHÔNG được đổi nghĩa binding.
 *
 * Thiết bị mất liên lạc là sự kiện RUNTIME: cấu hình không đổi, nên bố cục EXT
 * không đổi và binding vẫn trỏ đúng thanh ghi cũ. Điều PHẢI đổi là chất lượng —
 * `OFFLINE`, không phải `GOOD` và cũng không phải `BAD` (trả lời sai khác hẳn
 * không trả lời). Bỏ điểm khỏi Catalog cũng là sai: điểm vẫn tồn tại, chỉ là
 * chưa đọc được.
 */
func TestPIO36Scenario5DeviceGoingOfflineKeepsBindingAndAdmitsOffline(t *testing.T) {
	app, _ := newTestAppWithAdmin(t)
	pio36FieldbusTwoDevices(t, app, true)
	binding, found := pio36Slots(t, app).Lookup("bus-1-slave-3", "VFD_HZ")
	if !found {
		t.Fatal("không tra được điểm để đóng dấu binding")
	}

	// Thiết bị 3 mất điện: Core vẫn chở điểm ra, quality OFFLINE.
	app.core = &pio36Core{points: []PointDTO{
		{ID: "AHU_SAT", Kind: "modbus_rtu", BusID: 1, SlaveAddr: 2, Value: float32(21), Quality: "GOOD"},
		{ID: "VFD_HZ", Kind: "modbus_rtu", BusID: 1, SlaveAddr: 3, Value: nil, Quality: "OFFLINE"},
	}}

	if reason := pio36Slots(t, app).VerifyBinding(binding); reason != "" {
		t.Fatalf("thiết bị mất liên lạc mà binding bị chặn: %s — mất liên lạc không phải đổi cấu hình (%s)",
			reason, "F-PIO-029")
	}
	entries, err := app.programmingPointCatalog().ListPointCatalog(context.Background())
	if err != nil {
		t.Fatalf("đọc catalog: %v", err)
	}
	var offline *programmingapplication.PointCatalogEntry
	for index := range entries {
		if entries[index].PointID == "VFD_HZ" {
			offline = &entries[index]
		}
	}
	if offline == nil {
		t.Fatal("điểm của thiết bị mất liên lạc biến mất khỏi Catalog")
	}
	if offline.Quality != "OFFLINE" {
		t.Fatalf("quality = %q; thiết bị mất liên lạc phải ra OFFLINE, không được gộp vào BAD hay GOOD",
			offline.Quality)
	}
	if offline.ExtIndex != binding.ExtIndex {
		t.Fatalf("slot của điểm mất liên lạc đổi từ %d sang %d", binding.ExtIndex, offline.ExtIndex)
	}
}

/* VÔ HIỆU HOÁ một thiết bị trong CẤU HÌNH là chuyện khác hẳn: điểm của nó không
 * còn trong bố cục đang chạy, nên binding cũ phải bị CHẶN. Cấm im lặng chuyển
 * slot sang điểm còn lại — slot đó nay là thanh ghi của thiết bị khác.
 */
func TestPIO36Scenario5DisablingDeviceBlocksBindingInsteadOfSilentlyRepointing(t *testing.T) {
	app, _ := newTestAppWithAdmin(t)
	pio36FieldbusTwoDevices(t, app, true)
	binding, found := pio36Slots(t, app).Lookup("bus-1-slave-3", "VFD_HZ")
	if !found {
		t.Fatal("không tra được điểm để đóng dấu binding")
	}

	pio36FieldbusTwoDevices(t, app, false)
	after := pio36Slots(t, app)

	reason := after.VerifyBinding(binding)
	if reason == "" {
		t.Fatal("thiết bị đã bị vô hiệu hoá mà binding vẫn được chấp nhận")
	}
	if _, stillThere := after.Lookup("bus-1-slave-3", "VFD_HZ"); stillThere {
		t.Fatal("điểm của thiết bị đã vô hiệu hoá vẫn còn trong bố cục")
	}
	// Slot cũ không được lặng lẽ thuộc về điểm khác dưới cùng danh tính.
	for _, slot := range after.Slots {
		if slot.ExtIndex == binding.ExtIndex && slot.PointID != binding.PointID {
			t.Fatalf("slot %d nay thuộc %s#%s nhưng binding cũ không bị chặn rõ ràng",
				slot.ExtIndex, slot.DeviceID, slot.PointID)
		}
	}
}

/* ---------------------------------------------------------------------------
 * Kịch bản 6 — NHIỀU SKU CAPABILITY (F-PIO-008, F-PIO-009)
 * ------------------------------------------------------------------------ */

/* Ma trận SKU: mỗi bản đồ năng lực cho ra ĐÚNG số kênh của nó.
 *
 * Các test sẵn có kiểm từng khối một (`TestOptionalDIRequiresPositiveProof`,
 * `TestMandatoryBlockAbsentWhenBoardDeniesIt`…). Cái chưa có là bảng đối chiếu
 * TRỌN VẸN theo SKU: `F-PIO-008`/`F-PIO-009` sinh ra vì cùng một dữ kiện được
 * viết lại ở bốn nơi, và một bảng như thế này là chỗ duy nhất một SKU mới bị
 * bắt phải khai đủ bốn khối cùng lúc.
 */
func TestPIO36Scenario6ChannelCountsFollowEachSKU(t *testing.T) {
	cases := []struct {
		name  string
		cap   capabilities.BoardCap
		count map[string]int
	}{
		{
			name:  "SKU đầy đủ UI16+DI8+AO4+DO4",
			cap:   capabilities.BoardCap{Known: true, Map: capabilities.BoardCapUI16 | capabilities.BoardCapDI8 | capabilities.BoardCapAO4 | capabilities.BoardCapDO4},
			count: map[string]int{"UI": 16, "DI": 8, "AO": 4, "DO": 4},
		},
		{
			name:  "SKU không có module DI",
			cap:   capabilities.BoardCap{Known: true, Map: capabilities.BoardCapUI16 | capabilities.BoardCapAO4 | capabilities.BoardCapDO4},
			count: map[string]int{"UI": 16, "DI": 0, "AO": 4, "DO": 4},
		},
		{
			name:  "SKU chỉ vào, không ra",
			cap:   capabilities.BoardCap{Known: true, Map: capabilities.BoardCapUI16 | capabilities.BoardCapDI8},
			count: map[string]int{"UI": 16, "DI": 8, "AO": 0, "DO": 0},
		},
		{
			/* CHƯA HỎI ĐƯỢC không phải "không có" — và hai loại khối trả lời
			 * KHÁC NHAU, đúng theo bất đối xứng có chủ ý của `Build`:
			 *   - khối BẮT BUỘC (UI/AO/DO) vẫn công bố theo sức chứa ABI, đánh
			 *     dấu `unknown`, vì giấu chúng đi làm trang cấu hình trống rỗng
			 *     mỗi lần iobus chưa kịp handshake;
			 *   - khối TUỲ CHỌN (DI) đòi BẰNG CHỨNG DƯƠNG nên vẫn là 0.
			 * Gộp hai loại vào một quy tắc là cách một trong hai chế độ hỏng
			 * quay lại mà không ai thấy. */
			name:  "chưa handshake được với MCU",
			cap:   capabilities.BoardCap{Known: false},
			count: map[string]int{"UI": 16, "DI": 0, "AO": 4, "DO": 4},
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			document := capabilities.Build(testCase.cap)
			for kind, want := range testCase.count {
				if got := document.Count(kind); got != want {
					t.Fatalf("khối %s có %d kênh; chờ %d", kind, got, want)
				}
			}
			for _, block := range document.Blocks {
				/* `presence` phải nói ra CƠ SỞ của con số: một khối công bố 16
				 * kênh vì ABI dành sẵn 16 ô rất khác một khối công bố 16 kênh vì
				 * bo đã xác nhận. `unknown` là giá trị giữ hai ca đó tách nhau. */
				if !testCase.cap.Known && block.Count > 0 && block.Presence != capabilities.PresenceUnknown {
					t.Fatalf("khối %s công bố %d kênh với presence=%q dù chưa hỏi được bo",
						block.Kind, block.Count, block.Presence)
				}
				if block.Count > block.ABICapacity {
					t.Fatalf("khối %s công bố %d kênh vượt sức chứa ABI %d",
						block.Kind, block.Count, block.ABICapacity)
				}
				if len(block.Channels) != block.Count {
					t.Fatalf("khối %s khai count=%d nhưng liệt kê %d kênh",
						block.Kind, block.Count, len(block.Channels))
				}
			}
		})
	}
}

/* Cùng một mode UI, ba SKU, ba câu trả lời KHÁC NHAU.
 *
 * `PT100` là mode đòi mạch nhiệt trở (`ISS-PIO-12`). Ba mức phải phân biệt được:
 * `confirmed` khi bo khai có bit RTD, `withheld` khi bo khai KHÔNG có, và cũng
 * `withheld` khi CHƯA HỎI ĐƯỢC — nhưng với LÝ DO khác hẳn. Gộp hai lý do đó lại
 * là cách "chưa biết" bị đọc thành "không có": người vận hành nhìn thấy mode bị
 * chặn mà không biết nên đi kiểm bo hay đi kiểm iobus.
 */
func TestPIO36Scenario6ModeAvailabilityDiffersPerSKU(t *testing.T) {
	uiMode := func(cap capabilities.BoardCap, id string) (capabilities.Mode, bool) {
		for _, block := range capabilities.Build(cap).Blocks {
			if block.Kind != "UI" || len(block.Channels) == 0 {
				continue
			}
			for _, mode := range block.Channels[0].Modes {
				if mode.ID == id {
					return mode, true
				}
			}
		}
		return capabilities.Mode{}, false
	}

	cases := []struct {
		name string
		cap  capabilities.BoardCap
		want string
	}{
		{"bo khai có mạch RTD", capabilities.BoardCap{Known: true,
			Map: capabilities.BoardCapUI16 | capabilities.BoardCapRTD}, capabilities.AvailabilityConfirmed},
		{"bo khai KHÔNG có mạch RTD", capabilities.BoardCap{Known: true,
			Map: capabilities.BoardCapUI16}, capabilities.AvailabilityWithheld},
		{"chưa hỏi được BOARD_CAP_MAP", capabilities.BoardCap{Known: false},
			capabilities.AvailabilityWithheld},
	}
	reasons := map[string]string{}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			mode, found := uiMode(testCase.cap, "PT100")
			if !found {
				t.Fatal("khối UI không công bố mode PT100")
			}
			if mode.Availability != testCase.want {
				t.Fatalf("PT100 = %q; chờ %q", mode.Availability, testCase.want)
			}
			if testCase.want == capabilities.AvailabilityWithheld && mode.Reason == "" {
				t.Fatal("mode bị chặn mà không nói ra vì sao")
			}
			reasons[testCase.name] = mode.Reason
		})
	}
	// Hai ca cùng `withheld` nhưng phải nói ra hai lý do khác nhau.
	if reasons["bo khai KHÔNG có mạch RTD"] == reasons["chưa hỏi được BOARD_CAP_MAP"] {
		t.Fatalf("\"bo không có mạch\" và \"chưa hỏi được\" dùng chung một lý do %q",
			reasons["bo khai KHÔNG có mạch RTD"])
	}
}

/* ---------------------------------------------------------------------------
 * Kịch bản 7 — APPLY LỖI GIỮ TRỌN CẤU HÌNH HỢP LỆ TRƯỚC ĐÓ (F-PIO-013)
 * ------------------------------------------------------------------------ */

/* `io_config.conf` và `io_safe_state.conf` được ghi như MỘT giao dịch, nên phép
 * phục hồi cũng phải là một giao dịch.
 *
 * `TestActivationMismatchRollsBackAndNamesTheChannel` đã chứng minh tệp `io`
 * trở lại nội dung cũ. Nó KHÔNG kiểm `io_safe_state.conf`. Một lần rollback đi
 * được nửa đường sẽ để bo chạy trạng thái an toàn của một cấu hình VỪA BỊ TỪ
 * CHỐI — đúng loại lệch mà `F-PIO-013` nói tới, và là thứ chỉ lộ ra khi ngõ ra
 * rơi vào safe state.
 */
func TestPIO36Scenario7FailedApplyRestoresBothFilesOfTheBundle(t *testing.T) {
	core := aoModeCore{modes: []uint8{0, 0, 0, 0}}
	app, token := newTestAppWithRole(t, RoleAdmin, core)
	app.reloadDispatcher = func(string) (bool, []string) { return true, nil }

	ioPath := filepath.Join(app.cfg.ConfigDir, configGroupIO.file)
	safePath := filepath.Join(app.cfg.ConfigDir, configGroupSafeState.file)
	if err := os.WriteFile(ioPath, []byte(`{"ui":[],"ao":[],"do":[]}`+"\n"), 0o644); err != nil {
		t.Fatalf("dựng io_config cũ: %v", err)
	}
	if err := os.WriteFile(safePath, []byte(`{"ao":[{"ch":1,"safe":0}],"do":[]}`+"\n"), 0o644); err != nil {
		t.Fatalf("dựng io_safe_state cũ: %v", err)
	}
	beforeIO, err := os.ReadFile(ioPath)
	if err != nil {
		t.Fatalf("đọc io_config cũ: %v", err)
	}
	beforeSafe, err := os.ReadFile(safePath)
	if err != nil {
		t.Fatalf("đọc io_safe_state cũ: %v", err)
	}

	req := newAuthRequest(http.MethodPut, "/api/v1/system/config/io", aoBody(t, "4-20mA"), token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusConflict {
		t.Fatalf("status = %d body=%s; read-back lệch phải là 409", w.Code, w.Body.String())
	}

	afterIO, err := os.ReadFile(ioPath)
	if err != nil {
		t.Fatalf("đọc lại io_config: %v", err)
	}
	if string(afterIO) != string(beforeIO) {
		t.Fatalf("io_config KHÔNG trở lại bản cũ\ntrước=%s\nsau=%s", beforeIO, afterIO)
	}
	afterSafe, err := os.ReadFile(safePath)
	if err != nil {
		t.Fatalf("đọc lại io_safe_state: %v", err)
	}
	if string(afterSafe) != string(beforeSafe) {
		t.Fatalf("io_safe_state KHÔNG trở lại bản cũ — rollback đi nửa đường\ntrước=%s\nsau=%s",
			beforeSafe, afterSafe)
	}
}
