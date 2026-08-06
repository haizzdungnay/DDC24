package modbusrtu

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// Hợp đồng `fieldbus.conf` giữa BE (bên GHI) và iobus (bên ĐỌC).
//
// VÌ SAO CẦN TEST NÀY
//
// Sự cố bo Foxlinx 2026-08-06: `buses[]` do BE ghi ra KHÔNG có bus nào được
// iobus nhận. Hai bên đặt tên khoá khác nhau cho cùng một khái niệm —
// `bus_id`/`port`/`display_name`/`stop_bit` bên BE, `id`/`device`/`name`/`stop`
// bên iobus — và `parse_bus` coi `id` với `device` là BẮT BUỘC nên trả về false
// và loại sạch mọi phần tử.
//
// Hậu quả không phải một thông báo lỗi mà là một sự IM LẶNG: `buses[]` rỗng,
// iobus rơi về khối `rs485{}` cũ và chạy đúng một dây. Bus 2 không bao giờ lên.
// Nhìn từ systemd thì service `active`, không có lỗi nào.
//
// Cả hai phía đều CÓ test và đều XANH, vì mỗi bên tự dựng file thử bằng đúng bộ
// tên của mình. Không có test nào chạy trên file DO PHÍA KIA SINH RA — và đó
// chính là chỗ hợp đồng nằm. Test này lấp đúng khoảng trống đó bằng cách đọc mã
// nguồn C++ thật để biết iobus thực sự đọc những khoá nào.

// cppBusKeys trả về tập khoá mà `parse_bus` trong iobus thật sự đọc.
func cppBusKeys(t *testing.T) map[string]bool {
	t.Helper()
	root := repoRoot(t)
	path := filepath.Join(root, "apps", "iobus", "adapters", "modbus_rtu", "fieldbus_config.cpp")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Skipf("không đọc được %s: %v", path, err)
	}
	source := string(data)

	start := strings.Index(source, "static bool parse_bus(")
	if start < 0 {
		t.Fatalf("không tìm thấy parse_bus trong %s", path)
	}
	// Cắt tới hàm kế tiếp: đủ để bao trọn thân hàm mà không cần đếm ngoặc.
	rest := source[start:]
	if end := strings.Index(rest[1:], "\nstatic "); end >= 0 {
		rest = rest[:end+1]
	}

	keys := map[string]bool{}
	re := regexp.MustCompile(`jget_(?:str|int|bool)\s*\(\s*obj\s*,\s*"([^"]+)"`)
	for _, match := range re.FindAllStringSubmatch(rest, -1) {
		keys[match[1]] = true
	}
	if len(keys) == 0 {
		t.Fatal("không trích được khoá nào từ parse_bus — regex đã lạc hậu so với mã nguồn")
	}
	return keys
}

