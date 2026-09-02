package app

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

/* `ISS-PIO-31` — adapter phải đọc CHÍNH cấu hình fieldbus và phát bố cục
 * 1-based khớp thứ tự cấp phát của `iobus`.
 *
 * Test này khoá seam 0-based ↔ 1-based ở ĐẦU BE: allocator `iobus` đếm từ 0,
 * artifact/io_map kiểm `>= 1`. Phát thẳng chỉ số thô sẽ lệch đúng một thanh ghi
 * — hợp lệ với mọi phép kiểm hiện có, và sai ở đúng chỗ không ai nhìn.
 */
func TestProgrammingModbusSlotsPublishesOneBasedLayout(t *testing.T) {
	dir := t.TempDir()
	config := map[string]any{
		"rs485":           map[string]any{},
		"poll_default_ms": 1000,
		"slaves":          []any{},
		"devices": []map[string]any{
			{"device_id": "bus-1-slave-2", "enabled": true},
			{"device_id": "bus-1-slave-9", "enabled": false},
		},
		"points": []map[string]any{
			{"point_id": "PUMP_CMD", "device_id": "bus-1-slave-2", "enabled": true,
				"register_type": "holding_register", "data_type": "uint16", "read_write": "read_write"},
			{"point_id": "AAA_FLOW", "device_id": "bus-1-slave-2", "enabled": true,
				"register_type": "holding_register", "data_type": "uint16", "read_write": "read"},
			{"point_id": "OFF_POINT", "device_id": "bus-1-slave-2", "enabled": false,
				"register_type": "holding_register", "data_type": "uint16", "read_write": "read"},
			{"point_id": "HIDDEN", "device_id": "bus-1-slave-9", "enabled": true,
				"register_type": "holding_register", "data_type": "uint16", "read_write": "read"},
		},
	}
	data, err := json.Marshal(config)
	if err != nil {
		t.Fatalf("marshal cấu hình: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "fieldbus.conf"), data, 0o600); err != nil {
		t.Fatalf("ghi fieldbus.conf: %v", err)
	}

	app := &App{cfg: Config{ConfigDir: dir}}
	snapshot, err := app.programmingModbusSlots().ResolveModbusSlots(context.Background())
	if err != nil {
		t.Fatalf("phân giải slot: %v", err)
	}

	// `BuildProfile` sắp theo `PointID`, nên AAA_FLOW đứng trước PUMP_CMD.
	// Điểm tắt và thiết bị tắt không chiếm slot.
	if len(snapshot.Slots) != 2 {
		t.Fatalf("chỉ điểm đang bật của thiết bị đang bật mới có slot, nhận %+v", snapshot.Slots)
	}
	first, ok := snapshot.Lookup("bus-1-slave-2", "AAA_FLOW")
	if !ok || first.ExtIndex != 1 {
		t.Fatalf("slot đầu tiên phải là 1 (quy ước artifact), nhận %+v", first)
	}
	second, ok := snapshot.Lookup("bus-1-slave-2", "PUMP_CMD")
	if !ok || second.ExtIndex != 2 {
		t.Fatalf("slot thứ hai phải là 2, nhận %+v", second)
	}
	if _, ok := snapshot.Lookup("bus-1-slave-9", "HIDDEN"); ok {
		t.Fatal("điểm của thiết bị đã tắt không được có slot")
	}
	if _, ok := snapshot.Lookup("bus-1-slave-2", "OFF_POINT"); ok {
		t.Fatal("điểm đã tắt không được có slot")
	}
}