// busKeysWrittenByBackend là các khoá thực sự nằm trong `buses[]` của file mà
// BE ghi xuống đĩa, lấy bằng chính đường ghi thật chứ không liệt kê bằng tay.
func busKeysWrittenByBackend(t *testing.T) []string {
	t.Helper()
	cfg := Config{Buses: []Bus{NormalizeBus(Bus{
		BusID: "rs485-2", Port: "/dev/rs485-2", Baud: 19200, Parity: "N",
		StopBit: 2, OfflineProbeMs: 5000, Enabled: true, Direction: "rts",
		RtsDelayBeforeUs: 150, RtsDelayAfterUs: 250,
	})}}
	built := buildFieldbusBlocks(cfg, "/data/config")
	raw, err := json.Marshal(built)
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct {
		Buses []map[string]json.RawMessage `json:"buses"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if len(decoded.Buses) != 1 {
		t.Fatalf("chờ 1 bus trong file, có %d", len(decoded.Buses))
	}
	out := make([]string, 0, len(decoded.Buses[0]))
	for key := range decoded.Buses[0] {
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}

// Mọi khoá BE ghi ra phải hoặc được iobus đọc, hoặc được khai báo tường minh là
// chỉ dùng ở BE. Danh sách miễn trừ phải NGẮN và có lý do — nó là chỗ duy nhất
// hai bên được phép khác nhau.
func TestMoiKhoaBusBeGhiDeuDuocIobusDocHoacMienTruCoLyDo(t *testing.T) {
	backendOnly := map[string]string{
		// iobus mở cổng bằng modbus_new_rtu(..., 8, stop): 8 bit là viết cứng.
		// Validator BE từ chối giá trị khác 8 nên hai bên không thể lệch nhau.
		"data_bits": "iobus viết cứng 8 bit dữ liệu; validator BE chặn giá trị khác",
	}
	cppKeys := cppBusKeys(t)
	for _, key := range busKeysWrittenByBackend(t) {
		if cppKeys[key] {
			continue
		}
		if reason, exempt := backendOnly[key]; exempt {
			t.Logf("khoá %q chỉ dùng ở BE: %s", key, reason)
			continue
		}
		t.Errorf("BE ghi khoá %q vào buses[] nhưng parse_bus của iobus không đọc khoá này; "+
			"iobus sẽ bỏ qua giá trị người dùng đặt mà không báo gì", key)
	}
}

// Hai khoá BẮT BUỘC: thiếu một trong hai thì `parse_bus` loại cả phần tử, và
// `buses[]` rỗng là kiểu hỏng im lặng đã xảy ra trên bo.
func TestKhoaBatBuocCuaIobusLuonCoTrongFileBeGhi(t *testing.T) {
	written := map[string]bool{}
	for _, key := range busKeysWrittenByBackend(t) {
		written[key] = true
	}
	// iobus nhận `id` HOẶC `bus_id` cho định danh, `device` HOẶC `port` cho cổng.
	if !written["id"] && !written["bus_id"] {
		t.Error("file BE ghi không có định danh bus (`id` hoặc `bus_id`) ⇒ iobus loại toàn bộ bus")
	}
	if !written["device"] && !written["port"] {
		t.Error("file BE ghi không có đường dẫn cổng (`device` hoặc `port`) ⇒ iobus loại toàn bộ bus")
	}
}

// `direction` không có giao diện ở BE, nên rất dễ bị xoá mất khi cấu hình đi
// qua vòng unmarshal → marshal. Mất nó là cổng lặng lẽ quay về mặc định của
// driver — đúng thứ G-D đã bỏ công loại trừ.
func TestApDungCauHinhKhongXoaChieuDieuHuongCuaBus(t *testing.T) {
	onDisk := []byte(`{"buses":[{"bus_id":"rs485-1","port":"/dev/rs485-1","baud":19200,
	  "parity":"N","stop_bit":1,"data_bits":8,"offline_probe_ms":5000,"enabled":true,
	  "direction":"rts","rts_delay_before_us":150,"rts_delay_after_us":250}]}`)

	var cfg Config
	if err := json.Unmarshal(onDisk, &cfg); err != nil {
		t.Fatal(err)
	}
	roundTripped, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	var back Config
	if err := json.Unmarshal(roundTripped, &back); err != nil {
		t.Fatal(err)
	}
	if len(back.Buses) != 1 {
		t.Fatalf("mất bus sau round-trip: %d", len(back.Buses))
	}
	if back.Buses[0].Direction != "rts" {
		t.Errorf("direction bị mất sau round-trip: %q", back.Buses[0].Direction)
	}
	if back.Buses[0].RtsDelayBeforeUs != 150 || back.Buses[0].RtsDelayAfterUs != 250 {
		t.Errorf("độ trễ RTS bị mất: before=%d after=%d",
			back.Buses[0].RtsDelayBeforeUs, back.Buses[0].RtsDelayAfterUs)
	}
}

// Chiều ngược lại của cùng một hợp đồng: file viết theo bộ tên RÚT GỌN của
// iobus (hoặc do người sửa tay trên bo) phải đọc được ở BE.
//
// Đây là thứ chặn đúng thao tác người dùng báo lỗi. File trên bo Foxlinx ngày
// 2026-08-06 dùng bộ rút gọn, BE nạp thành công nhưng ra `bus_id: ""`, và mọi
// yêu cầu — kể cả POST /modbus/devices, vốn không đụng gì tới bus — đều bị
// validator từ chối với `buses[0].bus_id: bắt buộc`. Không có đường sửa từ
// giao diện, vì chính giao diện đó cũng phải đi qua cùng validator.
func TestDocDuocBusVietTheoTuVungRutGonCuaIobus(t *testing.T) {
	onDisk := []byte(`{"buses":[{"id":2,"name":"RS485-2","device":"/dev/rs485-2",
	  "baud":38400,"parity":"E","stop":2,"enabled":1}]}`)

	var cfg Config
	if err := json.Unmarshal(onDisk, &cfg); err != nil {
		t.Fatal(err)
	}
	buses, _ := MigrateBuses(cfg)
	if len(buses) != 1 {
		t.Fatalf("chờ 1 bus, có %d", len(buses))
	}
	bus := buses[0]
	if bus.BusID != "rs485-2" {
		t.Errorf("bus_id = %q, chờ \"rs485-2\" — rỗng sẽ làm validator chặn MỌI thao tác cấu hình", bus.BusID)
	}
	if bus.Port != "/dev/rs485-2" {
		t.Errorf("port = %q, chờ \"/dev/rs485-2\"", bus.Port)
	}
	if bus.DisplayName != "RS485-2" {
		t.Errorf("display_name = %q", bus.DisplayName)
	}
	if bus.StopBit != 2 {
		t.Errorf("stop_bit = %d, chờ 2", bus.StopBit)
	}
	if bus.DataBits != 8 {
		t.Errorf("data_bits = %d, chờ 8 — 0 làm giao diện hiện khung \"38400E02\"", bus.DataBits)
	}
	if !bool(bus.Enabled) {
		t.Error("enabled dạng số 1 phải hiểu là bật")
	}
	if bus.NumericID() != 2 {
		t.Errorf("NumericID = %d, chờ 2 — sai số hiệu sẽ dồn thiết bị sang nhầm dây", bus.NumericID())
	}
}

// Bộ tên chuẩn phải luôn THẮNG bộ rút gọn khi cả hai cùng có mặt: chỉ bộ chuẩn
// là thứ BE ghi ra, nên nó phản ánh thao tác gần nhất của người dùng.
func TestTuVungChuanThangTuVungRutGonKhiCaHaiCungCo(t *testing.T) {
	var cfg Config
	raw := []byte(`{"buses":[{"bus_id":"rs485-1","port":"/dev/rs485-1","stop_bit":1,
	  "id":2,"device":"/dev/rs485-2","stop":2}]}`)
	if err := json.Unmarshal(raw, &cfg); err != nil {
		t.Fatal(err)
	}
	bus := cfg.Buses[0]
	if bus.BusID != "rs485-1" || bus.Port != "/dev/rs485-1" || bus.StopBit != 1 {
		t.Errorf("bộ rút gọn đã ghi đè bộ chuẩn: bus_id=%q port=%q stop_bit=%d",
			bus.BusID, bus.Port, bus.StopBit)
	}
}

// Sự cố gốc: một file có `"enabled": 1` làm CẢ tính năng Modbus RTU chết, kể cả
// đường sửa lại chính chỗ hỏng. Nới lỏng ở đầu đọc là cách thoát duy nhất mà
// người vận hành có, vì họ không sửa được file từ giao diện đang trắng.
func TestDocDuocEnabledDangSoLanDangBoolean(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want bool
	}{
		{"boolean true", `true`, true},
		{"boolean false", `false`, false},
		{"số 1 — dạng iobus vẫn đọc được từ trước", `1`, true},
		{"số 0", `0`, false},
		{"chuỗi true — file sửa tay", `"true"`, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var cfg Config
			raw := `{"buses":[{"bus_id":"rs485-1","port":"/dev/rs485-1","enabled":` + tc.raw + `}]}`
			if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
				t.Fatalf("từ chối cả file chỉ vì một trường enabled: %v", err)
			}
			if got := bool(cfg.Buses[0].Enabled); got != tc.want {
				t.Errorf("enabled = %v, chờ %v", got, tc.want)
			}
		})
	}
}

// Chiều GHI phải luôn là boolean chuẩn: nới lỏng đầu đọc không có nghĩa là để
// file trên đĩa muốn kiểu gì cũng được.
func TestGhiRaLuonLaBooleanChuanJSON(t *testing.T) {
	raw, err := json.Marshal(Bus{BusID: "rs485-1", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"enabled":true`) {
		t.Errorf("chờ `\"enabled\":true` trong file ghi ra, có: %s", raw)
	}
}

// Giá trị vô nghĩa vẫn phải bị từ chối — nếu không, đầu đọc dễ dãi sẽ biến một
// lỗi gõ phím thành "bus đang tắt" mà không ai biết.
func TestEnabledVoNghiaVanBiTuChoi(t *testing.T) {
	var cfg Config
	err := json.Unmarshal([]byte(`{"buses":[{"bus_id":"rs485-1","enabled":"bật"}]}`), &cfg)
	if err == nil {
		t.Error("chờ lỗi cho giá trị enabled vô nghĩa, nhưng đã chấp nhận")
	}
}
